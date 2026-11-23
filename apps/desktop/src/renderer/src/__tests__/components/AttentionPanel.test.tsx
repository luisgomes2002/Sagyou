import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { AttentionPanel } from '../../components/ai/fleet/AttentionPanel'
import type { CodeAgentRunUI } from '../../components/ai/fleet/useCodeAgentRuns'

function runWith(
  expiresAt?: string,
  card: { name: string; resumo: string } = {
    name: 'mcp:criar_task',
    resumo: 'Criar task "X" em Sagyou'
  }
): CodeAgentRunUI {
  return {
    id: 'run-1',
    questions: [],
    hint: null,
    approvals: [
      {
        id: 'a1',
        name: card.name,
        args: {},
        resumo: card.resumo,
        ...(expiresAt ? { expiresAt } : {})
      }
    ]
  } as unknown as CodeAgentRunUI
}

describe('AttentionPanel mcp card label', () => {
  it('a read card says it is a read; a write card keeps saying write', () => {
    const { unmount } = render(
      <AttentionPanel
        run={runWith(undefined, {
          name: 'mcp:read_other_project_memory',
          resumo: 'Ler memórias do projeto "B"?'
        })}
        onApprove={vi.fn()}
      />
    )
    expect(screen.getByText('Ler memórias do projeto "B"?')).toBeTruthy()
    expect(screen.getByText('Leitura solicitada pelo MCP desta sessão.')).toBeTruthy()
    expect(screen.queryByText('Escrita solicitada pelo MCP desta sessão.')).toBeNull()
    unmount()
    render(
      <AttentionPanel
        run={runWith(undefined, { name: 'mcp:delete_task', resumo: 'Excluir task' })}
        onApprove={vi.fn()}
      />
    )
    expect(screen.getByText('Escrita solicitada pelo MCP desta sessão.')).toBeTruthy()
    expect(screen.queryByText('Leitura solicitada pelo MCP desta sessão.')).toBeNull()
  })
})

describe('AttentionPanel approval deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-26T12:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('counts down to the deadline', () => {
    render(<AttentionPanel run={runWith('2026-10-26T12:05:00.000Z')} onApprove={vi.fn()} />)
    expect(screen.getByText('Expira em 5:00')).toBeTruthy()
    act(() => vi.advanceTimersByTime(61_000))
    expect(screen.getByText('Expira em 3:59')).toBeTruthy()
  })

  it('an expired card says so and cannot be approved', () => {
    const onApprove = vi.fn()
    render(<AttentionPanel run={runWith('2026-10-26T12:05:00.000Z')} onApprove={onApprove} />)
    act(() => vi.advanceTimersByTime(5 * 60_000))

    expect(
      screen.getByText('Expirou sem resposta; o agente recebeu uma recusa e pode pedir de novo.')
    ).toBeTruthy()
    const approve = screen.getByRole('button', { name: 'Aprovar' }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    approve.click()
    expect(onApprove).not.toHaveBeenCalled()
  })

  it('a card without a deadline shows no countdown', () => {
    render(<AttentionPanel run={runWith()} onApprove={vi.fn()} />)
    expect(screen.queryByText(/Expira em/)).toBeNull()
  })
})
