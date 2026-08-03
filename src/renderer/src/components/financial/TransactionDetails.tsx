import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Currency, FinancialTransaction, FinancialTransactionDetail } from '../../types'
import {
  FINANCIAL_CATEGORIES,
  formatAmountInput,
  formatCurrency,
  parseDecimalInput,
  D
} from './shared'

interface TransactionDetailsProps {
  transaction: FinancialTransaction
  currency: Currency
  onUpdate: (updates: Partial<Omit<FinancialTransaction, 'id'>>) => void
}

export function TransactionDetails({ transaction, currency, onUpdate }: TransactionDetailsProps) {
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(transaction.date)
  const details = transaction.details ?? []
  const detailed = details.reduce((total, detail) => total.plus(detail.amount), D(0))
  const remaining = D(transaction.amount).minus(detailed)
  const parsedAmount = parseDecimalInput(amount)
  const canAdd =
    description.trim().length > 0 &&
    !!parsedAmount?.greaterThan(0) &&
    parsedAmount!.lessThanOrEqualTo(remaining)

  const saveDetails = (next: FinancialTransactionDetail[]) => onUpdate({ details: next })

  const updateDetail = (id: string, updates: Partial<FinancialTransactionDetail>): boolean => {
    const next = details.map((detail) => (detail.id === id ? { ...detail, ...updates } : detail))
    const nextTotal = next.reduce((total, detail) => total.plus(detail.amount), D(0))
    if (nextTotal.greaterThan(D(transaction.amount))) return false
    saveDetails(next)
    return true
  }

  const addDetail = () => {
    if (!parsedAmount || !canAdd) return
    saveDetails([
      ...details,
      {
        id: uuidv4(),
        description: description.trim(),
        amount: parsedAmount.toDecimalPlaces(2).toString(),
        ...(category.trim() ? { category: category.trim() } : {}),
        ...(date !== transaction.date ? { date } : {})
      }
    ])
    setDescription('')
    setCategory('')
    setAmount('')
    setDate(transaction.date)
  }

  return (
    <div className="ml-5 border-l-2 border-[#7c3aed]/40 bg-[#232323]/50 pl-3 pr-2 py-2 space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-[#999999]">
          Detalhado:{' '}
          <strong className="text-[#d4d4d4] tabular-nums">
            {formatCurrency(detailed, currency)}
          </strong>
        </span>
        <span
          className={
            'tabular-nums font-medium ' +
            (remaining.lessThan(0) ? 'text-[#e04040]' : 'text-[#a080f0]')
          }
        >
          {remaining.lessThan(0)
            ? formatCurrency(remaining.abs(), currency) + ' acima do total'
            : remaining.isZero()
              ? 'Total detalhado'
              : 'Falta detalhar ' + formatCurrency(remaining, currency)}
        </span>
      </div>

      {details.length > 0 && (
        <div className="space-y-1.5">
          {details.map((detail) => (
            <div
              key={detail.id + ':' + detail.amount + ':' + detail.description}
              className="grid grid-cols-[minmax(0,1fr)_6.5rem_7rem_5.5rem_1.4rem] gap-1.5 items-center"
            >
              <input
                defaultValue={detail.description}
                onBlur={(event) => {
                  const value = event.currentTarget.value.trim()
                  if (value) updateDetail(detail.id, { description: value })
                  else event.currentTarget.value = detail.description
                }}
                placeholder="Descrição"
                className="min-w-0 border-b border-[#3b3b3b] bg-transparent px-1 py-1 text-xs text-[#d4d4d4] focus:border-[#7c3aed] focus:outline-none"
              />
              <input
                type="date"
                defaultValue={detail.date ?? transaction.date}
                onChange={(event) =>
                  updateDetail(detail.id, {
                    date:
                      event.currentTarget.value === transaction.date
                        ? undefined
                        : event.currentTarget.value
                  })
                }
                className="min-w-0 border-b border-[#3b3b3b] bg-transparent px-1 py-1 text-xs text-[#999999] focus:border-[#7c3aed] focus:outline-none"
                aria-label={'Data de ' + detail.description}
              />
              <input
                list="financial-detail-categories"
                defaultValue={detail.category ?? ''}
                onBlur={(event) =>
                  updateDetail(detail.id, {
                    category: event.currentTarget.value.trim() || undefined
                  })
                }
                placeholder="Categoria"
                className="min-w-0 border-b border-[#3b3b3b] bg-transparent px-1 py-1 text-xs text-[#999999] focus:border-[#7c3aed] focus:outline-none"
              />
              <input
                defaultValue={formatAmountInput(detail.amount, currency)}
                inputMode="decimal"
                onBlur={(event) => {
                  const value = parseDecimalInput(event.currentTarget.value)
                  if (
                    !value ||
                    !value.greaterThan(0) ||
                    !updateDetail(detail.id, { amount: value.toDecimalPlaces(2).toString() })
                  ) {
                    event.currentTarget.value = formatAmountInput(detail.amount, currency)
                  }
                }}
                className="min-w-0 border-b border-[#3b3b3b] bg-transparent px-1 py-1 text-right text-xs text-[#d4d4d4] tabular-nums focus:border-[#7c3aed] focus:outline-none"
                aria-label={'Valor de ' + detail.description}
              />
              <button
                type="button"
                onClick={() => saveDetails(details.filter((item) => item.id !== detail.id))}
                title="Remover detalhe"
                className="p-1 text-[#666666] hover:text-[#e04040] transition-colors"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_7rem_5.5rem_auto] gap-1.5 items-center pt-1 border-t border-[#3b3b3b]">
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addDetail()
          }}
          placeholder="Adicionar item..."
          className="min-w-0 bg-[#232323] rounded px-2 py-1 text-xs text-[#d4d4d4] placeholder-[#555555] focus:outline-none focus:ring-1 focus:ring-[#7c3aed]"
        />
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="min-w-0 bg-[#232323] rounded px-2 py-1 text-xs text-[#999999] focus:outline-none focus:ring-1 focus:ring-[#7c3aed]"
          aria-label="Data da compra"
        />
        <input
          list="financial-detail-categories"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addDetail()
          }}
          placeholder="Categoria"
          className="min-w-0 bg-[#232323] rounded px-2 py-1 text-xs text-[#999999] placeholder-[#555555] focus:outline-none focus:ring-1 focus:ring-[#7c3aed]"
        />
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addDetail()
          }}
          inputMode="decimal"
          placeholder="Valor"
          className="min-w-0 bg-[#232323] rounded px-2 py-1 text-right text-xs text-[#d4d4d4] placeholder-[#555555] tabular-nums focus:outline-none focus:ring-1 focus:ring-[#7c3aed]"
        />
        <button
          type="button"
          onClick={addDetail}
          disabled={!canAdd}
          className="px-2 py-1 rounded text-xs font-medium text-[#a080f0] hover:bg-[#7c3aed]/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Adicionar
        </button>
      </div>
      <datalist id="financial-detail-categories">
        {FINANCIAL_CATEGORIES.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </div>
  )
}
