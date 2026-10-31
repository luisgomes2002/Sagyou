import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { Field, Screen } from '../components/ui'
import type { SearchHit, SearchKind } from '../data/search'
import { useApp } from '../store/app'
import { useTheme } from '../theme'

const KIND_LABELS: Record<SearchKind, string> = {
  project: 'Projeto',
  task: 'Tarefa',
  note: 'Nota',
  habit: 'Hábito',
  transaction: 'Lançamento'
}

/** One box for every record; transactions follow this phone's financial profile. */
export function SearchScreen({ onOpen }: { onOpen: (hit: SearchHit) => void }): React.JSX.Element {
  const theme = useTheme()
  const services = useApp((s) => s.services)
  const profileId = useApp((s) => s.profileId)
  const [text, setText] = useState('')
  const hits = text.trim() && services ? services.search(text, profileId) : []
  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Screen>
        <Field label="Buscar" value={text} onChangeText={setText} autoCorrect={false} />
        {text.trim() && hits.length === 0 ? (
          <Text style={{ color: theme.muted }}>Nada encontrado.</Text>
        ) : null}
        {hits.map((hit) => (
          <Pressable
            key={`${hit.kind}:${hit.id}`}
            accessibilityRole="button"
            accessibilityLabel={hit.title || KIND_LABELS[hit.kind]}
            onPress={() => onOpen(hit)}
            style={[styles.hit, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Text style={{ color: theme.muted, fontSize: 12 }}>{KIND_LABELS[hit.kind]}</Text>
            <Text style={{ color: theme.text }}>{hit.title || '—'}</Text>
          </Pressable>
        ))}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  hit: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 2 }
})
