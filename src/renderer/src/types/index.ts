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
  /** The selected code path (persisted across sessions). */
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
  dataUrl: string
  size: number
  addedAt: string
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
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#14b8a6',
  '#84cc16',
  '#f43f5e',
  '#d946ef'
] as const

export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bg: string }> = {
  low: { label: 'Low', color: 'text-sky-400', bg: 'bg-sky-400/15' },
  medium: { label: 'Medium', color: 'text-yellow-400', bg: 'bg-yellow-400/15' },
  high: { label: 'High', color: 'text-orange-400', bg: 'bg-orange-400/15' },
  urgent: { label: 'Urgent', color: 'text-red-400', bg: 'bg-red-400/15' }
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
    tags: ['investimento', 'gasto', 'economia', 'imposto', 'assinatura', 'renda extra', 'orçamento', 'dívida', 'cartão', 'poupança', 'declaração', 'recibo', 'transferência', 'AI', 'ADS', 'servidor', 'marketing', 'segurança cloud', 'domínio', 'AI programação', 'AI tokens', 'canva', 'streaming', 'contador', 'advogado']
  },
  {
    label: 'Pessoal',
    tags: ['hábito', 'rotina', 'projeto pessoal', 'criatividade', 'foco', 'urgente', 'importante', 'ideia', 'meta pessoal', 'lembrete', 'reflexão', 'diário', 'gratidão', 'planejamento semanal']
  }
]

// Tag list per area, derived from DEFAULT_TAGS so the prompt stays in sync.
const AI_TAG_LINES = DEFAULT_TAGS.map((g) => `  ${g.label}: ${g.tags.join(', ')}`).join('\n\n')

/**
 * Shared task-JSON template. Describes the exact `{ "tasks": [...] }` shape the
 * app imports. Used both as the copyable example in the Sidebar and as the
 * instruction sent to the model by the AI view's "Gerar Tasks". Tags are
 * generated from DEFAULT_TAGS so there is a single source of truth.
 */
export const AI_TASK_PROMPT_TEMPLATE = `{
  "tasks": [
    {
      "title": "Implementar login",
      "description": "Tela de autenticação com JWT.",
      "priority": "high",
      "dueDate": "2026-07-15",
      "tags": ["auth", "frontend"],
      "column": "In Progress",
      "sprint": "Sprint 1"
    },
    {
      "title": "Criar testes unitários",
      "priority": "medium",
      "tags": ["testes"],
      "column": "Backlog"
    }
  ]
}

Campos:
- priority — low · medium · high · urgent
- column — nome exato da coluna no projeto (ex: "In Progress")
- sprint — nome exato da sprint (ex: "Sprint 1"). Opcional.
- dueDate — formato YYYY-MM-DD. Opcional.
- tags — use as tags relevantes para o contexto. Tags disponíveis por área:

${AI_TAG_LINES}

Gere tarefas para cada parte desse projeto, não deixe as tarefas muito granuladas e se o assunto de uma para outra for muito diferente separe em arquivos json diferentes, por exemplo na área de desenvolvimento tem a parte de testes, refatoração e nova feature, cada uma dessas é um arquivo separado.`
