// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {
    private listeners = new Map<string, (...args: unknown[]) => void>()
    private destroyed = false
    webContents = {
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      getURL: vi.fn(() => '')
    }
    on(name: string, callback: (...args: unknown[]) => void): void {
      this.listeners.set(name, callback)
    }
    close(): void {
      const event = { preventDefault: vi.fn() }
      this.listeners.get('close')?.(event)
      if (!event.preventDefault.mock.calls.length) this.destroyed = true
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    loadFile = vi.fn()
    loadURL = vi.fn()
    show = vi.fn()
  },
  shell: { openExternal: vi.fn() }
}))

import { createManagedWindow, type ManagedWindow } from '../handlers/window'

function makeWindow(): ManagedWindow {
  return createManagedWindow({
    preloadPath: '/preload.js',
    productionPagePath: '/index.html',
    isDev: false
  })
}

afterEach(() => vi.useRealTimers())

describe('window close handshake', () => {
  it('waits for the renderer and closes after confirmation', () => {
    vi.useFakeTimers()
    const managed = makeWindow()
    managed.window.close()

    expect(managed.window.isDestroyed()).toBe(false)
    expect(managed.window.webContents.send).toHaveBeenCalledWith('app:flush-before-close')

    managed.completeClose()
    expect(managed.window.isDestroyed()).toBe(true)
  })

  it('keeps the first timeout when close is requested again', () => {
    vi.useFakeTimers()
    const managed = makeWindow()
    managed.window.close()
    vi.advanceTimersByTime(5_000)
    managed.window.close()

    expect(managed.window.webContents.send).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5_000)
    expect(managed.window.isDestroyed()).toBe(true)
  })

  it('closes after the safety timeout if the renderer never responds', () => {
    vi.useFakeTimers()
    const managed = makeWindow()
    managed.window.close()
    vi.advanceTimersByTime(9_999)
    expect(managed.window.isDestroyed()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(managed.window.isDestroyed()).toBe(true)
  })
})
