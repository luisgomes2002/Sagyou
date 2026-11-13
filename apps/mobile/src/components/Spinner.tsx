import { ActivityIndicator } from 'react-native'
import { useReducedMotion } from '../hooks/useReducedMotion'

/**
 * A small progress indicator that is not drawn at all when the person turned on Android's
 * "Remover animações" (the text next to it already says what is happening).
 */
export function Spinner({ color }: { color: string }): React.JSX.Element | null {
  const reduced = useReducedMotion()
  return reduced ? null : <ActivityIndicator size="small" color={color} testID="spinner" />
}
