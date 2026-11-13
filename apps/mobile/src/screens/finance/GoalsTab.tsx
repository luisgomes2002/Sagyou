import { formatCurrency } from '@sagyou/core/finance'
import { deleteGoal, revertGoal } from '@sagyou/core/finance-actions'
import { goalProgress, type GoalProgress } from '@sagyou/core/finance-views'
import { D } from '@sagyou/core/money'
import type { FinancialGoal, FinancialTable } from '@sagyou/core/types'
import { MONTH_NAMES } from '@sagyou/core/yieldSummary'
import { Target } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { confirmDelete, deleteTitle } from '../../components/confirm'
import { ACTION_ICONS } from '../../components/icons'
import { useApp } from '../../store/app'
import { toBRDate } from '../../store/dates'
import { applyFinance } from '../../store/finance'
import { FONT, SPACE, useTheme } from '../../theme'
import { CompleteGoalSheet, GoalSheet } from './GoalSheet'
import { Metric } from './Metric'
import { ProgressBar } from './ProgressBar'

export const NO_GOALS_TEXT = 'Nenhuma meta nesta tabela.'

interface GoalView {
  goal: FinancialGoal
  progress: GoalProgress
}

/**
 * Metas of one table, as the month on screen sees them (`goalProgress`, shared with the desktop):
 * the balance up to the viewed day, never past the deadline. Goals still to reach come first, by
 * deadline; the achieved or completed ones go to the end, with their note.
 */
export function GoalsTab({
  table,
  month,
  today
}: {
  table: FinancialTable
  month: string
  today: string
}): React.JSX.Element {
  const theme = useTheme()
  const readOnly = useApp((s) => s.readOnly)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [completingId, setCompletingId] = useState<string | null>(null)

  const views: GoalView[] = table.goals
    .map((goal) => ({ goal, progress: goalProgress(goal, table.transactions, month, today) }))
    .sort(
      (a, b) =>
        Number(a.progress.achieved) - Number(b.progress.achieved) ||
        a.goal.targetYear - b.goal.targetYear ||
        a.goal.targetMonth - b.goal.targetMonth
    )
  const editing = table.goals.find((g) => g.id === editingId)
  const completing = table.goals.find((g) => g.id === completingId)
  const [year, number] = month.split('-').map(Number)

  const remove = (goal: FinancialGoal): void =>
    confirmDelete(deleteTitle(goal.name), () => {
      applyFinance((tables, now) => deleteGoal(tables, table.id, goal.id, now))
    })

  return (
    <>
      <Button
        variant="secondary"
        icon={ACTION_ICONS.add}
        label="Nova meta"
        onPress={() => setCreating(true)}
        disabled={readOnly}
      />

      {views.length === 0 ? <EmptyState icon={Target} text={NO_GOALS_TEXT} /> : null}

      {views.map(({ goal, progress }) => {
        const target = D(goal.targetAmount)
        const effective = D(progress.effectiveBalance)
        const saved = effective.lt(0) ? D(0) : effective.gt(target) ? target : effective
        const remaining =
          progress.achieved || effective.gte(target) ? D(0) : target.minus(effective)
        const monthsLeft = Math.max((goal.targetYear - year) * 12 + (goal.targetMonth - number), 0)
        const urgent = !progress.achieved && monthsLeft > 0 && monthsLeft <= 2
        const barColor = progress.achieved
          ? theme.green
          : progress.overdue
            ? theme.red
            : urgent
              ? theme.attention
              : theme.primary
        return (
          <Card key={goal.id}>
            <Text
              accessibilityRole="header"
              numberOfLines={2}
              style={[styles.name, { color: theme.text }]}
            >
              {goal.name}
            </Text>
            <View style={styles.badges}>
              {progress.manuallyCompleted ? (
                <Badge tone="green" text="Concluída" />
              ) : progress.achieved ? (
                <Badge tone="green" text={progress.projected ? 'Projetada' : 'Alcançada'} />
              ) : null}
              {progress.overdue ? <Badge tone="red" text="Atrasada" /> : null}
              {urgent ? (
                <Badge
                  tone="attention"
                  text={`${monthsLeft} ${monthsLeft === 1 ? 'mês restante' : 'meses restantes'}`}
                />
              ) : null}
            </View>
            <Text style={[styles.caption, { color: theme.muted }]}>
              Meta de {formatCurrency(goal.targetAmount, table.currency)} até{' '}
              {MONTH_NAMES[goal.targetMonth - 1]} de {goal.targetYear}
            </Text>
            <ProgressBar
              percent={progress.progress * 100}
              color={barColor}
              label={`${goal.name}: ${progress.percent}% da meta`}
            />
            <Text testID={`percent-${goal.id}`} style={[styles.caption, { color: theme.text }]}>
              {progress.percent}%
              {progress.projected && !progress.manuallyCompleted
                ? ' · só com lançamentos futuros'
                : ''}
            </Text>
            <View style={styles.row}>
              <Metric
                testID={`acumulado-${goal.id}`}
                label="Acumulado"
                value={formatCurrency(saved, table.currency)}
                color={theme.green}
              />
              <Metric
                testID={`faltam-${goal.id}`}
                label="Faltam"
                value={formatCurrency(remaining, table.currency)}
                color={progress.overdue ? theme.red : theme.text}
              />
            </View>
            {!progress.achieved && monthsLeft > 0 ? (
              <Text style={[styles.caption, { color: theme.muted }]}>
                Economizar {formatCurrency(remaining.div(monthsLeft), table.currency)}/mês para
                atingir no prazo
              </Text>
            ) : null}
            {progress.manuallyCompleted && goal.completedAt ? (
              <>
                <Text style={[styles.caption, { color: theme.green }]}>
                  Concluída em {toBRDate(goal.completedAt)}
                </Text>
                {goal.completionNote ? (
                  <Text
                    testID={`nota-${goal.id}`}
                    style={{ color: theme.text, fontSize: FONT.body }}
                  >
                    {goal.completionNote}
                  </Text>
                ) : null}
              </>
            ) : null}
            <View testID={`acoes-${goal.id}`} style={styles.actions}>
              <View testID="acao" style={styles.action}>
                <Button
                  label="Editar"
                  a11yLabel={`Editar ${goal.name}`}
                  onPress={() => setEditingId(goal.id)}
                  disabled={readOnly}
                />
              </View>
              <View testID="acao" style={styles.action}>
                {progress.manuallyCompleted ? (
                  <Button
                    label="Reabrir"
                    a11yLabel={`Reabrir ${goal.name}`}
                    onPress={() => {
                      applyFinance((tables, now) => revertGoal(tables, table.id, goal.id, now))
                    }}
                    disabled={readOnly}
                  />
                ) : (
                  <Button
                    label="Concluir"
                    a11yLabel={`Concluir ${goal.name}`}
                    onPress={() => setCompletingId(goal.id)}
                    disabled={readOnly}
                  />
                )}
              </View>
              <View testID="acao" style={styles.action}>
                <Button
                  variant="danger"
                  label="Excluir"
                  a11yLabel={`Excluir ${goal.name}`}
                  onPress={() => remove(goal)}
                  disabled={readOnly}
                />
              </View>
            </View>
          </Card>
        )
      })}

      <GoalSheet
        visible={creating}
        onClose={() => setCreating(false)}
        table={table}
        today={today}
      />
      <GoalSheet
        visible={!!editing}
        goal={editing}
        onClose={() => setEditingId(null)}
        table={table}
        today={today}
      />
      {completing ? (
        <CompleteGoalSheet
          visible
          goal={completing}
          onClose={() => setCompletingId(null)}
          table={table}
          today={today}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: FONT.bodyLg, fontWeight: '600' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  caption: { fontSize: FONT.caption },
  row: { flexDirection: 'row', gap: SPACE.md },
  // Wraps on a 360 dp phone: two or three buttons of 112 dp+ no longer squeeze their labels.
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  action: { flexGrow: 1, minWidth: 112 }
})
