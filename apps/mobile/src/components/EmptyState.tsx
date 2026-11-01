import type { LucideIcon } from 'lucide-react-native'
import { StyleSheet, Text, View } from 'react-native'
import { FONT, SPACE, useTheme } from '../theme'

/** An empty list: a quiet icon and one sentence saying what to do. */
export function EmptyState({
  icon: Icon,
  text
}: {
  icon: LucideIcon
  text: string
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={styles.empty}>
      <Icon size={32} color={theme.onSurfaceIcon} />
      <Text style={[styles.text, { color: theme.muted }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.xl * 2 },
  text: { fontSize: FONT.body, textAlign: 'center' }
})
