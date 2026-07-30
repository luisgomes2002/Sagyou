import { useState } from 'react'
import Decimal from 'decimal.js'
import type { FinancialTable, FinancialTransaction, FinancialGoal } from '../../types'
import { ConfirmDialog } from '../ConfirmDialog'
import { MONTH_NAMES, FINANCIAL_CATEGORIES, formatCurrency, D } from './shared'
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
          <div className="rounded-lg bg-[#7c3aed]/10 border border-[#7c3aed]/30 p-3">
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium text-[#7c3aed] border border-[#7c3aed]/30 hover:bg-[#7c3aed]/10 transition-colors"
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
                className="px-3 py-1.5 rounded-lg bg-[#7c3aed]/15 text-[10px] font-medium text-[#a080f0] hover:bg-[#7c3aed]/25 transition-colors"
              >
                Criar primeiro objetivo
              </button>
            </div>
          ) : visibleGoals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 rounded-xl border border-dashed border-[#20b858]/20 bg-[#20b858]/5">
              <div className="w-12 h-12 rounded-full bg-[#20b858]/10 flex items-center justify-center">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#20b858"
                  strokeWidth="1.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-[#46d478]">Todos os objetivos concluídos</p>
                <p className="text-[10px] text-[#20b858]/50 mt-0.5">
                  Nenhum objetivo ativo no momento
                </p>
              </div>
              <button
                onClick={() => setHistoryOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-[#20b858]/15 text-[10px] font-medium text-[#46d478] hover:bg-[#20b858]/25 transition-colors"
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
            <span className="ml-2 text-[#999999] font-normal">({monthTxs.length})</span>
          </p>
        </div>

        <div className="px-5 pb-3">
          <select
            value={categoryFilter ?? ''}
            onChange={(e) => onCategoryFilterChange(e.target.value || null)}
            className="w-full bg-[#2a2a2a] border border-[#3b3b3b] text-[#d4d4d4] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#7c3aed]"
          >
            <option value="">Todos</option>
            {FINANCIAL_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
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
            {monthTxs.map((tx) => {
              const isYieldSummary = tx.description.startsWith('Rendimentos ')
              return (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
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
            {monthTxs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-xs text-[#999999] italic">
                  Nenhuma transação em {MONTH_NAMES[activeMonth.month - 1]}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <GoalModal
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
