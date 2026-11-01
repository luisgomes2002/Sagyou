import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * How many full-screen editors are open (note editor, full task form). While
 * any is, the tab hides its (+): it would sit on top of the form's "Salvar".
 */
export const useEditing = create<{ count: number }>(() => ({ count: 0 }))

/** Call in an editor: counts it as open while mounted. */
export function useEditorOpen(): void {
  useEffect(() => {
    useEditing.setState((s) => ({ count: s.count + 1 }))
    return () => useEditing.setState((s) => ({ count: Math.max(0, s.count - 1) }))
  }, [])
}
