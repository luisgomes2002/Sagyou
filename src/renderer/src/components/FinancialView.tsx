import { useEffect, useState } from 'react'
import type { Currency } from '../types'
import { CURRENCY_CONFIG } from '../types'
import { useKanbanStore } from '../store/kanban'
import { ConfirmDialog } from './ConfirmDialog'
import { TableSidebar } from './financial/TableSidebar'
import { ShoppingTab } from './financial/ShoppingTab'
import { FinanceTab } from './financial/FinanceTab'
import { AnalyticsTab } from './financial/AnalyticsTab'

type ActiveTab = 'shopping' | 'finance' | 'analytics'

interface TableViewState {
  activeTab: ActiveTab
  financeMonth: { year: number; month: number }
  financeCategoryFilter: string | null
  analyticsYear: string
  analyticsMonth: string
  analyticsCatView: 'expense' | 'income'
}

function makeDefaultState(): TableViewState {
  const now = new Date()
  return {
    activeTab: 'shopping',
    financeMonth: { year: now.getFullYear(), month: now.getMonth() + 1 },
    financeCategoryFilter: null,
    analyticsYear: 'all',
    analyticsMonth: 'all',
    analyticsCatView: 'expense'
  }
}

export function FinancialView() {
  const lists = useKanbanStore((s) => s.lists)
  const createList = useKanbanStore((s) => s.createList)
  const updateList = useKanbanStore((s) => s.updateList)
  const deleteList = useKanbanStore((s) => s.deleteList)
  const addItem = useKanbanStore((s) => s.addItem)
  const updateItem = useKanbanStore((s) => s.updateItem)
  const deleteItem = useKanbanStore((s) => s.deleteItem)
  const toggleItem = useKanbanStore((s) => s.toggleItem)
  const addTransaction = useKanbanStore((s) => s.addTransaction)
  const updateTransaction = useKanbanStore((s) => s.updateTransaction)
  const deleteTransaction = useKanbanStore((s) => s.deleteTransaction)
  const addFinancialGoal = useKanbanStore((s) => s.addFinancialGoal)
  const updateFinancialGoal = useKanbanStore((s) => s.updateFinancialGoal)
  const deleteFinancialGoal = useKanbanStore((s) => s.deleteFinancialGoal)

  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [tableStates, setTableStates] = useState<Record<string, TableViewState>>({})
  const [confirm, setConfirm] = useState<{
    open: boolean
    title: string
    message: string
    onConfirm: () => void
  }>({ open: false, title: '', message: '', onConfirm: () => {} })

  useEffect(() => {
    if (!activeListId && lists.length > 0) {
      setActiveListId(lists[0].id)
      return
    }
    if (activeListId && !lists.find((l) => l.id === activeListId)) {
      setActiveListId(lists[0]?.id ?? null)
    }
  }, [lists, activeListId])

  const activeList = lists.find((l) => l.id === activeListId) ?? null
  const currency: Currency = activeList?.currency ?? 'BRL'

  const ts: TableViewState = activeListId
    ? (tableStates[activeListId] ?? makeDefaultState())
    : makeDefaultState()

  const updateTs = (patch: Partial<TableViewState>) => {
    if (!activeListId) return
    setTableStates((prev) => ({
      ...prev,
      [activeListId]: { ...(prev[activeListId] ?? makeDefaultState()), ...patch }
    }))
  }

  const handleCreateList = (name: string, cur: Currency) => {
    const id = createList(name, cur)
    setActiveListId(id)
  }

  const handleDeleteList = (id: string) => {
    const list = lists.find((l) => l.id === id)
    setConfirm({
      open: true,
      title: 'Deletar tabela',
      message: `Deletar "${list?.name}"? Todos os itens e transações serão removidos.`,
      onConfirm: () => {
        deleteList(id)
        setConfirm((c) => ({ ...c, open: false }))
      }
    })
  }

  const handleDeleteItem = (itemId: string) => {
    const item = activeList?.items.find((i) => i.id === itemId)
    setConfirm({
      open: true,
      title: 'Remover item',
      message: `Remover "${item?.name}" da lista?`,
      onConfirm: () => {
        deleteItem(activeListId!, itemId)
        setConfirm((c) => ({ ...c, open: false }))
      }
    })
  }

  const handleDeleteTransaction = (txId: string) => {
    setConfirm({
      open: true,
      title: 'Remover transação',
      message: 'Remover esta transação?',
      onConfirm: () => {
        deleteTransaction(activeListId!, txId)
        setConfirm((c) => ({ ...c, open: false }))
      }
    })
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-44 shrink-0">
        <TableSidebar
          lists={lists}
          activeId={activeListId}
          onSelect={setActiveListId}
          onCreate={handleCreateList}
          onRename={updateList}
          onDelete={handleDeleteList}
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {!activeList ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-[#2a2a2a] border border-[#3b3b3b] flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#999999" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-[#d4d4d4] font-medium mb-1">Nenhuma tabela selecionada</p>
              <p className="text-sm text-[#999999]">Crie uma tabela financeira para começar</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#3b3b3b] shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-[#d4d4d4]">{activeList.name}</h2>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-[#7c3aed]/15 text-[#a080f0]">
                  {CURRENCY_CONFIG[currency].symbol} {currency}
                </span>
              </div>
              <div className="flex items-center p-0.5 rounded-lg bg-[#2a2a2a] border border-[#3b3b3b]">
                <button
                  onClick={() => updateTs({ activeTab: 'shopping' })}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    ts.activeTab === 'shopping' ? 'bg-[#3b3b3b] text-[#d4d4d4]' : 'text-[#999999] hover:text-[#d4d4d4]'
                  }`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <path d="M16 10a4 4 0 0 1-8 0" />
                  </svg>
                  Compras
                </button>
                <button
                  onClick={() => updateTs({ activeTab: 'finance' })}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    ts.activeTab === 'finance' ? 'bg-[#3b3b3b] text-[#d4d4d4]' : 'text-[#999999] hover:text-[#d4d4d4]'
                  }`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                  Finanças
                </button>
                <button
                  onClick={() => updateTs({ activeTab: 'analytics' })}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    ts.activeTab === 'analytics' ? 'bg-[#3b3b3b] text-[#d4d4d4]' : 'text-[#999999] hover:text-[#d4d4d4]'
                  }`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
                    <path d="M22 12A10 10 0 0 0 12 2v10z" />
                  </svg>
                  Análise
                </button>
              </div>
            </div>

            {ts.activeTab === 'shopping' && (
              <ShoppingTab
                list={activeList}
                onUpdate={(itemId, updates) => updateItem(activeListId!, itemId, updates)}
                onDelete={handleDeleteItem}
                onToggle={(itemId) => toggleItem(activeListId!, itemId)}
                onAdd={(data) => addItem(activeListId!, data)}
              />
            )}
            {ts.activeTab === 'finance' && (
              <FinanceTab
                list={activeList}
                activeMonth={ts.financeMonth}
                onMonthChange={(m) => updateTs({ financeMonth: m })}
                categoryFilter={ts.financeCategoryFilter}
                onCategoryFilterChange={(c) => updateTs({ financeCategoryFilter: c })}
                onAddTransaction={(data) => addTransaction(activeListId!, data)}
                onUpdateTransaction={(txId, updates) => updateTransaction(activeListId!, txId, updates)}
                onDeleteTransaction={handleDeleteTransaction}
                onAddGoal={(data) => addFinancialGoal(activeListId!, data)}
                onUpdateGoal={(goalId, updates) => updateFinancialGoal(activeListId!, goalId, updates)}
                onDeleteGoal={(goalId) => deleteFinancialGoal(activeListId!, goalId)}
              />
            )}
            {ts.activeTab === 'analytics' && (
              <AnalyticsTab
                list={activeList}
                selectedYear={ts.analyticsYear}
                onYearChange={(y) => updateTs({ analyticsYear: y, analyticsMonth: 'all' })}
                selectedMonth={ts.analyticsMonth}
                onMonthChange={(m) => updateTs({ analyticsMonth: m })}
                catView={ts.analyticsCatView}
                onCatViewChange={(v) => updateTs({ analyticsCatView: v })}
              />
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel="Deletar"
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm((c) => ({ ...c, open: false }))}
      />
    </div>
  )
}
