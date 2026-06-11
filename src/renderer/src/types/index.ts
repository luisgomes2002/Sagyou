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
  order: number
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
