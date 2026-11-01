// Regression: unlocking after a lock must not run loadData again. loadData
// credits every saved timer's elapsed time, so a second run counts it twice.
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSX } from 'react'

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }))

vi.mock('../../services/ElectronStorage', () => ({
  ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
    this.load = mocks.load
    this.save = mocks.save
  })
}))

import { useKanbanStore } from '../../store/kanban'
import { useLoadOnFirstUnlock } from '../../hooks/useLoadOnFirstUnlock'

function Harness({ unlocked }: { unlocked: boolean }): JSX.Element {
  const loadData = useKanbanStore((state) => state.loadData)
  useLoadOnFirstUnlock(unlocked, loadData)
  return <div />
}

const T = '2026-11-01T12:00:00.000Z'

beforeEach(() => {
  mocks.save.mockReset().mockResolvedValue(undefined)
  // A timer saved one hour ago: every loadData credits that hour to the task.
  mocks.load.mockReset().mockResolvedValue({
    projects: [],
    tasks: [
      {
        id: 't1',
        projectId: 'p1',
        columnId: 'c1',
        title: 'Com cronômetro',
        priority: 'medium',
        tags: [],
        order: 0,
        timeSpent: 0,
        createdAt: T,
        updatedAt: T
      }
    ],
    activeTimers: [{ taskId: 't1', startedAt: Date.now() - 3_600_000 }]
  })
  useKanbanStore.setState({ isLoaded: false, tasks: [] })
})

describe('useLoadOnFirstUnlock', () => {
  it('loads once on the first unlock and never again after a lock', async () => {
    const { rerender } = render(<Harness unlocked={false} />)
    expect(mocks.load).not.toHaveBeenCalled()

    rerender(<Harness unlocked />)
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(mocks.load).toHaveBeenCalledTimes(1)
    const credited = useKanbanStore.getState().tasks[0].timeSpent ?? 0
    expect(credited).toBeGreaterThanOrEqual(3600)

    // Locked, then unlocked again with the password.
    rerender(<Harness unlocked={false} />)
    rerender(<Harness unlocked />)
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(useKanbanStore.getState().tasks[0].timeSpent).toBe(credited)
  })
})
