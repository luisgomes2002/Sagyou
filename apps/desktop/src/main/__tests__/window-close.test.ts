// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'

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
    emit(name: string): void {
      this.listeners.get(name)?.()
    }
    loadFile = vi.fn()
    loadURL = vi.fn()
    show = vi.fn()
    hide = vi.fn()
    focus = vi.fn()
    restore = vi.fn()
    isMinimized = vi.fn(() => false)
  },
  shell: { openExternal: vi.fn() }
}))

import { createManagedWindow, registerWindowHandlers, type ManagedWindow } from '../handlers/window'

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

  it('accepts completion from the trusted renderer while locked and rejects other senders', () => {
    vi.useFakeTimers()
    const managed = makeWindow()
    managed.window.close()
    const handlers = new Map<string, (event: IpcMainInvokeEvent) => unknown>()
    const ipc = {
      handle: (channel: string, callback: (event: IpcMainInvokeEvent) => unknown) =>
        handlers.set(channel, callback)
    } as unknown as IpcMain
    const assertTrustedRenderer = vi.fn((event: IpcMainInvokeEvent) => {
      if (event.sender !== managed.window.webContents) throw new Error('untrusted renderer')
    })
    registerWindowHandlers(
      ipc,
      () => managed.window,
      () => managed,
      assertTrustedRenderer
    )
    const complete = handlers.get('app:flush-before-close:complete')

    expect(complete).toBeDefined()
    expect(() => complete?.({ sender: {} } as IpcMainInvokeEvent)).toThrow('untrusted renderer')
    expect(managed.window.isDestroyed()).toBe(false)
    complete?.({ sender: managed.window.webContents } as IpcMainInvokeEvent)
    expect(managed.window.isDestroyed()).toBe(true)
  })
})

describe('tray mode', () => {
  type FakeWindow = ManagedWindow['window'] & {
    emit: (name: string) => void
    hide: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
  }

  it('hides on close instead of closing, without the save handshake', () => {
    const onHidden = vi.fn()
    const managed = createManagedWindow({
      preloadPath: '/preload.js',
      productionPagePath: '/index.html',
      isDev: false,
      hideOnClose: () => true,
      onHidden
    })
    const window = managed.window as FakeWindow
    window.close()
    expect(window.hide).toHaveBeenCalledTimes(1)
    expect(onHidden).toHaveBeenCalledTimes(1)
    expect(window.webContents.send).not.toHaveBeenCalledWith('app:flush-before-close')
    expect(window.isDestroyed()).toBe(false)
  })

  it('a real quit (hideOnClose false) still saves before closing', () => {
    vi.useFakeTimers()
    let quitting = false
    const managed = createManagedWindow({
      preloadPath: '/preload.js',
      productionPagePath: '/index.html',
      isDev: false,
      hideOnClose: () => !quitting
    })
    const window = managed.window as FakeWindow
    quitting = true
    window.close()
    expect(window.hide).not.toHaveBeenCalled()
    expect(window.webContents.send).toHaveBeenCalledWith('app:flush-before-close')
    managed.completeClose()
    expect(window.isDestroyed()).toBe(true)
  })

  it('an update install closes even in tray mode', () => {
    const managed = createManagedWindow({
      preloadPath: '/preload.js',
      productionPagePath: '/index.html',
      isDev: false,
      hideOnClose: () => true
    })
    const window = managed.window as FakeWindow
    managed.allowCloseForInstall(true)
    window.close()
    expect(window.hide).not.toHaveBeenCalled()
    expect(window.isDestroyed()).toBe(true)
  })

  it('never shows a window started hidden', () => {
    const managed = createManagedWindow({
      preloadPath: '/preload.js',
      productionPagePath: '/index.html',
      isDev: false,
      startHidden: true
    })
    const window = managed.window as FakeWindow
    window.emit('ready-to-show')
    expect(window.show).not.toHaveBeenCalled()
    managed.show()
    expect(window.show).toHaveBeenCalledTimes(1)
  })

  it('shows a normal window when ready', () => {
    const managed = makeWindow()
    const window = managed.window as FakeWindow
    window.emit('ready-to-show')
    expect(window.show).toHaveBeenCalledTimes(1)
  })
})

describe('flush before installing an update', () => {
  function withHandlers(managed: ManagedWindow): Map<string, (...args: unknown[]) => unknown> {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = {
      handle: (channel: string, callback: (...args: unknown[]) => unknown) =>
        handlers.set(channel, callback)
    } as unknown as IpcMain
    registerWindowHandlers(
      ipc,
      () => managed.window,
      () => managed,
      () => {}
    )
    return handlers
  }

  it('resolves true on the renderer ack and keeps the window open', async () => {
    const managed = makeWindow()
    const handlers = withHandlers(managed)
    const flushed = managed.flushForInstall()
    expect(managed.window.webContents.send).toHaveBeenCalledWith('app:flush-before-install')
    expect(managed.window.webContents.send).not.toHaveBeenCalledWith('app:flush-before-close')
    handlers.get('app:flush-before-install:complete')?.(
      { sender: managed.window.webContents },
      true
    )
    await expect(flushed).resolves.toBe(true)
    expect(managed.window.isDestroyed()).toBe(false)
  })

  it('resolves false when the renderer reports a failed save', async () => {
    const managed = makeWindow()
    const handlers = withHandlers(managed)
    const flushed = managed.flushForInstall()
    handlers.get('app:flush-before-install:complete')?.(
      { sender: managed.window.webContents },
      false
    )
    await expect(flushed).resolves.toBe(false)
  })

  it('resolves false after 10 s without an answer', async () => {
    vi.useFakeTimers()
    const managed = makeWindow()
    const flushed = managed.flushForInstall()
    vi.advanceTimersByTime(9_999)
    let settled = false
    void flushed.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    vi.advanceTimersByTime(1)
    await expect(flushed).resolves.toBe(false)
    expect(managed.window.isDestroyed()).toBe(false)
  })

  it('lets the install close through without a second flush', () => {
    const managed = makeWindow()
    managed.allowCloseForInstall(true)
    managed.window.close()
    expect(managed.window.webContents.send).not.toHaveBeenCalledWith('app:flush-before-close')
    expect(managed.window.isDestroyed()).toBe(true)
  })

  it('an aborted install restores the normal close and tells the renderer', () => {
    vi.useFakeTimers()
    const managed = makeWindow()
    managed.allowCloseForInstall(true)
    managed.abortInstall()
    expect(managed.window.webContents.send).toHaveBeenCalledWith('app:install-aborted')
    managed.window.close()
    expect(managed.window.isDestroyed()).toBe(false)
    expect(managed.window.webContents.send).toHaveBeenCalledWith('app:flush-before-close')
  })

  it('a regular close still works after an install flush', () => {
    vi.useFakeTimers()
    const managed = makeWindow()
    void managed.flushForInstall()
    vi.advanceTimersByTime(10_000)
    managed.window.close()
    managed.completeClose()
    expect(managed.window.isDestroyed()).toBe(true)
  })
})
