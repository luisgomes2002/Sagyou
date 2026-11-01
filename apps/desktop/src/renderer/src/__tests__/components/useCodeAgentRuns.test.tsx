import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCodeAgentRuns } from '../../components/ai/fleet/useCodeAgentRuns'

type OutputListener = (payload: { runId: string; chunk: string }) => void

describe('useCodeAgentRuns', () => {
  let emitOutput: OutputListener
  let status: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    status = vi.fn().mockResolvedValue({
      running: true,
      log: '',
      hint: null,
      runs: ['run-A', 'run-B'].map((id) => ({
        id,
        dir: '/repo',
        task: 'Sessão',
        agent: 'codex',
        startedAt: 0,
        log: 'inicio ',
        hint: null,
        interactive: true
      }))
    })
    if (!window.electronAPI) window.electronAPI = {} as never
    window.electronAPI.ai ??= {} as never
    window.electronAPI.ai.codeAgent = {
      status,
      onStarted: vi.fn(() => vi.fn()),
      onOutput: vi.fn((listener: OutputListener) => {
        emitOutput = listener
        return vi.fn()
      }),
      onProgress: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
      onAutoChanged: vi.fn(() => vi.fn()),
      onApproveRequest: vi.fn(() => vi.fn()),
      onQuestion: vi.fn(() => vi.fn()),
      onHint: vi.fn(() => vi.fn())
    } as never
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Every chunk of every terminal used to re-fetch the full status (all runs,
  // all logs) over IPC and rebuild every run, so each extra terminal slowed the
  // others down.
  it('appends terminal output locally instead of re-fetching the status per chunk', async () => {
    const { result } = renderHook(() => useCodeAgentRuns())
    await waitFor(() => expect(result.current.runs).toHaveLength(2))
    status.mockClear()

    act(() => {
      for (let index = 0; index < 50; index++) {
        emitOutput({ runId: 'run-A', chunk: 'a' })
        emitOutput({ runId: 'run-B', chunk: 'b' })
      }
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(status).not.toHaveBeenCalled()
    expect(result.current.runs.find((run) => run.id === 'run-A')?.log).toBe(
      'inicio ' + 'a'.repeat(50)
    )
    expect(result.current.runs.find((run) => run.id === 'run-B')?.log).toBe(
      'inicio ' + 'b'.repeat(50)
    )
  })
})
