import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/ElectronStorage', () => {
  return {
    ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
      this.load = vi.fn().mockResolvedValue({})
      this.save = vi.fn().mockResolvedValue(undefined)
      this.exportBackup = vi.fn().mockResolvedValue({ success: true })
      this.autoSaveBackup = vi.fn().mockResolvedValue({ success: true })
      this.commitBackupBlobs = vi.fn().mockResolvedValue({ success: true })
      this.importBackup = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.importAIJson = vi.fn().mockResolvedValue({ success: false, cancelled: true })
      this.loadMemories = vi.fn().mockResolvedValue([])
      this.replaceMemories = vi.fn().mockResolvedValue(undefined)
      this.rebuildSearchIndex = vi.fn().mockResolvedValue(undefined)
    })
  }
})

import { useKanbanStore } from '../../store/kanban'
import {
  applyMcpAction,
  formatMcpMoney,
  freeNotePosition,
  parseMcpMoney,
  prepareMcpAction
} from '../../services/mcpActions'
import {
  DEFAULT_FINANCIAL_PROFILE_ID,
  PROJECT_COLORS,
  type FinancialProfile,
  type FinancialTable,
  type Goal,
  type Project,
  type StickyNote,
  type Task
} from '../../types'
import {
  MCP_RENDERER_WRITE_TOOLS,
  type McpActionResult,
  type McpScope
} from '../../types/mcp-actions'

const state = (): ReturnType<typeof useKanbanStore.getState> => useKanbanStore.getState()

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
    financialProfiles: [
      {
        id: DEFAULT_FINANCIAL_PROFILE_ID,
        name: 'Minhas finanças',
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z'
      }
    ],
    activeFinancialProfileId: DEFAULT_FINANCIAL_PROFILE_ID,
    activeProjectId: null,
    sprintFilter: null,
    activeTimers: [],
    isLoaded: true
  })
}

/** Runs both phases the way main does: prepare must pass before apply. */
function both(name: string, args: Record<string, unknown>, scope: McpScope): McpActionResult {
  const prepared = prepareMcpAction(name, args, scope)
  if (!prepared.ok) return prepared
  return applyMcpAction(name, args, scope)
}

function seedProject(name = 'Sagyou'): { id: string; scope: McpScope } {
  const id = state().createProject(name)
  return { id, scope: { projectId: id, financialProfileId: DEFAULT_FINANCIAL_PROFILE_ID } }
}

const general: McpScope = { projectId: null, financialProfileId: DEFAULT_FINANCIAL_PROFILE_ID }
const project = (id: string): Project => state().projects.find((item) => item.id === id)!

describe('MCP project and column writes', () => {
  beforeEach(resetStore)

  it('prepare never writes', () => {
    const { scope } = seedProject()
    const result = prepareMcpAction('create_column', { name: 'Testes' }, scope)
    expect(result).toMatchObject({ ok: true, resumo: 'Criar coluna "Testes" em Sagyou' })
    expect(state().projects[0].columns.map((c) => c.name)).not.toContain('Testes')
  })

  it('create_project trims, creates default columns and keeps the active project', () => {
    const { id: active } = seedProject('Atual')
    const result = both('create_project', { name: '  Novo  ', color: PROJECT_COLORS[1] }, general)
    expect(result.ok).toBe(true)
    const created = state().projects.find((p) => p.name === 'Novo')!
    expect(created.color).toBe(PROJECT_COLORS[1])
    expect(created.columns).toHaveLength(4)
    expect(state().activeProjectId).toBe(active)
  })

  it('create_project with a duplicate name returns the existing id without writing', () => {
    const { id } = seedProject('Sagyou')
    const result = both('create_project', { name: 'sagyou ' }, general)
    expect(result).toMatchObject({ ok: true, id, existente: true })
    expect(state().projects).toHaveLength(1)
  })

  it('update_project edits fields and refuses an unknown color', () => {
    const { id, scope } = seedProject()
    expect(both('update_project', { description: 'Kanban' }, scope).ok).toBe(true)
    expect(project(id).description).toBe('Kanban')
    expect(both('update_project', { color: '#123456' }, scope)).toMatchObject({ ok: false })
    expect(both('update_project', {}, scope)).toEqual({ ok: false, error: 'Nada para alterar.' })
  })

  it('links replace keeps ids of unchanged urls and refuses credentials', () => {
    const { id, scope } = seedProject()
    state().updateProject(id, {
      links: [{ id: 'keep', label: 'Repo', url: 'https://github.com/x/y' }]
    })
    expect(
      both(
        'update_project',
        {
          links: [
            { label: 'Repo', url: 'https://github.com/x/y' },
            { url: 'https://docs.example.com/a' }
          ]
        },
        scope
      ).ok
    ).toBe(true)
    const links = project(id).links!
    expect(links[0].id).toBe('keep')
    expect(links[1]).toMatchObject({ label: 'docs.example.com', url: 'https://docs.example.com/a' })
    expect(
      both('update_project', { links: [{ url: 'https://user:senha@example.com/' }] }, scope)
    ).toEqual({ ok: false, error: 'Links não podem conter usuário ou senha.' })
    expect(both('update_project', { links: [] }, scope).ok).toBe(true)
    expect(project(id).links).toEqual([])
  })

  it('archive and unarchive are idempotent', () => {
    const { id, scope } = seedProject()
    expect(both('archive_project', {}, scope)).toMatchObject({ ok: true })
    expect(project(id).archivedAt).toBeDefined()
    expect(both('archive_project', {}, scope)).toMatchObject({ ok: true, jaArquivado: true })
    expect(both('unarchive_project', {}, scope)).toMatchObject({ ok: true })
    expect(project(id).archivedAt).toBeUndefined()
  })

  it('delete_project removes notes, unlinks goals, and the resumo counts tasks and notes', () => {
    const { id, scope } = seedProject()
    const col = project(id).columns[0].id
    state().createTask({ projectId: id, columnId: col, title: 'A' })
    state().createTask({ projectId: id, columnId: col, title: 'B' })
    state().createNote(id, { content: 'nota' })
    state().createGoal({
      title: 'Meta',
      target: 3,
      unit: '',
      color: PROJECT_COLORS[0],
      kind: 'quantity',
      projectId: id
    })
    expect(prepareMcpAction('delete_project', {}, scope)).toMatchObject({
      resumo: 'Excluir projeto "Sagyou" e 2 tarefa(s), com 1 nota(s) do canvas'
    })
    expect(applyMcpAction('delete_project', {}, scope).ok).toBe(true)
    expect(state().projects).toHaveLength(0)
    expect(state().tasks).toHaveLength(0)
    expect(state().notes).toHaveLength(0)
    expect(state().goals).toHaveLength(1)
    expect(state().goals[0].projectId).toBeUndefined()
  })

  it('delete_project of a project removed after prepare refuses in apply', () => {
    const { id, scope } = seedProject()
    expect(prepareMcpAction('delete_project', {}, scope).ok).toBe(true)
    state().deleteProject(id)
    expect(applyMcpAction('delete_project', {}, scope)).toEqual({
      ok: false,
      error: 'Projeto não encontrado.'
    })
  })

  it('general scope without projectId asks for one', () => {
    expect(both('create_column', { name: 'X' }, general)).toEqual({
      ok: false,
      error: 'Escolha um projeto em list_projects.'
    })
  })

  it('create, rename and reorder columns', () => {
    const { id, scope } = seedProject()
    const created = both('create_column', { name: 'Testes' }, scope)
    expect(created.ok).toBe(true)
    expect(project(id).columns.at(-1)!.name).toBe('Testes')
    expect(both('update_column', { column: 'testes', name: 'QA' }, scope).ok).toBe(true)
    expect(project(id).columns.at(-1)!.name).toBe('QA')
    const reversed = project(id)
      .columns.map((c) => c.id)
      .reverse()
    expect(both('reorder_columns', { columnIds: reversed }, scope).ok).toBe(true)
    expect([...project(id).columns].sort((a, b) => a.order - b.order).map((c) => c.id)).toEqual(
      reversed
    )
    expect(both('reorder_columns', { columnIds: reversed.slice(1) }, scope)).toEqual({
      ok: false,
      error: 'columnIds precisa listar todas as colunas do projeto, uma vez cada.'
    })
  })

  it('renaming Done or naming a column done is refused', () => {
    const { scope } = seedProject()
    const refusal = {
      ok: false,
      error: 'A coluna de concluídas é identificada pelo nome "Done"; renomeie-a no Sagyou.'
    }
    expect(both('update_column', { column: 'Done', name: 'Feito' }, scope)).toEqual(refusal)
    expect(both('update_column', { column: 'Review', name: 'DONE' }, scope)).toEqual(refusal)
    expect(both('create_column', { name: 'done' }, scope)).toEqual(refusal)
  })

  it('delete_column refuses a column with tasks and the last column', () => {
    const { id, scope } = seedProject()
    const backlog = project(id).columns[0]
    state().createTask({ projectId: id, columnId: backlog.id, title: 'A' })
    expect(both('delete_column', { column: 'Backlog' }, scope)).toEqual({
      ok: false,
      error: 'A coluna "Backlog" tem 1 tarefa(s); mova-as antes de excluí-la.'
    })
    expect(both('delete_column', { column: 'Review' }, scope).ok).toBe(true)
    expect(project(id).columns.map((c) => c.name)).not.toContain('Review')
  })

  it('delete_column refuses in apply when a task appeared after prepare, deleting nothing', () => {
    const { id, scope } = seedProject()
    const review = project(id).columns.find((c) => c.name === 'Review')!
    expect(prepareMcpAction('delete_column', { column: 'Review' }, scope).ok).toBe(true)
    state().createTask({ projectId: id, columnId: review.id, title: 'Nova' })
    expect(applyMcpAction('delete_column', { column: 'Review' }, scope)).toMatchObject({
      ok: false
    })
    expect(state().tasks).toHaveLength(1)
    expect(project(id).columns.map((c) => c.name)).toContain('Review')
  })
})

describe('MCP task writes', () => {
  beforeEach(resetStore)

  function seedTasks(): {
    id: string
    scope: McpScope
    taskId: string
    col: (name: string) => string
  } {
    const { id, scope } = seedProject()
    const col = (name: string): string => project(id).columns.find((c) => c.name === name)!.id
    const taskId = state().createTask({
      projectId: id,
      columnId: col('Backlog'),
      title: 'Corrigir login',
      description: 'antiga',
      dueDate: '2026-11-01',
      tags: ['bug']
    })
    return { id, scope, taskId, col }
  }
  const task = (id: string): Task | undefined => state().tasks.find((t) => t.id === id)

  it('update_task only touches sent keys and clears with empty string', () => {
    const { scope, taskId } = seedTasks()
    expect(both('update_task', { id: taskId, priority: 'high', description: '' }, scope).ok).toBe(
      true
    )
    expect(task(taskId)).toMatchObject({
      priority: 'high',
      dueDate: '2026-11-01',
      tags: ['bug'],
      title: 'Corrigir login'
    })
    expect(task(taskId)!.description).toBeUndefined()
    expect(both('update_task', { id: taskId, tags: [], newTitle: 'Login' }, scope).ok).toBe(true)
    expect(task(taskId)).toMatchObject({ tags: [], title: 'Login' })
  })

  it('update_task rejects an impossible date and an unknown priority', () => {
    const { scope, taskId } = seedTasks()
    expect(both('update_task', { id: taskId, dueDate: '2026-02-30' }, scope)).toMatchObject({
      ok: false
    })
    expect(both('update_task', { id: taskId, priority: 'alta' }, scope)).toMatchObject({
      ok: false
    })
    expect(task(taskId)!.dueDate).toBe('2026-11-01')
  })

  it('update_task assigns a sprint by name or id and clears it with empty string', () => {
    const { id, scope, taskId } = seedTasks()
    const sprintId = state().createSprint(id, 'Sprint 1')
    expect(both('update_task', { id: taskId, sprint: 'sprint 1' }, scope).ok).toBe(true)
    expect(task(taskId)!.sprintId).toBe(sprintId)
    expect(both('update_task', { id: taskId, sprint: '' }, scope).ok).toBe(true)
    expect(task(taskId)!.sprintId).toBeUndefined()
    expect(both('update_task', { id: taskId, sprint: sprintId }, scope).ok).toBe(true)
    expect(task(taskId)!.sprintId).toBe(sprintId)
  })

  it('update_task refuses a sprint from another project', () => {
    const { scope, taskId } = seedTasks()
    const other = state().createProject('Outro')
    const foreign = state().createSprint(other, 'Sprint 1')
    expect(both('update_task', { id: taskId, sprint: foreign }, scope)).toMatchObject({
      ok: false
    })
    expect(both('update_task', { id: taskId, sprint: 'Sprint 1' }, scope)).toMatchObject({
      ok: false
    })
    expect(task(taskId)!.sprintId).toBeUndefined()
  })

  it('create_sprint creates once and returns the existing sprint for a repeated name', () => {
    const { id, scope } = seedTasks()
    expect(prepareMcpAction('create_sprint', { name: 'Electron' }, scope).ok).toBe(true)
    expect(state().sprints).toHaveLength(0)
    const created = both('create_sprint', { name: '  Electron ' }, scope)
    expect(created.ok).toBe(true)
    expect(state().sprints).toMatchObject([{ projectId: id, name: 'Electron' }])
    expect(both('create_sprint', { name: 'electron' }, scope)).toMatchObject({
      ok: true,
      id: (created as { id: string }).id,
      existente: true
    })
    expect(state().sprints).toHaveLength(1)
  })

  it('finds a task by title and refuses an ambiguous title with candidatos', () => {
    const { id, scope, col } = seedTasks()
    expect(both('update_task', { title: 'corrigir LOGIN', priority: 'low' }, scope).ok).toBe(true)
    state().createTask({ projectId: id, columnId: col('Review'), title: 'Corrigir login' })
    const result = both('update_task', { title: 'Corrigir login', priority: 'urgent' }, scope)
    expect(result).toMatchObject({
      ok: false,
      error: 'Mais de um registro com esse título; use o id.'
    })
    expect((result as { candidatos: unknown[] }).candidatos).toHaveLength(2)
    expect(state().tasks.every((t) => t.priority !== 'urgent')).toBe(true)
  })

  it('move_task within the project reports completion and reopening', () => {
    const { scope, taskId, col } = seedTasks()
    expect(both('move_task', { id: taskId, column: 'Done' }, scope)).toMatchObject({
      ok: true,
      concluida: true
    })
    expect(task(taskId)!.columnId).toBe(col('Done'))
    expect(both('move_task', { id: taskId, column: 'Review' }, scope)).toMatchObject({
      ok: true,
      reaberta: true
    })
  })

  it('move_task across projects without column lands in the target first column', () => {
    const { scope, taskId } = seedTasks()
    const { id: other } = seedProject('Outro')
    expect(both('move_task', { id: taskId, projectId: other }, scope).ok).toBe(true)
    expect(task(taskId)).toMatchObject({
      projectId: other,
      columnId: project(other).columns[0].id
    })
  })

  it('move_task across projects resolves the column on the target, clears sprint and credits timer', () => {
    const { id, scope, taskId } = seedTasks()
    const sprintId = state().createSprint(id, 'S1')
    state().setTaskSprint(taskId, sprintId)
    useKanbanStore.setState({ activeTimers: [{ taskId, startedAt: Date.now() - 60_000 }] })
    const { id: other } = seedProject('Outro')
    const targetReview = project(other).columns.find((c) => c.name === 'Review')!.id
    expect(both('move_task', { id: taskId, projectId: other, column: 'Review' }, scope).ok).toBe(
      true
    )
    expect(task(taskId)).toMatchObject({ projectId: other, columnId: targetReview })
    expect(task(taskId)!.sprintId).toBeUndefined()
    expect(task(taskId)!.timeSpent).toBeGreaterThanOrEqual(60)
    expect(state().activeTimers).toHaveLength(0)
  })

  it('move_task to a column created earlier in the same run works', () => {
    const { scope, taskId } = seedTasks()
    expect(both('create_column', { name: 'Testes' }, scope).ok).toBe(true)
    expect(both('move_task', { id: taskId, column: 'Testes' }, scope).ok).toBe(true)
  })

  it('complete_task and reopen_task are idempotent', () => {
    const { scope, taskId, col } = seedTasks()
    expect(both('complete_task', { id: taskId }, scope)).toMatchObject({ ok: true })
    expect(task(taskId)).toMatchObject({ columnId: col('Done') })
    expect(task(taskId)!.completedAt).toBeDefined()
    expect(both('complete_task', { id: taskId }, scope)).toMatchObject({
      ok: true,
      jaConcluida: true
    })
    expect(both('reopen_task', { id: taskId }, scope)).toMatchObject({ ok: true })
    expect(task(taskId)).toMatchObject({ columnId: col('Backlog') })
    expect(both('reopen_task', { id: taskId }, scope)).toMatchObject({ ok: true, jaAberta: true })
  })

  it('complete_task refuses a project without a Done column', () => {
    const { id, scope, taskId } = seedTasks()
    const doneCol = project(id).columns.find((c) => c.name === 'Done')!
    state().deleteColumn(id, doneCol.id)
    expect(both('complete_task', { id: taskId }, scope)).toEqual({
      ok: false,
      error: 'O projeto não tem coluna de concluídas.'
    })
  })

  it('delete_task leaves a tombstone and its resumo names the project', () => {
    const { scope, taskId } = seedTasks()
    expect(prepareMcpAction('delete_task', { id: taskId }, scope)).toMatchObject({
      resumo: 'Excluir tarefa "Corrigir login" do projeto Sagyou'
    })
    expect(applyMcpAction('delete_task', { id: taskId }, scope).ok).toBe(true)
    expect(task(taskId)).toBeUndefined()
    expect(state().tombstones.some((t) => t.id === taskId && t.type === 'task')).toBe(true)
  })

  it('a task deleted after prepare returns "Tarefa não encontrada." in apply', () => {
    const { scope, taskId } = seedTasks()
    expect(prepareMcpAction('update_task', { id: taskId, priority: 'low' }, scope).ok).toBe(true)
    state().deleteTask(taskId)
    expect(applyMcpAction('update_task', { id: taskId, priority: 'low' }, scope)).toEqual({
      ok: false,
      error: 'Tarefa não encontrada.'
    })
  })
})

describe('MCP goal writes', () => {
  beforeEach(resetStore)
  const goal = (id: string): Goal | undefined => state().goals.find((g) => g.id === id)

  it('create_goal defaults and rejects target 0 and NaN', () => {
    const { id, scope } = seedProject()
    const created = both('create_goal', { title: 'Ler livros', target: 12, unit: 'livros' }, scope)
    expect(created.ok).toBe(true)
    const g = goal((created as { id: string }).id)!
    expect(g).toMatchObject({ kind: 'quantity', target: 12, color: PROJECT_COLORS[0] })
    expect(g.projectId).toBeUndefined()
    expect(both('create_goal', { title: 'X', target: 0 }, scope)).toMatchObject({ ok: false })
    expect(both('create_goal', { title: 'X', target: Number.NaN }, scope)).toMatchObject({
      ok: false
    })
    const scoped = both('create_goal', { title: 'Do projeto', target: 2, projectId: id }, scope)
    expect(goal((scoped as { id: string }).id)!.projectId).toBe(id)
  })

  it('completion goal forces target 1 and progress writes value 1', () => {
    const { scope } = seedProject()
    const created = both(
      'create_goal',
      { title: 'Lançar v1', kind: 'completion', target: 9 },
      scope
    )
    const id = (created as { id: string }).id
    expect(goal(id)!.target).toBe(1)
    expect(both('add_goal_progress', { id, value: 5 }, scope)).toMatchObject({
      ok: true,
      concluida: true
    })
    expect(goal(id)!.entries.map((e) => e.value)).toEqual([1])
  })

  it('add_goal_progress requires a positive value on quantity goals and no-ops when reached', () => {
    const { scope } = seedProject()
    const id = (both('create_goal', { title: 'Correr', target: 10 }, scope) as { id: string }).id
    expect(both('add_goal_progress', { id }, scope)).toMatchObject({ ok: false })
    expect(both('add_goal_progress', { id, value: -1 }, scope)).toMatchObject({ ok: false })
    expect(
      both(
        'add_goal_progress',
        { title: 'correr', value: 10, date: '2026-10-20', label: 'treino' },
        scope
      )
    ).toMatchObject({ ok: true, progresso: 10, concluida: true })
    expect(goal(id)!.entries[0]).toMatchObject({ date: '2026-10-20', label: 'treino', value: 10 })
    expect(both('add_goal_progress', { id, value: 1 }, scope)).toMatchObject({
      ok: true,
      jaConcluida: true
    })
    expect(goal(id)!.entries).toHaveLength(1)
  })

  it('update_goal edits fields and refuses an unknown project', () => {
    const { scope } = seedProject()
    const id = (both('create_goal', { title: 'Correr', target: 10 }, scope) as { id: string }).id
    expect(both('update_goal', { id, newTitle: 'Correr 10k', target: 20 }, scope).ok).toBe(true)
    expect(goal(id)).toMatchObject({ title: 'Correr 10k', target: 20 })
    expect(both('update_goal', { id, projectId: 'nope' }, scope)).toEqual({
      ok: false,
      error: 'Projeto não encontrado.'
    })
  })

  it('an ambiguous goal title returns candidatos', () => {
    const { scope } = seedProject()
    both('create_goal', { title: 'Meta', target: 1 }, scope)
    both('create_goal', { title: 'meta', target: 2 }, scope)
    expect(both('delete_goal', { title: 'Meta' }, scope)).toMatchObject({
      ok: false,
      error: 'Mais de um registro com esse título; use o id.'
    })
    expect(state().goals).toHaveLength(2)
  })

  it('delete_goal removes the goal', () => {
    const { scope } = seedProject()
    const id = (both('create_goal', { title: 'Meta', target: 1 }, scope) as { id: string }).id
    expect(prepareMcpAction('delete_goal', { id }, scope)).toMatchObject({
      resumo: 'Excluir meta "Meta"'
    })
    expect(applyMcpAction('delete_goal', { id }, scope).ok).toBe(true)
    expect(goal(id)).toBeUndefined()
  })
})

describe('MCP note writes', () => {
  beforeEach(resetStore)

  it('freeNotePosition skips occupied cells', () => {
    expect(freeNotePosition([])).toEqual({ x: 100, y: 100 })
    const at = (x: number, y: number): StickyNote =>
      ({ x, y, width: 200, height: 150 }) as StickyNote
    expect(freeNotePosition([at(100, 100)])).toEqual({ x: 320, y: 100 })
    const row = [100, 320, 540, 760, 980].map((x) => at(x, 100))
    expect(freeNotePosition(row)).toEqual({ x: 100, y: 270 })
  })

  it('create_note tiles instead of stacking at 100,100', () => {
    const { id, scope } = seedProject()
    for (const content of ['a', 'b', 'c'])
      expect(both('create_note', { content }, scope).ok).toBe(true)
    const notes = state().notes.filter((n) => n.projectId === id)
    expect(new Set(notes.map((n) => `${n.x},${n.y}`)).size).toBe(3)
  })

  it('create_note validates color, update_note edits and delete_note removes', () => {
    const { scope } = seedProject()
    expect(both('create_note', { content: 'x', color: '#000000' }, scope)).toMatchObject({
      ok: false
    })
    const id = (both('create_note', { content: 'Ideia' }, scope) as { id: string }).id
    expect(both('update_note', { id, content: 'Ideia melhor' }, scope).ok).toBe(true)
    expect(state().notes.find((n) => n.id === id)!.content).toBe('Ideia melhor')
    expect(both('update_note', { id: 'nope', content: 'x' }, scope)).toEqual({
      ok: false,
      error: 'Nota não encontrada.'
    })
    expect(both('delete_note', { id }, scope).ok).toBe(true)
    expect(state().notes).toHaveLength(0)
  })
})

describe('MCP financial writes', () => {
  beforeEach(resetStore)

  const scope: McpScope = { projectId: null, financialProfileId: DEFAULT_FINANCIAL_PROFILE_ID }
  const table = (id: string): FinancialTable => state().lists.find((l) => l.id === id)!

  function seedTables(): { mine: string; other: string; otherProfile: string } {
    const mine = state().createList('Nubank', 'BRL', DEFAULT_FINANCIAL_PROFILE_ID)
    const otherProfile = state().createFinancialProfile('Empresa')
    const other = state().createList('PJ', 'BRL', otherProfile)
    return { mine, other, otherProfile }
  }

  it('parseMcpMoney accepts plain decimals and refuses ambiguous or non-positive values', () => {
    expect(parseMcpMoney('1500')).toBe('1500')
    expect(parseMcpMoney('10,5')).toBe('10.5')
    expect(parseMcpMoney(12.5)).toBe('12.5')
    for (const bad of ['1.500', '1.500,00', '-5', '0', 0, 12.345, 'abc', ''])
      expect(parseMcpMoney(bad)).toBeNull()
  })

  it('formatMcpMoney follows the table currency', () => {
    expect(formatMcpMoney('1500', 'BRL')).toBe('R$ 1.500,00')
    expect(formatMcpMoney('1500', 'JPY')).toBe('¥ 1.500')
    expect(formatMcpMoney('1500.5', 'USD')).toBe('$ 1,500.50')
  })

  it('create_transaction stores a 2-place decimal string and a readable resumo', () => {
    const { mine } = seedTables()
    const args = {
      tableId: mine,
      type: 'despesa',
      amount: '1500,45',
      description: 'Mercado',
      date: '2026-10-25',
      category: 'Alimentação'
    }
    expect(prepareMcpAction('create_transaction', args, scope)).toMatchObject({
      ok: true,
      resumo: 'Lançar despesa de R$ 1.500,45 em Nubank — Mercado — 2026-10-25'
    })
    expect(applyMcpAction('create_transaction', args, scope).ok).toBe(true)
    const tx = table(mine).transactions[0]
    expect(tx).toMatchObject({
      amount: '1500.45',
      type: 'expense',
      description: 'Mercado',
      date: '2026-10-25',
      category: 'Alimentação'
    })
    expect(tx.createdAt).toBeDefined()
  })

  it('refuses "1.500" instead of reading it as 1.5', () => {
    const { mine } = seedTables()
    const args = { tableId: mine, type: 'receita', amount: '1.500', description: 'X' }
    expect(both('create_transaction', args, scope)).toMatchObject({ ok: false })
    expect(table(mine).transactions).toHaveLength(0)
  })

  it('a table of another profile and a missing table give the same refusal', () => {
    const { other } = seedTables()
    const refusal = { ok: false, error: 'Tabela indisponível nesta sessão MCP.' }
    const args = { type: 'receita', amount: '10', description: 'X' }
    expect(both('create_transaction', { ...args, tableId: other }, scope)).toEqual(refusal)
    expect(both('create_transaction', { ...args, tableId: 'nope' }, scope)).toEqual(refusal)
    expect(table(other).transactions).toHaveLength(0)
  })

  it('a transaction id of another table gives the transaction refusal', () => {
    const { mine, other } = seedTables()
    const foreign = state().addTransaction(other, {
      description: 'PJ',
      amount: '50',
      type: 'income',
      date: '2026-10-01'
    })
    expect(both('delete_transaction', { tableId: mine, id: foreign }, scope)).toEqual({
      ok: false,
      error: 'Transação indisponível nesta sessão MCP.'
    })
    expect(table(other).transactions).toHaveLength(1)
  })

  it('update_transaction appends audit and clears reconciledAt when the amount changes', () => {
    const { mine } = seedTables()
    const id = state().addTransaction(mine, {
      description: 'Luz',
      amount: '100',
      type: 'expense',
      date: '2026-10-01',
      reconciledAt: '2026-10-02T00:00:00.000Z'
    })
    expect(both('update_transaction', { tableId: mine, id, amount: '120' }, scope).ok).toBe(true)
    const tx = table(mine).transactions[0]
    expect(tx.amount).toBe('120')
    expect(tx.reconciledAt).toBeUndefined()
    expect(tx.audit?.length).toBeGreaterThan(0)
  })

  it('a debt payment transaction cannot be edited or deleted', () => {
    const { mine } = seedTables()
    const id = state().addTransaction(mine, {
      description: 'Parcela',
      amount: '100',
      type: 'expense',
      date: '2026-10-01',
      debtId: 'debt-1'
    })
    const refusal = {
      ok: false,
      error: 'Esta transação pertence a uma dívida; altere-a no Sagyou.'
    }
    expect(both('update_transaction', { tableId: mine, id, amount: '1' }, scope)).toEqual(refusal)
    expect(both('delete_transaction', { tableId: mine, id }, scope)).toEqual(refusal)
    expect(table(mine).transactions).toHaveLength(1)
  })

  it('delete_transaction removes it', () => {
    const { mine } = seedTables()
    const id = state().addTransaction(mine, {
      description: 'Luz',
      amount: '100',
      type: 'expense',
      date: '2026-10-01'
    })
    expect(both('delete_transaction', { tableId: mine, id }, scope).ok).toBe(true)
    expect(table(mine).transactions).toHaveLength(0)
  })

  it('create_financial_table uses the session profile and requested currency', () => {
    const { otherProfile } = seedTables()
    useKanbanStore.setState({ activeFinancialProfileId: otherProfile })
    const created = both('create_financial_table', { name: 'Wise', currency: 'JPY' }, scope)
    expect(table((created as { id: string }).id)).toMatchObject({
      name: 'Wise',
      currency: 'JPY',
      profileId: DEFAULT_FINANCIAL_PROFILE_ID
    })
    expect(both('create_financial_table', { name: 'X', currency: 'EUR' }, scope)).toMatchObject({
      ok: false
    })
  })

  it('categories: add ignores case, remove matches case-insensitively and keeps history', () => {
    const { mine } = seedTables()
    const profile = (): FinancialProfile =>
      state().financialProfiles.find((p) => p.id === DEFAULT_FINANCIAL_PROFILE_ID)!
    expect(both('add_financial_category', { category: 'Pets' }, scope).ok).toBe(true)
    expect(both('add_financial_category', { category: 'pets' }, scope).ok).toBe(true)
    expect(profile().customCategories).toEqual(['Pets'])
    state().addTransaction(mine, {
      description: 'Ração',
      amount: '80',
      type: 'expense',
      date: '2026-10-01',
      category: 'Pets'
    })
    expect(both('remove_financial_category', { category: 'PETS' }, scope).ok).toBe(true)
    expect(profile().customCategories).toEqual([])
    expect(table(mine).transactions[0].category).toBe('Pets')
    expect(both('remove_financial_category', { category: 'Nada' }, scope)).toMatchObject({
      ok: false
    })
  })

  it('profiles: duplicate name returns the existing id; rename touches only the session profile', () => {
    const { otherProfile } = seedTables()
    expect(both('create_financial_profile', { name: 'empresa' }, scope)).toMatchObject({
      ok: true,
      id: otherProfile,
      existente: true
    })
    expect(both('rename_financial_profile', { name: 'Casa' }, scope).ok).toBe(true)
    const names = Object.fromEntries(state().financialProfiles.map((p) => [p.id, p.name]))
    expect(names[DEFAULT_FINANCIAL_PROFILE_ID]).toBe('Casa')
    expect(names[otherProfile]).toBe('Empresa')
  })
})

describe('MCP review fixes', () => {
  beforeEach(resetStore)

  it('refuses every write while the store is not loaded, so an empty store is never saved', () => {
    useKanbanStore.setState({ isLoaded: false })
    const refusal = {
      ok: false,
      error: 'O Sagyou ainda está carregando ou bloqueado; tente de novo em instantes.'
    }
    expect(prepareMcpAction('create_project', { name: 'X' }, general)).toEqual(refusal)
    expect(applyMcpAction('create_project', { name: 'X' }, general)).toEqual(refusal)
    expect(state().projects).toHaveLength(0)
  })

  it('update_transaction refuses an amount below the sum of its details', () => {
    const scope: McpScope = { projectId: null, financialProfileId: DEFAULT_FINANCIAL_PROFILE_ID }
    const tableId = state().createList('Cartão', 'BRL', DEFAULT_FINANCIAL_PROFILE_ID)
    const id = state().addTransaction(tableId, {
      description: 'Fatura',
      amount: '500',
      type: 'expense',
      date: '2026-10-01',
      details: [
        { id: 'd1', description: 'A', amount: '300' },
        { id: 'd2', description: 'B', amount: '200' }
      ]
    })
    expect(prepareMcpAction('update_transaction', { tableId, id, amount: '400' }, scope)).toEqual({
      ok: false,
      error: 'Os detalhes desta transação somam R$ 500,00; ajuste-os antes de reduzir o valor.'
    })
    expect(state().lists[0].transactions[0].amount).toBe('500')
  })
})

describe('MCP handler coverage', () => {
  it('every renderer write tool has a handler', () => {
    for (const name of MCP_RENDERER_WRITE_TOOLS)
      expect(prepareMcpAction(name, {}, general)).not.toEqual({
        ok: false,
        error: 'Ferramenta indisponível nesta sessão MCP.'
      })
  })
})
