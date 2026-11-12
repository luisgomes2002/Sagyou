import { Alert } from 'react-native'

/** "Excluir Almoço?": what the confirmation asks for a row. */
export const deleteTitle = (name: string): string => `Excluir ${name}?`

/** What the confirmation asks before a whole table goes away. */
export const deleteTableTitle = (name: string): string =>
  `Excluir a tabela ${name} e todos os lançamentos dela?`

/**
 * Deleting asks first, as on the desktop, and there is no "Desfazer" afterwards. Only
 * **Excluir** runs `onConfirm`; **Cancelar** and the back button leave everything as it was.
 */
export function confirmDelete(title: string, onConfirm: () => void): void {
  Alert.alert(title, undefined, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Excluir', style: 'destructive', onPress: onConfirm }
  ])
}
