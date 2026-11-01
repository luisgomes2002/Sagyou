import { useEffect, useRef, useState } from 'react'
import type { PropsWithChildren, ReactElement } from 'react'
import { useKanbanStore } from '../../store/kanban'
import { ClosingScreen } from './ClosingScreen'

export function CloseLifecycle({ children }: PropsWithChildren): ReactElement {
  const closingRef = useRef(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let frame: number | null = null
    let fallback: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    let flushStarted = false

    const blockKeyboard = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    const flushAndClose = async (): Promise<void> => {
      const state = useKanbanStore.getState()
      try {
        // Before load or unlock, the in-memory store is empty; saving it would
        // replace the user's persisted data with that empty state.
        if (state.isLoaded) await state._flushPersist()
      } catch {
        if (!cancelled) setError(true)
        return
      }
      if (!cancelled) {
        // The main process still owns the safety timeout if this IPC fails.
        void window.electronAPI.lifecycle.flushBeforeCloseComplete().catch(() => {})
      }
    }

    const startFlush = (): void => {
      if (flushStarted || cancelled) return
      flushStarted = true
      if (frame !== null) cancelAnimationFrame(frame)
      if (fallback !== null) clearTimeout(fallback)
      void flushAndClose()
    }

    const unsubscribe = window.electronAPI.lifecycle.onFlushBeforeClose(() => {
      if (closingRef.current) return
      closingRef.current = true
      window.addEventListener('keydown', blockKeyboard, true)
      setClosing(true)
      // A frame lets the closing screen paint first. Background windows may
      // never receive one, so the short timer starts the flush regardless.
      frame = requestAnimationFrame(startFlush)
      fallback = setTimeout(startFlush, 100)
    })

    // An update install saves like a close, but must give the app back if the
    // save or the install fails: the current version keeps running then.
    const release = (): void => {
      closingRef.current = false
      window.removeEventListener('keydown', blockKeyboard, true)
      setClosing(false)
      setError(false)
    }

    const unsubscribeInstall = window.electronAPI.lifecycle.onFlushBeforeInstall(() => {
      if (closingRef.current) return
      closingRef.current = true
      window.addEventListener('keydown', blockKeyboard, true)
      setClosing(true)
      void (async () => {
        let ok = true
        try {
          const state = useKanbanStore.getState()
          if (state.isLoaded) await state._flushPersist()
        } catch {
          ok = false
        }
        if (cancelled) return
        if (!ok) release()
        void window.electronAPI.lifecycle.flushBeforeInstallComplete(ok).catch(() => {})
      })()
    })
    const unsubscribeAborted = window.electronAPI.lifecycle.onInstallAborted(release)

    return () => {
      cancelled = true
      if (frame !== null) cancelAnimationFrame(frame)
      if (fallback !== null) clearTimeout(fallback)
      window.removeEventListener('keydown', blockKeyboard, true)
      unsubscribe()
      unsubscribeInstall()
      unsubscribeAborted()
    }
  }, [])

  return (
    <>
      <div data-app-content inert={closing} aria-hidden={closing}>
        {children}
      </div>
      {closing && <ClosingScreen error={error} />}
    </>
  )
}
