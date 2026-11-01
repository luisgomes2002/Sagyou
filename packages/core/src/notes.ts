import type { StickyNote } from './types'

/** Same defaults as the desktop's createNote. */
export const NOTE_DEFAULTS = { width: 200, height: 150, color: '#fef08a' } as const
const ORIGIN = 100
const GAP = 24

/**
 * Where a note created on the phone lands on the project's canvas: below the
 * lowest note, aligned with the leftmost one. Text blocks are visual only and
 * do not count.
 */
export function mobileNotePosition(existing: StickyNote[]): { x: number; y: number } {
  const notes = existing.filter((n) => n.type !== 'text')
  if (!notes.length) return { x: ORIGIN, y: ORIGIN }
  return {
    x: Math.min(...notes.map((n) => n.x)),
    y: Math.max(...notes.map((n) => n.y + n.height)) + GAP
  }
}
