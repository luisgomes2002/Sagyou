import { todayLocalISO } from '@sagyou/core/dates'
import type { FinancialTable } from '@sagyou/core/types'
import { Wallet } from 'lucide-react-native'
import { useState } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import { Skeleton } from '../components/Skeleton'
import { Button, EmptyState, Screen } from '../components/ui'
import { navigationRef } from '../navigation'
import { awaitingFirstSync, useApp } from '../store/app'
import { lastTablePref, tablesOfProfile } from '../store/finance'
import { DebtsTab } from './finance/DebtsTab'
import { FinanceTabs } from './finance/FinanceTabs'
import { FinanceTop } from './finance/FinanceTop'
import { GoalsTab } from './finance/GoalsTab'
import { ShoppingTab } from './finance/ShoppingTab'
import { SummaryTab } from './finance/SummaryTab'
import { TableSheet } from './finance/TableSheet'
import { TransactionsTab } from './finance/TransactionsTab'
import { YieldsTab } from './finance/YieldsTab'
import type { FinanceTab } from './finance/tabs'

export const NO_TABLE_TEXT = 'Nenhuma tabela neste perfil.'
export const PICK_TABLE_TEXT = 'Escolha uma tabela para ver esta área.'

/** A row of the list opens its details: the `Lancamento` screen of the root stack. */
function openTransaction(tableId: string, txId: string): void {
  if (navigationRef.isReady()) navigationRef.navigate('Lancamento', { tableId, txId })
}

/**
 * Finanças: the top (table, month), the six areas as tabs and the chosen one. The table is
 * remembered per profile (`finance.lastTable.<perfil>`, which also accepts `'all'`, the
 * Consolidado); the month starts at the current one and the tab at Lançamentos, neither remembered.
 */
export function FinanceScreen({
  today = todayLocalISO(),
  initialTab = 'lancamentos',
  onOpenTransaction = openTransaction
}: {
  today?: string
  /** Only tests start elsewhere: in the app the tab always opens on Lançamentos. */
  initialTab?: FinanceTab
  /** Tests pass their own; in the app it goes to the root stack. */
  onOpenTransaction?: (tableId: string, txId: string) => void
}): React.JSX.Element {
  const app = useApp((s) => s.state)
  const profileId = useApp((s) => s.profileId)
  const services = useApp((s) => s.services)
  const readOnly = useApp((s) => s.readOnly)
  const waiting = useApp((s) => awaitingFirstSync(s.status))
  const tables = tablesOfProfile(app, profileId)
  const [chosen, setChosen] = useState<string | null>(
    () => services?.repo.readPref(lastTablePref(profileId)) ?? null
  )
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [tab, setTab] = useState<FinanceTab>(initialTab)
  const [creating, setCreating] = useState(false)

  const choose = (id: string): void => {
    setChosen(id)
    services?.repo.writePref(lastTablePref(profileId), id)
  }

  if (tables.length === 0)
    return (
      <Screen>
        {waiting ? (
          <Skeleton />
        ) : (
          <>
            <EmptyState icon={Wallet} text={NO_TABLE_TEXT} />
            <Button
              variant="primary"
              label="Nova tabela"
              onPress={() => setCreating(true)}
              disabled={readOnly}
            />
            <TableSheet visible={creating} onClose={() => setCreating(false)} onCreated={choose} />
          </>
        )}
      </Screen>
    )

  const all = chosen === 'all'
  const table = all ? undefined : (tables.find((t) => t.id === chosen) ?? tables[0])

  return (
    <ScrollView contentContainerStyle={styles.bottomRoom}>
      <Screen>
        <FinanceTop
          tableId={table?.id ?? 'all'}
          onTable={choose}
          month={month}
          onMonth={setMonth}
          today={today}
        />
        <FinanceTabs value={tab} onChange={setTab} />
        <TabContent
          table={table}
          tables={tables}
          tab={tab}
          month={month}
          today={today}
          onOpenTransaction={onOpenTransaction}
        />
      </Screen>
    </ScrollView>
  )
}

/** Where each tab's own screen goes. */
function TabContent({
  table,
  tables,
  tab,
  month,
  today,
  onOpenTransaction
}: {
  table: FinancialTable | undefined
  tables: FinancialTable[]
  tab: FinanceTab
  month: string
  today: string
  onOpenTransaction: (tableId: string, txId: string) => void
}): React.JSX.Element {
  if (tab === 'lancamentos')
    return (
      <TransactionsTab
        table={table}
        tables={tables}
        month={month}
        today={today}
        onOpen={onOpenTransaction}
      />
    )
  if (tab === 'resumo')
    return <SummaryTab table={table} tables={tables} month={month} today={today} />
  // The Consolidado is read-only: the table areas ask for a table.
  if (!table) return <EmptyState icon={Wallet} text={PICK_TABLE_TEXT} />
  if (tab === 'dividas') return <DebtsTab table={table} today={today} />
  if (tab === 'metas') return <GoalsTab table={table} month={month} today={today} />
  if (tab === 'compras') return <ShoppingTab table={table} today={today} />
  return <YieldsTab table={table} month={month} today={today} />
}

const styles = StyleSheet.create({
  bottomRoom: { paddingBottom: 96 }
})
