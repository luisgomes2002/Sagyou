import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../theme'

/** Stand-in for a tab whose screen arrives in a later task. */
export function Placeholder({ title }: { title: string }): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <Text style={{ color: theme.muted }}>{title}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' }
})
