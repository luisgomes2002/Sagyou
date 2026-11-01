import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ModalBase } from '../../components/ModalBase'

describe('ModalBase accessibility', () => {
  it('traps focus, closes on Escape and restores the previous focus', () => {
    const onClose = vi.fn()
    const { rerender } = render(<button>Origem</button>)
    const origin = screen.getByRole('button', { name: 'Origem' })
    origin.focus()
    rerender(
      <>
        <button>Origem</button>
        <ModalBase open onClose={onClose}>
          <div>
            <button>Primeiro</button>
            <button>Último</button>
          </div>
        </ModalBase>
      </>
    )
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Primeiro' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    rerender(<button>Origem</button>)
    expect(screen.getByRole('button', { name: 'Origem' })).toHaveFocus()
  })
})
