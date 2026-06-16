import type { FinancialGoal, FinancialTransaction, Currency } from '../../types'
import { MONTH_NAMES, formatCurrency, formatDateBR } from './shared'

interface GoalHistoryModalProps {
  open: boolean
  goals: FinancialGoal[]
  transactions: FinancialTransaction[]
  accBalance: number
  currency: Currency
  onRevert: (goalId: string) => void
  onClose: () => void
}

export function GoalHistoryModal({ open, goals, transactions, accBalance, currency, onRevert, onClose }: GoalHistoryModalProps) {
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
      const effectiveBalance = deadlinePast
        ? transactions
            .filter((t) => t.date.slice(0, 7) <= dk)
            .reduce((s, t) => (t.type === 'income' ? s + t.amount : s - t.amount), 0)
        : accBalance
      const progress =
        goal.targetAmount > 0 ? Math.min(Math.max(effectiveBalance / goal.targetAmount, 0), 1) : 0

      type StatusKey = 'concluded' | 'achieved' | 'overdue' | 'urgent' | 'active'
      let status: StatusKey
      if (goal.completedAt) status = 'concluded'
      else if (effectiveBalance >= goal.targetAmount) status = 'achieved'
      else if (monthsLeft === 0) status = 'overdue'
      else if (monthsLeft <= 2) status = 'urgent'
      else status = 'active'

      return { goal, status, progress, monthsLeft }
    })
    .sort((a, b) => {
      const order: Record<string, number> = { active: 0, urgent: 1, overdue: 2, achieved: 3, concluded: 4 }
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
      return b.goal.targetYear * 12 + b.goal.targetMonth - (a.goal.targetYear * 12 + a.goal.targetMonth)
    })

  const statusCfg: Record<string, { label: string; bg: string; text: string }> = {
    concluded: { label: 'Concluído', bg: 'bg-[#22c55e]/15', text: 'text-[#4ade80]' },
    achieved: { label: 'Alcançado', bg: 'bg-[#22c55e]/15', text: 'text-[#22c55e]' },
    overdue: { label: 'Vencido', bg: 'bg-red-500/15', text: 'text-red-400' },
    urgent: { label: 'Urgente', bg: 'bg-orange-500/15', text: 'text-orange-400' },
    active: { label: 'Em andamento', bg: 'bg-[#6366f1]/15', text: 'text-[#a5b4fc]' }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-[580px] max-h-[75vh] rounded-xl border border-[#2a2d42] bg-[#13151f] shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d42] shrink-0">
          <div className="flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="2" />
            </svg>
            <h3 className="text-sm font-semibold text-[#e2e8f0]">Todos os Objetivos</h3>
            <span className="text-[10px] text-[#8892a4]">({goals.length})</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#2a2d42] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-[#1a1d2e]">
          {withStatus.map(({ goal, status, progress }) => {
            const cfg = statusCfg[status]
            return (
              <div key={goal.id} className="flex items-center gap-4 px-5 py-3 hover:bg-[#1a1c2c] transition-colors">
                <div className="relative shrink-0 w-9 h-9">
                  <svg width="36" height="36" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="13" fill="none" stroke="#2a2d42" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="13"
                      fill="none"
                      stroke={status === 'overdue' ? '#ef4444' : status === 'urgent' ? '#fb923c' : '#22c55e'}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={`${progress * 2 * Math.PI * 13} ${2 * Math.PI * 13}`}
                      transform="rotate(-90 18 18)"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-[#e2e8f0]">
                    {Math.round(progress * 100)}%
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${cfg.bg} ${cfg.text}`}>
                      {cfg.label}
                    </span>
                    <span className="text-xs font-medium text-[#e2e8f0] truncate">{goal.name}</span>
                  </div>
                  <p className="text-[10px] text-[#8892a4]">
                    Prazo: {MONTH_NAMES[goal.targetMonth - 1]} {goal.targetYear}
                    {goal.completedAt && (
                      <span className="text-[#4ade80]"> · Concluído em {formatDateBR(goal.completedAt)}</span>
                    )}
                  </p>
                  {goal.completionNote && (
                    <p className="text-[10px] text-[#8892a4]/60 mt-0.5 truncate">{goal.completionNote}</p>
                  )}
                </div>

                <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                  <p className="text-xs font-bold text-[#e2e8f0] tabular-nums">{formatCurrency(goal.targetAmount, currency)}</p>
                  <p className="text-[10px] text-[#8892a4]">{MONTH_NAMES[goal.targetMonth - 1].slice(0, 3)} {goal.targetYear}</p>
                  {status === 'concluded' && (
                    <button
                      onClick={() => onRevert(goal.id)}
                      className="flex items-center gap-1 text-[9px] font-medium text-[#8892a4] hover:text-orange-400 transition-colors"
                    >
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
    </div>
  )
}
