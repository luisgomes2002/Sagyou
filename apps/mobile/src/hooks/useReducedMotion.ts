import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/** True when the person turned on Android's "Remover animações": every motion becomes instant. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduced(value)
      })
      .catch(() => undefined)
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      alive = false
      sub?.remove()
    }
  }, [])
  return reduced
}
