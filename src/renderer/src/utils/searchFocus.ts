import { useEffect, useRef } from 'react'

export function useSearchFocus<T extends HTMLElement>(active: boolean): React.RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [active])
  return ref
}

export function searchFocusClass(active: boolean): string {
  return active
    ? 'relative z-10 rounded-lg ring-2 ring-[#a080f0] ring-offset-2 ring-offset-[#0b0b0f]'
    : ''
}
