import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import {
  EXTERNAL_APPROVAL_TITLE,
  ExternalApprovalDialog
} from '../../components/modals/ExternalApprovalDialog'

const NOW = Date.UTC(2026, 10, 7, 12)
type Card = { id: string; name: string; resumo: string; expiresAt?: string }

let request: ((card: Card) => void) | undefined
let closed: ((id: string) => void) | undefined
let answer: ReturnType<typeof vi.fn>

const card = (id: string, resumo: string): Card => ({
  id,
  name: 'mcp:delete_task',
  resumo,
  expiresAt: new Date(NOW + 5 * 60_000).toISOString()
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
  request = undefined
  closed = undefined
  answer = vi.fn().mockResolvedValue(true)
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    mcpExternal: {
      onApproveRequest: vi.fn((cb: (card: Card) => void) => {
        request = cb
        return vi.fn()
      }),
      onApprovalClosed: vi.fn((cb: (id: string) => void) => {
        closed = cb
        return vi.fn()
      }),
      answer
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ExternalApprovalDialog', () => {
  it('abre num pedido com o título, o resumo e a contagem', () => {
    render(<ExternalApprovalDialog />)
    expect(screen.queryByText(EXTERNAL_APPROVAL_TITLE)).toBeNull()
    act(() => request?.(card('c1', 'Excluir tarefa "Pagar luz"')))
    expect(screen.getByText(EXTERNAL_APPROVAL_TITLE)).toBeInTheDocument()
    expect(EXTERNAL_APPROVAL_TITLE).toBe('Aprovar ação do acesso externo')
    expect(
      screen.getByText('O Claude externo quer: Excluir tarefa "Pagar luz"')
    ).toBeInTheDocument()
    expect(screen.getByText('Expira em 5:00')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('Expira em 4:59')).toBeInTheDocument()
  })

  it('Aprovar responde true e fecha; Recusar responde false', () => {
    render(<ExternalApprovalDialog />)
    act(() => request?.(card('c1', 'Excluir nota')))
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }))
    expect(answer).toHaveBeenCalledWith('c1', true)
    expect(screen.queryByText('O Claude externo quer: Excluir nota')).toBeNull()
    act(() => request?.(card('c2', 'Lançar despesa')))
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }))
    expect(answer).toHaveBeenCalledWith('c2', false)
    expect(screen.queryByText('O Claude externo quer: Lançar despesa')).toBeNull()
  })

  it('fecha quando o mesmo cartão é respondido no celular (approval-closed)', () => {
    render(<ExternalApprovalDialog />)
    act(() => request?.(card('c1', 'Excluir nota')))
    act(() => closed?.('outro'))
    expect(screen.getByText('O Claude externo quer: Excluir nota')).toBeInTheDocument()
    act(() => closed?.('c1'))
    expect(screen.queryByText('O Claude externo quer: Excluir nota')).toBeNull()
    expect(answer).not.toHaveBeenCalled()
  })

  it('dois pedidos fazem fila: um de cada vez', () => {
    render(<ExternalApprovalDialog />)
    act(() => {
      request?.(card('c1', 'Excluir nota'))
      request?.(card('c2', 'Lançar despesa'))
    })
    expect(screen.getByText('O Claude externo quer: Excluir nota')).toBeInTheDocument()
    expect(screen.queryByText('O Claude externo quer: Lançar despesa')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }))
    expect(screen.getByText('O Claude externo quer: Lançar despesa')).toBeInTheDocument()
  })
})
