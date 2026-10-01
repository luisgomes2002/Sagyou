import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StickyNoteCard } from '../../components/StickyNoteCard'
import type { StickyNote } from '../../types'

const textNote: StickyNote = {
  id: 'heading',
  projectId: 'project',
  type: 'text',
  content: 'Título',
  color: 'transparent',
  x: 10,
  y: 20,
  width: 240,
  height: 60,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z'
}

describe('texto livre do canvas', () => {
  it('edita no próprio canvas, ajusta fonte e largura sem abrir o modal', () => {
    const onUpdate = vi.fn()
    const onOpenModal = vi.fn()
    render(
      <StickyNoteCard
        note={textNote}
        scale={2}
        tasks={[]}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        onStartConnect={vi.fn()}
        onDragMove={vi.fn()}
        onDragEnd={vi.fn()}
        onOpenModal={onOpenModal}
      />
    )

    const field = screen.getByRole('textbox', { name: 'Texto do canvas' })
    fireEvent.change(field, { target: { value: 'Novo título' } })
    fireEvent.blur(field)
    expect(onUpdate).toHaveBeenCalledWith({ content: 'Novo título' })
    expect(onOpenModal).not.toHaveBeenCalled()

    const fontInput = screen.getByRole('spinbutton', { name: 'Tamanho da fonte' })
    fireEvent.change(fontInput, { target: { value: '3' } })
    expect(fontInput).toHaveValue(3)
    expect(onUpdate).not.toHaveBeenCalledWith({ fontSize: 12 })
    fireEvent.change(fontInput, {
      target: { value: '32' }
    })
    fireEvent.blur(fontInput)
    expect(onUpdate).toHaveBeenCalledWith({ fontSize: 32 })

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Arraste para ajustar a largura' }), {
      clientX: 100
    })
    fireEvent.mouseMove(window, { clientX: 160 })
    fireEvent.mouseUp(window)
    expect(onUpdate).toHaveBeenCalledWith({ width: 270 })
    expect(screen.queryByRole('button', { name: /conectar/i })).not.toBeInTheDocument()
  })
})
