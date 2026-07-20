import Decimal from 'decimal.js'
import { useKanbanStore } from '../store/kanban'
import { D, FINANCIAL_CATEGORIES } from '../components/financial/shared'
import { computeHabitSummary, todayISO } from '../utils/habits'
import { isDoneColumn } from '../utils/columns'
import { PRIORITY_CONFIG, PROJECT_COLORS, NOTE_COLORS } from '../types'
import type { AITaskInput, Task, Priority, Goal, Habit, FinancialTable, StickyNote } from '../types'

// ---------------------------------------------------------------------------
// AI tool registry
//
// One place to declare the tools the assistant can call. Each entry pairs an
// OpenAI-format `definition` (sent to the model) with a `run` function executed
// against the Zustand store. Add a tool by adding one entry to REGISTRY — the
// definition list and the dispatcher are derived from it.
// ---------------------------------------------------------------------------

/** An OpenAI-format function/tool definition. */
export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** A tool = its OpenAI definition + the handler that runs it against the store. */
interface AITool {
  definition: ToolDef
  /** Whether the tool mutates state — used to gate it behind user approval. */
  write?: boolean
  /** Runs the tool, returning a JSON string result fed back to the model. */
  run: (args: Record<string, unknown>) => string | Promise<string>
}

/** Build a function tool definition. */
function fn(name: string, description: string, parameters: Record<string, unknown>): ToolDef {
  return { type: 'function', function: { name, description, parameters } }
}

const NO_PARAMS = { type: 'object', properties: {}, additionalProperties: false }

/**
 * How many tasks `ler_tasks` returns when it isn't told otherwise.
 *
 * Above the largest real board today (155), so this is a ceiling against future
 * growth rather than a change to what the model sees now — a bare `ler_tasks`
 * answers exactly as it always did. Every result is resent on each later step
 * of the run, so an unbounded list is a bill that compounds.
 */
export const DEFAULT_TASK_LIMIT = 200

/** Hard ceiling: a hand-picked `limit` can raise the default, but not past this. */
const MAX_TASK_LIMIT = 500

/** `limit` comes from the model, so it is a suggestion, not an instruction. */
function clampLimit(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) return DEFAULT_TASK_LIMIT
  return Math.min(Math.floor(v), MAX_TASK_LIMIT)
}

/**
 * Casefold and strip accents.
 *
 * The app is Portuguese: without this, a model searching "habito" misses
 * "hábito" and "reuniao" misses "reunião". Mirrors `normalize` in
 * main/conversation-search.ts, which does the same for the history search.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

/** The valid priorities, straight from the type's config so the two can't drift. */
const PRIORITIES = Object.keys(PRIORITY_CONFIG) as Priority[]

/**
 * Whether `s` is a real YYYY-MM-DD calendar date. Task.dueDate is only ever
 * read back as that bare shape (UpcomingView does `new Date(dueDate +
 * 'T00:00:00')` and sorts by string), so anything else persists as a date that
 * renders as "Invalid Date" for good. Built in UTC on purpose: this is a
 * calendar check, and a local-time round-trip would reject valid dates west of
 * Greenwich.
 */
function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

/** Find a task by taskId, else by exact title within the (active) project. */
function resolveTask(args: Record<string, unknown>): Task | undefined {
  const state = useKanbanStore.getState()
  if (typeof args.taskId === 'string') {
    const byId = state.tasks.find((t) => t.id === args.taskId)
    if (byId) return byId
  }
  if (typeof args.titulo === 'string') {
    const projectId =
      (typeof args.projectId === 'string' && args.projectId) || state.activeProjectId
    const title = args.titulo.toLowerCase()
    return state.tasks.find((t) => t.projectId === projectId && t.title.toLowerCase() === title)
  }
  return undefined
}

/**
 * Resolve a task for a destructive call. Unlike resolveTask, an ambiguous title
 * is an error rather than the first match: duplicates are exactly what the model
 * is asked to clean up, so "the first of the two" is the one thing it must not
 * silently pick. Same stance as ler_arquivo across multiple code roots.
 */
function resolveTaskForDelete(
  args: Record<string, unknown>
): { task: Task } | { error: string; candidatos?: { id: string; coluna?: string }[] } {
  const state = useKanbanStore.getState()
  if (typeof args.taskId === 'string') {
    const byId = state.tasks.find((t) => t.id === args.taskId)
    return byId ? { task: byId } : { error: 'Task não encontrada' }
  }
  if (typeof args.titulo !== 'string') {
    return { error: 'Informe taskId ou titulo' }
  }
  const projectId = (typeof args.projectId === 'string' && args.projectId) || state.activeProjectId
  const title = args.titulo.toLowerCase()
  const matches = state.tasks.filter(
    (t) => t.projectId === projectId && t.title.toLowerCase() === title
  )
  if (matches.length === 0) return { error: 'Task não encontrada' }
  if (matches.length > 1) {
    const project = state.projects.find((p) => p.id === projectId)
    return {
      error:
        `${matches.length} tasks têm esse título. Chame de novo com o "taskId" da que deve ser ` +
        'deletada (uma chamada por task).',
      candidatos: matches.map((t) => ({
        id: t.id,
        coluna: project?.columns.find((c) => c.id === t.columnId)?.name
      }))
    }
  }
  return { task: matches[0] }
}

/**
 * A goal's target as a usable number, or null. Accepts a numeric string too —
 * models routinely send "10" for a number field. Must be finite and above zero:
 * ler_metas and GoalView divide by it to get the progress percentage.
 */
function toTarget(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Find a goal for a write call: by id, else by exact title. An ambiguous title
 * is an error rather than the first match — goals carry history, so editing the
 * wrong one is silent and hard to notice. Same stance as deletar_task.
 */
function resolveGoal(
  args: Record<string, unknown>
): { goal: Goal } | { error: string; candidatos?: { id: string; alvo: number }[] } {
  const { goals } = useKanbanStore.getState()
  if (typeof args.metaId === 'string') {
    const byId = goals.find((g) => g.id === args.metaId)
    return byId ? { goal: byId } : { error: 'Meta não encontrada' }
  }
  if (typeof args.titulo !== 'string') return { error: 'Informe metaId ou titulo' }
  const title = args.titulo.trim().toLowerCase()
  const matches = goals.filter((g) => g.title.trim().toLowerCase() === title)
  if (matches.length === 0) return { error: 'Meta não encontrada' }
  if (matches.length > 1) {
    return {
      error: `${matches.length} metas têm esse título. Chame de novo com o "metaId" da certa.`,
      candidatos: matches.map((g) => ({ id: g.id, alvo: g.target }))
    }
  }
  return { goal: matches[0] }
}

/**
 * Find a habit by id, else by exact name. Ambiguous names error rather than
 * resolving to the first, same as resolveGoal.
 */
function resolveHabit(
  args: Record<string, unknown>
): { habit: Habit } | { error: string; candidatos?: { id: string; streak: number }[] } {
  const { habits } = useKanbanStore.getState()
  if (typeof args.habitoId === 'string') {
    const byId = habits.find((h) => h.id === args.habitoId)
    return byId ? { habit: byId } : { error: 'Hábito não encontrado' }
  }
  if (typeof args.nome !== 'string') return { error: 'Informe habitoId ou nome' }
  const name = args.nome.trim().toLowerCase()
  const matches = habits.filter((h) => h.name.trim().toLowerCase() === name)
  if (matches.length === 0) return { error: 'Hábito não encontrado' }
  if (matches.length > 1) {
    return {
      error: `${matches.length} hábitos têm esse nome. Chame de novo com o "habitoId" do certo.`,
      candidatos: matches.map((h) => ({ id: h.id, streak: h.completions.length }))
    }
  }
  return { habit: matches[0] }
}

/**
 * A money amount as a Decimal, or null if it isn't unambiguously one.
 *
 * Accepts a JSON number, or a string in plain decimal form with at most two
 * decimals ("1500", "1500.50", "1500,50"). Anything with a thousands separator
 * is REJECTED rather than parsed: Decimal reads "1.500" as 1.5, so guessing
 * would turn R$ 1.500 into R$ 1,50 silently. Better to make the model resend.
 */
function parseMoney(v: unknown): Decimal | null {
  let d: Decimal
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    d = new Decimal(v)
  } else if (typeof v === 'string' && /^\d+([.,]\d{1,2})?$/.test(v.trim())) {
    d = new Decimal(v.trim().replace(',', '.'))
  } else {
    return null
  }
  return d.isFinite() && !d.isNaN() ? d : null
}

/**
 * The financial table to write to: by name or id, else the only one there is.
 * Never guesses between several — a transaction in the wrong table is invisible
 * where it was meant to go and wrong where it landed.
 */
function resolveList(
  args: Record<string, unknown>
): { list: FinancialTable } | { error: string; tabelas?: string[] } {
  const { lists } = useKanbanStore.getState()
  if (lists.length === 0) return { error: 'Nenhuma tabela financeira existe ainda' }
  const nomes = lists.map((l) => l.name)
  if (args.tabela !== undefined) {
    if (typeof args.tabela !== 'string') return { error: 'tabela deve ser texto' }
    const key = args.tabela.trim().toLowerCase()
    const found = lists.filter((l) => l.name.trim().toLowerCase() === key || l.id === args.tabela)
    if (found.length === 0) return { error: 'Tabela não encontrada', tabelas: nomes }
    if (found.length > 1) {
      return { error: 'Mais de uma tabela tem esse nome — use o id', tabelas: nomes }
    }
    return { list: found[0] }
  }
  if (lists.length > 1) {
    return { error: 'Há mais de uma tabela financeira: informe "tabela"', tabelas: nomes }
  }
  return { list: lists[0] }
}

// The size store.createNote gives a note when none is passed. Mirrored here so
// placement reasons about the same box the note will actually occupy.
const NOTE_W = 200
const NOTE_H = 150
const NOTE_GAP = 24

/**
 * A free spot on the project's canvas for a new note.
 *
 * store.createNote defaults every note to (100,100), so notes made from chat
 * would pile on one another — the user would see one note and have to drag it
 * aside to find the rest. Walk a grid from the top-left and take the first cell
 * that clears the existing notes. Sequential calls each see the previous note,
 * so a run of them tiles instead of stacking.
 */
function freeNoteSpot(notes: StickyNote[]): { x: number; y: number } {
  const clashes = (x: number, y: number): boolean =>
    notes.some(
      (n) =>
        x < n.x + n.width + NOTE_GAP &&
        x + NOTE_W + NOTE_GAP > n.x &&
        y < n.y + n.height + NOTE_GAP &&
        y + NOTE_H + NOTE_GAP > n.y
    )
  const stepX = NOTE_W + NOTE_GAP
  const stepY = NOTE_H + NOTE_GAP
  for (let row = 0; row < 40; row++) {
    for (let col = 0; col < 6; col++) {
      const x = 100 + col * stepX
      const y = 100 + row * stepY
      if (!clashes(x, y)) return { x, y }
    }
  }
  return { x: 100, y: 100 } // canvas is packed — fall back to the default
}

/** A selected code root: the folder the code tools may reach into. */
interface Root {
  id: string
  /** Display name for the model — the folder's label, falling back to its path. */
  nome: string
  path: string
}

/**
 * The code roots selected on the (active) project. A project can have several
 * selected at once, so every code tool works across a list; `pastaId` narrows
 * it to one.
 */
function activeRoots(args: Record<string, unknown>): { roots: Root[]; error?: string } {
  const { projects, activeProjectId } = useKanbanStore.getState()
  const projectId = (typeof args.projectId === 'string' && args.projectId) || activeProjectId
  const project = projects.find((p) => p.id === projectId)
  if (!project) return { roots: [], error: 'Projeto não encontrado' }
  const active = project.activeCodePathIds ?? []
  const roots: Root[] = (project.codePaths ?? [])
    .filter((c) => active.includes(c.id))
    .map((c) => ({ id: c.id, nome: c.label ?? c.path, path: c.path }))
  if (!roots.length) return { roots: [], error: 'Nenhuma pasta de código marcada neste projeto' }

  const pastaId = typeof args.pastaId === 'string' ? args.pastaId : ''
  if (!pastaId) return { roots }
  const one = roots.find((r) => r.id === pastaId || r.nome === pastaId)
  if (!one) {
    return { roots: [], error: `Pasta "${pastaId}" não encontrada. Disponíveis: ${roots.map((r) => r.nome).join(', ')}` }
  }
  return { roots: [one] }
}

/** The `pastaId` parameter, shared by the code tools. */
const PASTA_PARAM = {
  pastaId: {
    type: 'string',
    description: 'Restringe a uma pasta de código (id ou nome de ler_projetos). Omita para usar todas as marcadas.'
  }
} as const

// --- Registry: name -> tool. This is the map the task asks for. ---
const REGISTRY: Record<string, AITool> = {
  ler_projetos: {
    definition: fn(
      'ler_projetos',
      'Lista os projetos do usuário com suas colunas e o total de tasks.',
      NO_PARAMS
    ),
    run: () => {
      const { projects, tasks } = useKanbanStore.getState()
      const projetos = projects.map((p) => ({
        id: p.id,
        nome: p.name,
        colunas: [...p.columns].sort((a, b) => a.order - b.order).map((c) => c.name),
        totalTasks: tasks.filter((t) => t.projectId === p.id).length,
        // The code roots the tools may reach into (several can be selected).
        pastasAtivas: (p.codePaths ?? [])
          .filter((c) => (p.activeCodePathIds ?? []).includes(c.id))
          .map((c) => ({ id: c.id, nome: c.label ?? c.path, path: c.path }))
      }))
      return JSON.stringify({ projetos })
    }
  },

  ler_tasks: {
    definition: fn(
      'ler_tasks',
      'Lista as tasks de um projeto (título, coluna, prioridade, tags, se concluída). ' +
        'Sem projectId, usa o projeto ativo. ' +
        'Use os filtros (busca, tag, coluna, concluida) sempre que a pergunta for sobre um ' +
        'assunto específico: um projeto grande devolve centenas de tasks, e a lista inteira é ' +
        'reenviada ao modelo a cada passo seguinte. "busca" casa com o título, ignorando ' +
        'acentos e maiúsculas. A resposta traz "total" (quantas casaram) e "truncado".',
      {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'ID do projeto (opcional)' },
          busca: { type: 'string', description: 'Texto no título (opcional, ignora acentos)' },
          tag: { type: 'string', description: 'Só tasks com esta tag (opcional)' },
          coluna: { type: 'string', description: 'Só tasks nesta coluna, pelo nome (opcional)' },
          concluida: { type: 'boolean', description: 'Filtra por concluída ou não (opcional)' },
          limit: {
            type: 'number',
            description: `Máximo de tasks a devolver (opcional, padrão ${DEFAULT_TASK_LIMIT})`
          }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const { projects, tasks, activeProjectId } = useKanbanStore.getState()
      const projectId = (typeof args.projectId === 'string' && args.projectId) || activeProjectId
      const project = projects.find((p) => p.id === projectId)
      if (!project) return JSON.stringify({ error: 'Projeto não encontrado' })
      const colName = (id: string): string => project.columns.find((c) => c.id === id)?.name ?? '?'

      const busca = typeof args.busca === 'string' ? normalize(args.busca.trim()) : ''
      const tag = typeof args.tag === 'string' ? normalize(args.tag.trim()) : ''
      const coluna = typeof args.coluna === 'string' ? normalize(args.coluna.trim()) : ''
      const concluida = typeof args.concluida === 'boolean' ? args.concluida : null

      const matched = tasks.filter((t) => {
        if (t.projectId !== project.id) return false
        if (busca && !normalize(t.title).includes(busca)) return false
        if (tag && !t.tags.some((x) => normalize(x) === tag)) return false
        if (coluna && normalize(colName(t.columnId)) !== coluna) return false
        if (concluida !== null && !!t.completedAt !== concluida) return false
        return true
      })

      // Bounded by default. The cap sits above any real project here, so today
      // it changes nothing — it's there so a project that grows to thousands
      // can't put its whole board in the prompt, resent on every later step.
      const limit = clampLimit(args.limit)
      const list = matched.slice(0, limit).map((t) => ({
        id: t.id,
        titulo: t.title,
        coluna: colName(t.columnId),
        prioridade: t.priority,
        tags: t.tags,
        concluida: !!t.completedAt
      }))
      return JSON.stringify({
        projeto: project.name,
        // `total` vs the array's length is how the model knows it's seeing a
        // slice — without it, a truncated list reads as the whole board and it
        // would answer "you have 50 tasks" when there are 300.
        total: matched.length,
        truncado: matched.length > list.length,
        tasks: list
      })
    }
  },

  ler_financeiro: {
    definition: fn(
      'ler_financeiro',
      'Resumo financeiro por tabela: totais de receitas/despesas/saldo, gastos por categoria, ' +
        'metas financeiras e uma amostra das transações. Filtra por período (de/ate, YYYY-MM-DD) ' +
        'e por tabela. Sem período, considera tudo.',
      {
        type: 'object',
        properties: {
          tabela: { type: 'string', description: 'Nome ou ID da tabela financeira (opcional)' },
          de: { type: 'string', description: 'Data inicial YYYY-MM-DD (opcional)' },
          ate: { type: 'string', description: 'Data final YYYY-MM-DD (opcional)' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const { lists } = useKanbanStore.getState()
      const filtro = typeof args.tabela === 'string' ? args.tabela.toLowerCase() : null
      const de = typeof args.de === 'string' ? args.de : null
      const ate = typeof args.ate === 'string' ? args.ate : null
      const inPeriod = (date: string): boolean => (!de || date >= de) && (!ate || date <= ate)

      const tabelas = lists
        .filter((l) => !filtro || l.name.toLowerCase() === filtro || l.id === args.tabela)
        .map((l) => {
          const txs = l.transactions.filter((t) => inPeriod(t.date))
          let receitas = D(0)
          let despesas = D(0)
          const porCategoria: Record<string, { receita: string; despesa: string }> = {}
          for (const t of txs) {
            const amount = D(t.amount)
            if (t.type === 'income') receitas = receitas.plus(amount)
            else despesas = despesas.plus(amount)
            const cat = t.category || 'sem categoria'
            const acc = porCategoria[cat] ?? { receita: '0', despesa: '0' }
            if (t.type === 'income') acc.receita = D(acc.receita).plus(amount).toString()
            else acc.despesa = D(acc.despesa).plus(amount).toString()
            porCategoria[cat] = acc
          }
          const amostra = [...txs]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 15)
            .map((t) => ({
              data: t.date,
              descricao: t.description,
              tipo: t.type === 'income' ? 'receita' : 'despesa',
              valor: t.amount,
              categoria: t.category
            }))
          return {
            nome: l.name,
            moeda: l.currency,
            receitas: receitas.toString(),
            despesas: despesas.toString(),
            saldo: receitas.minus(despesas).toString(),
            qtdTransacoes: txs.length,
            porCategoria,
            metasFinanceiras: l.goals.map((g) => ({
              nome: g.name,
              alvo: g.targetAmount,
              mes: g.targetMonth,
              ano: g.targetYear,
              concluida: !!g.completedAt
            })),
            amostraTransacoes: amostra,
            truncado: txs.length > amostra.length
          }
        })
      return JSON.stringify({ periodo: { de, ate }, tabelas })
    }
  },

  ler_metas: {
    definition: fn(
      'ler_metas',
      'Lista as metas de progresso: título, unidade, alvo, valor atual, progresso (%) e ' +
        'quantas entradas tem.',
      NO_PARAMS
    ),
    run: () => {
      const { goals } = useKanbanStore.getState()
      const metas = goals.map((g) => {
        const atual = g.entries.reduce((sum, e) => sum + (e.value || 0), 0)
        const ultima = g.entries.reduce((max, e) => (e.date > max ? e.date : max), '')
        return {
          // Without the id, atualizar_meta can only be aimed by title — which
          // is exactly what fails when two goals share one.
          id: g.id,
          titulo: g.title,
          unidade: g.unit,
          alvo: g.target,
          atual,
          progresso: g.target > 0 ? Math.round((atual / g.target) * 100) : 0,
          qtdEntradas: g.entries.length,
          ultimaEntrada: ultima || null,
          projetoId: g.projectId ?? null
        }
      })
      return JSON.stringify({ metas })
    }
  },

  ler_habitos: {
    definition: fn(
      'ler_habitos',
      'Resumo dos hábitos: sequência atual (streak), feitos no mês, taxa do mês (%) e se foi ' +
        'feito hoje.',
      NO_PARAMS
    ),
    run: () => {
      const { habits } = useKanbanStore.getState()
      const today = new Date()
      const todayStr = todayISO(today)
      const resumo = computeHabitSummary(habits, today).map((h) => ({
        // marcar_habito can only be aimed reliably with the id.
        id: h.habit.id,
        nome: h.habit.name,
        streak: h.streak,
        feitosNoMes: h.monthDone,
        taxaMes: h.rate,
        feitoHoje: h.habit.completions.includes(todayStr),
        totalConclusoes: h.habit.completions.length
      }))
      return JSON.stringify({ habitos: resumo })
    }
  },

  criar_projeto: {
    write: true,
    definition: fn(
      'criar_projeto',
      'Cria um projeto kanban novo, já com as colunas padrão (Backlog, In Progress, Review, Done). ' +
        'O projeto criado vira o ATIVO: as chamadas seguintes sem projectId passam a usar ele, ' +
        'então crie o projeto antes de criar as tasks dele. Se já existir um projeto com esse ' +
        'nome, a chamada falha e devolve o id do existente — use esse id em vez de criar um ' +
        'projeto repetido.',
      {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome do projeto' },
          descricao: { type: 'string', description: 'Descrição do projeto (opcional)' },
          cor: {
            type: 'string',
            enum: [...PROJECT_COLORS],
            description: 'Cor do projeto (opcional)'
          }
        },
        required: ['nome'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      // createProject stores the name as given, so trim here or the project is
      // named "  Site  " forever.
      const nome = typeof args.nome === 'string' ? args.nome.trim() : ''
      if (!nome) return JSON.stringify({ error: 'Informe o nome do projeto' })

      // Creating a twin is worse than failing: it also steals activeProjectId,
      // so the tasks that follow would land in the empty copy.
      const existing = state.projects.find(
        (p) => p.name.trim().toLowerCase() === nome.toLowerCase()
      )
      if (existing) {
        return JSON.stringify({
          error: `Já existe um projeto chamado "${existing.name}"`,
          projectId: existing.id
        })
      }

      let cor: string | undefined
      if (args.cor !== undefined) {
        if (typeof args.cor !== 'string' || !(PROJECT_COLORS as readonly string[]).includes(args.cor)) {
          return JSON.stringify({ error: 'Cor inválida', disponiveis: PROJECT_COLORS })
        }
        cor = args.cor
      }

      let descricao: string | undefined
      if (args.descricao !== undefined) {
        if (typeof args.descricao !== 'string') {
          return JSON.stringify({ error: 'descricao deve ser texto' })
        }
        descricao = args.descricao.trim() || undefined
      }

      const projectId = state.createProject(nome, descricao, cor)
      const created = useKanbanStore.getState().projects.find((p) => p.id === projectId)
      return JSON.stringify({
        ok: true,
        projectId,
        nome,
        colunas: [...(created?.columns ?? [])].sort((a, b) => a.order - b.order).map((c) => c.name),
        // Say it outright: the model's next criar_tasks without projectId lands here.
        ativo: true
      })
    }
  },

  criar_tasks: {
    write: true,
    definition: fn(
      'criar_tasks',
      'Cria uma ou mais tasks no projeto (mesma estrutura do import). Sem projectId, usa o ativo.',
      {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'ID do projeto (opcional)' },
          tasks: {
            type: 'array',
            description: 'Lista de tasks a criar',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
                dueDate: { type: 'string', description: 'YYYY-MM-DD' },
                tags: { type: 'array', items: { type: 'string' } },
                column: { type: 'string', description: 'Nome exato da coluna' },
                sprint: { type: 'string', description: 'Nome exato da sprint' }
              },
              required: ['title'],
              additionalProperties: false
            }
          }
        },
        required: ['tasks'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const projectId =
        (typeof args.projectId === 'string' && args.projectId) || state.activeProjectId
      if (!projectId) return JSON.stringify({ error: 'Nenhum projeto ativo' })
      if (!Array.isArray(args.tasks) || args.tasks.length === 0) {
        return JSON.stringify({ error: 'Nenhuma task informada' })
      }
      const count = state.importTasksFromAIChat(projectId, args.tasks as AITaskInput[])
      return JSON.stringify({ criadas: count })
    }
  },

  atualizar_task: {
    write: true,
    definition: fn(
      'atualizar_task',
      'Edita uma task que já existe: prioridade, descrição, tags ou prazo. Só altera os campos ' +
        'que você mandar — os demais ficam como estão. Para esvaziar um campo, mande "" ' +
        '(descricao, dueDate) ou [] (tags). Não muda a coluna nem a sprint da task: use ' +
        'concluir_task e atribuir_sprint para isso. Identifique por taskId ou titulo.',
      {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID da task' },
          titulo: { type: 'string', description: 'Título exato da task' },
          projectId: { type: 'string', description: 'ID do projeto (opcional)' },
          prioridade: { type: 'string', enum: PRIORITIES },
          descricao: { type: 'string', description: 'Nova descrição; "" apaga a atual' },
          dueDate: { type: 'string', description: 'Prazo em YYYY-MM-DD; "" remove o prazo' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Substitui a lista inteira de tags — repita as que devem continuar. [] limpa todas.'
          }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const task = resolveTask(args)
      if (!task) return JSON.stringify({ error: 'Task não encontrada' })

      // Only the keys actually present may end up in `updates` — updateTask
      // spreads it over the task, so an undefined value clears the field rather
      // than leaving it alone.
      const updates: Parameters<typeof state.updateTask>[1] = {}

      if (args.prioridade !== undefined) {
        if (!PRIORITIES.includes(args.prioridade as Priority)) {
          return JSON.stringify({
            error: `Prioridade inválida. Use uma de: ${PRIORITIES.join(', ')}.`
          })
        }
        updates.priority = args.prioridade as Priority
      }

      if (args.descricao !== undefined) {
        if (typeof args.descricao !== 'string') {
          return JSON.stringify({ error: 'descricao deve ser texto' })
        }
        updates.description = args.descricao.trim() || undefined
      }

      if (args.dueDate !== undefined) {
        if (typeof args.dueDate !== 'string') {
          return JSON.stringify({ error: 'dueDate deve ser texto' })
        }
        const due = args.dueDate.trim()
        if (due === '') updates.dueDate = undefined
        else if (!isCalendarDate(due)) {
          return JSON.stringify({ error: 'dueDate deve ser uma data real no formato YYYY-MM-DD' })
        } else updates.dueDate = due
      }

      if (args.tags !== undefined) {
        if (!Array.isArray(args.tags) || args.tags.some((t) => typeof t !== 'string')) {
          return JSON.stringify({ error: 'tags deve ser uma lista de textos' })
        }
        updates.tags = (args.tags as string[]).map((t) => t.trim()).filter(Boolean)
      }

      const changed = Object.keys(updates)
      if (changed.length === 0) {
        return JSON.stringify({
          error: 'Nenhum campo informado. Mande prioridade, descricao, dueDate ou tags.'
        })
      }
      state.updateTask(task.id, updates)
      return JSON.stringify({ ok: true, task: task.title, atualizados: changed })
    }
  },

  mover_task: {
    write: true,
    definition: fn(
      'mover_task',
      'Move uma task para outra coluna (pelo nome da coluna), sem necessariamente concluí-la. ' +
        'A task vai para o fim da coluna de destino. Mover para a coluna Done conclui a task ' +
        '(prefira concluir_task para isso) e tirá-la de Done reabre a task. Não muda o projeto ' +
        'da task. Identifique a task por taskId ou titulo.',
      {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID da task' },
          titulo: { type: 'string', description: 'Título exato da task' },
          coluna: { type: 'string', description: 'Nome exato da coluna de destino' },
          projectId: { type: 'string', description: 'ID do projeto (opcional)' }
        },
        required: ['coluna'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const task = resolveTask(args)
      if (!task) return JSON.stringify({ error: 'Task não encontrada' })
      const project = state.projects.find((p) => p.id === task.projectId)
      if (!project) return JSON.stringify({ error: 'Projeto da task não encontrado' })

      // Resolve against the task's own project, never args.projectId: moveTask
      // looks the column up under task.projectId, so a column from elsewhere
      // would leave the task pointing at an id its board can't render.
      const name = typeof args.coluna === 'string' ? args.coluna.trim().toLowerCase() : ''
      const col = project.columns.find((c) => c.name.toLowerCase() === name)
      if (!col) {
        return JSON.stringify({
          error: 'Coluna não encontrada no projeto da task',
          disponiveis: project.columns.map((c) => c.name)
        })
      }

      const from = project.columns.find((c) => c.id === task.columnId)
      if (col.id === task.columnId) {
        // Re-inserting would reshuffle the column for no reason.
        return JSON.stringify({ ok: true, task: task.title, coluna: col.name, semMudanca: true })
      }

      const index = state.tasks.filter(
        (t) => t.projectId === task.projectId && t.columnId === col.id && t.id !== task.id
      ).length
      state.moveTask(task.id, col.id, index)

      // Crossing the Done boundary silently completes or reopens the task; say so
      // rather than letting the model report a plain move.
      const wasDone = isDoneColumn(from)
      const nowDone = isDoneColumn(col)
      return JSON.stringify({
        ok: true,
        task: task.title,
        de: from?.name,
        para: col.name,
        ...(nowDone && !wasDone && { concluida: true }),
        ...(wasDone && !nowDone && { reaberta: true })
      })
    }
  },

  concluir_task: {
    write: true,
    definition: fn(
      'concluir_task',
      'Move a task para a coluna Done (conclui a task e pausa o cronômetro dela). ' +
        'Identifique por taskId ou titulo.',
      {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID da task' },
          titulo: { type: 'string', description: 'Título exato da task' },
          projectId: { type: 'string', description: 'ID do projeto (opcional)' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const task = resolveTask(args)
      if (!task) return JSON.stringify({ error: 'Task não encontrada' })
      const project = state.projects.find((p) => p.id === task.projectId)
      const doneCol = project?.columns.find(isDoneColumn)
      if (!doneCol) return JSON.stringify({ error: 'Coluna "Done" não encontrada no projeto' })
      const index = state.tasks.filter((t) => t.columnId === doneCol.id).length
      state.moveTask(task.id, doneCol.id, index)
      return JSON.stringify({ ok: true, task: task.title, coluna: doneCol.name })
    }
  },

  deletar_task: {
    write: true,
    definition: fn(
      'deletar_task',
      'Apaga uma task PERMANENTEMENTE (não dá para desfazer). Use só para tasks duplicadas ou ' +
        'irrelevantes, quando o usuário pedir para remover — para uma task que foi finalizada, ' +
        'use concluir_task. Apaga uma task por chamada: para várias, faça uma chamada para cada ' +
        'uma. Identifique por taskId ou titulo; se o título se repetir, a chamada falha e devolve ' +
        'os ids para você escolher.',
      {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID da task' },
          titulo: { type: 'string', description: 'Título exato da task' },
          projectId: { type: 'string', description: 'ID do projeto (opcional)' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const resolved = resolveTaskForDelete(args)
      if ('error' in resolved) return JSON.stringify(resolved)
      const { task } = resolved
      useKanbanStore.getState().deleteTask(task.id)
      return JSON.stringify({ ok: true, deletada: task.title, taskId: task.id })
    }
  },

  iniciar_cronometro: {
    write: true,
    definition: fn(
      'iniciar_cronometro',
      'Inicia o cronômetro de uma task para registrar o tempo gasto (pausa sozinho ao concluir). ' +
        'Identifique por taskId ou titulo.',
      {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID da task' },
          titulo: { type: 'string', description: 'Título exato da task' },
          projectId: { type: 'string', description: 'ID do projeto (opcional)' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const task = resolveTask(args)
      if (!task) return JSON.stringify({ error: 'Task não encontrada' })
      state.startTimer(task.id)
      return JSON.stringify({ ok: true, task: task.title })
    }
  },

  criar_sprints: {
    write: true,
    definition: fn('criar_sprints', 'Cria uma ou mais sprints no projeto. Sem projectId, usa o ativo.', {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (opcional)' },
        nomes: { type: 'array', items: { type: 'string' }, description: 'Nomes das sprints' }
      },
      required: ['nomes'],
      additionalProperties: false
    }),
    run: (args) => {
      const state = useKanbanStore.getState()
      const projectId =
        (typeof args.projectId === 'string' && args.projectId) || state.activeProjectId
      if (!projectId) return JSON.stringify({ error: 'Nenhum projeto ativo' })
      const nomes = Array.isArray(args.nomes)
        ? args.nomes.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
        : []
      if (nomes.length === 0) return JSON.stringify({ error: 'Nenhum nome de sprint informado' })
      state.createSprints(projectId, nomes)
      return JSON.stringify({ criadas: nomes })
    }
  },

  atribuir_sprint: {
    write: true,
    definition: fn(
      'atribuir_sprint',
      'Atribui uma sprint (por nome) a uma task. A sprint precisa já existir no projeto ' +
        '(use criar_sprints antes). Identifique a task por taskId ou titulo.',
      {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID da task' },
          titulo: { type: 'string', description: 'Título exato da task' },
          sprint: { type: 'string', description: 'Nome exato da sprint' },
          projectId: { type: 'string', description: 'ID do projeto (opcional)' }
        },
        required: ['sprint'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const task = resolveTask(args)
      if (!task) return JSON.stringify({ error: 'Task não encontrada' })
      const sprintName = typeof args.sprint === 'string' ? args.sprint.toLowerCase() : ''
      const projectSprints = state.sprints.filter((s) => s.projectId === task.projectId)
      const sprint = projectSprints.find((s) => s.name.toLowerCase() === sprintName)
      if (!sprint) {
        return JSON.stringify({
          error: 'Sprint não encontrada',
          disponiveis: projectSprints.map((s) => s.name)
        })
      }
      state.updateTask(task.id, { sprintId: sprint.id })
      return JSON.stringify({ ok: true, task: task.title, sprint: sprint.name })
    }
  },

  criar_meta: {
    write: true,
    definition: fn(
      'criar_meta',
      'Cria uma meta de progresso (ex.: "Correr", alvo 100, unidade "km"). A meta nasce sem ' +
        'nenhuma entrada, ou seja, com progresso zero — esta ferramenta não registra progresso. ' +
        'Opcionalmente vincule a meta a um projeto com projectId.',
      {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Nome da meta' },
          alvo: { type: 'number', description: 'Valor alvo, maior que zero' },
          unidade: { type: 'string', description: 'Unidade do alvo (ex.: km, páginas). Opcional.' },
          cor: { type: 'string', enum: [...PROJECT_COLORS], description: 'Cor da meta (opcional)' },
          projectId: { type: 'string', description: 'Projeto ao qual vincular (opcional)' }
        },
        required: ['titulo', 'alvo'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const titulo = typeof args.titulo === 'string' ? args.titulo.trim() : ''
      if (!titulo) return JSON.stringify({ error: 'Informe o título da meta' })

      const alvo = toTarget(args.alvo)
      if (alvo === null) {
        return JSON.stringify({ error: 'alvo deve ser um número maior que zero' })
      }

      let cor: string = PROJECT_COLORS[0]
      if (args.cor !== undefined) {
        if (typeof args.cor !== 'string' || !(PROJECT_COLORS as readonly string[]).includes(args.cor)) {
          return JSON.stringify({ error: 'Cor inválida', disponiveis: PROJECT_COLORS })
        }
        cor = args.cor
      }

      let unidade = ''
      if (args.unidade !== undefined) {
        if (typeof args.unidade !== 'string') {
          return JSON.stringify({ error: 'unidade deve ser texto' })
        }
        unidade = args.unidade.trim()
      }

      let projectId: string | undefined
      if (args.projectId !== undefined) {
        if (typeof args.projectId !== 'string') {
          return JSON.stringify({ error: 'projectId deve ser texto' })
        }
        // A dangling projectId shows up as a goal linked to nothing.
        if (!state.projects.some((p) => p.id === args.projectId)) {
          return JSON.stringify({ error: 'Projeto não encontrado' })
        }
        projectId = args.projectId
      }

      const metaId = state.createGoal({ title: titulo, target: alvo, unit: unidade, color: cor, projectId })
      return JSON.stringify({ ok: true, metaId, titulo, alvo, unidade, progresso: 0 })
    }
  },

  atualizar_meta: {
    write: true,
    definition: fn(
      'atualizar_meta',
      'Edita uma meta que já existe: título, alvo, unidade, cor ou o projeto vinculado. Só ' +
        'altera os campos que você mandar. NÃO registra progresso nem mexe nas entradas já ' +
        'lançadas — mudar o alvo só muda a régua, o valor atual continua o mesmo. Para ' +
        'desvincular do projeto, mande projectId "". Identifique por metaId (veja ler_metas) ' +
        'ou pelo titulo exato.',
      {
        type: 'object',
        properties: {
          metaId: { type: 'string', description: 'ID da meta (vem de ler_metas)' },
          titulo: { type: 'string', description: 'Título exato da meta a editar' },
          novoTitulo: { type: 'string', description: 'Novo nome da meta' },
          alvo: { type: 'number', description: 'Novo valor alvo, maior que zero' },
          unidade: { type: 'string', description: 'Nova unidade' },
          cor: { type: 'string', enum: [...PROJECT_COLORS] },
          projectId: { type: 'string', description: 'Novo projeto vinculado; "" desvincula' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const resolved = resolveGoal(args)
      if ('error' in resolved) return JSON.stringify(resolved)
      const { goal } = resolved

      // Only the keys given may land in `updates`: updateGoal spreads it over the
      // goal, so an undefined value would wipe the field instead of skipping it.
      const updates: Parameters<typeof state.updateGoal>[1] = {}

      if (args.novoTitulo !== undefined) {
        if (typeof args.novoTitulo !== 'string' || args.novoTitulo.trim() === '') {
          return JSON.stringify({ error: 'novoTitulo não pode ser vazio' })
        }
        updates.title = args.novoTitulo.trim()
      }

      if (args.alvo !== undefined) {
        const alvo = toTarget(args.alvo)
        if (alvo === null) {
          return JSON.stringify({ error: 'alvo deve ser um número maior que zero' })
        }
        updates.target = alvo
      }

      if (args.unidade !== undefined) {
        if (typeof args.unidade !== 'string') {
          return JSON.stringify({ error: 'unidade deve ser texto' })
        }
        // Goal.unit is a required string — "" is empty, not absent.
        updates.unit = args.unidade.trim()
      }

      if (args.cor !== undefined) {
        if (typeof args.cor !== 'string' || !(PROJECT_COLORS as readonly string[]).includes(args.cor)) {
          return JSON.stringify({ error: 'Cor inválida', disponiveis: PROJECT_COLORS })
        }
        updates.color = args.cor
      }

      if (args.projectId !== undefined) {
        if (typeof args.projectId !== 'string') {
          return JSON.stringify({ error: 'projectId deve ser texto' })
        }
        if (args.projectId.trim() === '') updates.projectId = undefined
        else if (!state.projects.some((p) => p.id === args.projectId)) {
          return JSON.stringify({ error: 'Projeto não encontrado' })
        } else updates.projectId = args.projectId
      }

      const changed = Object.keys(updates)
      if (changed.length === 0) {
        return JSON.stringify({
          error: 'Nenhum campo informado. Mande novoTitulo, alvo, unidade, cor ou projectId.'
        })
      }
      state.updateGoal(goal.id, updates)

      // The entries are untouched, so report the progress against the new target.
      const atual = goal.entries.reduce((sum, e) => sum + (e.value || 0), 0)
      const alvo = updates.target ?? goal.target
      return JSON.stringify({
        ok: true,
        metaId: goal.id,
        meta: updates.title ?? goal.title,
        atualizados: changed,
        atual,
        progresso: alvo > 0 ? Math.round((atual / alvo) * 100) : 0
      })
    }
  },

  marcar_habito: {
    write: true,
    definition: fn(
      'marcar_habito',
      'Marca um hábito como feito HOJE. É seguro chamar de novo: se o hábito já estiver marcado ' +
        'hoje, a ferramenta não faz nada e NÃO desmarca. Só mexe no dia de hoje — não marca ' +
        'outros dias nem desfaz marcações. Identifique por habitoId (veja ler_habitos) ou pelo ' +
        'nome exato.',
      {
        type: 'object',
        properties: {
          habitoId: { type: 'string', description: 'ID do hábito (vem de ler_habitos)' },
          nome: { type: 'string', description: 'Nome exato do hábito' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const resolved = resolveHabit(args)
      if ('error' in resolved) return JSON.stringify(resolved)
      const { habit } = resolved
      const now = new Date()
      const hoje = todayISO(now)

      const summary = (h: Habit): number => computeHabitSummary([h], now)[0]?.streak ?? 0

      // store.toggleHabit FLIPS the day. On a habit that's already done today it
      // would unmark it — the exact opposite of what this tool promises — so an
      // already-marked habit is a no-op, not a toggle.
      if (habit.completions.includes(hoje)) {
        return JSON.stringify({
          ok: true,
          habito: habit.name,
          data: hoje,
          jaEstavaMarcado: true,
          streak: summary(habit)
        })
      }

      state.toggleHabit(habit.id, hoje)
      const updated = useKanbanStore.getState().habits.find((h) => h.id === habit.id)
      return JSON.stringify({
        ok: true,
        habito: habit.name,
        data: hoje,
        streak: updated ? summary(updated) : 0
      })
    }
  },

  criar_nota: {
    write: true,
    definition: fn(
      'criar_nota',
      'Cria uma nota adesiva no canvas do projeto. Uma nota por chamada — para várias ideias, ' +
        'faça uma chamada para cada uma e elas se organizam sozinhas lado a lado, sem se ' +
        'sobrepor. Sem projectId, usa o projeto ativo.',
      {
        type: 'object',
        properties: {
          conteudo: { type: 'string', description: 'Texto da nota' },
          cor: { type: 'string', enum: [...NOTE_COLORS], description: 'Cor da nota (opcional)' },
          projectId: { type: 'string', description: 'ID do projeto (opcional)' }
        },
        required: ['conteudo'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const projectId =
        (typeof args.projectId === 'string' && args.projectId) || state.activeProjectId
      if (!projectId) return JSON.stringify({ error: 'Nenhum projeto ativo' })
      if (!state.projects.some((p) => p.id === projectId)) {
        return JSON.stringify({ error: 'Projeto não encontrado' })
      }

      const conteudo = typeof args.conteudo === 'string' ? args.conteudo.trim() : ''
      if (!conteudo) return JSON.stringify({ error: 'Informe o conteúdo da nota' })

      let cor: string | undefined
      if (args.cor !== undefined) {
        if (typeof args.cor !== 'string' || !(NOTE_COLORS as readonly string[]).includes(args.cor)) {
          return JSON.stringify({ error: 'Cor inválida', disponiveis: NOTE_COLORS })
        }
        cor = args.cor
      }

      const { x, y } = freeNoteSpot(state.notes.filter((n) => n.projectId === projectId))
      const notaId = state.createNote(projectId, { content: conteudo, color: cor, x, y })
      return JSON.stringify({ ok: true, notaId, conteudo, posicao: { x, y } })
    }
  },

  criar_transacao: {
    write: true,
    definition: fn(
      'criar_transacao',
      'Lança uma receita ou despesa numa tabela financeira. O valor é sempre POSITIVO — quem ' +
        'diz se entra ou sai é o "tipo" (receita/despesa). Mande o valor como número (ex.: ' +
        '1500.5); não use separador de milhar. Sem "data", usa hoje. Sem "tabela", usa a única ' +
        'que existir — se houver mais de uma, informe qual.',
      {
        type: 'object',
        properties: {
          descricao: { type: 'string', description: 'Descrição da transação' },
          valor: { type: 'number', description: 'Valor positivo, ex.: 1500.5' },
          tipo: { type: 'string', enum: ['receita', 'despesa'] },
          data: { type: 'string', description: 'Data YYYY-MM-DD (opcional, padrão hoje)' },
          categoria: {
            type: 'string',
            description: `Categoria (opcional). Prefira uma existente: ${FINANCIAL_CATEGORIES.join(', ')}`
          },
          tabela: { type: 'string', description: 'Nome ou ID da tabela financeira' }
        },
        required: ['descricao', 'valor', 'tipo'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const resolved = resolveList(args)
      if ('error' in resolved) return JSON.stringify(resolved)
      const { list } = resolved

      const descricao = typeof args.descricao === 'string' ? args.descricao.trim() : ''
      if (!descricao) return JSON.stringify({ error: 'Informe a descrição da transação' })

      if (args.tipo !== 'receita' && args.tipo !== 'despesa') {
        return JSON.stringify({ error: 'tipo deve ser "receita" ou "despesa"' })
      }

      const valor = parseMoney(args.valor)
      if (valor === null) {
        return JSON.stringify({
          error: 'valor inválido. Mande um número simples, sem separador de milhar (ex.: 1500.5).'
        })
      }
      // The sign lives in `type`: ler_financeiro sums expenses as positives, so a
      // negative here would quietly subtract from the month's expenses.
      if (!valor.greaterThan(0)) {
        return JSON.stringify({ error: 'valor deve ser maior que zero — use o tipo para o sinal' })
      }

      // todayISO() here is the LOCAL-day helper from utils/habits, not the
      // same-named UTC one in financial/shared.ts (which AddTransactionRow
      // defaults with — see the note in CLAUDE.md).
      let data = todayISO()
      if (args.data !== undefined) {
        if (typeof args.data !== 'string' || !isCalendarDate(args.data.trim())) {
          return JSON.stringify({ error: 'data deve ser uma data real no formato YYYY-MM-DD' })
        }
        data = args.data.trim()
      }

      let categoria: string | undefined
      if (args.categoria !== undefined) {
        if (typeof args.categoria !== 'string') {
          return JSON.stringify({ error: 'categoria deve ser texto' })
        }
        categoria = args.categoria.trim() || undefined
      }

      // Canonical decimal string, rounded like AddTransactionRow does — one
      // rounding rule for the table, whoever wrote the row.
      const amount = valor.toDecimalPlaces(2).toString()
      const txId = state.addTransaction(list.id, {
        description: descricao,
        amount,
        type: args.tipo === 'receita' ? 'income' : 'expense',
        date: data,
        category: categoria
      })
      return JSON.stringify({
        ok: true,
        txId,
        tabela: list.name,
        descricao,
        valor: amount,
        tipo: args.tipo,
        data,
        categoria: categoria ?? null
      })
    }
  },

  rodar_agente_codigo: {
    write: true,
    definition: fn(
      'rodar_agente_codigo',
      'Dispara um agente de código externo (Aider/Codex) no diretório do projeto para ' +
        'implementar uma tarefa de código. Roda em UMA pasta: se o projeto tiver várias ' +
        'marcadas, informe pastaId. O agente escreve arquivos e roda comandos, por isso ' +
        'passa por aprovação. IMPORTANTE: quando você já souber quais arquivos mudar (ache-os ' +
        'antes com buscar_no_codigo/ler_arquivo), passe-os em "arquivos" — o agente edita ' +
        'direto, sem gastar rodadas caras redescobrindo o arquivo sozinho.',
      {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'O que o agente deve fazer no código' },
          arquivos: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Caminhos relativos à pasta do projeto dos arquivos a editar (ex.: ' +
              '"src/renderer/src/components/AIView.tsx"). Opcional, mas fortemente recomendado: ' +
              'evita o passo lento de descoberta do agente.'
          },
          agent: { type: 'string', enum: ['aider', 'codex'], description: 'Agente (padrão: aider)' },
          ...PASTA_PARAM,
          projectId: { type: 'string', description: 'ID do projeto (opcional; usa o ativo)' }
        },
        required: ['task'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const { roots, error } = activeRoots(args)
      if (error) return JSON.stringify({ error })
      // The agent is a child process with a single cwd — it cannot span roots,
      // and guessing which one to edit risks writing to the wrong repo.
      if (roots.length > 1) {
        return JSON.stringify({
          error: `O agente roda em uma pasta só, e ${roots.length} estão marcadas. Repita com pastaId.`,
          pastas: roots.map((r) => ({ id: r.id, nome: r.nome }))
        })
      }
      const path = roots[0].path
      const task = typeof args.task === 'string' ? args.task.trim() : ''
      if (!task) return JSON.stringify({ error: 'Tarefa vazia' })
      const agent = args.agent === 'codex' ? 'codex' : 'aider'
      // Pinning the target files lets the agent edit them directly instead of
      // rediscovering them via its repo map (slow, and a UI string is invisible
      // there anyway). Main confines each path to the root; here we just pass the
      // clean list through.
      const files = Array.isArray(args.arquivos)
        ? args.arquivos.filter((f): f is string => typeof f === 'string' && f.trim() !== '')
        : undefined
      // Fire-and-forget; the real outcome streams to the UI panel. Report the
      // request honestly — do NOT claim guaranteed success.
      void window.electronAPI.ai.codeAgent.run({ path, task, agent, files })
      return JSON.stringify({
        status: 'solicitado',
        agente: agent,
        diretorio: path,
        arquivos: files && files.length ? files : undefined,
        aviso:
          'Pedido enviado. Não afirme sucesso: acompanhe o painel de saída. Se o agente não ' +
          'estiver instalado, aparecerá um erro lá.'
      })
    }
  },

  listar_arquivos: {
    definition: fn(
      'listar_arquivos',
      'Lista os arquivos do código do projeto (recursivo; ignora node_modules/.git/dist). ' +
        'Use para descobrir a estrutura antes de ler arquivos. Cobre todas as pastas de ' +
        'código marcadas no projeto. Devolve no máximo ~200 caminhos por pasta de cada vez; ' +
        'se "truncated" for verdadeiro, use "inicio" = "nextOffset" para continuar, ou ' +
        '"subpasta" para restringir a uma parte da árvore.',
      {
        type: 'object',
        properties: {
          subpasta: { type: 'string', description: 'Subpasta relativa (opcional, ex: src/renderer)' },
          inicio: {
            type: 'number',
            description: 'Posição de onde começar a listar; use o "nextOffset" da chamada anterior para paginar (opcional, padrão 0)'
          },
          max_arquivos: {
            type: 'number',
            description: 'Máximo de caminhos a devolver por pasta (opcional, padrão 200, teto 400)'
          },
          ...PASTA_PARAM,
          projectId: { type: 'string', description: 'ID do projeto (opcional; usa o ativo)' }
        },
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const { roots, error } = activeRoots(args)
      if (error) return JSON.stringify({ error })
      const sub = typeof args.subpasta === 'string' ? args.subpasta : '.'
      const inicio = typeof args.inicio === 'number' ? args.inicio : undefined
      const maxArquivos = typeof args.max_arquivos === 'number' ? args.max_arquivos : undefined
      const pastas = await Promise.all(
        roots.map(async (r) => ({
          pasta: r.nome,
          ...(await window.electronAPI.ai.code.list(r.path, sub, inicio, maxArquivos))
        }))
      )
      return JSON.stringify({ pastas })
    }
  },

  ler_arquivo: {
    definition: fn(
      'ler_arquivo',
      'Lê um arquivo do código do projeto pelo caminho relativo (ex: src/main/store.ts). ' +
        'Procura em todas as pastas marcadas; use pastaId se o mesmo caminho existir em mais de uma. ' +
        'Devolve no máximo ~20 mil caracteres por vez; se "truncated" for verdadeiro, releia com ' +
        '"inicio" = "nextOffset" para continuar de onde parou.',
      {
        type: 'object',
        properties: {
          caminho: { type: 'string', description: 'Caminho relativo do arquivo' },
          inicio: {
            type: 'number',
            description: 'Posição (em caracteres) de onde começar a ler; use o "nextOffset" da leitura anterior para paginar (opcional, padrão 0)'
          },
          max_chars: {
            type: 'number',
            description: 'Máximo de caracteres a devolver nesta leitura (opcional, padrão 20000, teto 60000)'
          },
          ...PASTA_PARAM,
          projectId: { type: 'string', description: 'ID do projeto (opcional; usa o ativo)' }
        },
        required: ['caminho'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const { roots, error } = activeRoots(args)
      if (error) return JSON.stringify({ error })
      const rel = typeof args.caminho === 'string' ? args.caminho : ''
      if (!rel) return JSON.stringify({ error: 'Caminho vazio' })
      const inicio = typeof args.inicio === 'number' ? args.inicio : undefined
      const maxChars = typeof args.max_chars === 'number' ? args.max_chars : undefined

      const reads = await Promise.all(
        roots.map(async (r) => ({
          root: r,
          res: await window.electronAPI.ai.code.read(r.path, rel, inicio, maxChars)
        }))
      )
      const hits = reads.filter((h) => !('error' in h.res && h.res.error))
      // Reading the wrong file silently would be worse than asking: when the
      // path is ambiguous across roots, make the model pick.
      if (hits.length > 1) {
        return JSON.stringify({
          error: `"${rel}" existe em mais de uma pasta: ${hits.map((h) => h.root.nome).join(', ')}. Repita com pastaId.`,
          pastas: hits.map((h) => ({ id: h.root.id, nome: h.root.nome }))
        })
      }
      if (!hits.length) {
        return JSON.stringify(reads[0]?.res ?? { error: 'Arquivo não encontrado' })
      }
      return JSON.stringify({ pasta: hits[0].root.nome, ...hits[0].res })
    }
  },

  buscar_no_codigo: {
    definition: fn(
      'buscar_no_codigo',
      'Busca um termo/texto no código do projeto (grep). Retorna arquivos e linhas que casam, ' +
        'em todas as pastas de código marcadas.',
      {
        type: 'object',
        properties: {
          termo: { type: 'string', description: 'Texto a buscar' },
          ...PASTA_PARAM,
          projectId: { type: 'string', description: 'ID do projeto (opcional; usa o ativo)' }
        },
        required: ['termo'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const { roots, error } = activeRoots(args)
      if (error) return JSON.stringify({ error })
      const termo = typeof args.termo === 'string' ? args.termo : ''
      if (!termo) return JSON.stringify({ error: 'Termo vazio' })
      const pastas = await Promise.all(
        roots.map(async (r) => ({
          pasta: r.nome,
          ...(await window.electronAPI.ai.code.search(r.path, termo))
        }))
      )
      return JSON.stringify({ pastas })
    }
  },

  buscar_na_web: {
    // Not a write tool: it touches no app data. The risk here is the other
    // direction — an untrusted page answering back — and that is main's to
    // police (scheme, private hosts, every redirect hop, size cap). The URL is
    // passed through unvetted on purpose: a second opinion in the renderer
    // would be a second place for the policy to drift out of step.
    definition: fn(
      'buscar_na_web',
      'Lê o texto de uma página web pela URL. Use para consultar documentação ou uma ' +
        'referência que não esteja no app nem no código do projeto. Se a página for uma SPA ' +
        'que renderiza por JavaScript (o texto vier vazio ou só o esqueleto), repita com ' +
        'renderizar_js=true para carregá-la num navegador de verdade.',
      {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL completa da página (http:// ou https://)' },
          renderizar_js: {
            type: 'boolean',
            description:
              'Renderiza a página num navegador headless (executa JavaScript). Mais lento; ' +
              'use só quando o fetch simples devolver pouco ou nenhum texto (opcional, padrão false)'
          }
        },
        required: ['url'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const url = typeof args.url === 'string' ? args.url.trim() : ''
      if (!url) return JSON.stringify({ error: 'URL vazia' })
      const render = args.renderizar_js === true
      // Shape is `{ content, url, truncated }` or `{ error }`; `url` is the
      // final one after redirects, so the model is told where it actually
      // landed rather than where it aimed.
      return JSON.stringify(await window.electronAPI.ai.web.fetch(url, render))
    }
  }
}

/** Tool definitions sent to the model each turn (derived from the registry). */
export const TOOL_DEFS: ToolDef[] = Object.values(REGISTRY).map((t) => t.definition)

/** Dispatch one tool call by name, returning a JSON string result. */
export async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = REGISTRY[name]
  if (!tool) return JSON.stringify({ error: `Ferramenta desconhecida: ${name}` })
  try {
    return await tool.run(args)
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : 'Falha na ferramenta' })
  }
}

/** Whether a tool mutates state (used to gate it behind user approval). */
export function isWriteTool(name: string): boolean {
  return REGISTRY[name]?.write === true
}

/**
 * What the assistant is doing right now, in the present tense — shown as a
 * status line in the transcript while the agent works. Unlike describeToolCall
 * (write actions only), this covers every tool, including the read ones.
 */
export function describeToolActivity(name: string, args: Record<string, unknown>): string {
  const str = (v: unknown): string => (typeof v === 'string' && v.trim() !== '' ? v : '')
  // `args` may legitimately be EMPTY: this also labels a tool call the model is
  // still composing, whose name arrives a beat before its arguments. So every
  // case must degrade to the generic verb rather than invent the detail — a
  // guessed number or type reads as fact and is worse than saying less. The
  // same restraint covers a model that sends malformed args at execution time.
  const n = (v: unknown): number | null => (Array.isArray(v) ? v.length : null)
  switch (name) {
    case 'ler_projetos':
      return 'Consultando os projetos'
    case 'ler_tasks':
      return 'Consultando as tasks'
    case 'ler_financeiro':
      return 'Consultando o financeiro'
    case 'ler_metas':
      return 'Consultando as metas'
    case 'ler_habitos':
      return 'Consultando os hábitos'
    case 'listar_arquivos': {
      const sub = str(args.subpasta)
      return sub ? `Listando os arquivos em ${sub}` : 'Listando os arquivos do projeto'
    }
    case 'ler_arquivo': {
      const caminho = str(args.caminho)
      return caminho ? `Lendo ${caminho}` : 'Lendo um arquivo'
    }
    case 'buscar_no_codigo': {
      const termo = str(args.termo)
      return termo ? `Buscando "${termo}" no código` : 'Buscando no código'
    }
    case 'buscar_na_web': {
      const url = str(args.url)
      return url ? `Lendo ${url}` : 'Lendo uma página web'
    }
    case 'criar_projeto': {
      const nome = str(args.nome)
      return nome ? `Criando o projeto ${nome}` : 'Criando um projeto'
    }
    case 'criar_tasks': {
      // Never "Criando 0 task(s)": with no args yet that is simply false, and
      // it is the label shown while a big criar_tasks writes its arguments.
      const count = n(args.tasks)
      return count === null ? 'Criando tasks' : `Criando ${count} task(s)`
    }
    case 'atualizar_task': {
      const alvo = str(args.titulo) || str(args.taskId)
      return alvo ? `Atualizando a task ${alvo}` : 'Atualizando uma task'
    }
    case 'mover_task':
      return `Movendo ${str(args.titulo) || str(args.taskId) || 'a task'} para ${
        str(args.coluna) || 'outra coluna'
      }`
    case 'concluir_task': {
      const alvo = str(args.titulo) || str(args.taskId)
      return alvo ? `Concluindo a task ${alvo}` : 'Concluindo uma task'
    }
    case 'deletar_task': {
      const alvo = str(args.titulo) || str(args.taskId)
      return alvo ? `Deletando a task ${alvo}` : 'Deletando uma task'
    }
    case 'iniciar_cronometro': {
      const alvo = str(args.titulo) || str(args.taskId)
      return alvo ? `Iniciando o cronômetro em ${alvo}` : 'Iniciando o cronômetro'
    }
    case 'marcar_habito': {
      const alvo = str(args.nome) || str(args.habitoId)
      return alvo ? `Marcando o hábito ${alvo} como feito` : 'Marcando um hábito como feito'
    }
    case 'criar_nota':
      return `Criando uma nota no canvas`
    case 'criar_transacao': {
      // Defaulting the type to 'despesa' would announce the wrong direction for
      // money before the model has said which it is.
      const tipo = args.tipo === 'receita' ? 'receita' : args.tipo === 'despesa' ? 'despesa' : ''
      if (!tipo || args.valor === undefined) return 'Lançando uma transação'
      return `Lançando ${tipo} de ${args.valor}`
    }
    case 'criar_meta': {
      const titulo = str(args.titulo)
      return titulo ? `Criando a meta ${titulo}` : 'Criando uma meta'
    }
    case 'atualizar_meta': {
      const alvo = str(args.titulo) || str(args.metaId)
      return alvo ? `Atualizando a meta ${alvo}` : 'Atualizando uma meta'
    }
    case 'criar_sprints': {
      const nomes = Array.isArray(args.nomes) ? args.nomes.join(', ') : ''
      return nomes ? `Criando sprints: ${nomes}` : 'Criando sprints'
    }
    case 'atribuir_sprint': {
      const sprint = str(args.sprint)
      return sprint ? `Atribuindo a sprint "${sprint}"` : 'Atribuindo uma sprint'
    }
    case 'rodar_agente_codigo':
      return `Rodando o agente de código (${str(args.agent) || 'aider'})`
    default:
      return name
  }
}

/** Human-readable summary of a write action, shown in the approval card. */
export function describeToolCall(name: string, args: Record<string, unknown>): string {
  const alvo = (args.titulo ?? args.taskId ?? '?') as string
  switch (name) {
    // Worth spelling out: this also switches the active project.
    case 'criar_projeto':
      return `Criar projeto "${args.nome ?? '?'}" (passa a ser o projeto ativo)`
    case 'criar_tasks':
      return `Criar ${Array.isArray(args.tasks) ? args.tasks.length : 0} task(s)`
    // Spell out each field: approving "atualizar_task" without seeing that it
    // wipes the tags is not a real approval.
    case 'atualizar_task': {
      const blank = (v: unknown): boolean => typeof v === 'string' && v.trim() === ''
      const campos: string[] = []
      if (args.prioridade !== undefined) campos.push(`prioridade → ${args.prioridade}`)
      if (args.descricao !== undefined) {
        campos.push(blank(args.descricao) ? 'apagar a descrição' : 'nova descrição')
      }
      if (args.dueDate !== undefined) {
        campos.push(blank(args.dueDate) ? 'remover o prazo' : `prazo → ${args.dueDate}`)
      }
      if (args.tags !== undefined) {
        const tags = Array.isArray(args.tags) ? args.tags : []
        campos.push(tags.length > 0 ? `tags → ${tags.join(', ')}` : 'apagar as tags')
      }
      return `Atualizar task ${alvo}: ${campos.join('; ') || '(nada)'}`
    }
    case 'mover_task':
      return `Mover task ${alvo} para a coluna "${args.coluna ?? '?'}"`
    case 'concluir_task':
      return `Concluir task: ${alvo}`
    // Unlike the rest, this one can't be undone — flag it like the code agent.
    case 'deletar_task':
      return `⚠️ Deletar task PERMANENTEMENTE: ${alvo}`
    case 'iniciar_cronometro':
      return `Iniciar cronômetro: ${alvo}`
    case 'marcar_habito':
      return `Marcar hábito ${args.nome ?? args.habitoId ?? '?'} como feito hoje`
    case 'criar_nota': {
      const texto = String(args.conteudo ?? '')
      return `Criar nota: "${texto.length > 60 ? `${texto.slice(0, 60)}…` : texto}"`
    }
    // Money: the amount and where it lands have to be on the card itself.
    case 'criar_transacao': {
      const tipo = args.tipo === 'receita' ? 'Receita' : 'Despesa'
      const extra = [
        args.categoria ? `categoria ${args.categoria}` : '',
        args.data ? `em ${args.data}` : 'hoje',
        args.tabela ? `tabela ${args.tabela}` : ''
      ].filter(Boolean)
      return `${tipo} de ${args.valor ?? '?'} — "${args.descricao ?? ''}" (${extra.join(', ')})`
    }
    case 'criar_meta':
      return `Criar meta "${args.titulo ?? '?'}": alvo ${args.alvo ?? '?'} ${args.unidade ?? ''}`.trim()
    case 'atualizar_meta': {
      const campos: string[] = []
      if (args.novoTitulo !== undefined) campos.push(`nome → ${args.novoTitulo}`)
      if (args.alvo !== undefined) campos.push(`alvo → ${args.alvo}`)
      if (args.unidade !== undefined) campos.push(`unidade → ${args.unidade || '(vazia)'}`)
      if (args.cor !== undefined) campos.push('nova cor')
      if (args.projectId !== undefined) {
        campos.push(String(args.projectId).trim() === '' ? 'desvincular do projeto' : 'novo projeto')
      }
      const alvoMeta = (args.titulo ?? args.metaId ?? '?') as string
      return `Atualizar meta ${alvoMeta}: ${campos.join('; ') || '(nada)'}`
    }
    case 'criar_sprints':
      return `Criar sprints: ${Array.isArray(args.nomes) ? args.nomes.join(', ') : ''}`
    case 'atribuir_sprint':
      return `Atribuir sprint "${args.sprint ?? '?'}" à task ${alvo}`
    case 'rodar_agente_codigo':
      return `⚠️ Rodar agente de código (${args.agent ?? 'aider'}) no projeto: ${args.task ?? ''}`
    default:
      return name
  }
}
