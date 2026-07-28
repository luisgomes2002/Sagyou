export interface Column {
  id: string
  name: string
  order: number
  color?: string
}

export interface ProjectLink {
  id: string
  label: string
  url: string
}

/** A local filesystem path to the project's code on the PC. */
export interface CodePath {
  id: string
  label?: string
  path: string
}

export interface Project {
  id: string
  name: string
  description?: string
  color: string
  columns: Column[]
  links?: ProjectLink[]
  /** Local code paths for this project (the AI's working directories). */
  codePaths?: CodePath[]
  /**
   * The selected code paths — the AI reads across all of them. Source of truth
   * for the selection; persisted across sessions.
   */
  activeCodePathIds?: string[]
  /**
   * @deprecated Legacy single-selection field. Superseded by
   * `activeCodePathIds`, but kept written and in sync with its first entry so
   * older app versions (and old backups) keep working. Read
   * `activeCodePathIds`; never write this directly — the store keeps both in
   * step.
   */
  activeCodePathId?: string
  order?: number
  createdAt: string
  updatedAt: string
}

export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export interface Task {
  id: string
  projectId: string
  columnId: string
  title: string
  description?: string
  priority: Priority
  dueDate?: string
  tags: string[]
  sprintId?: string
  images?: TaskImage[]
  timeSpent?: number
  order: number
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface GoalEntry {
  id: string
  date: string
  label?: string
  value: number
  createdAt: string
}

export interface Goal {
  id: string
  title: string
  entries: GoalEntry[]
  target: number
  unit: string
  color: string
  projectId?: string
  createdAt: string
  updatedAt: string
}

export interface Habit {
  id: string
  name: string
  color: string
  completions: string[]
  createdAt: string
  updatedAt: string
}

export interface ShoppingItem {
  id: string
  name: string
  qty: number
  /** Unit price as a canonical decimal string (e.g. "1500.5"). Migrated from number on load. */
  price?: string
  done: boolean
  link?: string
  linkedTransactionId?: string
}

export type Currency = 'BRL' | 'USD' | 'JPY'

export const CURRENCY_CONFIG: Record<Currency, { symbol: string; decimals: number; label: string }> = {
  BRL: { symbol: 'R$', decimals: 2, label: 'Real' },
  USD: { symbol: '$',  decimals: 2, label: 'Dólar' },
  JPY: { symbol: '¥',  decimals: 0, label: 'Iene' },
}

export interface FinancialTransaction {
  id: string
  description: string
  /** Amount as a canonical decimal string (e.g. "1500.5"). Migrated from number on load. */
  amount: string
  type: 'income' | 'expense'
  date: string
  category?: string
  fromShopping?: boolean
}

export interface FinancialGoal {
  id: string
  name: string
  /** Target amount as a canonical decimal string (e.g. "70000"). Migrated from number on load. */
  targetAmount: string
  targetMonth: number
  targetYear: number
  completedAt?: string
  completionNote?: string
}

export interface FinancialTable {
  id: string
  name: string
  currency: Currency
  items: ShoppingItem[]
  transactions: FinancialTransaction[]
  goals: FinancialGoal[]
  createdAt: string
  updatedAt: string
}

export interface AIMessage {
  // 'status' is the agent's display-only trace, kept in the transcript and
  // persisted alongside real turns (see AIView's ChatMessage).
  role: 'user' | 'assistant' | 'status'
  content: string
}

export interface AIConversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: AIMessage[]
}

export interface Backup {
  version: number
  exportedAt: string
  projects: Project[]
  tasks: Task[]
  sprints?: Sprint[]
  tombstones?: Tombstone[]
  notes?: StickyNote[]
  goals?: Goal[]
  habits?: Habit[]
  lists?: FinancialTable[]
  // Added in version 3. Absent in older backups — importing one of those must
  // leave the local history untouched rather than wiping it.
  conversations?: AIConversation[]
  // Added in version 4. Same rule: absent = leave local memory alone.
  memories?: AiMemory[]
  // Added in version 5: the physical files that used to live only on disk.
  // `files` is the attachment metadata (was never in the backup before — a
  // restore preserved local files); `fileBlobs`/`chatImages` carry the actual
  // bytes as base64. The bytes are injected by the main process at export time
  // and written back to disk by it at import time — they never reach the
  // renderer. Same "absent = leave local files untouched" rule as above.
  files?: StoredFile[]
  fileBlobs?: BackupFileBlob[]
  chatImages?: BackupChatImage[]
  // Task-image bytes (metadata rides on `tasks[].images`). Same main-injects-on-
  // export / main-writes-and-strips-on-import handling as fileBlobs.
  taskImages?: BackupFileBlob[]
  // Added in version 6 (addition only, no breaking changes)
  timeBlocks?: TimeBlock[]
  routines?: Routine[]
}

/** An attachment's bytes, base64-encoded, keyed to its StoredFile id/ext. */
export interface BackupFileBlob {
  id: string
  ext: string
  base64: string
}

/** A chat image's bytes, base64-encoded, keyed to its on-disk `<uuid>.<ext>` id. */
export interface BackupChatImage {
  id: string
  base64: string
}

/** The type of a durable AI memory. Mirrors MemoryType in main/memory.ts. */
export type MemoryType = 'decisao' | 'tradeoff' | 'gotcha' | 'fato' | 'handoff' | 'planejamento'

/**
 * A durable fact the assistant carries across conversations. Renderer-side
 * mirror of AiMemory in main/memory.ts (the store's source of truth) — the two
 * are kept in step by hand, like store.ts mirrors these types the other way.
 */
export interface AiMemory {
  id: string
  projectId: string | null
  type: MemoryType
  title: string
  body: string
  tags: string[]
  pinned: boolean
  source: 'modelo' | 'usuario'
  createdAt: string
  updatedAt: string
  lastAccessedAt: string
  accessCount: number
  archivedAt: string | null
}

export interface AITaskInput {
  title: string
  description?: string
  priority?: Priority
  dueDate?: string
  tags?: string[]
  column?: string
  sprint?: string
}

export interface AIJson {
  projectName?: string
  tasks: AITaskInput[]
}

export interface StoredFile {
  id: string
  name: string      // original filename with extension
  ext: string       // e.g. '.pdf', '.docx'
  size: number      // bytes
  createdAt: string
  projectId?: string
}

export interface TaskImage {
  id: string
  name: string
  ext: string // e.g. '.jpg' — the bytes live on disk at task-images/<id><ext>
  size: number
  addedAt: string
  // Legacy/transient only: older data (a pre-migration DB row or an old backup)
  // carried the bytes inline here. It is NEVER persisted now — the store writes
  // metadata only, and importBackup/migration move any dataUrl to a disk file.
  dataUrl?: string
}

export interface Sprint {
  id: string
  projectId: string
  name: string
  createdAt: string
  closedAt?: string
}

export interface Tombstone {
  id: string
  type: 'project' | 'task' | 'sprint'
  deletedAt: string
}

export interface StickyNote {
  id: string
  projectId: string
  content: string
  color: string
  x: number
  y: number
  width: number
  height: number
  taskId?: string
  connections?: string[]
  createdAt: string
  updatedAt: string
  fontSize?: number
  type?: 'note' | 'text'
  completedAt?: string
}

export const NOTE_COLORS = [
  '#fef08a',
  '#fda4af',
  '#93c5fd',
  '#86efac',
  '#d8b4fe',
  '#fdba74',
  '#a5f3fc',
  '#99f6e4',
  '#fca5a5',
  '#f9a8d4',
  '#bef264',
  '#c7d2fe'
] as const

export const PROJECT_COLORS = [
  '#7c3aed',
  '#8b5cf6',
  '#ec4899',
  '#e04040',
  '#f97316',
  '#eab308',
  '#20b858',
  '#06b6d4',
  '#14b8a6',
  '#84cc16',
  '#f43f5e',
  '#d946ef'
] as const

export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bg: string }> = {
  low: { label: 'Low', color: 'text-[#34b4ec]', bg: 'bg-[#34b4ec]/15' },
  medium: { label: 'Medium', color: 'text-[#f0c210]', bg: 'bg-[#f0c210]/15' },
  high: { label: 'High', color: 'text-[#f08a34]', bg: 'bg-[#f08a34]/15' },
  urgent: { label: 'Urgent', color: 'text-[#e04040]', bg: 'bg-[#e04040]/15' }
}

export const DEFAULT_COLUMN_NAMES = ['Backlog', 'In Progress', 'Review', 'Done']

export const DEFAULT_TAGS: { label: string; tags: string[] }[] = [
  {
    label: 'Dev',
    tags: ['frontend', 'backend', 'bug', 'fix', 'feat', 'refactor', 'api', 'design', 'mobile', 'devops', 'testes', 'docs', 'deploy', 'delivery', 'auth', 'security', 'performance', 'infra', 'ipc', 'store', 'utils', 'dnd', 'memoization', 'correctness', 'idempotency', 'query-optimization', 'redis', 'jwt', 'reports', 'heatmap', 'due-date', 'tags', 'sprints']
  },
  {
    label: 'Estudo',
    tags: ['estudo', 'leitura', 'revisão', 'resumo', 'prova', 'pesquisa', 'aula', 'curso', 'faculdade', 'idioma', 'exercício-mental', 'flashcard', 'vocabulário', 'gramática', 'prática', 'escrita', 'listening', 'tradução']
  },
  {
    label: 'Trabalho',
    tags: ['reunião', 'relatório', 'prazo', 'cliente', 'apresentação', 'email', 'planejamento', 'meta', 'entrega', 'revisão', 'feedback', 'onboarding', 'contrato', 'proposta', 'sprint', 'retrospectiva']
  },
  {
    label: 'Saúde',
    tags: ['exercício', 'academia', 'dieta', 'médico', 'sono', 'saúde mental', 'hidratação', 'corrida', 'alongamento', 'meditação', 'consulta', 'exame', 'suplemento', 'descanso']
  },
  {
    label: 'Casa & Vida',
    tags: ['compras', 'casa', 'limpeza', 'contas', 'família', 'social', 'lazer', 'viagem', 'alimentação', 'pet', 'manutenção', 'organização', 'decoração', 'mudança', 'vizinhança']
  },
  {
    label: 'Finanças',
    tags: ['investimento', 'gasto', 'economia', 'imposto', 'assinatura', 'renda extra', 'orçamento', 'dívida', 'cartão', 'poupança', 'declaração', 'recibo', 'transferência', 'devolução', 'saldo', 'AI', 'ADS', 'servidor', 'marketing', 'segurança cloud', 'domínio', 'AI programação', 'AI tokens', 'canva', 'streaming', 'contador', 'advogado']
  },
  {
    label: 'Pessoal',
    tags: ['hábito', 'rotina', 'projeto pessoal', 'criatividade', 'foco', 'urgente', 'importante', 'ideia', 'meta pessoal', 'lembrete', 'reflexão', 'diário', 'gratidão', 'planejamento semanal']
  }
]

// ── Planner (time blocks & routines) ───────────────────────────────────────

export type TimeBlockType = 'task' | 'routine' | 'buffer' | 'custom'

export interface TimeBlock {
  id: string
  date: string // YYYY-MM-DD
  startTime: string // HH:MM
  endTime: string // HH:MM
  title: string
  description?: string
  taskId?: string // optional link to a kanban task
  habitId?: string // optional link to a habit
  type: TimeBlockType
  color?: string
  order: number
  createdAt: string
  updatedAt: string
}

export interface Routine {
  id: string
  title: string
  description?: string
  startTime: string // HH:MM
  endTime: string // HH:MM
  daysOfWeek: number[] // 0=Sun, 1=Mon, …, 6=Sat
  color?: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export const TIME_BLOCK_COLORS = [
  '#7c3aed',
  '#8b5cf6',
  '#ec4899',
  '#e04040',
  '#f97316',
  '#eab308',
  '#20b858',
  '#06b6d4',
  '#14b8a6',
  '#84cc16',
  '#f43f5e',
  '#d946ef'
] as const

// ── Entity Event Log (data lineage) ──────────────────────────────────────────

/** One mutation recorded in the append-only event log. */
export interface EntityEvent {
  id: string
  entityType: 'project' | 'task' | 'sprint' | 'note' | 'goal' | 'habit' | 'financial_table' | 'file'
  entityId: string
  action: 'created' | 'updated' | 'deleted'
  /** Human-readable summary (e.g. "task 'Corrigir bug' moved to Done"). */
  summary: string
  /** Who or what triggered the change. */
  source: 'user' | 'ai'
  /** AI tool name when source=ai. */
  toolName?: string
  /** Conversation id when source=ai. */
  convId?: string
  timestamp: string
}

