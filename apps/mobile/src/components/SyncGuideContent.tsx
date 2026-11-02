import { StyleSheet, Text, View } from 'react-native'
import {
  EXAMPLE_LABEL,
  SYNC_GUIDE_ARTICLES,
  exampleA11yLabel,
  type SyncGuideBlock
} from '@sagyou/core/sync/guide'
import { FONT, RADIUS, SPACE, useTheme } from '../theme'
import { Card } from './Card'

export const SYNC_GUIDE_LINK = 'Como funciona a sincronização'

function Block({ block }: { block: SyncGuideBlock }): React.JSX.Element {
  const theme = useTheme()
  switch (block.type) {
    case 'p':
      return <Text style={[styles.body, { color: theme.text }]}>{block.text}</Text>
    case 'steps':
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <Text key={item} style={[styles.body, { color: theme.text }]}>
              {`${i + 1}. ${item}`}
            </Text>
          ))}
        </View>
      )
    case 'callout':
      return (
        <View
          style={[
            styles.callout,
            {
              borderColor: block.tone === 'tip' ? theme.purple : theme.attention,
              backgroundColor: theme.surface
            }
          ]}
        >
          <Text style={[styles.body, { color: theme.text }]}>
            <Text style={{ fontWeight: '600' }}>{block.tone === 'tip' ? 'Dica: ' : 'Atenção: '}</Text>
            {block.text}
          </Text>
        </View>
      )
    case 'keyExample':
      return (
        <Card>
          <Text accessibilityRole="header" style={[styles.keyName, { color: theme.text }]}>
            {block.name}
          </Text>
          <View
            accessible
            accessibilityLabel={exampleA11yLabel(block.name)}
            style={[styles.example, { borderColor: theme.border }]}
          >
            <Text style={[styles.badge, { color: theme.attention }]}>{EXAMPLE_LABEL}</Text>
            <Text style={[styles.mono, { color: theme.muted }]}>{block.example}</Text>
          </View>
          {block.lines.map((line) => (
            <View key={line.label}>
              <Text style={[styles.caption, { color: theme.muted }]}>{line.label}</Text>
              <Text style={[styles.body, { color: theme.text }]}>{line.text}</Text>
            </View>
          ))}
        </Card>
      )
    case 'table':
      return (
        <Card>
          {block.rows.map(([lost, use]) => (
            <View key={lost} style={styles.row}>
              <Text style={[styles.body, { color: theme.text, fontWeight: '600' }]}>
                {`${block.head[0]}: ${lost}`}
              </Text>
              <Text style={[styles.body, { color: theme.text }]}>{`${block.head[1]}: ${use}`}</Text>
            </View>
          ))}
        </Card>
      )
  }
}

/** The same two articles as the desktop's Como funciona (packages/core/src/sync/guide.ts). */
export function SyncGuideContent(): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={styles.page}>
      {SYNC_GUIDE_ARTICLES.map((article) => (
        <View key={article.id} style={styles.article}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
            {article.title}
          </Text>
          {article.blocks.map((block, i) => (
            <Block key={`${article.id}-${i}`} block={block} />
          ))}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: SPACE.xl },
  article: { gap: SPACE.md },
  title: { fontSize: FONT.title, fontWeight: '700' },
  keyName: { fontSize: FONT.bodyLg, fontWeight: '600' },
  body: { fontSize: FONT.body, lineHeight: 20 },
  caption: { fontSize: FONT.caption },
  list: { gap: SPACE.sm },
  callout: { borderWidth: 1, borderRadius: RADIUS.control, padding: SPACE.md },
  example: { borderWidth: 1, borderStyle: 'dashed', borderRadius: RADIUS.control, padding: SPACE.sm, gap: 2 },
  badge: { fontSize: FONT.caption, fontWeight: '600' },
  mono: { fontSize: FONT.caption, fontFamily: 'monospace' },
  row: { gap: 2, paddingVertical: SPACE.xs }
})
