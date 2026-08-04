import Decimal from 'decimal.js'
import type { FinancialGoal, FinancialTransaction, Currency } from '../../types'
import { MONTH_NAMES, formatCurrency, formatDateBR, D } from './shared'
import { ModalBase } from '../ModalBase'

interface GoalHistoryModalProps {
  open: boolean
  goals: FinancialGoal[]
  transactions: FinancialTransaction[]
  accBalance: Decimal
  currency: Currency
  onRevert: (goalId: string) => void
  onClose: () => void
}

export function GoalHistoryModal({
  open,
  goals,
  transactions,
  accBalance,
  currency,
  onRevert,
  onClose
}: GoalHistoryModalProps) {
  if (!open || goals.length === 0) return null
  const now = new Date()

  const withStatus = goals
    .map((goal) => {
      const monthsLeft = Math.max(
        (goal.targetYear - now.getFullYear()) * 12 + (goal.targetMonth - (now.getMonth() + 1)),
        0
      )
      const deadlinePast =
        monthsLeft === 0 &&
        (goal.targetYear < now.getFullYear() ||
          (goal.targetYear === now.getFullYear() && goal.targetMonth < now.getMonth() + 1))
      const dk = `${goal.targetYear}-${String(goal.targetMonth).padStart(2, '0')}`
      const target = D(goal.targetAmount)
      const effectiveBalance = deadlinePast
        ? transactions
            .filter((t) => t.date.slice(0, 7) <= dk)
            .reduce(
              (s, t) => (t.type === 'income' ? s.plus(t.amount) : s.minus(t.amount)),
              new Decimal(0)
            )
        : accBalance
      const progress = target.greaterThan(0)
        ? Math.min(Math.max(effectiveBalance.div(target).toNumber(), 0), 1)
        : 0

      type StatusKey = 'concluded' | 'achieved' | 'overdue' | 'urgent' | 'active'
      let status: StatusKey
      if (goal.completedAt) status = 'concluded'
      else if (effectiveBalance.greaterThanOrEqualTo(target)) status = 'achieved'
      else if (monthsLeft === 0) status = 'overdue'
      else if (monthsLeft <= 2) status = 'urgent'
      else status = 'active'

      return { goal, status, progress, monthsLeft }
    })
    .sort((a, b) => {
      const order: Record<string, number> = {
        active: 0,
        urgent: 1,
        overdue: 2,
        achieved: 3,
        concluded: 4
      }
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
      return (
        b.goal.targetYear * 12 + b.goal.targetMonth - (a.goal.targetYear * 12 + a.goal.targetMonth)
      )
    })

  const statusCfg: Record<string, { label: string; bg: string; text: string }> = {
    concluded: { label: 'Concluído', bg: 'bg-[#4f9f68]/12', text: 'text-[#69b780]' },
    achieved: { label: 'Alcançado', bg: 'bg-[#4f9f68]/12', text: 'text-[#69b780]' },
    overdue: { label: 'Vencido', bg: 'bg-[#e04040]/15', text: 'text-[#e04040]' },
    urgent: { label: 'Urgente', bg: 'bg-[#f08a34]/15', text: 'text-[#f08a34]' },
    active: { label: 'Em andamento', bg: 'bg-[#7c3aed]/15', text: 'text-[#a080f0]' }
  }

  return (
    <ModalBase open={true} onClose={onClose}>
      <div className="relative z-10 w-[580px] max-h-[75vh] rounded-xl border border-[#3b3b3b] bg-[#232323] shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3b3b3b] shrink-0">
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
            <h3 className="text-sm font-semibold text-[#d4d4d4]">Todos os Objetivos</h3>
            <span className="text-[10px] text-[#999999]">({goals.length})</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#3b3b3b] transition-colors"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#3b3b3b]">
          {withStatus.map(({ goal, status, progress }) => {
            const cfg = statusCfg[status]
            return (
              <div
                key={goal.id}
                className="flex items-center gap-4 px-5 py-3 hover:bg-[#2a2a2a] transition-colors"
              >
                <div className="relative shrink-0 w-9 h-9">
                  <svg width="36" height="36" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="13" fill="none" stroke="#3b3b3b" strokeWidth="3" />
                    <circle
                      cx="18"
                      cy="18"
                      r="13"
                      fill="none"
                      stroke={
                        status === 'overdue'
                          ? '#e04040'
                          : status === 'urgent'
                            ? '#f08a34'
                            : '#4f9f68'
                      }
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={`${progress * 2 * Math.PI * 13} ${2 * Math.PI * 13}`}
                      transform="rotate(-90 18 18)"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-[#d4d4d4]">
                    {Math.round(progress * 100)}%
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span
                      className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${cfg.bg} ${cfg.text}`}
                    >
                      {cfg.label}
                    </span>
                    <span className="text-xs font-medium text-[#d4d4d4] truncate">{goal.name}</span>
                  </div>
                  <p className="text-[10px] text-[#999999]">
                    Prazo: {MONTH_NAMES[goal.targetMonth - 1]} {goal.targetYear}
                    {goal.completedAt && (
                      <span className="text-[#69b780]">
                        {' '}
                        · Concluído em {formatDateBR(goal.completedAt)}
                      </span>
                    )}
                  </p>
                  {goal.completionNote && (
                    <p className="text-[10px] text-[#999999]/60 mt-0.5 truncate">
                      {goal.completionNote}
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                  <p className="text-xs font-bold text-[#d4d4d4] tabular-nums">
                    {formatCurrency(goal.targetAmount, currency)}
                  </p>
                  <p className="text-[10px] text-[#999999]">
                    {MONTH_NAMES[goal.targetMonth - 1].slice(0, 3)} {goal.targetYear}
                  </p>
                  {status === 'concluded' && (
                    <button
                      onClick={() => onRevert(goal.id)}
                      className="flex items-center gap-1 text-[9px] font-medium text-[#999999] hover:text-[#f08a34] transition-colors"
                    >
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                        <path d="M3 3v5h5" />
                      </svg>
                      Reverter
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </ModalBase>
  )
}
