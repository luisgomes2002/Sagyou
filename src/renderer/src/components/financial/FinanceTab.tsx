import { useState } from 'react'
import Decimal from 'decimal.js'
import type { FinancialTable, FinancialTransaction, FinancialGoal } from '../../types'
import { ConfirmDialog } from '../ConfirmDialog'
import { useKanbanStore } from '../../store/kanban'
import { MONTH_NAMES, financialCategories, formatCurrency, D } from './shared'
import { GoalModal, FinancialGoalCard } from './FinancialGoalCard'
import { GoalHistoryModal } from './GoalHistoryModal'
import { AddTransactionRow, TransactionRow } from './TransactionRow'

interface FinanceTabProps {
  list: FinancialTable
  allLists: FinancialTable[]
  activeMonth: { year: number; month: number }
  onMonthChange: (month: { year: number; month: number }) => void
  categoryFilter: string | null
  onCategoryFilterChange: (cat: string | null) => void
  onAddTransaction: (data: Omit<FinancialTransaction, 'id'>) => void
  onUpdateTransaction: (txId: string, updates: Partial<Omit<FinancialTransaction, 'id'>>) => void
  onDeleteTransaction: (txId: string) => void
  onAddGoal: (data: Omit<FinancialGoal, 'id'>) => void
  onUpdateGoal: (goalId: string, updates: Partial<Omit<FinancialGoal, 'id'>>) => void
  onDeleteGoal: (goalId: string) => void
}

export function FinanceTab({
  list,
  allLists,
  activeMonth,
  onMonthChange,
  categoryFilter,
  onCategoryFilterChange,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  onAddGoal,
  onUpdateGoal,
  onDeleteGoal
}: FinanceTabProps) {
  const currency = list.currency
  const profiles = useKanbanStore((state) => state.financialProfiles)
  const profileId = useKanbanStore((state) => state.activeFinancialProfileId)
  const addFinancialCategory = useKanbanStore((state) => state.addFinancialCategory)
  const removeFinancialCategory = useKanbanStore((state) => state.removeFinancialCategory)
  const profile = profiles.find((item) => item.id === profileId)
  const categories = financialCategories(profile, allLists)
  const files = useKanbanStore((state) => state.files)
  const existingFileIds = new Set(files.map((file) => file.id))
  const [newCategory, setNewCategory] = useState('')
  const [showCategories, setShowCategories] = useState(false)
  const [receiptFilter, setReceiptFilter] = useState<'all' | 'missing' | 'attached'>('all')
  const saveCategory = (): void => {
    const name = newCategory.trim()
    if (!name || categories.some((category) => category.toLowerCase() === name.toLowerCase()))
      return
    addFinancialCategory(profileId, name)
    setNewCategory('')
  }
  const now = new Date()
  const [goalModal, setGoalModal] = useState<{ open: boolean; goal?: FinancialGoal }>({
    open: false
  })
  const [deleteGoalConfirm, setDeleteGoalConfirm] = useState<{
    open: boolean
    goalId: string
    name: string
  }>({
    open: false,
    goalId: '',
    name: ''
  })
  const [historyOpen, setHistoryOpen] = useState(false)
  const [unlinkConfirm, setUnlinkConfirm] = useState<{
    open: boolean
    txId: string
    desc: string
  }>({ open: false, txId: '', desc: '' })

  const handleUnlinkRequest = (txId: string, desc: string) => {
    setUnlinkConfirm({ open: true, txId, desc })
  }

  const confirmUnlink = () => {
    onUpdateTransaction(unlinkConfirm.txId, { linkedTransactionId: undefined })
    setUnlinkConfirm((s) => ({ ...s, open: false }))
  }

  const prevMonth = () => {
    onCategoryFilterChange(null)
    onMonthChange(
      activeMonth.month === 1
        ? { year: activeMonth.year - 1, month: 12 }
        : { ...activeMonth, month: activeMonth.month - 1 }
    )
  }

  const nextMonth = () => {
    onCategoryFilterChange(null)
    onMonthChange(
      activeMonth.month === 12
        ? { year: activeMonth.year + 1, month: 1 }
        : { ...activeMonth, month: activeMonth.month + 1 }
    )
  }

  const allMonthTxs = list.transactions
    .filter((t) => {
      const [y, m] = t.date.split('-').map(Number)
      return y === activeMonth.year && m === activeMonth.month
    })
    .sort((a, b) => b.date.localeCompare(a.date))
  const monthTxs = categoryFilter
    ? allMonthTxs.filter((t) => (t.category ?? '') === categoryFilter)
    : allMonthTxs
  const receiptCount = (tx: FinancialTransaction): number =>
    tx.receiptFileIds?.filter((id) => existingFileIds.has(id)).length ?? 0
  const receiptEligibleTxs = monthTxs.filter((tx) => !tx.description.startsWith('Rendimentos '))
  const missingReceipts = receiptEligibleTxs.filter((tx) => receiptCount(tx) === 0).length
  const visibleTxs = monthTxs.filter(
    (tx) =>
      receiptFilter === 'all' ||
      (!tx.description.startsWith('Rendimentos ') &&
        (receiptFilter === 'missing' ? receiptCount(tx) === 0 : receiptCount(tx) > 0))
  )

  const monthIncome = monthTxs
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s.plus(t.amount), new Decimal(0))
  const monthExpense = monthTxs
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s.plus(t.amount), new Decimal(0))
  const monthBalance = monthIncome.minus(monthExpense)

  const accBalance = list.transactions.reduce(
    (s, t) => (t.type === 'income' ? s.plus(t.amount) : s.minus(t.amount)),
    new Decimal(0)
  )

  const visibleGoals = list.goals.filter((goal) => {
    const deadlineBeforeActiveMonth =
      goal.targetYear < activeMonth.year ||
      (goal.targetYear === activeMonth.year && goal.targetMonth < activeMonth.month)
    if (!deadlineBeforeActiveMonth) return true
    if (goal.completedAt) return false
    const dk = `${goal.targetYear}-${String(goal.targetMonth).padStart(2, '0')}`
    const bal = list.transactions
      .filter((t) => t.date.slice(0, 7) <= dk)
      .reduce(
        (s, t) => (t.type === 'income' ? s.plus(t.amount) : s.minus(t.amount)),
        new Decimal(0)
      )
    return bal.lessThan(D(goal.targetAmount))
  })

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* Month navigator */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#3b3b3b]">
          <button
            onClick={prevMonth}
            className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="text-sm font-medium text-[#d4d4d4] min-w-32 text-center">
            {MONTH_NAMES[activeMonth.month - 1]} {activeMonth.year}
          </span>
          <button
            onClick={nextMonth}
            className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button
            onClick={() => onMonthChange({ year: now.getFullYear(), month: now.getMonth() + 1 })}
            className="ml-1 text-[10px] text-[#999999] hover:text-[#7c3aed] transition-colors"
          >
            Hoje
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3 px-5 py-4 border-b border-[#3b3b3b]">
          <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-1">
              Entradas
            </p>
            <p className="text-sm font-bold text-[#46d478] tabular-nums">
              {formatCurrency(monthIncome, currency)}
            </p>
          </div>
          <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-1">
              Saídas
            </p>
            <p className="text-sm font-bold text-[#e04040] tabular-nums">
              {formatCurrency(monthExpense, currency)}
            </p>
          </div>
          <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-1">
              Saldo do Mês
            </p>
            <p
              className={`text-sm font-bold tabular-nums ${monthBalance.gte(0) ? 'text-[#d4d4d4]' : 'text-[#e04040]'}`}
            >
              {formatCurrency(monthBalance, currency)}
            </p>
          </div>
          <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a080f0] mb-1">
              Saldo Acumulado
            </p>
            <p
              className={`text-sm font-bold tabular-nums ${accBalance.gte(0) ? 'text-[#a080f0]' : 'text-[#e04040]'}`}
            >
              {formatCurrency(accBalance, currency)}
            </p>
          </div>
        </div>

        {/* Goals */}
        <div className="px-5 pt-4 pb-5 border-b border-[#3b3b3b]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#7c3aed"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
              <p className="text-xs font-semibold text-[#d4d4d4]">Objetivos Financeiros</p>
              {list.goals.length > 0 && (
                <span className="text-[10px] text-[#999999]">
                  ({visibleGoals.length} ativo{visibleGoals.length !== 1 ? 's' : ''} ·{' '}
                  {list.goals.length} total)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {list.goals.length > 0 && (
                <button
                  onClick={() => setHistoryOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium text-[#999999] border border-[#3b3b3b] hover:bg-[#2a2a2a] transition-colors"
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Ver todos
                </button>
              )}
              <button
                onClick={() => setGoalModal({ open: true })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium text-[#7c3aed] border border-[#3b3b3b] hover:bg-[#2a2a2a] transition-colors"
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Novo objetivo
              </button>
            </div>
          </div>

          {list.goals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 rounded-xl border border-dashed border-[#3b3b3b]">
              <div className="w-12 h-12 rounded-full bg-[#2a2a2a] flex items-center justify-center">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#555555"
                  strokeWidth="1.5"
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-[#999999]">Nenhum objetivo criado</p>
                <p className="text-[10px] text-[#555555] mt-0.5">
                  Defina metas de economia com prazo e valor alvo
                </p>
              </div>
              <button
                onClick={() => setGoalModal({ open: true })}
                className="px-3 py-1.5 rounded-lg bg-[#3b3b3b] text-[10px] font-medium text-[#a080f0] hover:bg-[#4a4a4a] transition-colors"
              >
                Criar primeiro objetivo
              </button>
            </div>
          ) : visibleGoals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 rounded-xl border border-dashed border-[#3b3b3b] bg-[#2a2a2a]">
              <div className="w-12 h-12 rounded-full bg-[#2a2a2a] flex items-center justify-center">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#4f9f68"
                  strokeWidth="1.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-[#69b780]">Todos os objetivos concluídos</p>
                <p className="text-[10px] text-[#69b780] mt-0.5">
                  Nenhum objetivo ativo no momento
                </p>
              </div>
              <button
                onClick={() => setHistoryOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-[#3b3b3b] text-[10px] font-medium text-[#69b780] hover:bg-[#4a4a4a] transition-colors"
              >
                Ver histórico
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {visibleGoals.map((goal) => (
                <FinancialGoalCard
                  key={goal.id}
                  goal={goal}
                  transactions={list.transactions}
                  accBalance={accBalance}
                  currency={currency}
                  onEdit={() => setGoalModal({ open: true, goal })}
                  onDelete={() =>
                    setDeleteGoalConfirm({ open: true, goalId: goal.id, name: goal.name })
                  }
                  onComplete={(date, note) =>
                    onUpdateGoal(goal.id, { completedAt: date, completionNote: note })
                  }
                  onRevert={() =>
                    onUpdateGoal(goal.id, { completedAt: undefined, completionNote: undefined })
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* Transactions */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs font-semibold text-[#d4d4d4] mb-3">
            Transações — {MONTH_NAMES[activeMonth.month - 1]} {activeMonth.year}
            <span className="ml-2 text-[#999999] font-normal">
              (
              {receiptFilter === 'all'
                ? monthTxs.length
                : `${visibleTxs.length} de ${monthTxs.length}`}
              )
            </span>
          </p>
        </div>

        <div className="px-5 pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#999999]">Filtrar por etiqueta</span>
            <button
              type="button"
              onClick={() => setShowCategories((open) => !open)}
              className="text-xs text-[#a080f0] hover:text-white"
            >
              {showCategories ? 'Fechar etiquetas' : '+ Gerenciar etiquetas'}
            </button>
          </div>
          {showCategories && (
            <div className="mb-3 rounded-lg border border-[#3b3b3b] bg-[#232323] p-3">
              <p className="mb-2 text-xs text-[#d4d4d4]">
                Etiquetas de {profile?.name ?? 'este perfil'}
              </p>
              <div className="flex gap-2">
                <input
                  aria-label="Nova etiqueta financeira"
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') saveCategory()
                  }}
                  placeholder="Ex.: Murasaki Japão"
                  className="min-w-0 flex-1 rounded border border-[#3b3b3b] bg-[#1b1b1b] px-2 py-1.5 text-xs text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed]"
                />
                <button
                  type="button"
                  onClick={saveCategory}
                  disabled={
                    !newCategory.trim() ||
                    categories.some(
                      (category) => category.toLowerCase() === newCategory.trim().toLowerCase()
                    )
                  }
                  className="rounded bg-[#7c3aed] px-3 py-1.5 text-xs text-white disabled:opacity-50"
                >
                  Adicionar
                </button>
              </div>
              {(profile?.customCategories?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile?.customCategories?.map((category) => (
                    <span
                      key={category}
                      className="inline-flex items-center gap-1 rounded border border-[#3b3b3b] px-2 py-1 text-xs text-[#d4d4d4]"
                    >
                      {category}
                      <button
                        type="button"
                        aria-label={`Remover etiqueta ${category}`}
                        title="Remove da lista; lançamentos existentes permanecem"
                        onClick={() => removeFinancialCategory(profileId, category)}
                        className="text-[#999999] hover:text-[#e04040]"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          <select
            value={categoryFilter ?? ''}
            onChange={(e) => onCategoryFilterChange(e.target.value || null)}
            className="w-full bg-[#2a2a2a] border border-[#3b3b3b] text-[#d4d4d4] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#7c3aed]"
          >
            <option value="">Todos</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[#999999]">Comprovantes:</span>
            {(
              [
                ['all', 'Todos'],
                ['missing', `Sem comprovante (${missingReceipts})`],
                ['attached', `Com comprovante (${receiptEligibleTxs.length - missingReceipts})`]
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setReceiptFilter(value)}
                className={`rounded border border-[#3b3b3b] px-2.5 py-1 transition-colors ${receiptFilter === value ? 'bg-[#3b3b3b] text-[#d4d4d4]' : 'bg-[#2a2a2a] text-[#999999] hover:bg-[#3b3b3b] hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {receiptFilter !== 'all' && (
            <p className="mt-2 text-[11px] text-[#999999]">
              Os saldos acima continuam considerando todas as transações do mês.
            </p>
          )}
        </div>

        <table className="w-full">
          <thead className="sticky top-0 bg-[#232323] z-10">
            <tr className="border-b border-[#3b3b3b]">
              <th className="pl-4 pr-2 py-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                Data
              </th>
              <th className="py-2 pr-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                Descrição
              </th>
              <th className="py-2 pr-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                Categoria
              </th>
              <th className="py-2 pr-2 w-20 text-center text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                Tipo
              </th>
              <th className="py-2 pr-2 w-32 text-right text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                Valor
              </th>
              <th className="py-2 pr-3 w-9" />
            </tr>
          </thead>
          <tbody>
            <AddTransactionRow
              currency={currency}
              onAdd={(data) => onAddTransaction({ ...data, source: data.source ?? list.provider })}
            />
            {visibleTxs.map((tx) => {
              const isYieldSummary = tx.description.startsWith('Rendimentos ')
              return (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  receiptCount={receiptCount(tx)}
                  currency={currency}
                  allLists={allLists}
                  onUpdate={(updates) => onUpdateTransaction(tx.id, updates)}
                  onDelete={isYieldSummary ? undefined : () => onDeleteTransaction(tx.id)}
                  readOnly={isYieldSummary || undefined}
                  onUnlink={
                    tx.linkedTransactionId
                      ? () => handleUnlinkRequest(tx.id, tx.description)
                      : undefined
                  }
                />
              )
            })}
            {visibleTxs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-xs text-[#999999] italic">
                  {monthTxs.length === 0
                    ? `Nenhuma transação em ${MONTH_NAMES[activeMonth.month - 1]}`
                    : 'Nenhuma transação corresponde ao filtro de comprovantes'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <GoalModal
        currency={currency}
        open={goalModal.open}
        goal={goalModal.goal}
        onSave={(data) => {
          if (goalModal.goal) onUpdateGoal(goalModal.goal.id, data)
          else onAddGoal(data)
        }}
        onClose={() => setGoalModal({ open: false })}
      />

      <ConfirmDialog
        open={deleteGoalConfirm.open}
        title="Deletar objetivo"
        message={`Deletar o objetivo "${deleteGoalConfirm.name}"?`}
        confirmLabel="Deletar"
        onConfirm={() => {
          onDeleteGoal(deleteGoalConfirm.goalId)
          setDeleteGoalConfirm((s) => ({ ...s, open: false }))
        }}
        onCancel={() => setDeleteGoalConfirm((s) => ({ ...s, open: false }))}
      />

      <ConfirmDialog
        open={unlinkConfirm.open}
        title="Desvincular transação"
        message={`Desvincular "${unlinkConfirm.desc}"? A transação relacionada não será afetada.`}
        confirmLabel="Desvincular"
        onConfirm={confirmUnlink}
        onCancel={() => setUnlinkConfirm((s) => ({ ...s, open: false }))}
      />

      <GoalHistoryModal
        open={historyOpen}
        goals={list.goals}
        transactions={list.transactions}
        accBalance={accBalance}
        currency={currency}
        onRevert={(goalId) =>
          onUpdateGoal(goalId, { completedAt: undefined, completionNote: undefined })
        }
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  )
}
