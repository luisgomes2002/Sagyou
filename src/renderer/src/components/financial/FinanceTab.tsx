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
  const [goalModal, setGoalModal] = useState<{ open: boolean; goal?: FinancialGoal }>({ open: false })
  const [deleteGoalConfirm, setDeleteGoalConfirm] = useState<{ open: boolean; goalId: string; name: string }>({
    open: false, goalId: '', name: ''
  })
  const [historyOpen, setHistoryOpen] = useState(false)

  const prevMonth = () => {
    onCategoryFilterChange(null)
    onMonthChange(activeMonth.month === 1
      ? { year: activeMonth.year - 1, month: 12 }
      : { ...activeMonth, month: activeMonth.month - 1 })
  }

  const nextMonth = () => {
    onCategoryFilterChange(null)
    onMonthChange(activeMonth.month === 12
      ? { year: activeMonth.year + 1, month: 1 }
      : { ...activeMonth, month: activeMonth.month + 1 })
  }

  const monthTxs = list.transactions
    .filter((t) => {
      const [y, m] = t.date.split('-').map(Number)
      if (y !== activeMonth.year || m !== activeMonth.month) return false
      if (categoryFilter && (t.category ?? '') !== categoryFilter) return false
      return true
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  const monthIncome = monthTxs.filter((t) => t.type === 'income').reduce((s, t) => s.plus(t.amount), new Decimal(0))
  const monthExpense = monthTxs.filter((t) => t.type === 'expense').reduce((s, t) => s.plus(t.amount), new Decimal(0))
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
      .reduce((s, t) => (t.type === 'income' ? s.plus(t.amount) : s.minus(t.amount)), new Decimal(0))
    return bal.lessThan(D(goal.targetAmount))
  })

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* Month navigator */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#2a2d42]">
          <button onClick={prevMonth} className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="text-sm font-medium text-[#e2e8f0] min-w-32 text-center">
            {MONTH_NAMES[activeMonth.month - 1]} {activeMonth.year}
          </span>
          <button onClick={nextMonth} className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button
            onClick={() => onMonthChange({ year: now.getFullYear(), month: now.getMonth() + 1 })}
            className="ml-1 text-[10px] text-[#8892a4] hover:text-[#6366f1] transition-colors"
          >
            Hoje
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3 px-5 py-4 border-b border-[#2a2d42]">
          <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-1">Entradas</p>
            <p className="text-sm font-bold text-[#4ade80] tabular-nums">{formatCurrency(monthIncome, currency)}</p>
          </div>
          <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-1">Saídas</p>
            <p className="text-sm font-bold text-red-400 tabular-nums">{formatCurrency(monthExpense, currency)}</p>
          </div>
          <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-1">Saldo do Mês</p>
            <p className={`text-sm font-bold tabular-nums ${monthBalance.gte(0) ? 'text-[#e2e8f0]' : 'text-red-400'}`}>
              {formatCurrency(monthBalance, currency)}
            </p>
          </div>
          <div className="rounded-lg bg-[#6366f1]/10 border border-[#6366f1]/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a5b4fc] mb-1">Saldo Acumulado</p>
            <p className={`text-sm font-bold tabular-nums ${accBalance.gte(0) ? 'text-[#a5b4fc]' : 'text-red-400'}`}>
              {formatCurrency(accBalance, currency)}
            </p>
          </div>
        </div>

        {/* Goals */}
        <div className="px-5 pt-4 pb-5 border-b border-[#2a2d42]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
              <p className="text-xs font-semibold text-[#e2e8f0]">Objetivos Financeiros</p>
              {list.goals.length > 0 && (
                <span className="text-[10px] text-[#8892a4]">
                  ({visibleGoals.length} ativo{visibleGoals.length !== 1 ? 's' : ''} · {list.goals.length} total)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {list.goals.length > 0 && (
                <button
                  onClick={() => setHistoryOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium text-[#8892a4] border border-[#2a2d42] hover:bg-[#1e2235] transition-colors"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Ver todos
                </button>
              )}
              <button
                onClick={() => setGoalModal({ open: true })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium text-[#6366f1] border border-[#6366f1]/30 hover:bg-[#6366f1]/10 transition-colors"
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Novo objetivo
              </button>
            </div>
          </div>

          {list.goals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 rounded-xl border border-dashed border-[#2a2d42]">
              <div className="w-12 h-12 rounded-full bg-[#1e2235] flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3a3e58" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-[#8892a4]">Nenhum objetivo criado</p>
                <p className="text-[10px] text-[#3a3e58] mt-0.5">Defina metas de economia com prazo e valor alvo</p>
              </div>
              <button
                onClick={() => setGoalModal({ open: true })}
                className="px-3 py-1.5 rounded-lg bg-[#6366f1]/15 text-[10px] font-medium text-[#a5b4fc] hover:bg-[#6366f1]/25 transition-colors"
              >
                Criar primeiro objetivo
              </button>
            </div>
          ) : visibleGoals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 rounded-xl border border-dashed border-[#22c55e]/20 bg-[#22c55e]/5">
              <div className="w-12 h-12 rounded-full bg-[#22c55e]/10 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-[#4ade80]">Todos os objetivos concluídos</p>
                <p className="text-[10px] text-[#22c55e]/50 mt-0.5">Nenhum objetivo ativo no momento</p>
              </div>
              <button
                onClick={() => setHistoryOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-[#22c55e]/15 text-[10px] font-medium text-[#4ade80] hover:bg-[#22c55e]/25 transition-colors"
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
                  onDelete={() => setDeleteGoalConfirm({ open: true, goalId: goal.id, name: goal.name })}
                  onComplete={(date, note) => onUpdateGoal(goal.id, { completedAt: date, completionNote: note })}
                  onRevert={() => onUpdateGoal(goal.id, { completedAt: undefined, completionNote: undefined })}
                />
              ))}
            </div>
          )}
        </div>

        {/* Transactions */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs font-semibold text-[#e2e8f0] mb-3">
            Transações — {MONTH_NAMES[activeMonth.month - 1]} {activeMonth.year}
            <span className="ml-2 text-[#8892a4] font-normal">({monthTxs.length})</span>
          </p>
        </div>

        <div className="px-5 pb-3">
          <select
            value={categoryFilter ?? ''}
            onChange={(e) => onCategoryFilterChange(e.target.value || null)}
            className="w-full bg-[#1e2235] border border-[#2a2d42] text-[#e2e8f0] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1]"
          >
            <option value="">Todos</option>
            {FINANCIAL_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <table className="w-full">
          <thead className="sticky top-0 bg-[#13151f] z-10">
            <tr className="border-b border-[#2a2d42]">
              <th className="pl-4 pr-2 py-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Data</th>
              <th className="py-2 pr-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Descrição</th>
              <th className="py-2 pr-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Categoria</th>
              <th className="py-2 pr-2 w-20 text-center text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Tipo</th>
              <th className="py-2 pr-2 w-32 text-right text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Valor</th>
              <th className="py-2 pr-3 w-9" />
            </tr>
          </thead>
          <tbody>
            <AddTransactionRow currency={currency} onAdd={onAddTransaction} />
            {monthTxs.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                currency={currency}
                onUpdate={(updates) => onUpdateTransaction(tx.id, updates)}
                onDelete={() => onDeleteTransaction(tx.id)}
              />
            ))}
            {monthTxs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-xs text-[#8892a4] italic">
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

      <GoalHistoryModal
        open={historyOpen}
        goals={list.goals}
        transactions={list.transactions}
        accBalance={accBalance}
        currency={currency}
        onRevert={(goalId) => onUpdateGoal(goalId, { completedAt: undefined, completionNote: undefined })}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  )
}
