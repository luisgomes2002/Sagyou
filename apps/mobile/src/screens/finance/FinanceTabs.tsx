import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../../theme'
import { FINANCE_TABS, type FinanceTab } from './tabs'

/** The six areas of Finanças as a row of chips that scrolls sideways; the choice is not remembered. */
export function FinanceTabs({
  value,
  onChange
}: {
  value: FinanceTab
  onChange: (tab: FinanceTab) => void
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      contentContainerStyle={styles.row}
    >
      {FINANCE_TABS.map((t) => {
        const selected = t.id === value
        return (
          <Pressable
            key={t.id}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(t.id)}
            style={[
              styles.tab,
              {
                backgroundColor: selected ? theme.selected : theme.surface,
                borderColor: selected ? theme.purple : theme.border
              }
            ]}
          >
            <Text style={{ color: selected ? theme.text : theme.muted, fontSize: FONT.body }}>
              {t.label}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { gap: SPACE.sm },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.md + 2,
    minHeight: MIN_TOUCH
  }
})
