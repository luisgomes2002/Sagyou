import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { SPACE, useTheme } from '../theme'

// The design system: one file per component, re-exported here so screens keep
// importing from '../components/ui'.
export { Badge, type BadgeTone } from './Badge'
export { BottomSheet } from './BottomSheet'
export { Button, type ButtonProps, type ButtonVariant } from './Button'
export { Card } from './Card'
export { Chip } from './Chip'
export { EmptyState } from './EmptyState'
export { Fab } from './Fab'
export { Field, type FieldProps } from './Field'
export { Header } from './Header'
export { ListItem, type ListItemProps } from './ListItem'
export { QrCode } from './QrCode'
export { Snackbar } from './Snackbar'

export function Row({ children }: { children: ReactNode }): React.JSX.Element {
  return <View style={styles.row}>{children}</View>
}

export function Screen({ children }: { children: ReactNode }): React.JSX.Element {
  const theme = useTheme()
  return <View style={[styles.screen, { backgroundColor: theme.bg }]}>{children}</View>
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  screen: { flex: 1, padding: SPACE.lg, gap: SPACE.md }
})
