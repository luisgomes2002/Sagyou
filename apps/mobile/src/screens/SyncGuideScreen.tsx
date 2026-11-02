import { ScrollView } from 'react-native'
import { SyncGuideContent } from '../components/SyncGuideContent'
import { Screen } from '../components/ui'

/** Ajustes → Como funciona a sincronização. */
export function SyncGuideScreen(): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <SyncGuideContent />
      </Screen>
    </ScrollView>
  )
}
