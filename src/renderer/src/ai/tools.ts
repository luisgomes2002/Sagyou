import Decimal from 'decimal.js'
import { useKanbanStore } from '../store/kanban'
import { useAiRunStore } from '../store/aiRun'
import { D, FINANCIAL_CATEGORIES } from '../components/financial/shared'
import { computeHabitSummary, todayISO } from '../utils/habits'
import { isDoneColumn } from '../utils/columns'
import { PRIORITY_CONFIG, PROJECT_COLORS, NOTE_COLORS } from '../types'
import type { AITaskInput, Task, Priority, Goal, Habit, FinancialTable, StickyNote } from '../types'
import { isWriteTool as isWriteFromRegistry } from './permission-registry'
import { validateToolInput } from './validators'
import glossaryRaw from './glossary.json'

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
export const DEFAULT_TASK_LIMIT = 100

/** Hard ceiling: a hand-picked `limit` can raise the default, but not past this. */
const MAX_TASK_LIMIT = 500

/** `limit` comes from the model, so it is a suggestion, not an instruction. */
function clampLimit(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) return DEFAULT_TASK_LIMIT
  return Math.min(Math.floor(v), MAX_TASK_LIMIT)
}

/**
 * Cap on the sibling projects named back when a search found nothing here.
 *
 * Bounded for the same reason everything else is: the hint is resent on every
 * later step of the run. Six projects is a real board today, so this is a
 * ceiling against growth rather than something a user meets.
 */
const OTHER_PROJECTS_MAX = 20

/** Which slice of the board `ler_tasks` returns. */
export type TaskState = 'abertas' | 'concluidas' | 'todas'

/**
 * Which tasks to return, defaulting to the open ones.
 *
 * ⚠️ **The default is 'abertas', and that is a cost decision.** Measured on real
 * data, 185 of 413 tasks (45%) were already done — dead weight that every later
 * step of a run pays for again. A question about open work is the common case;
 * one about finished work has to ask.
 *
 * The boolean `concluida` was the old parameter and is still accepted, never
 * rejected: an old transcript or a cached schema will keep sending it, and a
 * hard error there costs a paid step to say "wrong argument". Same tolerance as
 * `rodar_agente_codigo` ignoring a leftover `agent`. Anything unrecognised
 * (a typo, a hand-edited string) falls back to the default rather than erroring
 * — the model gets a smaller answer, never a broken one.
 */
export function resolveTaskState(args: Record<string, unknown>): TaskState {
  const raw = args.estado
  if (raw === 'concluidas' || raw === 'todas' || raw === 'abertas') return raw
  // Legacy: concluida:true meant "only done", false meant "only open".
  if (typeof args.concluida === 'boolean') return args.concluida ? 'concluidas' : 'abertas'
  return 'abertas'
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
    return {
      roots: [],
      error: `Pasta "${pastaId}" não encontrada. Disponíveis: ${roots.map((r) => r.nome).join(', ')}`
    }
  }
  return { roots: [one] }
}

/** The `pastaId` parameter, shared by the code tools. */
const PASTA_PARAM = {
  pastaId: {
    type: 'string',
    description:
      'Restringe a uma pasta de código (id ou nome de ler_projetos). Omita para usar todas as marcadas.'
  }
} as const

// ---------------------------------------------------------------------------
// buscar_no_codigo result cache
//
// A code grep is resent to the model on every later step of a run, and the
// model often searches near-duplicate terms across one run (e.g. "backup" then
// "exportBackup"). This caches a search's result by (roots + normalised term)
// for a short window, so re-searching the same term returns the same bytes
// without re-walking the tree.
//
// ⚠️ Trade-off: within CODE_SEARCH_TTL_MS a file edited *outside* the app (an
// editor, git) can return a stale hit. The code agent edits files too, so
// clearCodeSearchCache() runs whenever a code-agent run is fired. The TTL is
// deliberately short to bound the staleness the app can't observe.
// ---------------------------------------------------------------------------
const CODE_SEARCH_TTL_MS = 30_000
const CODE_SEARCH_CACHE_MAX = 50
const codeSearchCache = new Map<string, { at: number; result: string }>()

/** Drop every cached code-search result. Called when files may have changed. */
export function clearCodeSearchCache(): void {
  codeSearchCache.clear()
}

/** Cache key for a search: the (sorted) roots it spans plus the normalised term. */
function codeSearchKey(roots: Root[], termo: string): string {
  return (
    roots
      .map((r) => r.path)
      .sort()
      .join('|') +
    '::' +
    termo.trim().toLowerCase()
  )
}

// --- Registry: name -> tool. This is the map the task asks for. ---
const REGISTRY: Record<string, AITool> = {
  data_de_hoje: {
    definition: fn(
      'data_de_hoje',
      'Retorna a data e hora atual no fuso de Brasília (America/Sao_Paulo). ' +
        '⚠️ Use esta ferramenta ANTES de qualquer operação que envolva datas — NUNCA adivinhe o dia de hoje. ' +
        'O retorno inclui o dia da semana por extenso (segunda-feira, etc.) e a data em YYYY-MM-DD.',
      NO_PARAMS
    ),
    run: () => {
      const now = new Date()
      const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
      const iso = now.toISOString()
      const data = iso.slice(0, 10)
      const hora = iso.slice(11, 16)
      return JSON.stringify({
        dia_semana: dias[now.getDay()],
        data,
        hora,
        iso: now.toISOString()
      })
    }
  },

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
      'Lista as tasks do projeto: título, coluna, prioridade, tags. ' +
        '⚠️ Só devolve as ABERTAS por padrão — use estado="concluidas" ou "todas" quando precisar. ' +
        'Filtre com busca/tag/coluna/prioridade/sprint/prazo/criação para economizar tokens. ' +
        'Sem projectId ou projeto, usa o ativo.',
      {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'ID do projeto (opcional)' },
          projeto: { type: 'string', description: 'Nome do projeto (opcional, alternativa ao projectId)' },
          busca: { type: 'string', description: 'Texto no título (opcional, ignora acentos)' },
          tag: { type: 'string', description: 'Só tasks com esta tag (opcional)' },
          coluna: { type: 'string', description: 'Só tasks nesta coluna, pelo nome (opcional)' },
          estado: {
            type: 'string',
            enum: ['abertas', 'concluidas', 'todas'],
            description: 'Filtro: abertas (padrão), concluidas ou todas'
          },
          prioridade: {
            type: 'string',
            enum: [...PRIORITIES],
            description: 'Filtra por prioridade (opcional): low, medium, high, urgent'
          },
          sprint: { type: 'string', description: 'Nome da sprint (opcional)' },
          prazo_de: { type: 'string', description: 'Data inicial do prazo YYYY-MM-DD (opcional)' },
          prazo_ate: { type: 'string', description: 'Data final do prazo YYYY-MM-DD (opcional)' },
          criada_de: { type: 'string', description: 'Data inicial de criação YYYY-MM-DD (opcional)' },
          criada_ate: { type: 'string', description: 'Data final de criação YYYY-MM-DD (opcional)' },
          sem_sprint: { type: 'boolean', description: 'Só tasks sem sprint atribuída (opcional)' },
          limit: {
            type: 'number',
            description: `Máximo de tasks a devolver (opcional, padrão ${DEFAULT_TASK_LIMIT})`
          }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const { projects, tasks, sprints, activeProjectId } = useKanbanStore.getState()
      const projetoNome = typeof args.projeto === 'string' ? args.projeto.trim() : ''
      const byName = projetoNome
        ? projects.find((p) => p.name.trim().toLowerCase() === projetoNome.toLowerCase())?.id
        : undefined
      const projectId = (typeof args.projectId === 'string' && args.projectId) || byName || activeProjectId
      const project = projects.find((p) => p.id === projectId)
      if (!project) return JSON.stringify({ error: 'Projeto não encontrado' })
      const colName = (id: string): string => project.columns.find((c) => c.id === id)?.name ?? '?'

      const busca = typeof args.busca === 'string' ? normalize(args.busca.trim()) : ''
      const tag = typeof args.tag === 'string' ? normalize(args.tag.trim()) : ''
      const coluna = typeof args.coluna === 'string' ? normalize(args.coluna.trim()) : ''
      const prioridade = typeof args.prioridade === 'string' ? args.prioridade.trim().toLowerCase() : ''
      const estado = resolveTaskState(args)
      const sprintNome = typeof args.sprint === 'string' ? args.sprint.trim() : ''
      const projectSprints = sprintNome
        ? sprints.filter((s) => s.projectId === project.id)
        : []
      const sprintId = sprintNome
        ? projectSprints.find((s) => s.name.trim().toLowerCase() === sprintNome.toLowerCase())?.id
        : undefined
      const prazoDe = typeof args.prazo_de === 'string' ? args.prazo_de.trim() : ''
      const prazoAte = typeof args.prazo_ate === 'string' ? args.prazo_ate.trim() : ''
      const criadaDe = typeof args.criada_de === 'string' ? args.criada_de.trim() : ''
      const criadaAte = typeof args.criada_ate === 'string' ? args.criada_ate.trim() : ''
      const semSprint = args.sem_sprint === true

      // Everything the question matched, *before* the state filter. This is what
      // makes `concluidas_ocultas` truthful: the model has to be able to tell
      // "3 abertas" from "3 tasks", or it answers the wrong board size with
      // total confidence — the same failure `total`/`truncado` guard against.
      const subject = tasks.filter((t) => {
        if (t.projectId !== project.id) return false
        if (busca && !normalize(t.title).includes(busca)) return false
        if (tag && !t.tags.some((x) => normalize(x) === tag)) return false
        if (coluna && normalize(colName(t.columnId)) !== coluna) return false
        if (prioridade && t.priority !== prioridade) return false
        if (sprintId && t.sprintId !== sprintId) return false
        if (semSprint && t.sprintId) return false
        if (prazoDe && (!t.dueDate || t.dueDate < prazoDe)) return false
        if (prazoAte && (!t.dueDate || t.dueDate > prazoAte)) return false
        if (criadaDe && t.createdAt.slice(0, 10) < criadaDe) return false
        if (criadaAte && t.createdAt.slice(0, 10) > criadaAte) return false
        return true
      })

      const matched =
        estado === 'todas' ? subject : subject.filter((t) => !!t.completedAt === (estado === 'concluidas'))

      // ⚠️ The scope is ONE project — args.projectId, or the active one. When
      // nothing here matched the question at all, the likeliest explanation is
      // that it lives in another project, and staying quiet makes the model
      // answer "essa task não existe" about a task that does. Same class of
      // silent lie as `concluidas_ocultas`, different axis.
      //
      // Only on an empty subject: when something matched, the other projects
      // are noise that every later step of the run would pay for again. Ids and
      // names rather than a bare count, so the model can retry immediately
      // instead of spending a paid step on `ler_projetos` to learn them.
      const others = projects.filter((p) => p.id !== project.id)

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
        // Stated back, not assumed: the model asked for nothing and got a
        // filtered view, so the reply has to say which view it is.
        estado,
        // `total` vs the array's length is how the model knows it's seeing a
        // slice — without it, a truncated list reads as the whole board and it
        // would answer "you have 50 tasks" when there are 300.
        total: matched.length,
        truncado: matched.length > list.length,
        // How many the *state* filter dropped, on top of `truncado`'s slicing.
        // Without this the default view is a silent lie about the board's size.
        concluidas_ocultas: subject.length - matched.length,
        tasks: list,
        ...(subject.length === 0 &&
          others.length > 0 && {
            outros_projetos: others.slice(0, OTHER_PROJECTS_MAX).map((p) => ({
              id: p.id,
              nome: p.name
            }))
          })
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
        if (
          typeof args.cor !== 'string' ||
          !(PROJECT_COLORS as readonly string[]).includes(args.cor)
        ) {
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
      const busy = leaseBlock(task.id)
      if (busy) return busy

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
      const busy = leaseBlock(task.id)
      if (busy) return busy
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
      const busy = leaseBlock(task.id)
      if (busy) return busy
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
    definition: fn(
      'criar_sprints',
      'Cria uma ou mais sprints no projeto. Sem projectId, usa o ativo.',
      {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'ID do projeto (opcional)' },
          nomes: { type: 'array', items: { type: 'string' }, description: 'Nomes das sprints' }
        },
        required: ['nomes'],
        additionalProperties: false
      }
    ),
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
        if (
          typeof args.cor !== 'string' ||
          !(PROJECT_COLORS as readonly string[]).includes(args.cor)
        ) {
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

      const metaId = state.createGoal({
        title: titulo,
        target: alvo,
        unit: unidade,
        color: cor,
        projectId
      })
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
        if (
          typeof args.cor !== 'string' ||
          !(PROJECT_COLORS as readonly string[]).includes(args.cor)
        ) {
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
        if (
          typeof args.cor !== 'string' ||
          !(NOTE_COLORS as readonly string[]).includes(args.cor)
        ) {
          return JSON.stringify({ error: 'Cor inválida', disponiveis: NOTE_COLORS })
        }
        cor = args.cor
      }

      const { x, y } = freeNoteSpot(state.notes.filter((n) => n.projectId === projectId))
      const notaId = state.createNote(projectId, { content: conteudo, color: cor, x, y })
      return JSON.stringify({ ok: true, notaId, conteudo, posicao: { x, y } })
    }
  },

  ler_notas: {
    definition: fn(
      'ler_notas',
      'Lista as notas adesivas do canvas de um projeto: conteúdo, cor, posição e se está vinculada ' +
        'a alguma task. Sem projectId, usa o projeto ativo.',
      {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'ID do projeto (opcional; usa o ativo)' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const { projects, notes, activeProjectId } = useKanbanStore.getState()
      const projectId = (typeof args.projectId === 'string' && args.projectId) || activeProjectId
      const project = projects.find((p) => p.id === projectId)
      if (!project) return JSON.stringify({ error: 'Projeto não encontrado' })
      const list = notes
        .filter((n) => n.projectId === project.id)
        .map((n) => ({
          id: n.id,
          conteudo: n.content,
          cor: n.color,
          posicao: { x: n.x, y: n.y },
          taskVinculada: n.taskId ?? null,
          criadaEm: n.createdAt,
          tipo: n.type ?? 'note'
        }))
      return JSON.stringify({ projeto: project.name, total: list.length, notas: list })
    }
  },

  buscar_memoria: {
    definition: fn(
      'buscar_memoria',
      'Consulta as suas memórias duráveis (do projeto ativo + as globais). Sem filtro, ' +
        'lista todas; com "id" (o código em [colchetes] no briefing), pega aquela memória exata; ' +
        'com "termo", filtra por título, corpo ou tags (sem diferenciar acento/maiúscula). ' +
        'Use para recuperar o conteúdo de uma memória que aparece só como título no briefing.',
      {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Id da memória (o código entre [colchetes] no briefing). Busca exata.'
          },
          termo: { type: 'string', description: 'Texto a procurar (opcional)' },
          incluir_arquivadas: {
            type: 'boolean',
            description: 'true = inclui memórias arquivadas por inatividade (opcional)'
          }
        },
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      const termo = typeof args.termo === 'string' ? args.termo.trim() : ''
      const projectId = useKanbanStore.getState().activeProjectId
      const all = await window.electronAPI.ai.memory.list({
        projectId: projectId ?? null,
        includeArchived: args.incluir_arquivadas === true
      })
      // An id wins over a term (it's the precise lookup). The briefing shows an
      // 8-char prefix of a uuid, so match a prefix as well as the full id.
      const q = normalize(termo)
      const matched = id
        ? all.filter((m) => m.id === id || m.id.startsWith(id))
        : q
          ? all.filter((m) => normalize(`${m.title} ${m.body} ${m.tags.join(' ')}`).includes(q))
          : all
      const LIMIT = 30
      const top = matched.slice(0, LIMIT)
      // Explicit retrieval is what keeps a memory warm — the bulk briefing is
      // decay-neutral, so this is the only place access is bumped.
      if (top.length) void window.electronAPI.ai.memory.touch(top.map((m) => m.id))
      return JSON.stringify({
        total: matched.length,
        truncado: matched.length > top.length,
        memorias: top.map((m) => ({
          id: m.id,
          tipo: m.type,
          titulo: m.title,
          corpo: m.body,
          tags: m.tags,
          escopo: m.projectId ? 'projeto' : 'global',
          fixada: m.pinned,
          ...(m.archivedAt ? { arquivada: true } : {})
        }))
      })
    }
  },

  buscar_conversas: {
    definition: fn(
      'buscar_conversas',
      'Procura em conversas anteriores com este usuário por título ou por qualquer coisa dita ' +
        'no chat (sem diferenciar acento). Devolve os chats que batem, com um trecho. Use para ' +
        'lembrar o que já foi discutido antes.',
      {
        type: 'object',
        properties: {
          termo: { type: 'string', description: 'Texto a procurar nas conversas' }
        },
        required: ['termo'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const termo = typeof args.termo === 'string' ? args.termo.trim() : ''
      if (!termo) return JSON.stringify({ error: 'Informe o termo a buscar' })
      const res = await window.electronAPI.ai.conversations.search(termo)
      const LIMIT = 20
      return JSON.stringify({
        total: res.length,
        truncado: res.length > LIMIT,
        conversas: res.slice(0, LIMIT).map((c) => ({
          id: c.id,
          titulo: c.title,
          quando: c.updatedAt,
          ...(c.snippet ? { trecho: c.snippet } : {})
        }))
      })
    }
  },

  ler_conversa: {
    definition: fn(
      'ler_conversa',
      'Lê o conteúdo completo de uma conversa anterior pelo id (o "id=..." que um handoff ' +
        '"Última sessão" traz no fim). Use quando um handoff truncado (terminando em "…") for ' +
        'relevante e você precisar do que foi de fato discutido — em vez de refazer do zero. ' +
        'Devolve os turnos (sem as linhas de status), com teto de tamanho.',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id da conversa (ex.: o "id=..." do handoff)' }
        },
        required: ['id'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      if (!id) return JSON.stringify({ error: 'Informe o id da conversa' })
      const conv = await window.electronAPI.ai.conversations.get(id)
      if (!conv) return JSON.stringify({ error: 'Conversa não encontrada' })
      // Status lines are the agent's own tool trace — noise here; keep the real
      // exchange (user/assistant). Cap the total: the transcript is resent on
      // every later step, so a huge one would tax the whole run.
      const MAX_CHARS = 8000
      const turns: { autor: string; texto: string }[] = []
      let used = 0
      let truncado = false
      for (const m of conv.messages ?? []) {
        if (m.role === 'status') continue
        const texto = typeof m.content === 'string' ? m.content : ''
        if (!texto.trim()) continue
        if (used + texto.length > MAX_CHARS) {
          truncado = true
          break
        }
        used += texto.length
        turns.push({ autor: m.role === 'user' ? 'usuario' : 'assistente', texto })
      }
      return JSON.stringify({
        id: conv.id,
        titulo: conv.title,
        quando: conv.updatedAt,
        truncado,
        turnos: turns
      })
    }
  },

  verificar_memorias: {
    definition: fn(
      'verificar_memorias',
      'Audita suas memórias em busca de contradições — pares que falam do mesmo assunto ' +
        '(mesmo título) com conteúdos diferentes, sinal de que uma pode estar desatualizada. ' +
        'Use quando suspeitar que suas memórias se contradizem ou quando o usuário pedir para revisá-las.',
      NO_PARAMS
    ),
    run: async () => {
      const conflicts = await window.electronAPI.ai.memory.conflicts()
      if (!conflicts.length) {
        return JSON.stringify({ ok: true, total: 0, conflitos: [], mensagem: 'Nenhuma contradição aparente.' })
      }
      const all = await window.electronAPI.ai.memory.list({})
      const byId = new Map(all.map((m) => [m.id, m]))
      const fmt = (id: string): Record<string, unknown> => {
        const m = byId.get(id)
        return m
          ? {
              id: m.id,
              tipo: m.type,
              corpo: m.body,
              escopo: m.projectId ? 'projeto' : 'global',
              fixada: m.pinned
            }
          : { id, ausente: true }
      }
      return JSON.stringify({
        total: conflicts.length,
        conflitos: conflicts.map((c) => ({ titulo: c.title, a: fmt(c.a), b: fmt(c.b) })),
        aviso:
          'Cada par fala do mesmo assunto com conteúdos diferentes. Considere atualizar a ' +
          'memória correta e reescrever/apagar a desatualizada.'
      })
    }
  },

  salvar_memoria: {
    write: true,
    definition: fn(
      'salvar_memoria',
      'Guarda um fato durável entre conversas (decisao/tradeoff/gotcha/fato). ' +
        'Uma por chamada. Escopo = projeto ativo; use global=true para fatos pessoais. ' +
        'NUNCA salve segredos — são removidos automaticamente.',
      {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: ['decisao', 'tradeoff', 'gotcha', 'fato'],
            description: 'Tipo: decisao, tradeoff, gotcha ou fato'
          },
          titulo: { type: 'string', description: 'Assunto curto da memória' },
          corpo: { type: 'string', description: 'O fato em si, explicado' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Rótulos opcionais para agrupar/buscar'
          },
          global: {
            type: 'boolean',
            description: 'true = fato sobre o usuário, sem vínculo com projeto (opcional)'
          },
          fixar: {
            type: 'boolean',
            description: 'true = nunca expira por inatividade (opcional; use com parcimônia)'
          }
        },
        required: ['tipo', 'titulo', 'corpo'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const tipos = ['decisao', 'tradeoff', 'gotcha', 'fato']
      const tipo = tipos.includes(String(args.tipo)) ? String(args.tipo) : 'fato'
      const titulo = typeof args.titulo === 'string' ? args.titulo.trim() : ''
      const corpo = typeof args.corpo === 'string' ? args.corpo.trim() : ''
      if (!titulo && !corpo) return JSON.stringify({ error: 'Informe título e corpo da memória' })

      const global = args.global === true
      const projectId = global
        ? null
        : (typeof args.projectId === 'string' && args.projectId) ||
          useKanbanStore.getState().activeProjectId ||
          null
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((t): t is string => typeof t === 'string')
        : undefined

      const res = await window.electronAPI.ai.memory.save({
        type: tipo,
        title: titulo,
        body: corpo,
        tags,
        projectId,
        pinned: args.fixar === true,
        source: 'modelo'
      })
      if ('error' in res) return JSON.stringify({ error: res.error })
      return JSON.stringify({
        ok: true,
        memoriaId: res.memory.id,
        tipo,
        escopo: projectId ? 'projeto' : 'global',
        // If the scrubber touched anything, say so — the model (and the approval
        // card) shouldn't believe it stored something it didn't.
        ...(res.redacted
          ? { aviso: 'Trechos que pareciam segredos foram removidos antes de salvar.' }
          : {})
      })
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
      'Dispara o agente de código para IMPLEMENTAR (não só analisar). ' +
        'Roda em UMA pasta — use pastaId se houver várias. ' +
        'Passe "arquivos" com os caminhos já localizados para evitar descoberta cara.',
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
          decisoes: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Decisões de escopo já acertadas com o usuário que o agente deve respeitar sem ' +
              're-perguntar (ex.: "manter o fallback parseV1", "não alterar o tipo Project", ' +
              '"mexer só na documentação"). Opcional, mas envie quando existirem: evita o agente ' +
              'reabrir escolhas já feitas e gerar re-trabalho.'
          },
          ...PASTA_PARAM,
          projectId: { type: 'string', description: 'ID do projeto (opcional; usa o ativo)' }
        },
        required: ['task'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
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
      // Pinning the target files lets the agent edit them directly instead of
      // hunting for them with its own grep/read tools first. Main confines each
      // path to the root; here we just pass the clean list through.
      const files = Array.isArray(args.arquivos)
        ? args.arquivos.filter((f): f is string => typeof f === 'string' && f.trim() !== '')
        : undefined
      // Scope decisions the chat already settled: passed through to the agent's
      // system prompt as constraints, so it doesn't reopen a choice already made.
      const decisoes = Array.isArray(args.decisoes)
        ? args.decisoes.filter((d): d is string => typeof d === 'string' && d.trim() !== '')
        : undefined
      // Fire-and-forget; the real outcome streams to the UI panel. Report the
      // request honestly — do NOT claim guaranteed success.
      // Which chat this run belongs to, so its log and diff can be reopened from
      // there later. `runningConvId` and not `conversationId`: a run belongs to
      // the chat that started it, not to whichever one the user is looking at
      // when the agent finishes.
      // The agent is about to edit files under this root, so any cached code
      // search of it is now potentially stale — drop the cache.
      clearCodeSearchCache()
      const runningConvId = currentRunConvId()
      // Same project the read tools resolved to — so the code agent is briefed
      // with this project's memory (shared with the chat).
      const projectId =
        (typeof args.projectId === 'string' && args.projectId) ||
        useKanbanStore.getState().activeProjectId
      const result = await window.electronAPI.ai.codeAgent.run({
        path,
        task,
        files,
        decisoes,
        convId: runningConvId ?? undefined,
        projectId
      })
      if (!result.success) {
        return JSON.stringify({
          status: 'erro',
          erro: result.error || 'Falha ao iniciar o agente de código'
        })
      }
      return JSON.stringify({
        status: 'solicitado',
        agente: result.agent || 'codex',
        diretorio: path,
        runId: result.runId,
        arquivos: files && files.length ? files : undefined,
        decisoes: decisoes && decisoes.length ? decisoes : undefined,
        aviso:
          'Pedido enviado. Não afirme sucesso: acompanhe o painel de saída. Se o agente não ' +
          'estiver instalado, aparecerá um erro lá.'
      })
    }
  },

  listar_arquivos: {
    definition: fn(
      'listar_arquivos',
      'Lista os arquivos do projeto (recursivo; ignora node_modules/.git/dist). ' +
        'Use para descobrir a estrutura antes de ler arquivos. Cobre todas as pastas de ' +
        'código marcadas no projeto. Devolve no máximo ~200 caminhos por pasta de cada vez; ' +
        'se "truncated" for verdadeiro, use "inicio" = "nextOffset" para continuar, ou ' +
        '"subpasta" para restringir a uma parte da árvore.',
      {
        type: 'object',
        properties: {
          subpasta: {
            type: 'string',
            description: 'Subpasta relativa (opcional, ex: src/renderer)'
          },
          inicio: {
            type: 'number',
            description:
              'Posição de onde começar a listar; use o "nextOffset" da chamada anterior para paginar (opcional, padrão 0)'
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
      'Lê um arquivo pelo caminho relativo (ex: src/main/store.ts). ' +
        '💡 Prefira simbolo (extrai função/classe) ou linha_inicio/linha_fim a ler o arquivo todo. ' +
        'Quando truncado, use inicio=nextOffset para continuar. ' +
        'Se o caminho existir em várias pastas, use pastaId.',
      {
        type: 'object',
        properties: {
          caminho: { type: 'string', description: 'Caminho relativo do arquivo' },
          simbolo: {
            type: 'string',
            description:
              'Nome de uma função/classe/const/interface a extrair — devolve só o escopo dela ' +
              '(opcional). Preferível a ler o arquivo todo. Se não achar, a resposta traz "simbolos".'
          },
          linha_inicio: {
            type: 'number',
            description: 'Primeira linha (1-based) de um trecho a ler (opcional; use com linha_fim)'
          },
          linha_fim: {
            type: 'number',
            description: 'Última linha (1-based) do trecho a ler (opcional; padrão: até o fim)'
          },
          inicio: {
            type: 'number',
            description:
              'Posição (em caracteres) de onde começar a ler; use o "nextOffset" da leitura anterior para paginar (opcional, padrão 0)'
          },
          max_chars: {
            type: 'number',
            description:
              'Máximo de caracteres a devolver nesta leitura (opcional, padrão 20000, teto 60000)'
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

      // Scoped read: a named symbol or a line range. Only built when asked, so a
      // plain read still calls code.read with four args (its existing contract).
      const simbolo = typeof args.simbolo === 'string' && args.simbolo.trim() !== '' ? args.simbolo.trim() : undefined
      const lineStart = typeof args.linha_inicio === 'number' ? args.linha_inicio : undefined
      const lineEnd = typeof args.linha_fim === 'number' ? args.linha_fim : undefined
      const scope =
        simbolo || lineStart != null || lineEnd != null ? { symbol: simbolo, lineStart, lineEnd } : undefined

      const reads = await Promise.all(
        roots.map(async (r) => ({
          root: r,
          res: scope
            ? await window.electronAPI.ai.code.read(r.path, rel, inicio, maxChars, scope)
            : await window.electronAPI.ai.code.read(r.path, rel, inicio, maxChars)
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
      'Busca um termo/texto no código do projeto (grep), em todas as pastas marcadas. As ' +
        'ocorrências vêm AGRUPADAS por arquivo — cada arquivo traz suas linhas ("linha"/"texto"). ' +
        'Use a "linha" com ler_arquivo (linha_inicio/linha_fim ou simbolo) para ler só o trecho ' +
        'certo em vez do arquivo todo.',
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
      // Short-lived cache: a re-search of the same term over the same roots is
      // common within a run, and the result is resent on every later step.
      const key = codeSearchKey(roots, termo)
      const cached = codeSearchCache.get(key)
      if (cached && Date.now() - cached.at < CODE_SEARCH_TTL_MS) return cached.result
      const pastas = await Promise.all(
        roots.map(async (r) => {
          const res = await window.electronAPI.ai.code.search(r.path, termo)
          if (res.error) return { pasta: r.nome, error: res.error }
          // Group by file: the flat list repeats the path on every hit, and a
          // whole result is resent to the model on each later step of the run.
          // One entry per file, its lines nested, is smaller and easier to read.
          const byFile = new Map<string, { linha: number; texto: string }[]>()
          for (const m of res.matches ?? []) {
            const arr = byFile.get(m.file) ?? []
            arr.push({ linha: m.line, texto: m.text })
            byFile.set(m.file, arr)
          }
          return {
            pasta: r.nome,
            arquivos: [...byFile].map(([arquivo, ocorrencias]) => ({ arquivo, ocorrencias })),
            total: (res.matches ?? []).length,
            truncado: res.truncated === true
          }
        })
      )
      const result = JSON.stringify({ pastas })
      // Bounded: on the rare occasion the run explores dozens of distinct terms,
      // drop the whole cache rather than grow without limit.
      if (codeSearchCache.size >= CODE_SEARCH_CACHE_MAX) codeSearchCache.clear()
      codeSearchCache.set(key, { at: Date.now(), result })
      return result
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
  },

  ler_linhagem: {
    definition: fn(
      'ler_linhagem',
      'Consulta o histórico de alterações (event log) de uma entidade específica. ' +
        'Retorna quando foi criada, atualizada ou removida, e por quem (usuário ou IA). ' +
        'Use para rastrear a proveniência de uma task, meta, nota ou transação.',
      {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            description:
              'Tipo da entidade: project, task, sprint, note, goal, habit, financial_table, file'
          },
          id: { type: 'string', description: 'ID da entidade (ex: id da task, id da meta)' }
        },
        required: ['tipo', 'id']
      }
    ),
    run: async (args) => {
      const tipo = typeof args.tipo === 'string' ? args.tipo : ''
      const id = typeof args.id === 'string' ? args.id : ''
      if (!tipo || !id) return JSON.stringify({ error: 'Informe tipo e id da entidade' })
      const events = await window.electronAPI.ai.lineage.list(tipo, id)
      return JSON.stringify({ tipo, id, eventos: events, total: events.length })
    }
  },

  // ── Planner tools ──────────────────────────────────────────────────────────

  ler_plano: {
    definition: fn(
      'ler_plano',
      'Lê os blocos de tempo (time blocks) do planejamento para um dia ou uma semana. ' +
        'Também inclui tasks com dueDate no período, hábitos do dia, e transações financeiras do mês ' +
        '(contas a pagar/receber). Use para ver o que já está agendado antes de criar ou ajustar um plano.',
      {
        type: 'object',
        properties: {
          data: {
            type: 'string',
            description: 'Data YYYY-MM-DD para ler o plano de um dia, ou YYYY-MM-DD/YYYY-MM-DD para uma semana.'
          }
        },
        required: ['data']
      }
    ),
    run: (args) => {
      const raw = typeof args.data === 'string' ? args.data : ''
      if (!raw) return JSON.stringify({ error: 'Informe uma data (YYYY-MM-DD) ou intervalo (YYYY-MM-DD/YYYY-MM-DD)' })
      const parts = raw.split('/')
      const dateStart = parts[0]
      const dateEnd = parts[1] ?? parts[0]
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(dateEnd))
        return JSON.stringify({ error: 'Formato inválido. Use YYYY-MM-DD ou YYYY-MM-DD/YYYY-MM-DD' })

      const { timeBlocks, tasks, habits, lists } = useKanbanStore.getState()

      const blocks = timeBlocks
        .filter((tb) => tb.date >= dateStart && tb.date <= dateEnd)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))

      const tasksInRange = tasks
        .filter((t) => t.dueDate && t.dueDate >= dateStart && t.dueDate <= dateEnd)

      const habitsToday = dateStart === dateEnd
        ? habits
            .filter((h) => h.completions.includes(dateStart))
            .map((h) => ({ nome: h.name, cor: h.color }))
        : undefined

      const today = dateStart.slice(0, 7) // YYYY-MM
      const monthTransactions: { descricao: string; valor: string; tipo: string; data: string; categoria?: string }[] = []
      for (const list of lists) {
        for (const tx of list.transactions) {
          if (tx.date.startsWith(today)) monthTransactions.push({
            descricao: tx.description,
            valor: tx.amount,
            tipo: tx.type,
            data: tx.date,
            ...(tx.category ? { categoria: tx.category } : {})
          })
        }
      }

      const planosPorDia: Record<string, { blocos: unknown[]; tasks: unknown[] }> = {}
      for (const block of blocks) {
        const day = (planosPorDia[block.date] ??= { blocos: [], tasks: [] })
        day.blocos.push({
          id: block.id, titulo: block.title, inicio: block.startTime, fim: block.endTime,
          tipo: block.type,
          ...(block.description ? { descricao: block.description } : {}),
          ...(block.taskId ? { taskId: block.taskId } : {}),
          ...(block.habitId ? { habitId: block.habitId } : {}),
          ...(block.color ? { cor: block.color } : {})
        })
      }
      for (const t of tasksInRange) {
        const day = (planosPorDia[t.dueDate!] ??= { blocos: [], tasks: [] })
        day.tasks.push({
          id: t.id, titulo: t.title, prioridade: t.priority,
          coluna: t.columnId,
          ...(t.order ? {} : {})
        })
      }

      return JSON.stringify({
        intervalo: { de: dateStart, ate: dateEnd },
        planosPorDia,
        totalBlocos: blocks.length,
        totalTasksComPrazo: tasksInRange.length,
        ...(habitsToday ? { habitosConcluidosHoje: habitsToday } : {}),
        ...(monthTransactions.length ? {
          transacoesDoMes: monthTransactions.slice(0, 30),
          totalTransacoesMes: monthTransactions.length,
          truncado: monthTransactions.length > 30
        } : {})
      })
    }
  },

  criar_plano: {
    definition: fn(
      'criar_plano',
      'Cria blocos de tempo (time blocks) no planejamento para um dia ou vários dias. ' +
        'Cada bloco tem título, horário de início e fim, e um tipo: task (tarefa vinculada ao kanban), ' +
        'routine (rotina recorrente), buffer (tempo morto: deslocamento, almoço, banho), ou custom (genérico). ' +
        'Use SEMPRE que o usuário pedir para planejar/organizar o dia/semana. ' +
        '⚠️ Antes de criar, chame ler_plano para ver o que já existe e ler_tasks/ler_habitos/ler_financeiro ' +
        'para consultar os dados que vão alimentar o plano. ' +
        '⚠️ Respeite buffers: se o usuário sai do trabalho às 13h, não agende nada para 13h01 — ' +
        'coloque buffers de deslocamento, banho e almoço antes das tasks.',
      {
        type: 'object',
        properties: {
          blocos: {
            type: 'array',
            description: 'Array de blocos de tempo a criar',
            items: {
              type: 'object',
              properties: {
                data: { type: 'string', description: 'Data YYYY-MM-DD' },
                inicio: { type: 'string', description: 'Horário de início HH:MM' },
                fim: { type: 'string', description: 'Horário de fim HH:MM' },
                titulo: { type: 'string', description: 'Título do bloco' },
                descricao: { type: 'string', description: 'Descrição opcional' },
                tipo: { type: 'string', description: 'task, routine, buffer ou custom', enum: ['task', 'routine', 'buffer', 'custom'] },
                taskId: { type: 'string', description: 'ID da task do kanban (opcional, só se tipo=task)' },
                cor: { type: 'string', description: 'Cor hex opcional (ex: #7c3aed)' }
              },
              required: ['data', 'inicio', 'fim', 'titulo', 'tipo']
            }
          }
        },
        required: ['blocos']
      }
    ),
    write: true,
    run: (args) => {
      const blocos = Array.isArray(args.blocos) ? args.blocos : []
      if (!blocos.length) return JSON.stringify({ error: 'Informe ao menos um bloco' })

      const store = useKanbanStore.getState()
      const criados: string[] = []
      for (const b of blocos) {
        const data = typeof b.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.data) ? b.data : ''
        const inicio = typeof b.inicio === 'string' && /^\d{2}:\d{2}$/.test(b.inicio) ? b.inicio : ''
        const fim = typeof b.fim === 'string' && /^\d{2}:\d{2}$/.test(b.fim) ? b.fim : ''
        const titulo = typeof b.titulo === 'string' ? b.titulo.trim() : ''
        const tipo = (['task', 'routine', 'buffer', 'custom'] as const).includes(b.tipo as typeof b.tipo & string)
          ? b.tipo
          : 'custom'
        if (!data || !inicio || !fim || !titulo) continue
        if (fim <= inicio) continue
        const descricao = typeof b.descricao === 'string' ? b.descricao.trim() : undefined
        const taskId = typeof b.taskId === 'string' ? b.taskId : undefined
        const cor = typeof b.cor === 'string' ? b.cor : undefined
        const existingBlocks = store.timeBlocks.filter((tb) => tb.date === data)
        const maxOrder = existingBlocks.reduce((m, tb) => Math.max(m, tb.order), -1)
        const id = store.createTimeBlock({
          date: data, startTime: inicio, endTime: fim, title: titulo,
          ...(descricao ? { description: descricao } : {}),
          ...(taskId ? { taskId } : {}),
          type: tipo,
          ...(cor ? { color: cor } : {}),
          order: maxOrder + 1
        })
        criados.push(id)
      }

      return JSON.stringify({ criado: criados.length, ids: criados, dica: 'Use ler_plano para ver o resultado' })
    }
  },

  atualizar_plano: {
    definition: fn(
      'atualizar_plano',
      'Atualiza ou remove blocos de tempo do planejamento. Use para reordenar, mudar horários, ' +
        'ou remover blocos que o usuário quer ajustar.',
      {
        type: 'object',
        properties: {
          blocos: {
            type: 'array',
            description: 'Array de blocos a atualizar. Cada um precisa do id.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'ID do bloco a atualizar' },
                remover: { type: 'boolean', description: 'Se true, remove o bloco' },
                inicio: { type: 'string', description: 'Novo horário de início HH:MM' },
                fim: { type: 'string', description: 'Novo horário de fim HH:MM' },
                titulo: { type: 'string', description: 'Novo título' },
                descricao: { type: 'string', description: 'Nova descrição' },
                cor: { type: 'string', description: 'Nova cor hex' }
              },
              required: ['id']
            }
          }
        },
        required: ['blocos']
      }
    ),
    write: true,
    run: (args) => {
      const blocos = Array.isArray(args.blocos) ? args.blocos : []
      if (!blocos.length) return JSON.stringify({ error: 'Informe ao menos um bloco para atualizar' })

      const store = useKanbanStore.getState()
      let atualizados = 0
      let removidos = 0
      for (const b of blocos) {
        const id = typeof b.id === 'string' ? b.id : ''
        if (!id) continue
        const existing = store.timeBlocks.find((tb) => tb.id === id)
        if (!existing) continue
        if (b.remover === true) {
          store.deleteTimeBlock(id)
          removidos++
          continue
        }
        const updates: Record<string, unknown> = {}
        if (typeof b.inicio === 'string' && /^\d{2}:\d{2}$/.test(b.inicio)) updates.startTime = b.inicio
        if (typeof b.fim === 'string' && /^\d{2}:\d{2}$/.test(b.fim)) updates.endTime = b.fim
        if (typeof b.titulo === 'string') updates.title = b.titulo.trim()
        if (typeof b.descricao === 'string') updates.description = b.descricao.trim()
        if (typeof b.cor === 'string') updates.color = b.cor
        if (Object.keys(updates).length > 0) {
          store.updateTimeBlock(id, updates as Parameters<typeof store.updateTimeBlock>[1])
          atualizados++
        }
      }

      return JSON.stringify({ atualizados, removidos })
    }
  },

  resolver_termo: {
    definition: fn(
      'resolver_termo',
      'Consulta o glossário de termos do domínio Sagyou. Use quando encontrar um termo ' +
        'cujo significado exato no contexto deste app você não domina (ex: "sprint", "meta", ' +
        '"coluna Done", "handoff"). Retorna a definição, as ferramentas relevantes e um exemplo.',
      {
        type: 'object',
        properties: {
          termo: { type: 'string', description: 'Termo a consultar (ex: "kanban", "handoff", "dueDate")' }
        },
        required: ['termo']
      }
    ),
    run: (args) => {
      const termo = typeof args.termo === 'string' ? args.termo.trim().toLowerCase() : ''
      if (!termo) return JSON.stringify({ error: 'Informe o termo a consultar' })
      const glossary = glossaryRaw as { termo: string; definicao: string; contexto: string; ferramentas_relevantes: string[]; exemplo: string }[]
      // Exact match first, then accent-insensitive substring match
      const exact = glossary.find((g) => g.termo.toLowerCase() === termo)
      if (exact) return JSON.stringify({ termo: exact.termo, definicao: exact.definicao, contexto: exact.contexto, ferramentas: exact.ferramentas_relevantes, exemplo: exact.exemplo })
      // Normalize accents for fuzzy matching
      const normalized = termo.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const fuzzy = glossary.filter((g) => {
        const n = g.termo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        return n.includes(normalized) || normalized.includes(n)
      })
      if (fuzzy.length === 0) {
        const termos = glossary.map((g) => g.termo).join(', ')
        return JSON.stringify({ error: `Termo "${args.termo}" não encontrado no glossário.`, termos_disponiveis: termos })
      }
      if (fuzzy.length === 1) {
        const g = fuzzy[0]
        return JSON.stringify({ termo: g.termo, definicao: g.definicao, contexto: g.contexto, ferramentas: g.ferramentas_relevantes, exemplo: g.exemplo })
      }
      return JSON.stringify({
        ambiguo: true,
        opcoes: fuzzy.map((g) => ({ termo: g.termo, definicao: g.definicao })),
        dica: 'Especifique o termo exato dentre as opções acima.'
      })
    }
  }
}

/** Tool definitions sent to the model each turn (derived from the registry). */
export const TOOL_DEFS: ToolDef[] = Object.values(REGISTRY).map((t) => t.definition)

/** Code-only tool subset — excludes kanban, finance, habits, and other non-code
 *  tools. Used by the code-focused chat so the model doesn't waste tokens on
 *  irrelevant tools and isn't distracted by data it shouldn't touch.
 *  The `run` handler still exists for all tools; this only filters what the
 *  model *offers* to call. */
const CODE_TOOL_NAMES = new Set([
  'ler_projetos',
  'listar_arquivos', 'ler_arquivo', 'buscar_no_codigo',
  'rodar_agente_codigo',
  'buscar_na_web',
  'buscar_memoria', 'salvar_memoria', 'buscar_conversas', 'ler_conversa', 'verificar_memorias',
  'ler_linhagem',
  'resolver_termo'
])
export const CODE_TOOL_DEFS: ToolDef[] = Object.values(REGISTRY)
  .filter((t) => CODE_TOOL_NAMES.has(t.definition.function.name))
  .map((t) => t.definition)

/** Dispatch one tool call by name, returning a JSON string result. */
/**
 * The conversation the tool currently executing belongs to.
 *
 * A tool handler is module-global and shared across every run, so with several
 * runs in flight the store's on-screen `conversationId` is not the one that
 * asked. `runTool` sets this synchronously right before calling the handler, and
 * a handler that needs it (rodar_agente_codigo) reads it synchronously at the
 * top — before any await — so an interleaved run can't overwrite it first.
 */
let activeRunConvId: string | null = null
export function currentRunConvId(): string | null {
  return activeRunConvId
}

/**
 * Cooperative task lease for the multi-agent case: before a work tool mutates a
 * task, claim it for the running conversation. If another *active* run already
 * holds it, return a synthetic "someone else has this one" result — the model
 * reads it and moves on, exactly like the loop's other brakes, rather than two
 * agents duplicating the same task.
 *
 * A no-op outside a run (no owning convId — Gerar Tasks, tests): a single actor
 * needs no coordination. Returns the block message to return, or null to go on.
 */
function leaseBlock(taskId: string): string | null {
  const convId = currentRunConvId()
  if (!convId) return null
  if (useAiRunStore.getState().acquireLease(taskId, convId)) return null
  return JSON.stringify({
    error:
      'Outra IA já está trabalhando nesta task agora. Escolha outra task e, se precisar, volte a esta mais tarde.',
    lease: 'ocupada'
  })
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  convId: string | null = null
): Promise<string> {
  const tool = REGISTRY[name]
  if (!tool) return JSON.stringify({ error: `Ferramenta desconhecida: ${name}` })
  activeRunConvId = convId
  try {
    const result = await tool.run(args)
    // Validate write-tool outputs: check args against expected shapes and
    // attach warnings to the result so the approval card can surface them.
    if (tool.write) {
      const v = validateToolInput(name, args)
      if (!v.valid || v.warnings.length > 0) {
        const parsed = JSON.parse(result)
        parsed._validation = { valid: v.valid, errors: v.errors, warnings: v.warnings }
        return JSON.stringify(parsed)
      }
    }
    return result
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : 'Falha na ferramenta' })
  }
}

/** Whether a tool mutates state (used to gate it behind user approval). */
export function isWriteTool(name: string): boolean {
  return isWriteFromRegistry(name) || REGISTRY[name]?.write === true
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
    case 'data_de_hoje':
      return 'Verificando a data de hoje'
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
      const simbolo = str(args.simbolo)
      if (caminho && simbolo) return `Lendo ${simbolo} em ${caminho}`
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
    case 'buscar_memoria': {
      const termo = str(args.termo)
      return termo ? `Buscando "${termo}" na memória` : 'Consultando a memória'
    }
    case 'buscar_conversas': {
      const termo = str(args.termo)
      return termo ? `Buscando "${termo}" nas conversas` : 'Buscando nas conversas'
    }
    case 'ler_conversa':
      return 'Lendo uma conversa anterior'
    case 'verificar_memorias':
      return 'Verificando contradições na memória'
    case 'ler_linhagem':
      return 'Consultando o histórico da entidade'
    case 'resolver_termo':
      return `Consultando o glossário: "${str(args.termo) || '?'}"`
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
    case 'ler_notas':
      return 'Consultando as notas do canvas'
    case 'criar_nota':
      return `Criando uma nota no canvas`
    case 'salvar_memoria': {
      const titulo = str(args.titulo)
      return titulo ? `Salvando na memória: ${titulo}` : 'Salvando na memória'
    }
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
      return 'Rodando o agente de código'
    case 'ler_plano': {
      const data = str(args.data)
      return data ? `Consultando o plano de ${data}` : 'Consultando o plano'
    }
    case 'criar_plano': {
      const count = n(args.blocos)
      return count === null ? 'Criando blocos no plano' : `Criando ${count} bloco(s) no plano`
    }
    case 'atualizar_plano':
      return 'Atualizando o plano'
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
    case 'ler_notas':
      return 'Ler notas do canvas'
    case 'criar_nota': {
      const texto = String(args.conteudo ?? '')
      return `Criar nota: "${texto.length > 60 ? `${texto.slice(0, 60)}…` : texto}"`
    }
    case 'salvar_memoria': {
      const titulo = String(args.titulo ?? '')
      const escopo = args.global === true ? 'global' : 'projeto'
      const t = titulo.length > 60 ? `${titulo.slice(0, 60)}…` : titulo
      return `Salvar memória (${escopo}, ${args.tipo ?? 'fato'}): "${t}"`
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
        campos.push(
          String(args.projectId).trim() === '' ? 'desvincular do projeto' : 'novo projeto'
        )
      }
      const alvoMeta = (args.titulo ?? args.metaId ?? '?') as string
      return `Atualizar meta ${alvoMeta}: ${campos.join('; ') || '(nada)'}`
    }
    case 'criar_sprints':
      return `Criar sprints: ${Array.isArray(args.nomes) ? args.nomes.join(', ') : ''}`
    case 'atribuir_sprint':
      return `Atribuir sprint "${args.sprint ?? '?'}" à task ${alvo}`
    case 'rodar_agente_codigo':
      return `⚠️ Rodar agente de código no projeto: ${args.task ?? ''}`
    default:
      return name
  }
}
