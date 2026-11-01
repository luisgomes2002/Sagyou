import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { FONT, SPACE, useTheme } from '../theme'

/** A section or screen title on the left, an optional action on the right. */
export function Header({ title, right }: { title: string; right?: ReactNode }): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
        {title}
      </Text>
      {right}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm
  },
  title: { fontSize: FONT.title, fontWeight: '600', flexShrink: 1 }
})
