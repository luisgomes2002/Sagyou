// @vitest-environment node
import { describe, expect, it, vi, type Mock } from 'vitest'
import { createAutoLock, IDLE_CHECK_MS } from '../modules/desktop/auto-lock'
import { defaultDesktopPrefs, type DesktopPrefs } from '../modules/desktop/desktop-prefs'

interface Setup {
  state: { idle: number; canLock: boolean; prefs: DesktopPrefs }
  deps: { lock: Mock; setInterval: Mock; clearInterval: Mock }
  auto: ReturnType<typeof createAutoLock>
}

function setup(overrides: Partial<DesktopPrefs> = {}, canLock = true): Setup {
  const state = { idle: 0, canLock, prefs: { ...defaultDesktopPrefs('win32'), ...overrides } }
  const deps = {
    idleSeconds: () => state.idle,
    prefs: () => state.prefs,
    canLock: () => state.canLock,
    lock: vi.fn(),
    setInterval: vi.fn(() => 'handle'),
    clearInterval: vi.fn()
  }
  return { state, deps, auto: createAutoLock(deps) }
}

describe('automatic lock', () => {
  it('locks once the whole system has been idle for the chosen minutes', () => {
    const { state, deps, auto } = setup()
    state.idle = 899
    auto.tick()
    expect(deps.lock).not.toHaveBeenCalled()
    state.idle = 900
    auto.tick()
    expect(deps.lock).toHaveBeenCalledWith('idle')
  })

  it('never locks on idle when set to "Nunca" or without a password', () => {
    const never = setup({ idleLockMinutes: 0 })
    never.state.idle = 10 ** 6
    never.auto.tick()
    expect(never.deps.lock).not.toHaveBeenCalled()

    const noPassword = setup({}, false)
    noPassword.state.idle = 10 ** 6
    noPassword.auto.tick()
    noPassword.auto.onSystemLock()
    noPassword.auto.onSuspend()
    expect(noPassword.deps.lock).not.toHaveBeenCalled()
  })

  it('locks with the screen and on sleep unless that is turned off', () => {
    const on = setup()
    on.auto.onSystemLock()
    on.auto.onSuspend()
    expect(on.deps.lock.mock.calls).toEqual([['system-lock'], ['suspend']])

    const off = setup({ lockOnSystemLock: false })
    off.auto.onSystemLock()
    off.auto.onSuspend()
    expect(off.deps.lock).not.toHaveBeenCalled()
  })

  it('checks every 30 seconds, started once', () => {
    const { deps, auto } = setup()
    auto.start()
    auto.start()
    expect(deps.setInterval).toHaveBeenCalledTimes(1)
    expect(deps.setInterval).toHaveBeenCalledWith(expect.any(Function), 30_000)
    expect(IDLE_CHECK_MS).toBe(30_000)
    auto.stop()
    expect(deps.clearInterval).toHaveBeenCalledWith('handle')
  })
})
