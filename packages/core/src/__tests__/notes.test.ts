import { describe, expect, it } from 'vitest'
import { NOTE_DEFAULTS, mobileNotePosition } from '../notes'
import type { StickyNote } from '../types'

const note = (y: number, height: number, extra: Partial<StickyNote> = {}): StickyNote => ({
  id: `n${y}`,
  projectId: 'p1',
  content: '',
  color: '#fef08a',
  x: 100,
  y,
  width: 200,
  height,
  createdAt: '',
  updatedAt: '',
  ...extra
})

describe('mobileNotePosition', () => {
  it('começa em (100, 100) num canvas vazio', () => {
    expect(mobileNotePosition([])).toEqual({ x: 100, y: 100 })
  })

  it('fica abaixo da nota mais baixa e ignora blocos de texto', () => {
    const notes = [note(100, 150), note(900, 40, { type: 'text', x: 10 })]
    expect(mobileNotePosition(notes)).toEqual({ x: 100, y: 274 })
  })

  it('usa os padrões do createNote do desktop', () => {
    expect(NOTE_DEFAULTS).toEqual({ width: 200, height: 150, color: '#fef08a' })
  })
})
