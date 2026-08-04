import { useEffect, useState } from 'react'
import Decimal from 'decimal.js'
import type { FinancialGoal, FinancialTransaction, Currency } from '../../types'
import { MONTH_NAMES, formatCurrency, todayISO, formatDateBR, D, parseDecimalInput } from './shared'
import { ModalBase } from '../ModalBase'

// ── GoalModal ─────────────────────────────────────────────────────────────────

interface GoalModalProps {
  open: boolean
  goal?: FinancialGoal
  onSave: (data: Omit<FinancialGoal, 'id'>) => void
  onClose: () => void
}

export function GoalModal({ open, goal, onSave, onClose }: GoalModalProps) {
  const now = new Date()
  const [name, setName] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [targetMonth, setTargetMonth] = useState(now.getMonth() + 1)
  const [targetYear, setTargetYear] = useState(now.getFullYear())

  useEffect(() => {
    if (open) {
      setName(goal?.name ?? '')
      setTargetAmount(goal?.targetAmount ?? '')
      setTargetMonth(goal?.targetMonth ?? now.getMonth() + 1)
      setTargetYear(goal?.targetYear ?? now.getFullYear())
    }
  }, [open])

  if (!open) return null

  const amount = parseDecimalInput(targetAmount)

  const valid =
    name.trim().length > 0 &&
    amount !== null &&
    amount.greaterThan(0) &&
    targetYear >= now.getFullYear()

  const handleSubmit = () => {
    if (!valid || amount === null) return
    onSave({
      name: name.trim(),
      targetAmount: amount.toDecimalPlaces(2).toString(),
      targetMonth,
      targetYear
    })
    onClose()
  }

  return (
    <ModalBase open={open} onClose={onClose}>
      <div className="relative z-10 w-80 rounded-xl border border-[#3b3b3b] bg-[#232323] shadow-2xl p-5">
        <h3 className="text-sm font-semibold text-[#d4d4d4] mb-4">
          {goal ? 'Editar meta' : 'Nova meta financeira'}
        </h3>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] block mb-1">
              Nome
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="ex: Aluguel agosto"
              className="w-full px-3 py-2 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] block mb-1">
              Valor necessário
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="0"
              className="w-full px-3 py-2 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] block mb-1">
              Prazo
            </label>
            <div className="flex gap-2">
              <select
                value={targetMonth}
                onChange={(e) => setTargetMonth(Number(e.target.value))}
                className="flex-1 px-2 py-2 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors"
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={i + 1} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={targetYear}
                min={now.getFullYear()}
                onChange={(e) => setTargetYear(Number(e.target.value))}
                className="w-20 px-2 py-2 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors text-center"
              />
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            onClick={handleSubmit}
            disabled={!valid}
            className="flex-1 py-2 rounded-lg bg-[#7c3aed] text-sm text-white font-medium hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {goal ? 'Salvar' : 'Criar'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#3b3b3b] text-sm text-[#999999] hover:bg-[#2a2a2a] transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </ModalBase>
  )
}

// ── CompleteGoalModal ─────────────────────────────────────────────────────────

interface CompleteGoalModalProps {
  open: boolean
  goalName: string
  onConfirm: (date: string, note?: string) => void
  onClose: () => void
}

export function CompleteGoalModal({ open, goalName, onConfirm, onClose }: CompleteGoalModalProps) {
  const [date, setDate] = useState(todayISO)
  const [dateEditing, setDateEditing] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (open) {
      setDate(todayISO())
      setNote('')
      setDateEditing(false)
    }
  }, [open])

  if (!open) return null

  const handleSubmit = () => {
    onConfirm(date, note.trim() || undefined)
    onClose()
  }

  return (
    <ModalBase open={open} onClose={onClose}>
      <div className="relative z-10 w-80 rounded-xl border border-[#3b3b3b] bg-[#232323] shadow-2xl p-5">
        <h3 className="text-sm font-semibold text-[#d4d4d4] mb-1">Finalizar objetivo</h3>
        <p className="text-[11px] text-[#999999] mb-4 truncate">{goalName}</p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] block mb-1">
              Data de conclusão
            </label>
            {dateEditing ? (
              <input
                autoFocus
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                onBlur={() => setDateEditing(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') setDateEditing(false)
                }}
                className="w-full px-3 py-2 rounded-lg bg-[#1b1b1b] border border-[#7c3aed] text-sm text-[#d4d4d4] focus:outline-none"
              />
            ) : (
              <button
                onClick={() => setDateEditing(true)}
                className="w-full text-left px-3 py-2 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] hover:border-[#7c3aed] transition-colors"
              >
                {formatDateBR(date)}
              </button>
            )}
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] block mb-1">
              Descrição (opcional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) handleSubmit()
              }}
              placeholder="Ex: meta atingida antes do prazo"
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors resize-none"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            onClick={handleSubmit}
            className="flex-1 py-2 rounded-lg bg-[#20b858] text-sm text-white font-medium hover:bg-[#2e7a48] transition-colors"
          >
            Finalizar
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#3b3b3b] text-sm text-[#999999] hover:bg-[#2a2a2a] transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </ModalBase>
  )
}

// ── FinancialGoalCard ─────────────────────────────────────────────────────────

interface FinancialGoalCardProps {
  goal: FinancialGoal
  transactions: FinancialTransaction[]
  accBalance: Decimal
  currency: Currency
  onEdit: () => void
  onDelete: () => void
  onComplete: (date: string, note?: string) => void
  onRevert: () => void
}

export function FinancialGoalCard({
  goal,
  transactions,
  accBalance,
  currency,
  onEdit,
  onDelete,
  onComplete,
  onRevert
}: FinancialGoalCardProps) {
  const now = new Date()
  const [completeModalOpen, setCompleteModalOpen] = useState(false)

  const monthsLeft = Math.max(
    (goal.targetYear - now.getFullYear()) * 12 + (goal.targetMonth - (now.getMonth() + 1)),
    0
  )

  const deadlinePast =
    monthsLeft === 0 &&
    (goal.targetYear < now.getFullYear() ||
      (goal.targetYear === now.getFullYear() && goal.targetMonth < now.getMonth() + 1))
  const deadlineKey = `${goal.targetYear}-${String(goal.targetMonth).padStart(2, '0')}`
  const target = D(goal.targetAmount)
  const effectiveBalance = deadlinePast
    ? transactions
        .filter((t) => t.date.slice(0, 7) <= deadlineKey)
        .reduce(
          (s, t) => (t.type === 'income' ? s.plus(t.amount) : s.minus(t.amount)),
          new Decimal(0)
        )
    : accBalance

  const manuallyCompleted = !!goal.completedAt
  const balanceAchieved = effectiveBalance.greaterThanOrEqualTo(target)
  const achieved = manuallyCompleted || balanceAchieved
  const progress = manuallyCompleted
    ? 1
    : target.greaterThan(0)
      ? Math.min(Math.max(effectiveBalance.div(target).toNumber(), 0), 1)
      : 0
  const percent = Math.round(progress * 100)
  const savedAmount = Decimal.min(Decimal.max(effectiveBalance, 0), target)
  const remaining = achieved ? new Decimal(0) : Decimal.max(target.minus(effectiveBalance), 0)

  const isOverdue = !achieved && monthsLeft === 0
  const isUrgent = !achieved && monthsLeft > 0 && monthsLeft <= 2
  const monthlyNeeded = monthsLeft > 0 && !achieved ? remaining.div(monthsLeft) : new Decimal(0)

  const R = 30
  const circ = 2 * Math.PI * R
  const ringColor = achieved ? '#4f9f68' : isOverdue ? '#e04040' : isUrgent ? '#f08a34' : '#7c3aed'

  return (
    <div
      className={`rounded-xl border p-4 group transition-all duration-200 ${
        achieved
          ? 'border-[#4f9f68]/20 bg-[#4f9f68]/5'
          : isOverdue
            ? 'border-[#e04040]/25 bg-[#e04040]/5'
            : 'border-[#3b3b3b] bg-[#2a2a2a] hover:border-[#555555]'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="relative shrink-0 w-[76px] h-[76px]">
          <svg width="76" height="76" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r={R} fill="none" stroke="#3b3b3b" strokeWidth="5" />
            <circle
              cx="38"
              cy="38"
              r={R}
              fill="none"
              stroke={ringColor}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${progress * circ} ${circ}`}
              transform="rotate(-90 38 38)"
              style={{ transition: 'stroke-dasharray 0.6s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-0.5">
            <span
              className="text-sm font-bold leading-none tabular-nums"
              style={{ color: ringColor }}
            >
              {percent}%
            </span>
            {achieved && (
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke={ringColor}
                strokeWidth="3"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-[#d4d4d4] leading-snug truncate">
                {goal.name}
              </h4>
              <p className="text-[10px] text-[#999999] mt-0.5">
                Prazo: {MONTH_NAMES[goal.targetMonth - 1]} {goal.targetYear}
              </p>
            </div>
            {manuallyCompleted && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#4f9f68]/12 text-[#69b780] text-[10px] font-semibold shrink-0">
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Concluído
              </span>
            )}
            {!manuallyCompleted && balanceAchieved && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#4f9f68]/12 text-[#69b780] text-[10px] font-semibold shrink-0">
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Alcançado
              </span>
            )}
            {isOverdue && (
              <span className="px-2 py-0.5 rounded-full bg-[#e04040]/15 text-[#e04040] text-[10px] font-semibold shrink-0">
                Vencido
              </span>
            )}
            {isUrgent && (
              <span className="px-2 py-0.5 rounded-full bg-[#f08a34]/15 text-[#f08a34] text-[10px] font-semibold shrink-0">
                {monthsLeft}m restante{monthsLeft !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[#999999] mb-0.5">
                Acumulado
              </p>
              <p className="text-xs font-bold text-[#46d478] tabular-nums">
                {formatCurrency(savedAmount, currency)}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[#999999] mb-0.5">
                Faltam
              </p>
              <p className="text-xs font-bold text-[#d4d4d4] tabular-nums">
                {formatCurrency(remaining, currency)}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[#999999] mb-0.5">
                Meta total
              </p>
              <p className="text-xs font-bold text-[#d4d4d4] tabular-nums">
                {formatCurrency(goal.targetAmount, currency)}
              </p>
            </div>
          </div>

          {!achieved && monthsLeft > 0 && (
            <div className="mt-2.5 pt-2.5 border-t border-[#3b3b3b]">
              <p className="text-[10px] text-[#999999] leading-relaxed">
                Economizar{' '}
                <span className="text-[#a080f0] font-semibold">
                  {formatCurrency(monthlyNeeded, currency)}/mês
                </span>{' '}
                para atingir no prazo
              </p>
            </div>
          )}
          {manuallyCompleted && (
            <div className="mt-2.5 pt-2.5 border-t border-[#4f9f68]/20">
              <p className="text-[10px] text-[#69b780]/70 leading-relaxed">
                Concluído em{' '}
                <span className="text-[#69b780] font-semibold">
                  {formatDateBR(goal.completedAt!)}
                </span>
              </p>
              {goal.completionNote && (
                <p className="text-[10px] text-[#999999] mt-0.5 leading-relaxed">
                  {goal.completionNote}
                </p>
              )}
            </div>
          )}
          {!manuallyCompleted && balanceAchieved && (
            <div className="mt-2.5 pt-2.5 border-t border-[#4f9f68]/20">
              <p className="text-[10px] text-[#69b780]/60 leading-relaxed">
                Saldo excede a meta em{' '}
                <span className="text-[#69b780] font-semibold">
                  {formatCurrency(effectiveBalance.minus(target), currency)}
                </span>
              </p>
            </div>
          )}
          {isOverdue && (
            <div className="mt-2.5 pt-2.5 border-t border-[#e04040]/20">
              <p className="text-[10px] text-[#e04040]/60 leading-relaxed">
                Faltam{' '}
                <span className="text-[#e04040] font-semibold">
                  {formatCurrency(remaining, currency)}
                </span>{' '}
                para concluir esta meta
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-1 justify-end mt-3 pt-2.5 border-t border-[#3b3b3b]/50 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium text-[#999999] hover:text-[#d4d4d4] hover:bg-[#3b3b3b] transition-colors"
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Editar
        </button>
        {!manuallyCompleted && (
          <button
            onClick={() => setCompleteModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium text-[#999999] hover:text-[#20b858] hover:bg-[#20b858]/10 transition-colors"
          >
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Finalizar
          </button>
        )}
        {manuallyCompleted && (
          <button
            onClick={onRevert}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium text-[#999999] hover:text-[#f08a34] hover:bg-[#f08a34]/10 transition-colors"
          >
            <svg
              width="9"
              height="9"
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
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium text-[#999999] hover:text-[#e04040] hover:bg-[#e04040]/10 transition-colors"
        >
          <svg
            width="9"
            height="9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
          Deletar
        </button>
      </div>

      <CompleteGoalModal
        open={completeModalOpen}
        goalName={goal.name}
        onConfirm={(date, note) => onComplete(date, note)}
        onClose={() => setCompleteModalOpen(false)}
      />
    </div>
  )
}
