import type { SyncKind } from '../../../main/modules/sync/sync-records'

/** What a conflict calls each kind of record on the Sincronização screen. */
const KIND_LABELS: Record<SyncKind, string> = {
  project: 'Projeto',
  project_column: 'Coluna',
  project_link: 'Link do projeto',
  task: 'Task',
  sprint: 'Sprint',
  note: 'Nota',
  goal: 'Meta',
  goal_entry: 'Progresso de meta',
  habit: 'Hábito',
  habit_completion: 'Dia de hábito',
  financial_profile: 'Perfil financeiro',
  financial_table: 'Tabela financeira',
  financial_debt: 'Dívida',
  transaction: 'Transação',
  shopping_item: 'Item de compra',
  financial_goal: 'Meta financeira',
  yield_source: 'Fonte de rendimento',
  yield_entry: 'Rendimento',
  file: 'Arquivo',
  time_block: 'Bloco do planejamento',
  routine: 'Rotina',
  memory: 'Memória'
}

const NAME_FIELDS = ['title', 'name', 'description', 'text', 'content'] as const
const MAX_FIELDS = 6
const MAX_VALUE = 80

export function syncKindLabel(kind: SyncKind): string {
  return KIND_LABELS[kind] ?? kind
}

/** "Sincronizado há X min", from the last successful cycle. */
export function syncedAgoText(lastSyncAt: number, now: number): string {
  return `Sincronizado há ${Math.max(0, Math.floor((now - lastSyncAt) / 60000))} min`
}

export function pendingText(count: number): string {
  return count === 1 ? '1 alteração aguardando envio' : `${count} alterações aguardando envio`
}

function shorten(value: string): string {
  return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value
}

/** The record's own name, when its payload has one. */
export function recordName(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  for (const field of NAME_FIELDS) {
    const value = payload[field]
    if (typeof value === 'string' && value.trim()) return shorten(value.trim())
  }
  return null
}

/** A short "field: value" preview of a version; ids and nested objects are left out. */
export function versionLines(payload: Record<string, unknown> | null): string[] {
  if (!payload) return []
  const lines: string[] = []
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'id' || key.endsWith('Id') || key.endsWith('Ids')) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${shorten(String(value))}`)
      if (lines.length === MAX_FIELDS) break
    }
  }
  return lines
}

interface LocalDataState {
  projects: unknown[]
  tasks: unknown[]
  notes: unknown[]
  goals: unknown[]
  habits: unknown[]
  lists: unknown[]
  files?: unknown[]
  timeBlocks?: unknown[]
  routines?: unknown[]
}

/** Whether pairing must ask "Juntar" or "Substituir" (memories are not in the store). */
export function hasLocalData(state: LocalDataState): boolean {
  return [
    state.projects,
    state.tasks,
    state.notes,
    state.goals,
    state.habits,
    state.lists,
    state.files ?? [],
    state.timeBlocks ?? [],
    state.routines ?? []
  ].some((items) => items.length > 0)
}
