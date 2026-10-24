import { safeAttachmentName } from './backup-files'
import { isImageFileName } from '../conversations/chat-images'

const REQUIRED_ARRAYS = ['projects', 'tasks'] as const
const OPTIONAL_ARRAYS = [
  'sprints',
  'tombstones',
  'notes',
  'goals',
  'habits',
  'lists',
  'financialProfiles',
  'conversations',
  'memories',
  'files',
  'fileBlobs',
  'chatImages',
  'taskImages',
  'timeBlocks',
  'routines'
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isDate = (value: unknown): boolean =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
const isTimestamp = (value: unknown): boolean =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
const isTime = (value: unknown): boolean => {
  if (typeof value !== 'string') return false
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  return !!match && Number(match[1]) < 24 && Number(match[2]) < 60
}
const hasUniqueIds = (entries: unknown[]): boolean => {
  const ids = entries.map((entry) => (entry as Record<string, unknown>).id)
  return ids.every(isId) && new Set(ids).size === ids.length
}

/** Validate the envelope before a restore writes blobs or replaces live state. */
export function isValidBackup(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  if (
    !Number.isInteger(data.version) ||
    (data.version as number) < 1 ||
    (data.version as number) > 7
  )
    return false
  if (typeof data.exportedAt !== 'string' || !Number.isFinite(Date.parse(data.exportedAt)))
    return false
  for (const key of REQUIRED_ARRAYS) if (!Array.isArray(data[key])) return false
  for (const key of OPTIONAL_ARRAYS) if (key in data && !Array.isArray(data[key])) return false

  // A valid envelope with malformed entries would still crash normalization
  // after some state had already been changed.
  for (const key of [...REQUIRED_ARRAYS, ...OPTIONAL_ARRAYS]) {
    const entries = data[key]
    if (!Array.isArray(entries)) continue
    if (entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry)))
      return false
  }
  for (const key of [
    'projects',
    'tasks',
    'sprints',
    'tombstones',
    'notes',
    'goals',
    'habits',
    'lists',
    'financialProfiles',
    'conversations',
    'memories',
    'files',
    'timeBlocks',
    'routines'
  ] as const) {
    if (Array.isArray(data[key]) && !hasUniqueIds(data[key])) return false
  }

  const projects = data.projects as Record<string, unknown>[]
  const tasks = data.tasks as Record<string, unknown>[]
  const projectIds = new Set(projects.map((project) => project.id as string))
  const taskIds = new Set(tasks.map((task) => task.id as string))
  const habitIds = new Set(
    Array.isArray(data.habits)
      ? data.habits.map((habit) => (habit as Record<string, unknown>).id as string)
      : []
  )
  if (
    projects.some((project) => {
      if (typeof project.name !== 'string' || !Array.isArray(project.columns)) return true
      return (
        !hasUniqueIds(project.columns) ||
        project.columns.some(
          (column) =>
            !isRecord(column) || typeof column.name !== 'string' || !Number.isFinite(column.order)
        )
      )
    })
  )
    return false
  if (
    tasks.some((task) => {
      if (typeof task.title !== 'string' || !isId(task.projectId) || !isId(task.columnId))
        return true
      const project = projects.find((item) => item.id === task.projectId)
      return (
        !project ||
        !(project.columns as Record<string, unknown>[]).some(
          (column) => column.id === task.columnId
        )
      )
    })
  )
    return false
  const referencesProject = (entry: Record<string, unknown>): boolean =>
    !isId(entry.projectId) || projectIds.has(entry.projectId)
  for (const key of ['sprints', 'notes'] as const)
    if (
      Array.isArray(data[key]) &&
      data[key].some((entry) => !referencesProject(entry as Record<string, unknown>))
    )
      return false
  if (
    Array.isArray(data.goals) &&
    data.goals.some(
      (entry) =>
        isId((entry as Record<string, unknown>).projectId) &&
        !projectIds.has((entry as Record<string, unknown>).projectId as string)
    )
  )
    return false
  if (
    Array.isArray(data.timeBlocks) &&
    data.timeBlocks.some((entry) => {
      const block = entry as Record<string, unknown>
      return (
        !isDate(block.date) ||
        !isTime(block.startTime) ||
        !isTime(block.endTime) ||
        String(block.endTime) <= String(block.startTime) ||
        (isId(block.taskId) && !taskIds.has(block.taskId)) ||
        (isId(block.habitId) && !habitIds.has(block.habitId))
      )
    })
  )
    return false
  if (
    Array.isArray(data.routines) &&
    data.routines.some((entry) => {
      const routine = entry as Record<string, unknown>
      return (
        !isTime(routine.startTime) ||
        !isTime(routine.endTime) ||
        String(routine.endTime) <= String(routine.startTime) ||
        !Array.isArray(routine.daysOfWeek) ||
        routine.daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
      )
    })
  )
    return false
  const datedFields = ['createdAt', 'updatedAt', 'deletedAt', 'closedAt', 'completedAt', 'addedAt']
  for (const key of [...REQUIRED_ARRAYS, ...OPTIONAL_ARRAYS]) {
    if (!Array.isArray(data[key])) continue
    if (
      data[key].some((entry) =>
        datedFields.some(
          (field) =>
            field in (entry as Record<string, unknown>) &&
            !isTimestamp((entry as Record<string, unknown>)[field])
        )
      )
    )
      return false
  }
  const validBase64 = (value: unknown): boolean =>
    typeof value === 'string' &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  for (const key of ['fileBlobs', 'taskImages'] as const) {
    const entries = data[key]
    if (
      Array.isArray(entries) &&
      entries.some(
        (entry) => !safeAttachmentName(entry.id, entry.ext) || !validBase64(entry.base64)
      )
    )
      return false
  }
  if (
    Array.isArray(data.chatImages) &&
    data.chatImages.some((entry) => !isImageFileName(entry.id) || !validBase64(entry.base64))
  )
    return false
  return true
}
