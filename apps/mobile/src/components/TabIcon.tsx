import { View } from 'react-native'
import { TAB_ICONS, type TabLabel } from './icons'

/** The tab bar icon; the testID lets tests see which icon each tab carries. */
export function TabIcon({
  label,
  color,
  size = 22
}: {
  label: TabLabel
  color: string
  size?: number
}): React.JSX.Element {
  const Icon = TAB_ICONS[label]
  return (
    <View testID={`tab-icon-${label}`}>
      <Icon size={size} color={color} />
    </View>
  )
}
