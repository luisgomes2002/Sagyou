import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock ElectronStorage before importing the store (same pattern as kanban.test.ts)
vi.mock('../../services/ElectronStorage', () => {
  return {
    ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
      this.load = vi.fn().mockResolvedValue({
        projects: [],
        tasks: [],
        sprints: [],
        tombstones: [],
        notes: [],
        goals: [],
        habits: [],
        lists: []
      })
      this.save = vi.fn().mockResolvedValue(undefined)
      this.exportBackup = vi.fn().mockResolvedValue({ success: true })
      this.importBackup = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.importAIJson = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.loadConversations = vi.fn().mockResolvedValue([])
      this.saveConversations = vi.fn().mockResolvedValue(undefined)
    })
  }
})

import { useKanbanStore } from '../../store/kanban'
import {
  runTool,
  isWriteTool,
  TOOL_DEFS,
  describeToolCall,
  describeToolActivity
} from '../../ai/tools'
import { PROJECT_COLORS, NOTE_COLORS } from '../../types'

function resetStore(): void {
  useKanbanStore.setState({
    projects: [],
    tasks: [],
    sprints: [],
    tombstones: [],
    notes: [],
    goals: [],
    habits: [],
    lists: [],
    files: [],
    activeProjectId: null,
    sprintFilter: null,
    activeTimer: null,
    isLoaded: false
  })
}

const st = (): ReturnType<typeof useKanbanStore.getState> => useKanbanStore.getState()
const call = async (name: string, args: Record<string, unknown>): Promise<{ [k: string]: unknown }> =>
  JSON.parse(await runTool(name, args))

// ── concluir_task ──────────────────────────────────────────────────────────────

describe('concluir_task', () => {
  beforeEach(resetStore)

  it('moves the task to Done and stops the running timer', async () => {
    const pid = st().createProject('P')
    const backlog = st().projects[0].columns[0]
    const tid = st().createTask({ projectId: pid, columnId: backlog.id, title: 'T' })

    st().startTimer(tid)
    expect(st().activeTimer?.taskId).toBe(tid)

    const res = await call('concluir_task', { taskId: tid })
    expect(res.ok).toBe(true)

    const task = st().tasks.find((t) => t.id === tid)!
    const doneCol = st().projects[0].columns.find((c) => c.name === 'Done')!
    expect(task.columnId).toBe(doneCol.id)
    expect(task.completedAt).toBeTruthy()
    expect(st().activeTimer).toBeNull()
  })

  it('finds the task by exact title (case-insensitive)', async () => {
    const pid = st().createProject('P')
    const backlog = st().projects[0].columns[0]
    st().createTask({ projectId: pid, columnId: backlog.id, title: 'Fix bug' })

    const res = await call('concluir_task', { titulo: 'fix bug' })
    expect(res.ok).toBe(true)
    expect(st().tasks[0].completedAt).toBeTruthy()
  })

  it('returns an error when the task is not found', async () => {
    st().createProject('P')
    expect((await call('concluir_task', { taskId: 'nope' })).error).toBeTruthy()
  })
})

// ── code tools (listar_arquivos / ler_arquivo / buscar_no_codigo) ────────────
//
// These reach the disk through window.electronAPI.ai.code.*, which the main
// process implements (and code-files.test.ts covers for real). Here the bridge
// is stubbed: what's under test is how the tools fan out across the project's
// selected code roots and what they do when a path is ambiguous.

interface CodeApi {
  list: ReturnType<typeof vi.fn>
  read: ReturnType<typeof vi.fn>
  search: ReturnType<typeof vi.fn>
}
interface AgentApi {
  run: ReturnType<typeof vi.fn>
}

function installCodeApi(): { code: CodeApi; codeAgent: AgentApi } {
  const code: CodeApi = {
    list: vi.fn(async () => ({ files: [], truncated: false })),
    read: vi.fn(async () => ({ content: '', truncated: false })),
    search: vi.fn(async () => ({ matches: [], truncated: false }))
  }
  const codeAgent: AgentApi = { run: vi.fn(async () => ({ success: true })) }
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { ai: { code, codeAgent } }
  return { code, codeAgent }
}

/** A project with `n` code paths, all selected. Returns their ids. */
function projectWithRoots(...labels: string[]): { projectId: string; ids: string[] } {
  const projectId = st().createProject('P')
  const ids = labels.map((label) => st().addCodePath(projectId, `/src/${label}`, label))
  for (const id of ids) {
    const selected = st().projects.find((p) => p.id === projectId)?.activeCodePathIds ?? []
    if (!selected.includes(id)) st().toggleCodePath(projectId, id)
  }
  return { projectId, ids }
}

describe('code tools — root resolution', () => {
  let api: ReturnType<typeof installCodeApi>
  beforeEach(() => {
    resetStore()
    api = installCodeApi()
  })

  it('refuses when the project has no code path selected', async () => {
    st().createProject('P')
    for (const tool of ['listar_arquivos', 'ler_arquivo', 'buscar_no_codigo']) {
      const res = await call(tool, { caminho: 'a.ts', termo: 'x' })
      expect(res.error).toBeTruthy()
    }
    expect(api.code.list).not.toHaveBeenCalled()
  })

  it('refuses when there is no project at all', async () => {
    expect((await call('listar_arquivos', {})).error).toBeTruthy()
  })

  it('does not read a folder the user unselected', async () => {
    // An empty selection is a legitimate state: the AI reads no code.
    const { projectId, ids } = projectWithRoots('web')
    st().toggleCodePath(projectId, ids[0])

    expect((await call('listar_arquivos', {})).error).toBeTruthy()
    expect(api.code.list).not.toHaveBeenCalled()
  })

  it('narrows to one folder by pastaId, and by name', async () => {
    const { ids } = projectWithRoots('web', 'api')

    await call('listar_arquivos', { pastaId: ids[1] })
    expect(api.code.list).toHaveBeenCalledTimes(1)
    expect(api.code.list).toHaveBeenCalledWith('/src/api', '.', undefined, undefined)

    api.code.list.mockClear()
    await call('listar_arquivos', { pastaId: 'web' })
    expect(api.code.list).toHaveBeenCalledWith('/src/web', '.', undefined, undefined)
  })

  it('errors with the available folders when pastaId is unknown', async () => {
    projectWithRoots('web', 'api')
    const res = await call('listar_arquivos', { pastaId: 'mobile' })
    expect(res.error).toContain('web')
    expect(res.error).toContain('api')
    expect(api.code.list).not.toHaveBeenCalled()
  })
})

describe('listar_arquivos', () => {
  let api: ReturnType<typeof installCodeApi>
  beforeEach(() => {
    resetStore()
    api = installCodeApi()
  })

  it('fans out across every selected folder, labelling each', async () => {
    projectWithRoots('web', 'api')
    api.code.list.mockImplementation(async (path: string) => ({
      files: [`${path === '/src/web' ? 'App.tsx' : 'server.ts'}`],
      truncated: false
    }))

    const res = await call('listar_arquivos', {})

    expect(res.pastas).toEqual([
      { pasta: 'web', files: ['App.tsx'], truncated: false },
      { pasta: 'api', files: ['server.ts'], truncated: false }
    ])
  })

  it('passes the subfolder through, defaulting to the root', async () => {
    projectWithRoots('web')
    await call('listar_arquivos', {})
    expect(api.code.list).toHaveBeenCalledWith('/src/web', '.', undefined, undefined)

    await call('listar_arquivos', { subpasta: 'src/renderer' })
    expect(api.code.list).toHaveBeenCalledWith('/src/web', 'src/renderer', undefined, undefined)
  })

  it('forwards inicio/max_arquivos for paging and passes the paging fields back', async () => {
    projectWithRoots('web')
    api.code.list.mockResolvedValue({
      files: ['b.ts'],
      total: 500,
      offset: 200,
      truncated: true,
      nextOffset: 201
    })

    const res = await call('listar_arquivos', { inicio: 200, max_arquivos: 1 })

    expect(api.code.list).toHaveBeenCalledWith('/src/web', '.', 200, 1)
    expect((res.pastas as { total: number; nextOffset: number }[])[0]).toMatchObject({
      total: 500,
      nextOffset: 201
    })
  })

  it('passes the main process’s truncation flag on rather than hiding it', async () => {
    projectWithRoots('web')
    api.code.list.mockResolvedValue({ files: ['a.ts'], truncated: true })
    const res = await call('listar_arquivos', {})
    expect((res.pastas as { truncated: boolean }[])[0].truncated).toBe(true)
  })

  it('is a read tool, so it never asks for approval', () => {
    expect(isWriteTool('listar_arquivos')).toBe(false)
  })
})

describe('ler_arquivo', () => {
  let api: ReturnType<typeof installCodeApi>
  beforeEach(() => {
    resetStore()
    api = installCodeApi()
  })

  it('reads the file and says which folder it came from', async () => {
    projectWithRoots('web')
    api.code.read.mockResolvedValue({ content: 'export const a = 1', truncated: false })

    const res = await call('ler_arquivo', { caminho: 'src/a.ts' })

    expect(api.code.read).toHaveBeenCalledWith('/src/web', 'src/a.ts', undefined, undefined)
    expect(res).toMatchObject({ pasta: 'web', content: 'export const a = 1' })
  })

  it('forwards inicio/max_chars for paging and passes the paging fields back', async () => {
    projectWithRoots('web')
    api.code.read.mockResolvedValue({
      content: 'tail',
      truncated: true,
      offset: 20000,
      total: 60000,
      nextOffset: 24000
    })

    const res = await call('ler_arquivo', { caminho: 'big.ts', inicio: 20000, max_chars: 4000 })

    expect(api.code.read).toHaveBeenCalledWith('/src/web', 'big.ts', 20000, 4000)
    expect(res).toMatchObject({ pasta: 'web', truncated: true, nextOffset: 24000, total: 60000 })
  })

  it('finds the file in whichever folder has it', async () => {
    projectWithRoots('web', 'api')
    api.code.read.mockImplementation(async (path: string) =>
      path === '/src/api' ? { content: 'server' } : { error: 'Arquivo inválido' }
    )

    const res = await call('ler_arquivo', { caminho: 'server.ts' })

    expect(res).toMatchObject({ pasta: 'api', content: 'server' })
  })

  it('refuses to guess when the same path exists in two folders', async () => {
    projectWithRoots('web', 'api')
    // Both roots have an index.ts — reading "the first one" would silently
    // answer about the wrong repo.
    api.code.read.mockResolvedValue({ content: 'whatever' })

    const res = await call('ler_arquivo', { caminho: 'index.ts' })

    expect(res.error).toContain('mais de uma pasta')
    expect((res.pastas as { nome: string }[]).map((p) => p.nome)).toEqual(['web', 'api'])
  })

  it('resolves that ambiguity once given a pastaId', async () => {
    const { ids } = projectWithRoots('web', 'api')
    api.code.read.mockResolvedValue({ content: 'whatever' })

    const res = await call('ler_arquivo', { caminho: 'index.ts', pastaId: ids[0] })

    expect(res).toMatchObject({ pasta: 'web', content: 'whatever' })
  })

  it('passes the not-found error back when no folder has it', async () => {
    projectWithRoots('web')
    api.code.read.mockResolvedValue({ error: 'Arquivo inválido ou fora do projeto' })
    expect((await call('ler_arquivo', { caminho: 'nope.ts' })).error).toBeTruthy()
  })

  it('rejects a missing path without touching the disk', async () => {
    projectWithRoots('web')
    expect((await call('ler_arquivo', { caminho: '' })).error).toBeTruthy()
    expect((await call('ler_arquivo', {})).error).toBeTruthy()
    expect(api.code.read).not.toHaveBeenCalled()
  })

  it('is a read tool, so it never asks for approval', () => {
    expect(isWriteTool('ler_arquivo')).toBe(false)
  })
})

describe('buscar_no_codigo', () => {
  let api: ReturnType<typeof installCodeApi>
  beforeEach(() => {
    resetStore()
    api = installCodeApi()
  })

  it('searches every selected folder and labels the hits', async () => {
    projectWithRoots('web', 'api')
    api.code.search.mockImplementation(async (path: string) => ({
      matches: path === '/src/web' ? [{ file: 'App.tsx', line: 3, text: 'const x' }] : [],
      truncated: false
    }))

    const res = await call('buscar_no_codigo', { termo: 'const x' })

    expect(api.code.search).toHaveBeenCalledWith('/src/web', 'const x')
    expect(api.code.search).toHaveBeenCalledWith('/src/api', 'const x')
    expect(res.pastas).toEqual([
      { pasta: 'web', matches: [{ file: 'App.tsx', line: 3, text: 'const x' }], truncated: false },
      { pasta: 'api', matches: [], truncated: false }
    ])
  })

  it('rejects an empty term without touching the disk', async () => {
    projectWithRoots('web')
    expect((await call('buscar_no_codigo', { termo: '' })).error).toBeTruthy()
    expect((await call('buscar_no_codigo', {})).error).toBeTruthy()
    expect(api.code.search).not.toHaveBeenCalled()
  })

  it('is a read tool, so it never asks for approval', () => {
    expect(isWriteTool('buscar_no_codigo')).toBe(false)
  })
})

// ── buscar_na_web ────────────────────────────────────────────────────────────
//
// The fetch itself — scheme, private hosts, redirect hops, the size cap — is
// main's, and web-fetch's own tests cover it. Stubbed here: what's under test
// is that the tool hands main a URL and hands the model back what it got.

describe('buscar_na_web', () => {
  let fetchWeb: ReturnType<typeof vi.fn>
  beforeEach(() => {
    resetStore()
    fetchWeb = vi.fn(async () => ({ content: 'olá', url: 'https://x.dev/', truncated: false }))
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { ai: { web: { fetch: fetchWeb } } }
  })

  it('passes the URL to main and returns the page text', async () => {
    const res = await call('buscar_na_web', { url: 'https://x.dev' })

    // render defaults to false — a plain fetch unless the model asks for JS.
    expect(fetchWeb).toHaveBeenCalledWith('https://x.dev', false)
    expect(res).toEqual({ content: 'olá', url: 'https://x.dev/', truncated: false })
  })

  it('asks main to render with a headless browser when renderizar_js is set', async () => {
    await call('buscar_na_web', { url: 'https://spa.dev', renderizar_js: true })
    expect(fetchWeb).toHaveBeenCalledWith('https://spa.dev', true)
  })

  it('reports the URL it landed on, not the one it aimed at', async () => {
    // Redirects are resolved in main; the model needs the final URL or it will
    // cite the page it asked for rather than the page it read.
    fetchWeb.mockResolvedValue({ content: 'c', url: 'https://x.dev/final', truncated: true })

    expect((await call('buscar_na_web', { url: 'https://x.dev/start' })).url).toBe(
      'https://x.dev/final'
    )
  })

  it('rejects an empty or missing URL without calling main', async () => {
    expect((await call('buscar_na_web', { url: '' })).error).toBeTruthy()
    expect((await call('buscar_na_web', { url: '   ' })).error).toBeTruthy()
    expect((await call('buscar_na_web', {})).error).toBeTruthy()
    expect((await call('buscar_na_web', { url: 42 })).error).toBeTruthy()
    expect(fetchWeb).not.toHaveBeenCalled()
  })

  it("forwards main's refusal instead of throwing", async () => {
    // A blocked host is an answer, not a crash: the model should read why and
    // move on.
    fetchWeb.mockResolvedValue({ error: 'Host privado bloqueado' })

    expect((await call('buscar_na_web', { url: 'http://127.0.0.1' })).error).toBe(
      'Host privado bloqueado'
    )
  })

  it('is a read tool, so it never asks for approval', () => {
    expect(isWriteTool('buscar_na_web')).toBe(false)
  })

  it('is offered to the model, with url required', () => {
    const def = TOOL_DEFS.find((d) => d.function.name === 'buscar_na_web')
    expect(def).toBeDefined()
    expect(def?.function.parameters).toMatchObject({ required: ['url'] })
  })
})

// ── rodar_agente_codigo ──────────────────────────────────────────────────────

describe('rodar_agente_codigo', () => {
  let api: ReturnType<typeof installCodeApi>
  beforeEach(() => {
    resetStore()
    api = installCodeApi()
  })

  it('is gated behind approval — it writes files and runs commands', () => {
    expect(isWriteTool('rodar_agente_codigo')).toBe(true)
    expect(describeToolCall('rodar_agente_codigo', { agent: 'aider', task: 'x' })).toContain('⚠️')
  })

  it('launches the agent in the selected folder', async () => {
    projectWithRoots('web')

    const res = await call('rodar_agente_codigo', { task: '  corrigir o bug  ' })

    expect(api.codeAgent.run).toHaveBeenCalledWith({
      path: '/src/web',
      task: 'corrigir o bug',
      agent: 'aider'
    })
    expect(res).toMatchObject({ status: 'solicitado', agente: 'aider', diretorio: '/src/web' })
  })

  it('reports the request without claiming it succeeded', async () => {
    projectWithRoots('web')
    const res = await call('rodar_agente_codigo', { task: 'x' })
    // Fire-and-forget: the real outcome only shows up in the output panel, so
    // the model must not tell the user the work is done.
    expect(res.status).toBe('solicitado')
    expect(res.aviso).toContain('Não afirme sucesso')
  })

  it('honours the codex agent', async () => {
    projectWithRoots('web')
    await call('rodar_agente_codigo', { task: 'x', agent: 'codex' })
    expect(api.codeAgent.run).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex' }))
  })

  it('refuses to pick between folders — it writes, and the wrong repo is costly', async () => {
    projectWithRoots('web', 'api')

    const res = await call('rodar_agente_codigo', { task: 'x' })

    expect(res.error).toContain('pastaId')
    expect((res.pastas as { nome: string }[]).map((p) => p.nome)).toEqual(['web', 'api'])
    expect(api.codeAgent.run).not.toHaveBeenCalled()
  })

  it('runs once a pastaId picks the folder', async () => {
    const { ids } = projectWithRoots('web', 'api')
    await call('rodar_agente_codigo', { task: 'x', pastaId: ids[1] })
    expect(api.codeAgent.run).toHaveBeenCalledWith(expect.objectContaining({ path: '/src/api' }))
  })

  it('refuses an empty task without spawning anything', async () => {
    projectWithRoots('web')
    expect((await call('rodar_agente_codigo', { task: '   ' })).error).toBeTruthy()
    expect(api.codeAgent.run).not.toHaveBeenCalled()
  })

  it('refuses when no folder is selected', async () => {
    st().createProject('P')
    expect((await call('rodar_agente_codigo', { task: 'x' })).error).toBeTruthy()
    expect(api.codeAgent.run).not.toHaveBeenCalled()
  })
})

// ── ler_financeiro ───────────────────────────────────────────────────────────

describe('ler_financeiro', () => {
  beforeEach(resetStore)

  /** A table with a salary, groceries and rent across two months. */
  const seed = (): string => {
    const lid = st().createList('Casa')
    st().addTransaction(lid, {
      description: 'Salário',
      amount: '5000',
      type: 'income',
      date: '2026-07-01',
      category: 'Salário'
    })
    st().addTransaction(lid, {
      description: 'Mercado',
      amount: '150.5',
      type: 'expense',
      date: '2026-07-02',
      category: 'Alimentação'
    })
    st().addTransaction(lid, {
      description: 'Aluguel',
      amount: '1200',
      type: 'expense',
      date: '2026-06-05',
      category: 'Moradia'
    })
    return lid
  }
  const table = (res: { [k: string]: unknown }): Record<string, unknown> =>
    (res.tabelas as Record<string, unknown>[])[0]

  it('totals income, expenses and balance as decimal strings', async () => {
    seed()
    const t = table(await call('ler_financeiro', {}))

    // Money stays a string end to end; a float would drift.
    expect(t).toMatchObject({ nome: 'Casa', receitas: '5000', despesas: '1350.5', saldo: '3649.5' })
    expect(typeof t.saldo).toBe('string')
  })

  it('breaks spend down by category', async () => {
    seed()
    const t = table(await call('ler_financeiro', {}))
    expect(t.porCategoria).toEqual({
      Salário: { receita: '5000', despesa: '0' },
      Alimentação: { receita: '0', despesa: '150.5' },
      Moradia: { receita: '0', despesa: '1200' }
    })
  })

  it('files an uncategorised transaction under "sem categoria"', async () => {
    const lid = st().createList('Casa')
    st().addTransaction(lid, { description: 'X', amount: '10', type: 'expense', date: '2026-07-01' })
    const t = table(await call('ler_financeiro', {}))
    expect(t.porCategoria).toEqual({ 'sem categoria': { receita: '0', despesa: '10' } })
  })

  it('filters by period, inclusive on both ends', async () => {
    seed()
    const t = table(await call('ler_financeiro', { de: '2026-07-01', ate: '2026-07-02' }))
    // June's rent is out; both July days are in.
    expect(t).toMatchObject({ qtdTransacoes: 2, despesas: '150.5', receitas: '5000' })
  })

  it('treats an open-ended period as open on that side', async () => {
    seed()
    expect(table(await call('ler_financeiro', { de: '2026-07-01' })).qtdTransacoes).toBe(2)
    expect(table(await call('ler_financeiro', { ate: '2026-06-30' })).qtdTransacoes).toBe(1)
  })

  it('picks a table by name or id, and reports all of them by default', async () => {
    seed()
    const outra = st().createList('Empresa')

    expect((await call('ler_financeiro', {})).tabelas).toHaveLength(2)
    expect(table(await call('ler_financeiro', { tabela: 'casa' })).nome).toBe('Casa')
    expect(table(await call('ler_financeiro', { tabela: outra })).nome).toBe('Empresa')
  })

  it('samples the newest transactions first and flags truncation', async () => {
    const lid = st().createList('Casa')
    for (let i = 1; i <= 20; i++) {
      st().addTransaction(lid, {
        description: `T${i}`,
        amount: '1',
        type: 'expense',
        date: `2026-07-${String(i).padStart(2, '0')}`
      })
    }
    const t = table(await call('ler_financeiro', {}))

    expect(t.qtdTransacoes).toBe(20)
    const amostra = t.amostraTransacoes as { descricao: string }[]
    expect(amostra).toHaveLength(15)
    expect(amostra[0].descricao).toBe('T20') // newest first
    expect(t.truncado).toBe(true)
  })

  it('reports financial goals alongside the totals', async () => {
    const lid = st().createList('Casa')
    st().addFinancialGoal(lid, {
      name: 'Reserva',
      targetAmount: '10000',
      targetMonth: 7,
      targetYear: 2026
    })
    const t = table(await call('ler_financeiro', {}))
    expect(t.metasFinanceiras).toEqual([
      { nome: 'Reserva', alvo: '10000', mes: 7, ano: 2026, concluida: false }
    ])
  })

  it('is a read tool, so it never asks for approval', () => {
    expect(isWriteTool('ler_financeiro')).toBe(false)
    expect(TOOL_DEFS.some((d) => d.function.name === 'ler_financeiro')).toBe(true)
  })

  it('reports an empty financial module without inventing a table', async () => {
    expect((await call('ler_financeiro', {})).tabelas).toEqual([])
  })
})

// ── ler_metas ────────────────────────────────────────────────────────────────

describe('ler_metas', () => {
  beforeEach(resetStore)

  it('sums the entries into the current value and a percentage', async () => {
    const id = st().createGoal({ title: 'Correr', target: 100, unit: 'km', color: PROJECT_COLORS[0] })
    st().addGoalEntry(id, { date: '2026-07-01', value: 10 })
    st().addGoalEntry(id, { date: '2026-07-05', value: 20 })

    const [m] = (await call('ler_metas', {})).metas as Record<string, unknown>[]

    expect(m).toMatchObject({
      id,
      titulo: 'Correr',
      unidade: 'km',
      alvo: 100,
      atual: 30,
      progresso: 30,
      qtdEntradas: 2,
      ultimaEntrada: '2026-07-05'
    })
  })

  it('reports a goal with no entries as zero, not as broken', async () => {
    st().createGoal({ title: 'Ler', target: 12, unit: '', color: PROJECT_COLORS[0] })
    const [m] = (await call('ler_metas', {})).metas as Record<string, unknown>[]
    expect(m).toMatchObject({ atual: 0, progresso: 0, qtdEntradas: 0, ultimaEntrada: null })
  })

  it('does not divide by a zero target', async () => {
    // createGoal doesn't validate, so a 0 target can exist from older data.
    st().createGoal({ title: 'X', target: 0, unit: '', color: PROJECT_COLORS[0] })
    const [m] = (await call('ler_metas', {})).metas as Record<string, unknown>[]
    expect(m.progresso).toBe(0) // not Infinity or NaN
  })

  it('reports progress past 100% rather than capping it', async () => {
    const id = st().createGoal({ title: 'X', target: 10, unit: '', color: PROJECT_COLORS[0] })
    st().addGoalEntry(id, { date: '2026-07-01', value: 25 })
    const [m] = (await call('ler_metas', {})).metas as Record<string, unknown>[]
    expect(m.progresso).toBe(250)
  })

  it('surfaces the linked project, or null', async () => {
    const pid = st().createProject('P')
    st().createGoal({ title: 'A', target: 1, unit: '', color: PROJECT_COLORS[0], projectId: pid })
    st().createGoal({ title: 'B', target: 1, unit: '', color: PROJECT_COLORS[0] })

    const metas = (await call('ler_metas', {})).metas as Record<string, unknown>[]
    expect(metas.map((m) => m.projetoId)).toEqual([pid, null])
  })

  it('is a read tool, so it never asks for approval', () => {
    expect(isWriteTool('ler_metas')).toBe(false)
    expect(TOOL_DEFS.some((d) => d.function.name === 'ler_metas')).toBe(true)
  })

  it('reports no goals without inventing one', async () => {
    expect((await call('ler_metas', {})).metas).toEqual([])
  })
})

// ── ler_habitos ──────────────────────────────────────────────────────────────

describe('ler_habitos', () => {
  beforeEach(resetStore)
  afterEach(() => vi.useRealTimers())

  /** Freeze the clock so streaks and month rates are deterministic. */
  const freeze = (): void => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 16, 10, 0, 0)) // 16 Jul 2026, local
  }

  it('counts the streak up to today', async () => {
    freeze()
    const id = st().createHabit({ name: 'Ler', color: PROJECT_COLORS[0] })
    for (const d of ['2026-07-14', '2026-07-15', '2026-07-16']) st().toggleHabit(id, d)

    const [h] = (await call('ler_habitos', {})).habitos as Record<string, unknown>[]

    expect(h).toMatchObject({ id, nome: 'Ler', streak: 3, feitoHoje: true, totalConclusoes: 3 })
  })

  it('keeps yesterday-ending streaks alive, since today is not over', async () => {
    freeze()
    const id = st().createHabit({ name: 'Ler', color: PROJECT_COLORS[0] })
    for (const d of ['2026-07-14', '2026-07-15']) st().toggleHabit(id, d)

    const [h] = (await call('ler_habitos', {})).habitos as Record<string, unknown>[]

    expect(h).toMatchObject({ streak: 2, feitoHoje: false })
  })

  it('breaks the streak on a missed day', async () => {
    freeze()
    const id = st().createHabit({ name: 'Ler', color: PROJECT_COLORS[0] })
    // 13th and 16th, with the 14th/15th missed.
    for (const d of ['2026-07-13', '2026-07-16']) st().toggleHabit(id, d)

    const [h] = (await call('ler_habitos', {})).habitos as Record<string, unknown>[]

    expect(h).toMatchObject({ streak: 1, totalConclusoes: 2 })
  })

  it('rates the month against the days elapsed, not the whole month', async () => {
    freeze() // the 16th
    const id = st().createHabit({ name: 'Ler', color: PROJECT_COLORS[0] })
    for (const d of ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']) st().toggleHabit(id, d)
    // Last month's completions must not count towards this month.
    st().toggleHabit(id, '2026-06-20')

    const [h] = (await call('ler_habitos', {})).habitos as Record<string, unknown>[]

    expect(h.feitosNoMes).toBe(4)
    expect(h.taxaMes).toBe(25) // 4 of 16 days so far
  })

  it('orders the strongest habits first', async () => {
    freeze()
    const weak = st().createHabit({ name: 'Fraco', color: PROJECT_COLORS[0] })
    const strong = st().createHabit({ name: 'Forte', color: PROJECT_COLORS[0] })
    st().toggleHabit(weak, '2026-07-16')
    for (const d of ['2026-07-14', '2026-07-15', '2026-07-16']) st().toggleHabit(strong, d)

    const habitos = (await call('ler_habitos', {})).habitos as Record<string, unknown>[]

    expect(habitos.map((h) => h.nome)).toEqual(['Forte', 'Fraco'])
  })

  it('is a read tool, so it never asks for approval', () => {
    expect(isWriteTool('ler_habitos')).toBe(false)
    expect(TOOL_DEFS.some((d) => d.function.name === 'ler_habitos')).toBe(true)
  })

  it('reports no habits without inventing one', async () => {
    expect((await call('ler_habitos', {})).habitos).toEqual([])
  })
})

// ── criar_projeto ────────────────────────────────────────────────────────────

describe('criar_projeto', () => {
  beforeEach(resetStore)

  it('creates the project with the default columns and makes it active', async () => {
    const res = await call('criar_projeto', { nome: 'Site', descricao: 'Landing page' })

    expect(res).toMatchObject({
      ok: true,
      nome: 'Site',
      colunas: ['Backlog', 'In Progress', 'Review', 'Done'],
      ativo: true
    })
    const project = st().projects.find((p) => p.id === res.projectId)!
    expect(project.name).toBe('Site')
    expect(project.description).toBe('Landing page')
    // Later tools resolve projectId from the active project, so this must hold.
    expect(st().activeProjectId).toBe(res.projectId)
  })

  it('trims the name instead of storing the padding', async () => {
    const res = await call('criar_projeto', { nome: '  Site  ' })
    expect(st().projects.find((p) => p.id === res.projectId)!.name).toBe('Site')
  })

  it('rejects an empty or blank name', async () => {
    expect((await call('criar_projeto', { nome: '   ' })).error).toBeTruthy()
    expect((await call('criar_projeto', {})).error).toBeTruthy()
    expect(st().projects).toHaveLength(0)
  })

  it('refuses a duplicate name and hands back the existing id', async () => {
    const first = await call('criar_projeto', { nome: 'Site' })

    // Case and padding must not sneak a twin past the check.
    const res = await call('criar_projeto', { nome: ' site ' })

    expect(res.error).toBeTruthy()
    expect(res.projectId).toBe(first.projectId)
    expect(st().projects).toHaveLength(1)
    // A twin would also have stolen the active project.
    expect(st().activeProjectId).toBe(first.projectId)
  })

  it('accepts a known colour and rejects anything else', async () => {
    const ok = await call('criar_projeto', { nome: 'A', cor: '#ec4899' })
    expect(st().projects.find((p) => p.id === ok.projectId)!.color).toBe('#ec4899')

    const bad = await call('criar_projeto', { nome: 'B', cor: 'roxo' })
    expect(bad.error).toBeTruthy()
    expect(st().projects).toHaveLength(1)
  })

  it('falls back to the default colour when none is given', async () => {
    const res = await call('criar_projeto', { nome: 'A' })
    expect(st().projects.find((p) => p.id === res.projectId)!.color).toBe(PROJECT_COLORS[0])
  })

  it('is gated behind approval and warns that it switches the active project', () => {
    expect(isWriteTool('criar_projeto')).toBe(true)
    expect(TOOL_DEFS.some((d) => d.function.name === 'criar_projeto')).toBe(true)

    const label = describeToolCall('criar_projeto', { nome: 'Site' })
    expect(label).toContain('Site')
    expect(label).toContain('ativo')
  })
})

// ── atualizar_task ───────────────────────────────────────────────────────────

describe('atualizar_task', () => {
  beforeEach(resetStore)

  /** A task with every editable field already set, to prove edits are surgical. */
  const seed = (): string => {
    const pid = st().createProject('P')
    const col = st().projects[0].columns[0]
    const tid = st().createTask({ projectId: pid, columnId: col.id, title: 'T' })
    st().updateTask(tid, {
      description: 'antes',
      priority: 'low',
      dueDate: '2026-01-01',
      tags: ['dev']
    })
    return tid
  }
  const task = (id: string): NonNullable<ReturnType<typeof st>['tasks'][number]> =>
    st().tasks.find((t) => t.id === id)!

  it('edits only the fields it was given', async () => {
    const tid = seed()

    const res = await call('atualizar_task', { taskId: tid, prioridade: 'urgent' })

    expect(res.ok).toBe(true)
    expect(task(tid).priority).toBe('urgent')
    // The rest must survive untouched — this is the whole point of a partial edit.
    expect(task(tid).description).toBe('antes')
    expect(task(tid).dueDate).toBe('2026-01-01')
    expect(task(tid).tags).toEqual(['dev'])
    expect(task(tid).title).toBe('T')
  })

  it('edits description, dueDate and tags together, by title', async () => {
    const tid = seed()

    const res = await call('atualizar_task', {
      titulo: 't',
      descricao: 'depois',
      dueDate: '2026-03-09',
      tags: ['dev', 'ux']
    })

    expect(res.ok).toBe(true)
    expect(task(tid).description).toBe('depois')
    expect(task(tid).dueDate).toBe('2026-03-09')
    expect(task(tid).tags).toEqual(['dev', 'ux'])
  })

  it('replaces the tag list rather than merging into it', async () => {
    const tid = seed()
    await call('atualizar_task', { taskId: tid, tags: ['ux'] })
    expect(task(tid).tags).toEqual(['ux'])
  })

  it('clears description, dueDate and tags when given empty values', async () => {
    const tid = seed()

    await call('atualizar_task', { taskId: tid, descricao: '', dueDate: '', tags: [] })

    expect(task(tid).description).toBeUndefined()
    expect(task(tid).dueDate).toBeUndefined()
    expect(task(tid).tags).toEqual([])
  })

  it('rejects a priority outside the allowed set', async () => {
    const tid = seed()
    expect((await call('atualizar_task', { taskId: tid, prioridade: 'altíssima' })).error).toBeTruthy()
    expect(task(tid).priority).toBe('low')
  })

  it('rejects a dueDate that is not a real YYYY-MM-DD date', async () => {
    const tid = seed()
    // A stored '09/03/2026' or '2026-02-31' renders as "Invalid Date" forever.
    for (const dueDate of ['09/03/2026', '2026-02-31', 'amanhã', '2026-3-9']) {
      expect((await call('atualizar_task', { taskId: tid, dueDate })).error).toBeTruthy()
    }
    expect(task(tid).dueDate).toBe('2026-01-01')
  })

  it('accepts a leap day but not a fake one', async () => {
    const tid = seed()
    expect((await call('atualizar_task', { taskId: tid, dueDate: '2028-02-29' })).ok).toBe(true)
    expect(task(tid).dueDate).toBe('2028-02-29')
    expect((await call('atualizar_task', { taskId: tid, dueDate: '2027-02-29' })).error).toBeTruthy()
    expect(task(tid).dueDate).toBe('2028-02-29')
  })

  it('rejects tags that are not a list of strings', async () => {
    const tid = seed()
    expect((await call('atualizar_task', { taskId: tid, tags: 'dev' })).error).toBeTruthy()
    expect((await call('atualizar_task', { taskId: tid, tags: ['dev', 3] })).error).toBeTruthy()
    expect(task(tid).tags).toEqual(['dev'])
  })

  it('errors when no field was given, instead of silently touching the task', async () => {
    const tid = seed()
    const before = task(tid).updatedAt

    expect((await call('atualizar_task', { taskId: tid })).error).toBeTruthy()
    expect(task(tid).updatedAt).toBe(before)
  })

  it('returns an error when the task is not found', async () => {
    st().createProject('P')
    expect((await call('atualizar_task', { taskId: 'nope', prioridade: 'high' })).error).toBeTruthy()
  })

  it('is gated behind approval and spells out the fields it will change', () => {
    expect(isWriteTool('atualizar_task')).toBe(true)
    expect(TOOL_DEFS.some((d) => d.function.name === 'atualizar_task')).toBe(true)

    const label = describeToolCall('atualizar_task', {
      titulo: 'T',
      prioridade: 'urgent',
      tags: [],
      dueDate: ''
    })
    expect(label).toContain('prioridade → urgent')
    // Destructive edits have to be legible before the user approves them.
    expect(label).toContain('apagar as tags')
    expect(label).toContain('remover o prazo')
  })
})

// ── mover_task ───────────────────────────────────────────────────────────────

describe('mover_task', () => {
  beforeEach(resetStore)

  /** A project with the default columns and one task sitting in Backlog. */
  const seed = (): { pid: string; tid: string; col: (name: string) => string } => {
    const pid = st().createProject('P')
    const col = (name: string): string =>
      st().projects.find((p) => p.id === pid)!.columns.find((c) => c.name === name)!.id
    const tid = st().createTask({ projectId: pid, columnId: col('Backlog'), title: 'T' })
    return { pid, tid, col }
  }
  const task = (id: string): NonNullable<ReturnType<typeof st>['tasks'][number]> =>
    st().tasks.find((t) => t.id === id)!

  it('moves the task to the named column without completing it', async () => {
    const { tid, col } = seed()

    const res = await call('mover_task', { taskId: tid, coluna: 'In Progress' })

    expect(res).toMatchObject({ ok: true, de: 'Backlog', para: 'In Progress' })
    expect(task(tid).columnId).toBe(col('In Progress'))
    // The whole point of the tool: progress without being marked done.
    expect(task(tid).completedAt).toBeUndefined()
  })

  it('matches the column name case-insensitively and by title', async () => {
    const { tid, col } = seed()
    expect((await call('mover_task', { titulo: 't', coluna: 'review' })).ok).toBe(true)
    expect(task(tid).columnId).toBe(col('Review'))
  })

  it('appends to the end of the target column', async () => {
    const { pid, tid, col } = seed()
    const first = st().createTask({ projectId: pid, columnId: col('Review'), title: 'A' })

    await call('mover_task', { taskId: tid, coluna: 'Review' })

    const inReview = st()
      .tasks.filter((t) => t.columnId === col('Review'))
      .sort((a, b) => a.order - b.order)
    expect(inReview.map((t) => t.id)).toEqual([first, tid])
  })

  it('completes the task when the move lands in Done, and says so', async () => {
    const { tid } = seed()

    const res = await call('mover_task', { taskId: tid, coluna: 'Done' })

    expect(res).toMatchObject({ ok: true, concluida: true })
    expect(task(tid).completedAt).toBeTruthy()
  })

  it('reopens the task when the move leaves Done, and says so', async () => {
    const { tid } = seed()
    await call('concluir_task', { taskId: tid })
    expect(task(tid).completedAt).toBeTruthy()

    const res = await call('mover_task', { taskId: tid, coluna: 'In Progress' })

    expect(res).toMatchObject({ ok: true, reaberta: true })
    expect(task(tid).completedAt).toBeUndefined()
  })

  it('stops a running timer when the move completes the task', async () => {
    const { tid } = seed()
    st().startTimer(tid)

    await call('mover_task', { taskId: tid, coluna: 'Done' })

    expect(st().activeTimer).toBeNull()
  })

  it('refuses a column from another project instead of orphaning the task', async () => {
    const { tid, col } = seed()
    const other = st().createProject('Other')
    st().createColumn(other, 'Etc')
    // The column really does exist — just on the wrong project.
    const foreign = st().projects.find((p) => p.id === other)!.columns.find((c) => c.name === 'Etc')
    expect(foreign).toBeTruthy()

    // Moving there would point the task at a column its own board can't render.
    const res = await call('mover_task', { taskId: tid, coluna: 'Etc' })

    expect(res.error).toBeTruthy()
    expect(res.disponiveis).toEqual(['Backlog', 'In Progress', 'Review', 'Done'])
    expect(task(tid).columnId).toBe(col('Backlog'))
  })

  it('reports an unknown column with the ones that exist', async () => {
    const { tid, col } = seed()
    const res = await call('mover_task', { taskId: tid, coluna: 'Arquivado' })
    expect(res.error).toBeTruthy()
    expect(res.disponiveis).toContain('Backlog')
    expect(task(tid).columnId).toBe(col('Backlog'))
  })

  it('leaves the column untouched when the task is already there', async () => {
    const { pid, tid, col } = seed()
    const other = st().createTask({ projectId: pid, columnId: col('Backlog'), title: 'A' })
    const before = task(tid).updatedAt

    const res = await call('mover_task', { taskId: tid, coluna: 'Backlog' })

    // A no-op must not reshuffle the column it was already in.
    expect(res).toMatchObject({ ok: true, semMudanca: true })
    expect(task(tid).updatedAt).toBe(before)
    expect(task(tid).order).toBeLessThan(task(other).order)
  })

  it('returns an error when the task is not found', async () => {
    seed()
    expect((await call('mover_task', { taskId: 'nope', coluna: 'Done' })).error).toBeTruthy()
  })

  it('is gated behind approval and names the destination', () => {
    expect(isWriteTool('mover_task')).toBe(true)
    expect(TOOL_DEFS.some((d) => d.function.name === 'mover_task')).toBe(true)
    expect(describeToolCall('mover_task', { titulo: 'T', coluna: 'Review' })).toContain('Review')
  })
})

// ── deletar_task ─────────────────────────────────────────────────────────────

describe('deletar_task', () => {
  beforeEach(resetStore)

  it('removes the task for good and leaves a tombstone', async () => {
    const pid = st().createProject('P')
    const backlog = st().projects[0].columns[0]
    const tid = st().createTask({ projectId: pid, columnId: backlog.id, title: 'T' })

    const res = await call('deletar_task', { taskId: tid })

    expect(res.ok).toBe(true)
    expect(st().tasks).toHaveLength(0)
    // The tombstone is what stops a backup import from resurrecting it.
    expect(st().tombstones).toEqual([
      expect.objectContaining({ id: tid, type: 'task' })
    ])
  })

  it('finds the task by exact title (case-insensitive)', async () => {
    const pid = st().createProject('P')
    const backlog = st().projects[0].columns[0]
    st().createTask({ projectId: pid, columnId: backlog.id, title: 'Fix bug' })

    expect((await call('deletar_task', { titulo: 'fix bug' })).ok).toBe(true)
    expect(st().tasks).toHaveLength(0)
  })

  it('refuses an ambiguous title and hands back the ids instead of guessing', async () => {
    const pid = st().createProject('P')
    const backlog = st().projects[0].columns[0]
    const a = st().createTask({ projectId: pid, columnId: backlog.id, title: 'Dup' })
    const b = st().createTask({ projectId: pid, columnId: backlog.id, title: 'Dup' })

    const res = await call('deletar_task', { titulo: 'Dup' })

    // Deleting "the first of the two duplicates" is the one thing it must not do.
    expect(res.error).toBeTruthy()
    expect(st().tasks).toHaveLength(2)
    expect((res.candidatos as { id: string }[]).map((c) => c.id).sort()).toEqual([a, b].sort())
  })

  it('deletes one of the duplicates once given a taskId', async () => {
    const pid = st().createProject('P')
    const backlog = st().projects[0].columns[0]
    const a = st().createTask({ projectId: pid, columnId: backlog.id, title: 'Dup' })
    const b = st().createTask({ projectId: pid, columnId: backlog.id, title: 'Dup' })

    expect((await call('deletar_task', { taskId: b })).ok).toBe(true)
    expect(st().tasks.map((t) => t.id)).toEqual([a])
  })

  it('does not reach into another project when resolving by title', async () => {
    const other = st().createProject('Other')
    st().createTask({ projectId: other, columnId: st().projects[0].columns[0].id, title: 'T' })
    const active = st().createProject('Active')
    st().setActiveProject(active)

    expect((await call('deletar_task', { titulo: 'T' })).error).toBeTruthy()
    expect(st().tasks).toHaveLength(1)
  })

  it('returns an error when the task is not found', async () => {
    st().createProject('P')
    expect((await call('deletar_task', { taskId: 'nope' })).error).toBeTruthy()
    expect((await call('deletar_task', {})).error).toBeTruthy()
  })

  // Nothing else stands between the model and an unrecoverable delete.
  it('is gated behind approval and offered to the model', () => {
    expect(isWriteTool('deletar_task')).toBe(true)
    expect(TOOL_DEFS.some((d) => d.function.name === 'deletar_task')).toBe(true)
  })

  it('spells out in the approval card that the delete is permanent', () => {
    const label = describeToolCall('deletar_task', { titulo: 'Dup' })
    expect(label).toContain('Dup')
    expect(label).toMatch(/PERMANENTEMENTE/)
  })
})

// ── criar_nota ───────────────────────────────────────────────────────────────

describe('criar_nota', () => {
  beforeEach(resetStore)

  const notes = (): ReturnType<typeof st>['notes'] => st().notes
  /** True when any two notes share the exact same spot. */
  const stacked = (): boolean => {
    const seen = new Set(notes().map((n) => `${n.x},${n.y}`))
    return seen.size !== notes().length
  }

  it('creates the note in the active project', async () => {
    const pid = st().createProject('P')

    const res = await call('criar_nota', { conteudo: '  Ideia  ', cor: NOTE_COLORS[2] })

    expect(res).toMatchObject({ ok: true, conteudo: 'Ideia' })
    expect(notes()[0]).toMatchObject({ projectId: pid, content: 'Ideia', color: NOTE_COLORS[2] })
  })

  it('defaults the colour and sizes the note like the canvas does', async () => {
    st().createProject('P')
    await call('criar_nota', { conteudo: 'A' })
    expect(notes()[0]).toMatchObject({ color: '#fef08a', width: 200, height: 150 })
  })

  it('tiles successive notes instead of stacking them at (100,100)', async () => {
    st().createProject('P')

    for (const c of ['A', 'B', 'C', 'D', 'E']) await call('criar_nota', { conteudo: c })

    // store.createNote puts every note at (100,100) by default; five notes there
    // look like one note to the user.
    expect(notes()).toHaveLength(5)
    expect(stacked()).toBe(false)
  })

  it('does not overlap notes the user already placed', async () => {
    const pid = st().createProject('P')
    // Occupy the default spot by hand.
    st().createNote(pid, { content: 'minha', x: 100, y: 100 })

    const res = await call('criar_nota', { conteudo: 'nova' })

    expect(res.posicao).not.toEqual({ x: 100, y: 100 })
    const nova = notes().find((n) => n.content === 'nova')!
    expect(nova.x === 100 && nova.y === 100).toBe(false)
  })

  it('places per project, so another project’s canvas does not push it around', async () => {
    const a = st().createProject('A')
    st().createNote(a, { content: 'x', x: 100, y: 100 })
    const b = st().createProject('B') // becomes active

    const res = await call('criar_nota', { conteudo: 'primeira de B' })

    // B's canvas is empty, so the first free cell is the top-left one.
    expect(res.posicao).toEqual({ x: 100, y: 100 })
    expect(notes().find((n) => n.content === 'primeira de B')!.projectId).toBe(b)
  })

  it('rejects a blank note and an unknown colour', async () => {
    st().createProject('P')
    expect((await call('criar_nota', { conteudo: '   ' })).error).toBeTruthy()
    expect((await call('criar_nota', { conteudo: 'A', cor: 'azul' })).error).toBeTruthy()
    expect(notes()).toHaveLength(0)
  })

  it('errors with no active project and on an unknown one', async () => {
    expect((await call('criar_nota', { conteudo: 'A' })).error).toBeTruthy()
    st().createProject('P')
    expect((await call('criar_nota', { conteudo: 'A', projectId: 'nope' })).error).toBeTruthy()
    expect(notes()).toHaveLength(0)
  })

  it('is gated behind approval and shows the text on the card', () => {
    expect(isWriteTool('criar_nota')).toBe(true)
    expect(TOOL_DEFS.some((d) => d.function.name === 'criar_nota')).toBe(true)
    expect(describeToolCall('criar_nota', { conteudo: 'Ideia' })).toContain('Ideia')
  })
})

// ── criar_transacao ──────────────────────────────────────────────────────────

describe('criar_transacao', () => {
  beforeEach(resetStore)

  const txs = (listId: string): NonNullable<ReturnType<typeof st>['lists'][number]>['transactions'] =>
    st().lists.find((l) => l.id === listId)!.transactions

  it('records an expense as a positive canonical decimal string', async () => {
    const lid = st().createList('Casa')

    const res = await call('criar_transacao', {
      descricao: ' Mercado ',
      valor: 150.5,
      tipo: 'despesa',
      data: '2026-07-10',
      categoria: 'Alimentação'
    })

    expect(res).toMatchObject({ ok: true, tabela: 'Casa', descricao: 'Mercado', tipo: 'despesa' })
    const tx = txs(lid)[0]
    // Money is stored as a canonical decimal STRING, never a number.
    expect(tx.amount).toBe('150.5')
    expect(typeof tx.amount).toBe('string')
    expect(tx).toMatchObject({ type: 'expense', date: '2026-07-10', category: 'Alimentação' })
  })

  it('records income, and the sign lives in the type', async () => {
    const lid = st().createList('Casa')
    await call('criar_transacao', { descricao: 'Salário', valor: 5000, tipo: 'receita' })
    expect(txs(lid)[0]).toMatchObject({ type: 'income', amount: '5000' })
  })

  it('canonicalises the amount the way the UI does', async () => {
    const lid = st().createList('Casa')
    // "70000.0" → "70000", and >2dp rounds like AddTransactionRow's toDecimalPlaces(2).
    await call('criar_transacao', { descricao: 'A', valor: 70000.0, tipo: 'receita' })
    await call('criar_transacao', { descricao: 'B', valor: 10.567, tipo: 'despesa' })
    expect(txs(lid).map((t) => t.amount)).toEqual(['70000', '10.57'])
  })

  it('accepts a plain decimal string, with dot or comma', async () => {
    const lid = st().createList('Casa')
    await call('criar_transacao', { descricao: 'A', valor: '1500.50', tipo: 'despesa' })
    await call('criar_transacao', { descricao: 'B', valor: '1500,50', tipo: 'despesa' })
    expect(txs(lid).map((t) => t.amount)).toEqual(['1500.5', '1500.5'])
  })

  it('refuses a thousands-separated amount rather than reading 1.500 as 1.5', async () => {
    const lid = st().createList('Casa')

    // Decimal('1.500') is 1.5 — silently turning R$ 1.500 into R$ 1,50.
    for (const valor of ['1.500', '1,500', '1.500,50', '1,500.50', 'R$ 1500', 'muito']) {
      expect((await call('criar_transacao', { descricao: 'X', valor, tipo: 'despesa' })).error).toBeTruthy()
    }
    expect(txs(lid)).toHaveLength(0)
  })

  it('rejects a non-positive or non-finite amount', async () => {
    const lid = st().createList('Casa')
    for (const valor of [0, -50, Infinity, NaN]) {
      expect((await call('criar_transacao', { descricao: 'X', valor, tipo: 'despesa' })).error).toBeTruthy()
    }
    expect(txs(lid)).toHaveLength(0)
  })

  it('rejects a bad type, blank description and unreal date', async () => {
    const lid = st().createList('Casa')
    expect((await call('criar_transacao', { descricao: 'X', valor: 1, tipo: 'saida' })).error).toBeTruthy()
    expect((await call('criar_transacao', { descricao: ' ', valor: 1, tipo: 'despesa' })).error).toBeTruthy()
    expect((await call('criar_transacao', { descricao: 'X', valor: 1, tipo: 'despesa', data: '10/07/2026' })).error).toBeTruthy()
    expect((await call('criar_transacao', { descricao: 'X', valor: 1, tipo: 'despesa', data: '2026-02-31' })).error).toBeTruthy()
    expect(txs(lid)).toHaveLength(0)
  })

  it('defaults the date to the local today', async () => {
    vi.useFakeTimers()
    // 21:00 on the 16th in UTC-3; the UTC day is already the 17th.
    vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'))
    const lid = st().createList('Casa')

    await call('criar_transacao', { descricao: 'X', valor: 10, tipo: 'despesa' })

    expect(txs(lid)[0].date).toBe('2026-07-16')
    vi.useRealTimers()
  })

  it('uses the only table when none is named', async () => {
    const lid = st().createList('Casa')
    expect((await call('criar_transacao', { descricao: 'X', valor: 10, tipo: 'despesa' })).ok).toBe(true)
    expect(txs(lid)).toHaveLength(1)
  })

  it('refuses to guess between several tables', async () => {
    const casa = st().createList('Casa')
    const empresa = st().createList('Empresa')

    // Landing in the wrong table is invisible where it was meant to go.
    const res = await call('criar_transacao', { descricao: 'X', valor: 10, tipo: 'despesa' })

    expect(res.error).toBeTruthy()
    expect(res.tabelas).toEqual(['Casa', 'Empresa'])
    expect(txs(casa)).toHaveLength(0)
    expect(txs(empresa)).toHaveLength(0)
  })

  it('targets a table by name and by id', async () => {
    st().createList('Casa')
    const empresa = st().createList('Empresa')

    await call('criar_transacao', { descricao: 'A', valor: 10, tipo: 'despesa', tabela: 'empresa' })
    await call('criar_transacao', { descricao: 'B', valor: 20, tipo: 'despesa', tabela: empresa })

    expect(txs(empresa).map((t) => t.description)).toEqual(['A', 'B'])
  })

  it('errors on an unknown table and when none exists', async () => {
    expect((await call('criar_transacao', { descricao: 'X', valor: 1, tipo: 'despesa' })).error).toBeTruthy()
    st().createList('Casa')
    expect((await call('criar_transacao', { descricao: 'X', valor: 1, tipo: 'despesa', tabela: 'Nada' })).error).toBeTruthy()
  })

  it('lands in the totals ler_financeiro reports', async () => {
    st().createList('Casa')
    await call('criar_transacao', { descricao: 'Salário', valor: 5000, tipo: 'receita', data: '2026-07-01' })
    await call('criar_transacao', { descricao: 'Mercado', valor: 150.5, tipo: 'despesa', data: '2026-07-02' })

    const res = await call('ler_financeiro', {})
    const tabela = (res.tabelas as { receitas: string; despesas: string; saldo: string }[])[0]

    // The round trip is the point: written as strings, summed with decimal.js.
    expect(tabela.receitas).toBe('5000')
    expect(tabela.despesas).toBe('150.5')
    expect(tabela.saldo).toBe('4849.5')
  })

  it('is gated behind approval and puts the amount on the card', () => {
    expect(isWriteTool('criar_transacao')).toBe(true)
    expect(TOOL_DEFS.some((d) => d.function.name === 'criar_transacao')).toBe(true)

    const label = describeToolCall('criar_transacao', {
      descricao: 'Mercado',
      valor: 150.5,
      tipo: 'despesa',
      categoria: 'Alimentação'
    })
    expect(label).toContain('Despesa')
    expect(label).toContain('150.5')
    expect(label).toContain('Mercado')
  })
})

// ── marcar_habito ────────────────────────────────────────────────────────────

describe('marcar_habito', () => {
  beforeEach(resetStore)
  afterEach(() => vi.useRealTimers())

  const habit = (id: string): NonNullable<ReturnType<typeof st>['habits'][number]> =>
    st().habits.find((h) => h.id === id)!
  const seed = (name = 'Ler'): string => st().createHabit({ name, color: PROJECT_COLORS[0] })

  it('marks the habit done today and reports the streak', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 16, 10, 0, 0)) // 16 Jul 2026, local
    const id = seed()
    st().toggleHabit(id, '2026-07-15') // yesterday, so today makes it 2

    const res = await call('marcar_habito', { habitoId: id })

    expect(res).toMatchObject({ ok: true, habito: 'Ler', data: '2026-07-16', streak: 2 })
    expect(habit(id).completions).toContain('2026-07-16')
  })

  it('is a no-op when already marked today — it must never unmark', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 16, 10, 0, 0))
    const id = seed()
    await call('marcar_habito', { nome: 'Ler' })
    expect(habit(id).completions).toEqual(['2026-07-16'])

    // store.toggleHabit would flip it back off; the tool must not.
    const res = await call('marcar_habito', { nome: 'Ler' })

    expect(res).toMatchObject({ ok: true, jaEstavaMarcado: true })
    expect(habit(id).completions).toEqual(['2026-07-16'])
  })

  it('uses the local day, not the UTC one', async () => {
    vi.useFakeTimers()
    // 21:00 on the 16th in UTC-3 is already the 17th in UTC. HabitView's
    // checkbox ticks the 16th, so the tool must write the 16th too.
    vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'))
    // The suite pins TZ to UTC-3; without that this assertion is toothless.
    expect(new Date().getTimezoneOffset()).toBe(180)
    const id = seed()

    const res = await call('marcar_habito', { habitoId: id })

    expect(res.data).toBe('2026-07-16')
    expect(habit(id).completions).toEqual(['2026-07-16'])
  })

  it('agrees with the date ler_habitos calls today', async () => {
    const id = seed()
    await call('marcar_habito', { habitoId: id })
    const res = await call('ler_habitos', {})
    // Disagreement here means marking a habit leaves it showing as not done.
    expect((res.habitos as { feitoHoje: boolean }[])[0].feitoHoje).toBe(true)
  })

  it('matches the name case-insensitively', async () => {
    const id = seed('Correr')
    expect((await call('marcar_habito', { nome: ' correr ' })).ok).toBe(true)
    expect(habit(id).completions).toHaveLength(1)
  })

  it('refuses an ambiguous name and hands back the ids', async () => {
    const a = seed('Ler')
    const b = seed('Ler')

    const res = await call('marcar_habito', { nome: 'Ler' })

    expect(res.error).toBeTruthy()
    expect((res.candidatos as { id: string }[]).map((c) => c.id).sort()).toEqual([a, b].sort())
    expect(habit(a).completions).toEqual([])
    expect(habit(b).completions).toEqual([])
  })

  it('errors when the habit is unknown or unidentified', async () => {
    seed()
    expect((await call('marcar_habito', { habitoId: 'nope' })).error).toBeTruthy()
    expect((await call('marcar_habito', {})).error).toBeTruthy()
  })

  it('is gated behind approval and offered to the model', () => {
    expect(isWriteTool('marcar_habito')).toBe(true)
    expect(TOOL_DEFS.some((d) => d.function.name === 'marcar_habito')).toBe(true)
    expect(describeToolCall('marcar_habito', { nome: 'Ler' })).toContain('Ler')
  })

  it('ler_habitos exposes the id that marcar_habito needs', async () => {
    const id = seed()
    const res = await call('ler_habitos', {})
    expect((res.habitos as { id: string }[])[0].id).toBe(id)
  })
})

// ── criar_meta / atualizar_meta ───────────────────────────────────────────────

describe('criar_meta', () => {
  beforeEach(resetStore)

  const goal = (id: unknown): NonNullable<ReturnType<typeof st>['goals'][number]> =>
    st().goals.find((g) => g.id === id)!

  it('creates the goal at zero progress', async () => {
    const res = await call('criar_meta', { titulo: ' Correr ', alvo: 100, unidade: ' km ' })

    expect(res).toMatchObject({ ok: true, titulo: 'Correr', alvo: 100, unidade: 'km', progresso: 0 })
    expect(goal(res.metaId)).toMatchObject({ title: 'Correr', target: 100, unit: 'km' })
    // Progress comes from entries, and a new goal has none.
    expect(goal(res.metaId).entries).toEqual([])
  })

  it('defaults the unit and colour when they are omitted', async () => {
    const res = await call('criar_meta', { titulo: 'Ler', alvo: 12 })
    expect(goal(res.metaId)).toMatchObject({ unit: '', color: PROJECT_COLORS[0] })
  })

  it('accepts a numeric string for alvo, as models tend to send', async () => {
    const res = await call('criar_meta', { titulo: 'Ler', alvo: '12' })
    expect(goal(res.metaId).target).toBe(12)
  })

  it('rejects a target that is not a positive number', async () => {
    // ler_metas divides by target for the percentage.
    for (const alvo of [0, -5, 'muitos', Infinity, NaN]) {
      expect((await call('criar_meta', { titulo: 'X', alvo })).error).toBeTruthy()
    }
    expect(st().goals).toHaveLength(0)
  })

  it('rejects a blank title and an unknown colour', async () => {
    expect((await call('criar_meta', { titulo: '  ', alvo: 10 })).error).toBeTruthy()
    expect((await call('criar_meta', { titulo: 'X', alvo: 10, cor: 'roxo' })).error).toBeTruthy()
    expect(st().goals).toHaveLength(0)
  })

  it('links to a project, but refuses one that does not exist', async () => {
    const pid = st().createProject('P')
    const ok = await call('criar_meta', { titulo: 'A', alvo: 10, projectId: pid })
    expect(goal(ok.metaId).projectId).toBe(pid)

    const bad = await call('criar_meta', { titulo: 'B', alvo: 10, projectId: 'nope' })
    expect(bad.error).toBeTruthy()
    expect(st().goals).toHaveLength(1)
  })

  it('is gated behind approval and offered to the model', () => {
    expect(isWriteTool('criar_meta')).toBe(true)
    expect(TOOL_DEFS.some((d) => d.function.name === 'criar_meta')).toBe(true)
  })
})

describe('atualizar_meta', () => {
  beforeEach(resetStore)

  /** A goal with 30 of 100 km already logged across two entries. */
  const seed = (): string => {
    const id = st().createGoal({ title: 'Correr', target: 100, unit: 'km', color: PROJECT_COLORS[0] })
    st().addGoalEntry(id, { date: '2026-07-01', value: 10 })
    st().addGoalEntry(id, { date: '2026-07-02', value: 20 })
    return id
  }
  const goal = (id: string): NonNullable<ReturnType<typeof st>['goals'][number]> =>
    st().goals.find((g) => g.id === id)!

  it('edits only the fields it was given', async () => {
    const id = seed()

    const res = await call('atualizar_meta', { metaId: id, alvo: 60 })

    expect(res).toMatchObject({ ok: true, atualizados: ['target'] })
    expect(goal(id).target).toBe(60)
    expect(goal(id)).toMatchObject({ title: 'Correr', unit: 'km', color: PROJECT_COLORS[0] })
  })

  it('never touches the logged entries, and re-reports progress against the new target', async () => {
    const id = seed()

    const res = await call('atualizar_meta', { metaId: id, alvo: 60 })

    // Moving the goalposts must not rewrite history: 30km logged stays 30km.
    expect(goal(id).entries).toHaveLength(2)
    expect(res).toMatchObject({ atual: 30, progresso: 50 })
  })

  it('renames, re-units and re-colours by title', async () => {
    const id = seed()

    const res = await call('atualizar_meta', {
      titulo: 'correr',
      novoTitulo: 'Maratona',
      unidade: 'milhas',
      cor: PROJECT_COLORS[2]
    })

    expect(res.ok).toBe(true)
    expect(goal(id)).toMatchObject({ title: 'Maratona', unit: 'milhas', color: PROJECT_COLORS[2] })
  })

  it('links and unlinks the project', async () => {
    const id = seed()
    const pid = st().createProject('P')

    await call('atualizar_meta', { metaId: id, projectId: pid })
    expect(goal(id).projectId).toBe(pid)

    await call('atualizar_meta', { metaId: id, projectId: '' })
    expect(goal(id).projectId).toBeUndefined()
  })

  it('refuses an ambiguous title and hands back the ids', async () => {
    const a = seed()
    const b = st().createGoal({ title: 'Correr', target: 5, unit: 'km', color: PROJECT_COLORS[0] })

    const res = await call('atualizar_meta', { titulo: 'Correr', alvo: 42 })

    expect(res.error).toBeTruthy()
    expect((res.candidatos as { id: string }[]).map((c) => c.id).sort()).toEqual([a, b].sort())
    expect(goal(a).target).toBe(100)
    expect(goal(b).target).toBe(5)
  })

  it('rejects an invalid target, blank rename and unknown project', async () => {
    const id = seed()
    expect((await call('atualizar_meta', { metaId: id, alvo: 0 })).error).toBeTruthy()
    expect((await call('atualizar_meta', { metaId: id, novoTitulo: ' ' })).error).toBeTruthy()
    expect((await call('atualizar_meta', { metaId: id, projectId: 'nope' })).error).toBeTruthy()
    expect(goal(id)).toMatchObject({ target: 100, title: 'Correr' })
  })

  it('errors when nothing was given or the goal is unknown', async () => {
    const id = seed()
    const before = goal(id).updatedAt
    expect((await call('atualizar_meta', { metaId: id })).error).toBeTruthy()
    expect(goal(id).updatedAt).toBe(before)
    expect((await call('atualizar_meta', { metaId: 'nope', alvo: 5 })).error).toBeTruthy()
  })

  it('is gated behind approval and spells out the fields it changes', () => {
    expect(isWriteTool('atualizar_meta')).toBe(true)
    expect(TOOL_DEFS.some((d) => d.function.name === 'atualizar_meta')).toBe(true)

    const label = describeToolCall('atualizar_meta', { titulo: 'Correr', alvo: 60, projectId: '' })
    expect(label).toContain('alvo → 60')
    expect(label).toContain('desvincular do projeto')
  })

  it('ler_metas exposes the id that atualizar_meta needs', async () => {
    const id = seed()
    const res = await call('ler_metas', {})
    expect((res.metas as { id: string }[])[0].id).toBe(id)
  })
})

// ── criar_sprints ────────────────────────────────────────────────────────────

describe('criar_sprints', () => {
  beforeEach(resetStore)

  it('creates sprints in the given project', async () => {
    const pid = st().createProject('P')
    const res = await call('criar_sprints', { projectId: pid, nomes: ['Sprint 1', 'Sprint 2'] })
    expect(res.criadas).toEqual(['Sprint 1', 'Sprint 2'])

    const names = st()
      .sprints.filter((s) => s.projectId === pid)
      .map((s) => s.name)
    expect(names).toEqual(expect.arrayContaining(['Sprint 1', 'Sprint 2']))
  })

  it('falls back to the active project when projectId is omitted', async () => {
    const pid = st().createProject('P') // createProject sets it active
    await call('criar_sprints', { nomes: ['Sprint X'] })
    expect(st().sprints.some((s) => s.projectId === pid && s.name === 'Sprint X')).toBe(true)
  })

  it('returns an error when no names are given', async () => {
    st().createProject('P')
    expect((await call('criar_sprints', { nomes: [] })).error).toBeTruthy()
  })
})

// ── atribuir_sprint ──────────────────────────────────────────────────────────

describe('atribuir_sprint', () => {
  beforeEach(resetStore)

  it('assigns an existing sprint to a task by name (case-insensitive)', async () => {
    const pid = st().createProject('P')
    const backlog = st().projects[0].columns[0]
    const tid = st().createTask({ projectId: pid, columnId: backlog.id, title: 'T' })
    st().createSprints(pid, ['Sprint 1'])
    const sprintId = st().sprints.find((s) => s.name === 'Sprint 1')!.id

    const res = await call('atribuir_sprint', { taskId: tid, sprint: 'sprint 1' })
    expect(res.ok).toBe(true)
    expect(st().tasks.find((t) => t.id === tid)!.sprintId).toBe(sprintId)
  })

  it('returns an error listing available sprints when the sprint is unknown', async () => {
    const pid = st().createProject('P')
    const backlog = st().projects[0].columns[0]
    const tid = st().createTask({ projectId: pid, columnId: backlog.id, title: 'T' })
    st().createSprints(pid, ['Sprint 1'])

    const res = await call('atribuir_sprint', { taskId: tid, sprint: 'Missing' })
    expect(res.error).toBeTruthy()
    expect(res.disponiveis).toEqual(['Sprint 1'])
  })
})

// ── criar_tasks / importTasksFromAIChat ──────────────────────────────────────

describe('importTasksFromAIChat (via criar_tasks)', () => {
  beforeEach(resetStore)

  it('matches column and sprint by name (case-insensitive)', async () => {
    const pid = st().createProject('P')
    st().createSprints(pid, ['Sprint 1'])
    const inProgress = st().projects[0].columns.find((c) => c.name === 'In Progress')!
    const first = st().projects[0].columns[0]
    const sprintId = st().sprints.find((s) => s.name === 'Sprint 1')!.id

    const count = st().importTasksFromAIChat(pid, [
      { title: 'A', column: 'in progress', sprint: 'SPRINT 1' },
      { title: 'B' }
    ])
    expect(count).toBe(2)

    const a = st().tasks.find((t) => t.title === 'A')!
    const b = st().tasks.find((t) => t.title === 'B')!
    expect(a.columnId).toBe(inProgress.id)
    expect(a.sprintId).toBe(sprintId)
    // B has no column/sprint → first column, no sprint
    expect(b.columnId).toBe(first.id)
    expect(b.sprintId).toBeUndefined()
  })

  it('falls back to the first column when the column name does not match', async () => {
    const pid = st().createProject('P')
    const first = st().projects[0].columns[0]
    st().importTasksFromAIChat(pid, [{ title: 'X', column: 'Nonexistent' }])
    expect(st().tasks.find((t) => t.title === 'X')!.columnId).toBe(first.id)
  })

  it('returns 0 when the project does not exist', async () => {
    expect(st().importTasksFromAIChat('nope', [{ title: 'X' }])).toBe(0)
  })

  it('criar_tasks tool delegates to importTasksFromAIChat', async () => {
    const pid = st().createProject('P')
    const res = await call('criar_tasks', { projectId: pid, tasks: [{ title: 'A' }, { title: 'B' }] })
    expect(res.criadas).toBe(2)
    expect(st().tasks.filter((t) => t.projectId === pid)).toHaveLength(2)
  })
})

// ── ler_tasks: filters ─────────────────────────────────────────────────────────

/**
 * A board is not a free thing to read: everything a tool returns is resent to
 * the model on every later step of the run, so `ler_tasks` on a real project
 * (155 tasks here) costs ~8.5k tokens *per remaining step*. The filters are how
 * a question about one subject stops paying for the whole board.
 */
describe('ler_tasks — filters', () => {
  beforeEach(resetStore)

  /** A project with a handful of tasks whose titles/tags/columns differ. */
  const seed = (): string => {
    const pid = st().createProject('P')
    const [backlog, doing] = st().projects[0].columns
    const mk = (columnId: string, title: string, tags: string[]): string =>
      st().createTask({ projectId: pid, columnId, title, tags })
    mk(backlog.id, 'Revisar o layout do painel', ['Dev'])
    mk(backlog.id, 'Corrigir bug no login', ['Dev'])
    mk(doing.id, 'Estudar japonês', ['Estudo'])
    mk(doing.id, 'Revisão de código', ['Dev'])
    return pid
  }

  it('returns the whole board when asked for nothing in particular', async () => {
    seed()
    const res = await call('ler_tasks', {})
    expect(res.total).toBe(4)
    expect(res.truncado).toBe(false)
    expect((res.tasks as unknown[]).length).toBe(4)
  })

  it('narrows to a subject with busca', async () => {
    seed()
    const res = await call('ler_tasks', { busca: 'bug' })

    expect(res.total).toBe(1)
    expect((res.tasks as { titulo: string }[])[0].titulo).toBe('Corrigir bug no login')
  })

  it('ignores accents and case, because the app is in Portuguese', async () => {
    seed()
    // Nobody reaches for the accent keys mid-question, and the model won't either.
    const res = await call('ler_tasks', { busca: 'japones' })

    expect((res.tasks as { titulo: string }[])[0].titulo).toBe('Estudar japonês')
    expect((await call('ler_tasks', { busca: 'REVISAR' })).total).toBe(1)
    // …and an accented query still finds the unaccented title.
    expect((await call('ler_tasks', { busca: 'revisão' })).total).toBe(1)
  })

  it('filters by tag, column and completion', async () => {
    const pid = seed()
    expect((await call('ler_tasks', { tag: 'Estudo' })).total).toBe(1)
    expect((await call('ler_tasks', { coluna: st().projects[0].columns[1].name })).total).toBe(2)

    // Through the real path — completion is a move into the Done column.
    await call('concluir_task', { titulo: 'Estudar japonês' })
    expect((await call('ler_tasks', { projectId: pid, concluida: true })).total).toBe(1)
    expect((await call('ler_tasks', { projectId: pid, concluida: false })).total).toBe(3)
  })

  it('combines filters rather than picking one', async () => {
    seed()
    const res = await call('ler_tasks', { busca: 'revis', tag: 'Dev' })

    // "Revisar o layout" (Dev) and "Revisão de código" (Dev) match; "Estudar
    // japonês" is neither.
    expect(res.total).toBe(2)
  })

  it('says how many matched, so a slice is not read as the whole board', async () => {
    seed()
    const res = await call('ler_tasks', { limit: 2 })

    // The model must be able to tell "here are 2" from "you have 2" — without
    // `total` it would answer the wrong number with total confidence.
    expect(res.total).toBe(4)
    expect(res.truncado).toBe(true)
    expect((res.tasks as unknown[]).length).toBe(2)
  })

  it('bounds the result even when the model asks for everything', async () => {
    const pid = st().createProject('P')
    const col = st().projects[0].columns[0].id
    for (let i = 0; i < 620; i++) st().createTask({ projectId: pid, columnId: col, title: `Task ${i}` })

    // A hand-picked limit is a suggestion from the model, not an instruction.
    const res = await call('ler_tasks', { limit: 10_000 })
    expect((res.tasks as unknown[]).length).toBe(500)
    expect(res.total).toBe(620)
    expect(res.truncado).toBe(true)

    // …and the default caps it too, without being asked.
    expect(((await call('ler_tasks', {})).tasks as unknown[]).length).toBe(200)
  })

  it('falls back to the default on a nonsense limit', async () => {
    seed()
    for (const limit of [0, -5, NaN, 'muitas']) {
      expect((await call('ler_tasks', { limit })).total).toBe(4)
    }
  })

  it('finds nothing without erroring when nothing matches', async () => {
    seed()
    const res = await call('ler_tasks', { busca: 'nada com esse nome' })

    expect(res.total).toBe(0)
    expect(res.tasks).toEqual([])
  })
})

// ── describeToolActivity with no arguments yet ─────────────────────────────────

/**
 * This labels two different moments: a tool that is running (args known) and a
 * tool call the model is still composing (name known, args still arriving).
 * The second is why absent args must never be filled in with a guess.
 */
describe('describeToolActivity — before the arguments arrive', () => {
  it('never claims a count it has not been given', () => {
    // "Criando 0 task(s)" is what a user saw while the model wrote a call that
    // creates twenty — a statement of fact, and false.
    expect(describeToolActivity('criar_tasks', {})).toBe('Criando tasks')
    expect(describeToolActivity('criar_tasks', { tasks: [{}, {}] })).toBe('Criando 2 task(s)')
  })

  it('never guesses which way the money goes', () => {
    // The type used to default to 'despesa', announcing a direction the model
    // had not chosen yet.
    expect(describeToolActivity('criar_transacao', {})).toBe('Lançando uma transação')
    expect(describeToolActivity('criar_transacao', { tipo: 'receita', valor: '10' })).toContain(
      'receita'
    )
    expect(describeToolActivity('criar_transacao', { tipo: 'despesa', valor: '10' })).toContain(
      'despesa'
    )
  })

  it('says the verb rather than a bare "?" for every tool', () => {
    // '?' is honest but reads as a glitch; these are shown to the user as a
    // sentence while the call is composed.
    for (const name of [
      'criar_projeto',
      'atualizar_task',
      'concluir_task',
      'deletar_task',
      'iniciar_cronometro',
      'marcar_habito',
      'criar_meta',
      'atualizar_meta',
      'criar_sprints',
      'atribuir_sprint'
    ]) {
      const text = describeToolActivity(name, {})
      expect(text).not.toContain('?')
      expect(text).not.toBe(name) // it fell through to the default
    }
  })

  it('still spells out the detail once the arguments are there', () => {
    // The generic form is a fallback, not a downgrade.
    expect(describeToolActivity('deletar_task', { titulo: 'Comprar leite' })).toBe(
      'Deletando a task Comprar leite'
    )
    expect(describeToolActivity('criar_projeto', { nome: 'Sagyou' })).toBe(
      'Criando o projeto Sagyou'
    )
  })

  it('names every registered tool, so none shows up as a raw identifier', () => {
    // The transient line renders this for whatever the model calls; a tool
    // added without a case here would surface as "criar_foo" mid-chat.
    for (const def of TOOL_DEFS) {
      expect(describeToolActivity(def.function.name, {})).not.toBe(def.function.name)
    }
  })
})
