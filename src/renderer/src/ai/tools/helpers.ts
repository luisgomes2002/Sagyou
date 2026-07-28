import Decimal from 'decimal.js'
import { useKanbanStore } from '../../store/kanban'
import { PRIORITY_CONFIG } from '../../types'
import type { Priority, Task, Goal, Habit, FinancialTable, StickyNote } from '../../types'

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
export interface AITool {
  definition: ToolDef
  /** Whether the tool mutates state — used to gate it behind user approval. */
  write?: boolean
  /** Runs the tool, returning a JSON string result fed back to the model. */
  run: (args: Record<string, unknown>) => string | Promise<string>
}

/** Build a function tool definition. */
export function fn(name: string, description: string, parameters: Record<string, unknown>): ToolDef {
  return { type: 'function', function: { name, description, parameters } }
}

export const NO_PARAMS = { type: 'object', properties: {}, additionalProperties: false }

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
export function clampLimit(v: unknown): number {
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
export const OTHER_PROJECTS_MAX = 20

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
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

/** The valid priorities, straight from the type's config so the two can't drift. */
export const PRIORITIES = Object.keys(PRIORITY_CONFIG) as Priority[]

/**
 * Whether `s` is a real YYYY-MM-DD calendar date. Task.dueDate is only ever
 * read back as that bare shape (UpcomingView does `new Date(dueDate +
 * 'T00:00:00')` and sorts by string), so anything else persists as a date that
 * renders as "Invalid Date" for good. Built in UTC on purpose: this is a
 * calendar check, and a local-time round-trip would reject valid dates west of
 * Greenwich.
 */
export function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

/** Find a task by taskId, else by exact title within the (active) project. */
export function resolveTask(args: Record<string, unknown>): Task | undefined {
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
export function resolveTaskForDelete(
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
export function toTarget(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Find a goal for a write call: by id, else by exact title. An ambiguous title
 * is an error rather than the first match — goals carry history, so editing the
 * wrong one is silent and hard to notice. Same stance as deletar_task.
 */
export function resolveGoal(
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
export function resolveHabit(
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
export function parseMoney(v: unknown): Decimal | null {
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
export function resolveList(
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
export function freeNoteSpot(notes: StickyNote[]): { x: number; y: number } {
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
export function activeRoots(args: Record<string, unknown>): { roots: Root[]; error?: string } {
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
export const PASTA_PARAM = {
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
export const CODE_SEARCH_TTL_MS = 30_000
export const CODE_SEARCH_CACHE_MAX = 50
export const codeSearchCache = new Map<string, { at: number; result: string }>()

/** Drop every cached code-search result. Called when files may have changed. */
export function clearCodeSearchCache(): void {
  codeSearchCache.clear()
}

/** Cache key for a search: the (sorted) roots it spans plus the normalised term. */
export function codeSearchKey(roots: Root[], termo: string): string {
  return (
    roots
      .map((r) => r.path)
      .sort()
      .join('|') +
    '::' +
    termo.trim().toLowerCase()
  )
}
