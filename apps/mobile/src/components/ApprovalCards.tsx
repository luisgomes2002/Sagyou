import type { ApprovalCardBody } from '@sagyou/core/control/bodies'
import { CONTROL_TEXT } from '@sagyou/core/control/texts'
import { StyleSheet, Text, View } from 'react-native'
import { cardCountdown } from '../remote/texts'
import { FONT, SPACE, useTheme } from '../theme'
import { Button } from './Button'
import { Card } from './Card'

/**
 * The approval cards of the Fleet and of the external token (spec
 * docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md moved them from the PC tab to the
 * Notificações screen): the summary, the countdown and Aprovar/Recusar. An expired card
 * says so and answers nothing.
 */
export function ApprovalCards({
  cards,
  clock,
  busy,
  onAnswer
}: {
  cards: ApprovalCardBody[]
  /** "Now", ticking once a second in the screen that renders this. */
  clock: number
  busy: boolean
  onAnswer: (id: string, approved: boolean) => void
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={{ gap: SPACE.sm }}>
      {cards.map((card) => {
        const left = card.expiresAt - clock
        const expired = left <= 0
        return (
          <Card key={card.id}>
            <Text style={{ color: theme.text, fontSize: FONT.bodyLg }}>{card.resumo}</Text>
            <Text style={{ color: theme.muted, fontSize: FONT.caption }}>
              {`${card.session} · ${card.tool} · ${expired ? CONTROL_TEXT.cardGone : cardCountdown(left)}`}
            </Text>
            <View style={styles.actions}>
              <Button
                variant="primary"
                label="Aprovar"
                a11yLabel={`Aprovar: ${card.resumo}`}
                disabled={busy || expired}
                onPress={() => onAnswer(card.id, true)}
              />
              <Button
                label="Recusar"
                a11yLabel={`Recusar: ${card.resumo}`}
                disabled={busy || expired}
                onPress={() => onAnswer(card.id, false)}
              />
            </View>
          </Card>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: SPACE.sm, flexWrap: 'wrap' }
})
