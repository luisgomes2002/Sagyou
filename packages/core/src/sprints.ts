import { v4 as uuidv4 } from 'uuid'
import type { Sprint } from './types'

export const SPRINT_NAME_EMPTY = 'Dê um nome à sprint.'
export const SPRINT_NAME_TAKEN = 'Já existe uma sprint com esse nome neste projeto.'

export type AddSprintResult = { sprints: Sprint[]; sprintId: string } | { error: string }

/**
 * Adds one sprint to a project. Names are unique within a project, compared
 * trimmed and case-insensitively, like the desktop's createSprints (which drops
 * a duplicate silently; here the caller needs to tell the user why).
 */
export function addSprint(
  sprints: Sprint[],
  projectId: string,
  name: string,
  now: Date
): AddSprintResult {
  const clean = name.trim()
  if (!clean) return { error: SPRINT_NAME_EMPTY }
  const key = clean.toLowerCase()
  if (sprints.some((s) => s.projectId === projectId && s.name.trim().toLowerCase() === key))
    return { error: SPRINT_NAME_TAKEN }
  const sprint: Sprint = { id: uuidv4(), projectId, name: clean, createdAt: now.toISOString() }
  return { sprints: [...sprints, sprint], sprintId: sprint.id }
}

/** The open sprint created last, or undefined. */
export function latestOpenSprint(sprints: Sprint[], projectId: string): Sprint | undefined {
  return sprints
    .filter((s) => s.projectId === projectId && !s.closedAt)
    .reduce<
      Sprint | undefined
    >((best, s) => (!best || s.createdAt > best.createdAt ? s : best), undefined)
}
