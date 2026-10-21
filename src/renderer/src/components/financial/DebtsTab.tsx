import { useState } from 'react'
import type { FinancialDebt, FinancialTable } from '../../types'
import { D, formatCurrency, parseDecimalInput, todayISO } from './shared'

interface DebtsTabProps {
  list: FinancialTable
  onAdd: (name: string, amount: string) => void
  onPay: (debtId: string, amount: string, date: string) => boolean
  onDelete: (debtId: string) => void
}

export function DebtsTab({ list, onAdd, onPay, onDelete }: DebtsTabProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [payments, setPayments] = useState<Record<string, string>>({})
  const [paymentDate, setPaymentDate] = useState(todayISO())
  const add = () => {
    const value = parseDecimalInput(amount, list.currency)
    if (!name.trim() || !value || !value.greaterThan(0)) return
    onAdd(name, value.toString())
    setName('')
    setAmount('')
  }
  const pay = (id: string) => {
    const value = parseDecimalInput(payments[id] ?? '', list.currency)
    if (!value || !value.greaterThan(0)) return
    if (onPay(id, value.toString(), paymentDate))
      setPayments((current) => ({ ...current, [id]: '' }))
  }
  const open = (list.debts ?? []).filter((debt) => debt.remainingAmount !== '0')
  const settled = (list.debts ?? []).filter((debt) => debt.remainingAmount === '0')
  const debtCard = (debt: FinancialDebt) => {
    const paid = D(debt.originalAmount).minus(debt.remainingAmount)
    const percent = D(debt.originalAmount).isZero()
      ? 0
      : Math.min(100, Math.max(0, paid.div(debt.originalAmount).times(100).toNumber()))
    return (
      <div key={debt.id} className="rounded-lg border border-[#2b2b31] bg-[#16161a] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-[#d4d4d4]">{debt.name}</h3>
            <p className="mt-1 text-xs text-[#999999]">
              Total: {formatCurrency(debt.originalAmount, list.currency)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onDelete(debt.id)}
            className="text-xs text-[#999999] hover:text-[#e04040]"
          >
            Remover
          </button>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded bg-[#2a2a30]">
          <div className="h-full bg-[#7c3aed]" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs">
          <span className="text-[#999999]">Pago: {formatCurrency(paid, list.currency)}</span>
          <span className={debt.remainingAmount === '0' ? 'text-[#60c080]' : 'text-[#f0a060]'}>
            {debt.remainingAmount === '0'
              ? 'Quitada'
              : `Falta: ${formatCurrency(debt.remainingAmount, list.currency)}`}
          </span>
        </div>
        {debt.remainingAmount !== '0' && (
          <div className="mt-3 flex gap-2">
            <input
              aria-label={`Pagamento para ${debt.name}`}
              value={payments[debt.id] ?? ''}
              onChange={(event) =>
                setPayments((current) => ({ ...current, [debt.id]: event.target.value }))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') pay(debt.id)
              }}
              placeholder="Valor do pagamento"
              className="min-w-0 flex-1 rounded border border-[#2b2b31] bg-[#101014] px-2 py-1.5 text-xs text-[#d4d4d4] focus:border-[#7c3aed] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => pay(debt.id)}
              className="rounded bg-[#7c3aed] px-3 py-1.5 text-xs text-white"
            >
              Pagar
            </button>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="flex-1 overflow-auto p-5">
      <div className="mb-5 rounded-lg border border-[#2b2b31] bg-[#16161a] p-4">
        <h2 className="text-sm font-semibold text-[#d4d4d4]">Nova dívida</h2>
        <p className="mt-1 text-xs text-[#999999]">
          Cada pagamento vira uma despesa nesta tabela e reduz o saldo pendente.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            aria-label="Nome da dívida"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Notebook"
            className="min-w-48 flex-1 rounded border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#d4d4d4] focus:border-[#7c3aed] focus:outline-none"
          />
          <input
            aria-label="Valor da dívida"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add()
            }}
            placeholder="Valor total"
            className="w-36 rounded border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#d4d4d4] focus:border-[#7c3aed] focus:outline-none"
          />
          <button
            type="button"
            onClick={add}
            className="rounded bg-[#7c3aed] px-4 py-2 text-sm text-white"
          >
            Adicionar
          </button>
        </div>
        <label className="mt-3 flex w-fit items-center gap-2 text-xs text-[#999999]">
          Data dos pagamentos{' '}
          <input
            aria-label="Data do pagamento"
            type="date"
            value={paymentDate}
            onChange={(event) => setPaymentDate(event.target.value)}
            className="rounded border border-[#2b2b31] bg-[#101014] px-2 py-1 text-[#d4d4d4]"
          />
        </label>
      </div>
      <h2 className="mb-3 text-sm font-semibold text-[#d4d4d4]">A pagar ({open.length})</h2>
      <div className="grid gap-3 lg:grid-cols-2">{open.map(debtCard)}</div>
      {open.length === 0 && <p className="text-sm text-[#999999]">Nenhuma dívida pendente.</p>}
      {settled.length > 0 && (
        <>
          <h2 className="mb-3 mt-7 text-sm font-semibold text-[#999999]">
            Quitadas ({settled.length})
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">{settled.map(debtCard)}</div>
        </>
      )}
    </div>
  )
}
