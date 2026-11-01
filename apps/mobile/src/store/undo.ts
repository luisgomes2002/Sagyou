import { create } from 'zustand'

/** How long the bottom notice stays (and "Desfazer" can be pressed). */
export const UNDO_MS = 5000

interface UndoStore {
  message: string | null
  /** False for a plain notice (no "Desfazer" button). */
  canUndo: boolean
  /** Shows a notice; with `revert`, it offers "Desfazer". Replaces any notice on screen. */
  show(message: string, revert?: () => void): void
  /** Runs the pending revert once and closes the notice. */
  run(): void
  dismiss(): void
}

let timer: ReturnType<typeof setTimeout> | null = null
let pending: (() => void) | null = null

function clear(): void {
  if (timer) clearTimeout(timer)
  timer = null
  pending = null
}

export const useUndo = create<UndoStore>((set) => ({
  message: null,
  canUndo: false,

  show(message, revert) {
    clear()
    pending = revert ?? null
    timer = setTimeout(() => {
      clear()
      set({ message: null, canUndo: false })
    }, UNDO_MS)
    set({ message, canUndo: !!revert })
  },

  run() {
    const revert = pending
    clear()
    set({ message: null, canUndo: false })
    revert?.()
  },

  dismiss() {
    clear()
    set({ message: null, canUndo: false })
  }
}))
