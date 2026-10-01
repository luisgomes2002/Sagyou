import { safeAttachmentName } from './backup-files'
import { isImageFileName } from './chat-images'

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
  for (const key of ['projects', 'tasks', 'lists', 'files'] as const) {
    const entries = data[key]
    if (
      Array.isArray(entries) &&
      entries.some((entry) => typeof entry.id !== 'string' || !entry.id)
    )
      return false
  }
  if (
    (data.projects as unknown[]).some(
      (project) =>
        typeof (project as Record<string, unknown>).name !== 'string' ||
        !Array.isArray((project as Record<string, unknown>).columns)
    )
  )
    return false
  if (
    (data.tasks as unknown[]).some(
      (task) => typeof (task as Record<string, unknown>).title !== 'string'
    )
  )
    return false
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
