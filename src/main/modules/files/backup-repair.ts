const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

const toMinutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
const fromMinutes = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/**
 * Fix the leftovers that older builds wrote and `isValidBackup` refuses, so a
 * backup the app exported itself can still be restored (and auto-saved). Runs
 * before validation; anything it cannot repair safely is left untouched for
 * the validator to refuse.
 *
 * - sprints/notes of a deleted project are dropped (invisible in the app);
 *   a `projectId` holding a project's name is pointed back at its id;
 * - a goal linked to a deleted project keeps its data and loses the link;
 * - a planner block/routine ending at or before its start ends at 23:59 when
 *   it ended at midnight, otherwise one minute after it starts.
 */
export function repairBackup<T>(value: T): T {
  if (!isRecord(value) || !Array.isArray(value.projects)) return value
  const projects = value.projects.filter(isRecord)
  const projectIds = new Set(projects.map((project) => project.id).filter(isId))
  const idsByName = new Map<string, string[]>()
  for (const project of projects) {
    if (!isId(project.id) || typeof project.name !== 'string') continue
    idsByName.set(project.name, [...(idsByName.get(project.name) ?? []), project.id])
  }
  const resolveProject = (projectId: unknown): unknown => {
    if (!isId(projectId) || projectIds.has(projectId)) return projectId
    const byName = idsByName.get(projectId)
    return byName?.length === 1 ? byName[0] : null
  }

  const data: Record<string, unknown> = { ...value }
  for (const key of ['sprints', 'notes'] as const) {
    if (!Array.isArray(data[key])) continue
    data[key] = (data[key] as unknown[]).flatMap((entry) => {
      if (!isRecord(entry)) return [entry]
      const projectId = resolveProject(entry.projectId)
      if (projectId === null) return []
      return [projectId === entry.projectId ? entry : { ...entry, projectId }]
    })
  }
  if (Array.isArray(data.goals)) {
    data.goals = data.goals.map((entry) => {
      if (!isRecord(entry)) return entry
      const projectId = resolveProject(entry.projectId)
      if (projectId === entry.projectId) return entry
      if (projectId !== null) return { ...entry, projectId }
      const unlinked = { ...entry }
      delete unlinked.projectId
      return unlinked
    })
  }
  for (const key of ['timeBlocks', 'routines'] as const) {
    if (!Array.isArray(data[key])) continue
    data[key] = (data[key] as unknown[]).map((entry) => {
      if (!isRecord(entry)) return entry
      const { startTime, endTime } = entry
      if (typeof startTime !== 'string' || typeof endTime !== 'string') return entry
      if (!TIME.test(startTime) || !TIME.test(endTime) || endTime > startTime) return entry
      const start = Math.min(toMinutes(startTime), 23 * 60 + 58)
      const end = endTime === '00:00' ? 23 * 60 + 59 : start + 1
      return {
        ...entry,
        startTime: fromMinutes(start),
        endTime: fromMinutes(Math.max(end, start + 1))
      }
    })
  }
  return data as T
}
