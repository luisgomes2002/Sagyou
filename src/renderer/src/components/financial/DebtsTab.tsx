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
  const [addError, setAddError] = useState('')
  const [payments, setPayments] = useState<Record<string, string>>({})
  const [paymentDates, setPaymentDates] = useState<Record<string, string>>({})
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({})

  const add = (): void => {
    const value = parseDecimalInput(amount, list.currency)
    if (!name.trim()) {
      setAddError('Informe um nome para a dívida.')
      return
    }
    if (!value || !value.greaterThan(0)) {
      setAddError('Informe um valor total válido.')
      return
    }
    onAdd(name, value.toString())
    setName('')
    setAmount('')
    setAddError('')
  }

  const setPaymentError = (id: string, message: string): void => {
    setPaymentErrors((current) => ({ ...current, [id]: message }))
  }

  const pay = (debt: FinancialDebt): void => {
    const value = parseDecimalInput(payments[debt.id] ?? '', list.currency)
    const paymentDate = paymentDates[debt.id] ?? todayISO()
    if (!value || !value.greaterThan(0)) {
      setPaymentError(debt.id, 'Informe um valor de pagamento válido.')
      return
    }
    if (value.greaterThan(debt.remainingAmount)) {
      setPaymentError(
        debt.id,
        `O pagamento não pode ultrapassar ${formatCurrency(debt.remainingAmount, list.currency)}.`
      )
      return
    }
    if (!paymentDate) {
      setPaymentError(debt.id, 'Escolha a data em que o pagamento foi feito.')
      return
    }
    if (!onPay(debt.id, value.toString(), paymentDate)) {
      setPaymentError(debt.id, 'Não foi possível registrar o pagamento.')
      return
    }
    setPayments((current) => ({ ...current, [debt.id]: '' }))
    setPaymentErrors((current) => ({ ...current, [debt.id]: '' }))
  }

  const open = (list.debts ?? []).filter((debt) => debt.remainingAmount !== '0')
  const settled = (list.debts ?? []).filter((debt) => debt.remainingAmount === '0')
  const debtCard = (debt: FinancialDebt): React.JSX.Element => {
    const paid = D(debt.originalAmount).minus(debt.remainingAmount)
    const percent = D(debt.originalAmount).isZero()
      ? 0
      : Math.min(100, Math.max(0, paid.div(debt.originalAmount).times(100).toNumber()))
    const paymentDate = paymentDates[debt.id] ?? todayISO()
    const error = paymentErrors[debt.id]

    return (
      <article key={debt.id} className="rounded-lg border border-[#2b2b31] bg-[#16161a] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[#d4d4d4]">{debt.name}</h3>
            <p className="mt-1 text-xs text-[#999999]">
              Valor original: {formatCurrency(debt.originalAmount, list.currency)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onDelete(debt.id)}
            className="rounded px-2 py-1 text-xs text-[#999999] transition-colors hover:bg-[#2a2a30] hover:text-[#ec6a6a]"
          >
            Remover
          </button>
        </div>

        <div className="mt-4 h-1.5 overflow-hidden rounded bg-[#2a2a30]">
          <div
            className="h-full rounded bg-[#7c3aed] transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between gap-3 text-xs">
          <span className="text-[#999999]">Pago: {formatCurrency(paid, list.currency)}</span>
          <span
            className={
              debt.remainingAmount === '0'
                ? 'font-medium text-[#46d478]'
                : 'font-medium text-[#f0a060]'
            }
          >
            {debt.remainingAmount === '0'
              ? 'Dívida quitada'
              : `Restante: ${formatCurrency(debt.remainingAmount, list.currency)}`}
          </span>
        </div>

        {debt.remainingAmount !== '0' && (
          <form
            className="mt-4 rounded-lg border border-[#2b2b31] bg-[#101014] p-3"
            onSubmit={(event) => {
              event.preventDefault()
              pay(debt)
            }}
          >
            <div>
              <p className="text-xs font-semibold text-[#d4d4d4]">Registrar pagamento</p>
              <p className="mt-0.5 text-[11px] text-[#999999]">
                Será criada uma despesa na data informada.
              </p>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_auto] sm:items-end">
              <label className="min-w-0 text-[11px] text-[#999999]">
                Valor pago
                <input
                  aria-label={`Valor do pagamento de ${debt.name}`}
                  value={payments[debt.id] ?? ''}
                  onChange={(event) => {
                    setPayments((current) => ({ ...current, [debt.id]: event.target.value }))
                    setPaymentError(debt.id, '')
                  }}
                  placeholder="R$ 0,00"
                  className="mt-1 w-full rounded border border-[#2b2b31] bg-[#16161a] px-3 py-2 text-sm text-[#d4d4d4] outline-none transition-colors placeholder:text-[#66666f] focus:border-[#7c3aed]"
                />
              </label>
              <label className="text-[11px] text-[#999999]">
                Data do pagamento
                <input
                  aria-label={`Data do pagamento de ${debt.name}`}
                  type="date"
                  value={paymentDate}
                  onChange={(event) => {
                    setPaymentDates((current) => ({
                      ...current,
                      [debt.id]: event.target.value
                    }))
                    setPaymentError(debt.id, '')
                  }}
                  className="mt-1 w-full rounded border border-[#2b2b31] bg-[#16161a] px-3 py-2 text-sm text-[#d4d4d4] outline-none transition-colors focus:border-[#7c3aed]"
                />
              </label>
              <button
                type="submit"
                aria-label={`Registrar pagamento de ${debt.name}`}
                className="h-[38px] rounded bg-[#7c3aed] px-4 text-sm font-medium text-white transition-colors hover:bg-[#6d28d9]"
              >
                Pagar
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-2 text-xs text-[#ec6a6a]">
                {error}
              </p>
            )}
          </form>
        )}
      </article>
    )
  }
  return (
    <div className="flex-1 overflow-auto p-5">
      <form
        className="mb-6 rounded-lg border border-[#2b2b31] bg-[#16161a] p-4"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <h2 className="text-sm font-semibold text-[#d4d4d4]">Adicionar dívida</h2>
        <p className="mt-1 text-xs text-[#999999]">
          Informe o valor total devido. Os pagamentos serão registrados depois, em cada dívida.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_10rem_auto] sm:items-end">
          <label className="min-w-0 text-[11px] text-[#999999]">
            Nome da dívida
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setAddError('')
              }}
              placeholder="Ex.: Empréstimo familiar"
              className="mt-1 w-full rounded border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#d4d4d4] outline-none transition-colors placeholder:text-[#66666f] focus:border-[#7c3aed]"
            />
          </label>
          <label className="text-[11px] text-[#999999]">
            Valor total
            <input
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setAddError('')
              }}
              placeholder="R$ 0,00"
              className="mt-1 w-full rounded border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#d4d4d4] outline-none transition-colors placeholder:text-[#66666f] focus:border-[#7c3aed]"
            />
          </label>
          <button
            type="submit"
            className="h-[38px] rounded bg-[#7c3aed] px-4 text-sm font-medium text-white transition-colors hover:bg-[#6d28d9]"
          >
            Adicionar dívida
          </button>
        </div>
        {addError && (
          <p role="alert" className="mt-2 text-xs text-[#ec6a6a]">
            {addError}
          </p>
        )}
      </form>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#d4d4d4]">Dívidas em aberto</h2>
        <span className="rounded bg-[#2a2a30] px-2 py-1 text-xs text-[#999999]">
          {open.length} {open.length === 1 ? 'pendente' : 'pendentes'}
        </span>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">{open.map(debtCard)}</div>
      {open.length === 0 && (
        <div className="rounded-lg border border-[#2b2b31] bg-[#16161a] px-4 py-8 text-center">
          <p className="text-sm text-[#999999]">Nenhuma dívida pendente.</p>
        </div>
      )}

      {settled.length > 0 && (
        <section className="mt-7">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[#999999]">Dívidas quitadas</h2>
            <span className="rounded bg-[#2a2a30] px-2 py-1 text-xs text-[#999999]">
              {settled.length}
            </span>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">{settled.map(debtCard)}</div>
        </section>
      )}
    </div>
  )
}
