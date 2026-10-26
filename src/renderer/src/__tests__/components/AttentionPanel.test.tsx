import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { AttentionPanel } from '../../components/ai/fleet/AttentionPanel'
import type { CodeAgentRunUI } from '../../components/ai/fleet/useCodeAgentRuns'

function runWith(expiresAt?: string): CodeAgentRunUI {
  return {
    id: 'run-1',
    questions: [],
    hint: null,
    approvals: [
      {
        id: 'a1',
        name: 'mcp:criar_task',
        args: {},
        resumo: 'Criar task "X" em Sagyou',
        ...(expiresAt ? { expiresAt } : {})
      }
    ]
  } as unknown as CodeAgentRunUI
}

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
