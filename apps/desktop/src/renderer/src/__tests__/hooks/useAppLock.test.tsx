import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSX } from 'react'
import { useAppLock } from '../../hooks/useAppLock'
import { isDataLocked, setDataLocked } from '../../services/lockState'
import { useKanbanStore } from '../../store/kanban'

vi.mock('../../store/kanban', () => ({ useKanbanStore: { getState: vi.fn() } }))

let request: (() => void) | undefined
const order: string[] = []
const flush = vi.fn<() => Promise<void>>()
const lockReady = vi.fn<() => Promise<void>>()
const load = vi.fn()

function Harness({ onLocked }: { onLocked: () => void }): JSX.Element {
  useAppLock(onLocked)
  return <div />
}

function storeState(isLoaded: boolean): void {
  vi.mocked(useKanbanStore.getState).mockReturnValue({
    isLoaded,
    _flushPersist: flush,
    loadData: load
  } as unknown as ReturnType<typeof useKanbanStore.getState>)
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  request = undefined
  order.length = 0
  flush.mockReset().mockImplementation(async () => void order.push('flush'))
  lockReady.mockReset().mockImplementation(async () => void order.push('ready'))
  load.mockReset()
  storeState(true)
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    security: {
      onLockRequest: vi.fn((cb: () => void) => {
        request = cb
        return vi.fn()
      }),
      lockReady
    }
  }
})

afterEach(() => setDataLocked(false))

describe('useAppLock', () => {
  it('saves, tells main it may lock, then shows the lock screen', async () => {
    const onLocked = vi.fn(() => order.push('locked'))
    render(<Harness onLocked={onLocked} />)
    request?.()
    await settle()
    expect(order).toEqual(['flush', 'ready', 'locked'])
    expect(isDataLocked()).toBe(true)
    // The store stays in memory: nothing reloads it (loadData would credit
    // every saved timer again).
    expect(load).not.toHaveBeenCalled()
  })

  it('does not save an empty store that was never loaded', async () => {
    storeState(false)
    const onLocked = vi.fn()
    render(<Harness onLocked={onLocked} />)
    request?.()
    await settle()
    expect(flush).not.toHaveBeenCalled()
    expect(lockReady).toHaveBeenCalledOnce()
    expect(onLocked).toHaveBeenCalledOnce()
  })

  it('still answers main when the save fails', async () => {
    flush.mockRejectedValue(new Error('IPC'))
    const onLocked = vi.fn()
    render(<Harness onLocked={onLocked} />)
    request?.()
    await settle()
    expect(lockReady).toHaveBeenCalledOnce()
    expect(onLocked).toHaveBeenCalledOnce()
  })
})
