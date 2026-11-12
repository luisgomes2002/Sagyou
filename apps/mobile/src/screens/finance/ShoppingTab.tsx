import { todayLocalISO } from '@sagyou/core/dates'
import { formatCurrency, itemTotal } from '@sagyou/core/finance'
import { deleteItem, toggleItem } from '@sagyou/core/finance-actions'
import { D } from '@sagyou/core/money'
import type { FinancialTable, ShoppingItem } from '@sagyou/core/types'
import { ShoppingBag } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { confirmDelete, deleteTitle } from '../../components/confirm'
import { ACTION_ICONS } from '../../components/icons'
import { useApp } from '../../store/app'
import { applyFinance } from '../../store/finance'
import { openItemLink } from '../../store/links'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../../theme'
import { ItemSheet } from './ItemSheet'
import { Metric } from './Metric'
import { ProgressBar } from './ProgressBar'

const Tick = ACTION_ICONS.check

export const NO_ITEMS_TEXT = 'Nenhum item nesta lista.'

/**
 * Compras of one table: the list with a box per item. Marking an item that has a price records the
 * expense of today in the table (`fromShopping`); unmarking takes it back — both through the core,
 * in one commit. The bought items go to the end of the list.
 */
export function ShoppingTab({
  table,
  today
}: {
  table: FinancialTable
  /** Only tests pin the day; in the app it is read at the tap (the tab can stay open for days). */
  today?: string
}): React.JSX.Element {
  const theme = useTheme()
  const readOnly = useApp((s) => s.readOnly)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const items = table.items
  const ordered = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)]
  const editing = items.find((i) => i.id === editingId)

  const done = items.filter((i) => i.done).length
  const percent = items.length > 0 ? Math.round((done / items.length) * 100) : 0
  const total = items.reduce((sum, i) => sum.plus(itemTotal(i)), D(0))
  const spent = items.filter((i) => i.done).reduce((sum, i) => sum.plus(itemTotal(i)), D(0))

  const toggle = (item: ShoppingItem): void => {
    applyFinance((tables, now) =>
      toggleItem(tables, table.id, item.id, now, today ?? todayLocalISO())
    )
  }
  const remove = (item: ShoppingItem): void =>
    confirmDelete(deleteTitle(item.name), () => {
      applyFinance((tables, now) => deleteItem(tables, table.id, item.id, now))
    })

  return (
    <>
      <Button
        variant="secondary"
        icon={ACTION_ICONS.add}
        label="Novo item"
        onPress={() => setCreating(true)}
        disabled={readOnly}
      />

      {items.length === 0 ? <EmptyState icon={ShoppingBag} text={NO_ITEMS_TEXT} /> : null}

      {items.length > 0 ? (
        <Card>
          <Text
            testID="compras-progresso"
            style={{ color: theme.text, fontSize: FONT.body, fontWeight: '600' }}
          >
            {done}/{items.length} {done === 1 ? 'comprado' : 'comprados'} · {percent}%
          </Text>
          <ProgressBar
            percent={percent}
            color={percent === 100 ? theme.green : theme.primary}
            label={`Compras: ${percent}% comprado`}
          />
          {total.gt(0) ? (
            <View style={styles.row}>
              <Metric
                testID="compras-gasto"
                label="Gasto"
                value={formatCurrency(spent, table.currency)}
                color={theme.green}
              />
              <Metric
                testID="compras-total"
                label="Total"
                value={formatCurrency(total, table.currency)}
                color={theme.text}
              />
            </View>
          ) : null}
        </Card>
      ) : null}

      {ordered.map((item) => {
        const sum = itemTotal(item)
        return (
          <Card key={item.id}>
            <View style={styles.head}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={
                  item.done ? `Desmarcar ${item.name}` : `Marcar ${item.name} como comprado`
                }
                accessibilityState={{ checked: item.done, disabled: readOnly }}
                disabled={readOnly}
                onPress={() => toggle(item)}
                style={styles.check}
              >
                <View
                  style={[
                    styles.box,
                    item.done
                      ? { backgroundColor: theme.green, borderColor: theme.green }
                      : { borderColor: readOnly ? theme.border : theme.muted }
                  ]}
                >
                  {item.done ? <Tick size={14} color={theme.onPrimary} /> : null}
                </View>
              </Pressable>
              <View style={styles.body}>
                <Text
                  accessibilityRole="header"
                  numberOfLines={2}
                  style={[
                    styles.name,
                    { color: item.done ? theme.muted : theme.text },
                    item.done && styles.struck
                  ]}
                >
                  {item.name}
                </Text>
                <Text style={[styles.caption, { color: theme.muted }]}>
                  {String(item.qty).replace('.', ',')}
                  {item.price != null ? ` × ${formatCurrency(item.price, table.currency)}` : ''}
                  {item.done && item.linkedTransactionId ? ' · lançado como gasto' : ''}
                </Text>
              </View>
              {item.price != null && sum.gt(0) ? (
                <Text
                  testID={`total-${item.id}`}
                  style={[styles.sum, { color: item.done ? theme.muted : theme.text }]}
                >
                  {formatCurrency(sum, table.currency)}
                </Text>
              ) : null}
            </View>
            <View testID={`acoes-${item.id}`} style={styles.actions}>
              {item.link ? (
                <View testID="acao" style={styles.action}>
                  <Button
                    label="Abrir link"
                    a11yLabel={`Abrir link de ${item.name}`}
                    onPress={() => openItemLink(item.link ?? '')}
                  />
                </View>
              ) : null}
              <View testID="acao" style={styles.action}>
                <Button
                  label="Editar"
                  a11yLabel={`Editar ${item.name}`}
                  onPress={() => setEditingId(item.id)}
                  disabled={readOnly}
                />
              </View>
              <View testID="acao" style={styles.action}>
                <Button
                  variant="danger"
                  label="Excluir"
                  a11yLabel={`Excluir ${item.name}`}
                  onPress={() => remove(item)}
                  disabled={readOnly}
                />
              </View>
            </View>
          </Card>
        )
      })}

      <ItemSheet visible={creating} onClose={() => setCreating(false)} table={table} />
      <ItemSheet
        visible={!!editing}
        item={editing}
        onClose={() => setEditingId(null)}
        table={table}
      />
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: SPACE.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
  check: { width: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  box: {
    width: 22,
    height: 22,
    borderRadius: RADIUS.control / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  body: { flex: 1, minWidth: 0 },
  name: { fontSize: FONT.bodyLg, fontWeight: '600' },
  struck: { textDecorationLine: 'line-through' },
  caption: { fontSize: FONT.caption },
  sum: { fontSize: FONT.bodyLg, fontWeight: '600', fontVariant: ['tabular-nums'] },
  // Wraps on a 360 dp phone: two or three buttons of 112 dp+ no longer squeeze their labels.
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  action: { flexGrow: 1, minWidth: 112 }
})
