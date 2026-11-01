import { StyleSheet, Text, View } from 'react-native'
import { FONT, RADIUS, SPACE, useTheme, type Theme } from '../theme'

export type BadgeTone = 'neutral' | 'green' | 'red' | 'attention' | 'purple'

function toneColor(theme: Theme, tone: BadgeTone): string {
  return tone === 'neutral' ? theme.muted : theme[tone]
}

/** A small tag: neutral solid fill, the meaning goes in the text color. */
export function Badge({
  text,
  tone = 'neutral'
}: {
  text: string
  tone?: BadgeTone
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={[styles.badge, { backgroundColor: theme.selected }]}>
      <Text style={[styles.text, { color: toneColor(theme, tone) }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start'
  },
  text: { fontSize: FONT.caption }
})
