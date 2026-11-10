import {
  Folder,
  ListChecks,
  Repeat,
  Search,
  StickyNote,
  Wallet,
  X,
  type LucideIcon
} from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { EmptyState, Screen } from '../components/ui'
import type { SearchHit, SearchKind } from '../data/search'
import { useApp } from '../store/app'
import { highlightParts } from '../store/highlight'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'

const SEARCH_GROUP_ORDER: SearchKind[] = ['task', 'project', 'note', 'habit', 'transaction']

const SEARCH_GROUP_TITLES: Record<SearchKind, string> = {
  task: 'Tarefas',
  project: 'Projetos',
  note: 'Notas',
  habit: 'Hábitos',
  transaction: 'Lançamentos'
}

const GROUP_ICONS: Record<SearchKind, LucideIcon> = {
  task: ListChecks,
  project: Folder,
  note: StickyNote,
  habit: Repeat,
  transaction: Wallet
}

function Highlighted({ title, query }: { title: string; query: string }): React.JSX.Element {
  const theme = useTheme()
  return (
    <Text style={[styles.title, { color: theme.text }]}>
      {highlightParts(title || '—', query).map((part, i) =>
        part.match ? (
          <Text key={i} testID="match" style={{ color: theme.purple, fontWeight: '700' }}>
            {part.text}
          </Text>
        ) : (
          part.text
        )
      )}
    </Text>
  )
}

/** One box for every record; transactions follow this phone's financial profile. */
export function SearchScreen({ onOpen }: { onOpen: (hit: SearchHit) => void }): React.JSX.Element {
  const theme = useTheme()
  const services = useApp((s) => s.services)
  const profileId = useApp((s) => s.profileId)
  const [text, setText] = useState('')
  const query = text.trim()
  const hits = query && services ? services.search(text, profileId) : []
  const groups = SEARCH_GROUP_ORDER.map((kind) => ({
    kind,
    hits: hits.filter((h) => h.kind === kind)
  })).filter((g) => g.hits.length > 0)

  return (
    <ScrollView testID="search-screen" keyboardShouldPersistTaps="handled">
      <Screen>
        <View style={[styles.box, { backgroundColor: theme.field, borderColor: theme.border }]}>
          <Search size={18} color={theme.onSurfaceIcon} />
          <TextInput
            accessibilityLabel="Buscar"
            placeholder="Buscar"
            placeholderTextColor={theme.muted}
            value={text}
            onChangeText={setText}
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            style={[styles.input, { color: theme.text }]}
          />
          {text ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Limpar busca"
              onPress={() => setText('')}
              style={styles.clear}
            >
              <X size={18} color={theme.onSurfaceIcon} />
            </Pressable>
          ) : null}
        </View>
        {!query ? (
          <EmptyState icon={Search} text="Busque tarefas, notas, hábitos e lançamentos" />
        ) : hits.length === 0 ? (
          <EmptyState icon={Search} text={`Nada encontrado para "${query}"`} />
        ) : null}
        {groups.map(({ kind, hits: list }) => {
          const Icon = GROUP_ICONS[kind]
          const heading = `${SEARCH_GROUP_TITLES[kind]} · ${list.length}`
          return (
            <View key={kind} style={styles.group}>
              <View
                accessible
                accessibilityRole="header"
                accessibilityLabel={heading}
                style={styles.heading}
              >
                <Icon size={16} color={theme.onSurfaceIcon} />
                <Text style={[styles.headingText, { color: theme.muted }]}>{heading}</Text>
              </View>
              {list.map((hit) => (
                <Pressable
                  key={`${hit.kind}:${hit.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={hit.title || SEARCH_GROUP_TITLES[hit.kind]}
                  onPress={() => onOpen(hit)}
                  style={({ pressed }) => [
                    styles.hit,
                    {
                      backgroundColor: pressed ? theme.selected : theme.surface,
                      borderColor: theme.border
                    }
                  ]}
                >
                  <Highlighted title={hit.title} query={query} />
                </Pressable>
              ))}
            </View>
          )
        })}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
    borderWidth: 1,
    borderRadius: RADIUS.control,
    paddingLeft: SPACE.md,
    minHeight: MIN_TOUCH
  },
  input: { flex: 1, fontSize: FONT.bodyLg, paddingVertical: SPACE.sm },
  clear: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center'
  },
  group: { gap: SPACE.sm },
  heading: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  headingText: { fontSize: FONT.caption, fontWeight: '600', textTransform: 'uppercase' },
  hit: {
    borderWidth: 1,
    borderRadius: RADIUS.card,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
    minHeight: MIN_TOUCH,
    justifyContent: 'center'
  },
  title: { fontSize: FONT.bodyLg }
})
