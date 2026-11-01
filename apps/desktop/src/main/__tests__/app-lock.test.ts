// @vitest-environment node
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createAppLock, LOCK_RENDERER_TIMEOUT_MS } from '../modules/security/app-lock'

afterEach(() => vi.useRealTimers())

interface Setup {
  state: { unlocked: boolean }
  deps: { setUnlocked: Mock; askRenderer: Mock; onLocked: Mock }
  lock: ReturnType<typeof createAppLock>
}

function setup(unlocked = true): Setup {
  vi.useFakeTimers()
  const state = { unlocked }
  const deps = {
    isUnlocked: () => state.unlocked,
    setUnlocked: vi.fn((value: boolean) => (state.unlocked = value)),
    askRenderer: vi.fn(),
    onLocked: vi.fn(),
    setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimer: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
  return { state, deps, lock: createAppLock(deps) }
}

describe('app lock', () => {
  it('asks the renderer once and locks when it is ready', () => {
    const { state, deps, lock } = setup()
    lock.lock('idle')
    lock.lock('manual')
    expect(deps.askRenderer).toHaveBeenCalledTimes(1)
    expect(lock.isLocking()).toBe(true)
    expect(state.unlocked).toBe(true)
    lock.rendererReady()
    expect(state.unlocked).toBe(false)
    expect(deps.onLocked).toHaveBeenCalledTimes(1)
    expect(deps.onLocked).toHaveBeenCalledWith('idle')
    expect(lock.isLocking()).toBe(false)
  })

  it('locks anyway when the renderer never answers', () => {
    const { state, deps, lock } = setup()
    lock.lock('system-lock')
    vi.advanceTimersByTime(LOCK_RENDERER_TIMEOUT_MS - 1)
    expect(state.unlocked).toBe(true)
    vi.advanceTimersByTime(1)
    expect(state.unlocked).toBe(false)
    expect(deps.onLocked).toHaveBeenCalledWith('system-lock')
    lock.rendererReady()
    expect(deps.onLocked).toHaveBeenCalledTimes(1)
  })

  it('prepares first (run timers, cards) and only then asks the renderer to save', async () => {
    const { state, deps } = setup()
    const order: string[] = []
    let release: () => void = () => {}
    const lock = createAppLock({
      ...deps,
      isUnlocked: () => state.unlocked,
      setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimer: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      prepare: (reason) => {
        order.push(`prepare:${reason}`)
        return new Promise<void>((resolve) => (release = resolve))
      },
      askRenderer: () => order.push('ask')
    })
    lock.lock('idle')
    expect(order).toEqual(['prepare:idle'])
    // A lock-ready before the request was sent cannot skip the save.
    lock.rendererReady()
    expect(state.unlocked).toBe(true)
    release()
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['prepare:idle', 'ask'])
    lock.rendererReady()
    expect(state.unlocked).toBe(false)
  })

  it('a prepare that hangs still locks at the deadline', () => {
    const { state, deps } = setup()
    const lock = createAppLock({
      ...deps,
      isUnlocked: () => state.unlocked,
      setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimer: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      prepare: () => new Promise<void>(() => {})
    })
    lock.lock('manual')
    vi.advanceTimersByTime(LOCK_RENDERER_TIMEOUT_MS)
    expect(state.unlocked).toBe(false)
    expect(deps.askRenderer).not.toHaveBeenCalled()
  })

  it('does nothing when already locked', () => {
    const { deps, lock } = setup(false)
    lock.lock('manual')
    expect(deps.askRenderer).not.toHaveBeenCalled()
    lock.rendererReady()
    expect(deps.onLocked).not.toHaveBeenCalled()
    expect(LOCK_RENDERER_TIMEOUT_MS).toBe(5_000)
  })
})
