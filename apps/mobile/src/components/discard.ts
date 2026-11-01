import { Alert } from 'react-native'

export const DISCARD_TITLE = 'Descartar?'

/** Closing a form with something typed asks first; an untouched form just closes. */
export function closeOrConfirm(dirty: boolean, close: () => void): void {
  if (!dirty) return close()
  Alert.alert(DISCARD_TITLE, 'O que você digitou não foi salvo.', [
    { text: 'Continuar editando', style: 'cancel' },
    { text: 'Descartar', style: 'destructive', onPress: close }
  ])
}
