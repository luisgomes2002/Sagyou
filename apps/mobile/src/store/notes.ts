import { NOTE_DEFAULTS, mobileNotePosition } from '@sagyou/core/notes'
import { randomUUID } from '@sagyou/core/sync/bytes'
import type { StickyNote } from '@sagyou/core/types'
import type { MobileState } from '../data/state'

/** Canvas notes the phone lists: text blocks are visual-only on the desktop canvas. */
export function projectNotes(state: MobileState, projectId: string): StickyNote[] {
  return state.notes
    .filter((n) => n.projectId === projectId && n.type !== 'text')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** A note with the desktop's createNote defaults, placed below the lowest note of the project. */
export function createNote(
  state: MobileState,
  projectId: string,
  content: string,
  now: Date
): { state: MobileState; id: string } {
  const at = now.toISOString()
  const position = mobileNotePosition(state.notes.filter((n) => n.projectId === projectId))
  const note: StickyNote = {
    id: randomUUID(),
    projectId,
    content,
    color: NOTE_DEFAULTS.color,
    x: position.x,
    y: position.y,
    width: NOTE_DEFAULTS.width,
    height: NOTE_DEFAULTS.height,
    connections: [],
    createdAt: at,
    updatedAt: at
  }
  return { state: { ...state, notes: [...state.notes, note] }, id: note.id }
}

/** Only the text changes; position, size, color and links stay as the desktop left them. */
export function updateNoteContent(
  state: MobileState,
  id: string,
  content: string,
  now: Date
): MobileState {
  return {
    ...state,
    notes: state.notes.map((n) =>
      n.id === id ? { ...n, content, updatedAt: now.toISOString() } : n
    )
  }
}
