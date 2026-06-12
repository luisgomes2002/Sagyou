export interface Column {
  id: string
  name: string
  order: number
  color?: string
}

export interface Project {
  id: string
  name: string
  description?: string
  color: string
  columns: Column[]
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
}

export interface Goal {
  id: string
  title: string
  current: number
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
  price?: number
  done: boolean
  link?: string
}

export type Currency = 'BRL' | 'USD' | 'JPY'

export const CURRENCY_CONFIG: Record<Currency, { symbol: string; decimals: number; label: string }> = {
  BRL: { symbol: 'R$', decimals: 2, label: 'Real' },
  USD: { symbol: '$',  decimals: 2, label: 'Dólar' },
  JPY: { symbol: '¥',  decimals: 0, label: 'Iene' },
}

export interface ShoppingList {
  id: string
  name: string
  currency: Currency
  items: ShoppingItem[]
  createdAt: string
  updatedAt: string
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
  lists?: ShoppingList[]
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
}

export const NOTE_COLORS = [
  '#fef08a',
  '#fda4af',
  '#93c5fd',
  '#86efac',
  '#d8b4fe',
  '#fdba74'
] as const

export const PROJECT_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4'
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
    tags: ['frontend', 'backend', 'bug', 'feat', 'refactor', 'api', 'design', 'mobile', 'devops', 'testes', 'docs', 'deploy']
  },
  {
    label: 'Estudo',
    tags: ['estudo', 'leitura', 'revisão', 'resumo', 'prova', 'pesquisa', 'aula', 'curso', 'faculdade', 'idioma']
  },
  {
    label: 'Trabalho',
    tags: ['reunião', 'relatório', 'prazo', 'cliente', 'apresentação', 'email', 'planejamento', 'meta']
  },
  {
    label: 'Saúde',
    tags: ['exercício', 'academia', 'dieta', 'médico', 'sono', 'saúde mental', 'hidratação', 'corrida']
  },
  {
    label: 'Casa & Vida',
    tags: ['compras', 'casa', 'limpeza', 'contas', 'família', 'social', 'lazer', 'viagem', 'alimentação', 'pet']
  },
  {
    label: 'Finanças',
    tags: ['investimento', 'gasto', 'economia', 'imposto', 'assinatura', 'renda extra']
  },
  {
    label: 'Pessoal',
    tags: ['hábito', 'rotina', 'projeto pessoal', 'criatividade', 'foco', 'urgente', 'importante', 'ideia']
  }
]
