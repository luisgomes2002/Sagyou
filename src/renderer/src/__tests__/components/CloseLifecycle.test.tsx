import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloseLifecycle } from '../../components/layout/CloseLifecycle'
import { useKanbanStore } from '../../store/kanban'

vi.mock('../../store/kanban', () => ({ useKanbanStore: { getState: vi.fn() } }))

let onClose: (() => void) | undefined
let paint: FrameRequestCallback | undefined
const flush = vi.fn<() => Promise<void>>()
const complete = vi.fn<() => Promise<void>>()
const unsubscribe = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  onClose = undefined
  paint = undefined
  flush.mockReset().mockResolvedValue(undefined)
  complete.mockReset().mockResolvedValue(undefined)
  unsubscribe.mockReset()
  vi.mocked(useKanbanStore.getState).mockReturnValue({
    isLoaded: true,
    _flushPersist: flush
  } as unknown as ReturnType<typeof useKanbanStore.getState>)
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    lifecycle: {
      onFlushBeforeClose: vi.fn((callback: () => void) => {
        onClose = callback
        return unsubscribe
      }),
      flushBeforeCloseComplete: complete
    }
  }
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      paint = callback
      return 1
    })
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function requestClose(): Promise<void> {
  await act(async () => onClose?.())
}

async function paintFrame(): Promise<void> {
  await act(async () => paint?.(0))
}

describe('CloseLifecycle', () => {
  it('shows the closing state while saving and confirms only after the save resolves', async () => {
    let resolveSave: (() => void) | undefined
    flush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
    )
    render(<CloseLifecycle />)

    await requestClose()
    expect(screen.getByRole('status')).toHaveTextContent('Fechando Sagyou…')
    expect(flush).not.toHaveBeenCalled()
    await paintFrame()
    expect(flush).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()

    await act(async () => resolveSave?.())
    expect(complete).toHaveBeenCalledOnce()
  })

  it('does not run a second flush for repeated close requests', async () => {
    render(<CloseLifecycle />)
    await requestClose()
    await requestClose()
    await paintFrame()
    expect(flush).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledOnce()
  })

  it('closes without writing an empty store while locked or loading', async () => {
    vi.mocked(useKanbanStore.getState).mockReturnValue({
      isLoaded: false,
      _flushPersist: flush
    } as unknown as ReturnType<typeof useKanbanStore.getState>)
    render(<CloseLifecycle />)
    await requestClose()
    await paintFrame()

    expect(flush).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledOnce()
  })

  it('shows a save error without confirming success', async () => {
    flush.mockRejectedValue(new Error('disk failure'))
    render(<CloseLifecycle />)
    await requestClose()
    await paintFrame()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível salvar os dados. Aguarde o fechamento.'
    )
    expect(complete).not.toHaveBeenCalled()
  })

  it('uses a timer when animation frames are unavailable', async () => {
    render(<CloseLifecycle />)
    await requestClose()
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(flush).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledOnce()
  })

  it('unsubscribes on unmount and supports reduced motion', async () => {
    const { unmount } = render(<CloseLifecycle />)
    await requestClose()
    expect(screen.getByRole('status').querySelector('.motion-reduce\\:animate-none')).not.toBeNull()
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('makes the app inaccessible and blocks global shortcuts while closing', async () => {
    const shortcut = vi.fn()
    window.addEventListener('keydown', shortcut)
    try {
      const { container } = render(
        <CloseLifecycle>
          <button>Editar task</button>
        </CloseLifecycle>
      )
      await requestClose()

      expect(container.querySelector('[data-app-content]')).toHaveAttribute('inert')
      expect(container.querySelector('[data-app-content]')).toHaveAttribute('aria-hidden', 'true')
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
      })
      expect(shortcut).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', shortcut)
    }
  })
})
