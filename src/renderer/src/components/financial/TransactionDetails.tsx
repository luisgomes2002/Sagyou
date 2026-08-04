import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type {
  Currency,
  FinancialTable,
  FinancialTransaction,
  FinancialTransactionDetail
} from '../../types'
import { ConfirmDialog } from '../ConfirmDialog'
import { formatAmountInput, formatCurrency, formatDateBR, parseDecimalInput, D } from './shared'
import { CategoryInput } from './CategoryInput'

interface DetailCategoryInputProps {
  value: string
  onCommit: (value: string) => void
  className: string
}

function DetailCategoryInput({
  value,
  onCommit,
  className
}: DetailCategoryInputProps): React.JSX.Element {
  const [draft, setDraft] = useState(value)

  return (
    <CategoryInput
      value={draft}
      onChange={setDraft}
      onCommit={(next) => onCommit(next.trim())}
      placeholder="Categoria"
      className={className}
    />
  )
}

interface TransactionDetailsProps {
  transaction: FinancialTransaction
  currency: Currency
  allLists: FinancialTable[]
  onUpdate: (updates: Partial<Omit<FinancialTransaction, 'id'>>) => void
}

export function TransactionDetails({
  transaction,
  currency,
  allLists,
  onUpdate
}: TransactionDetailsProps) {
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(transaction.date)
  const [unlinkDetailId, setUnlinkDetailId] = useState<string | null>(null)
  const [deleteDetailId, setDeleteDetailId] = useState<string | null>(null)
  const details = transaction.details ?? []
  const detailed = details.reduce((total, detail) => total.plus(detail.amount), D(0))
  const remaining = D(transaction.amount).minus(detailed)
  const orderedDetails = [...details].sort(
    (a, b) => (b.date ?? transaction.date).localeCompare(a.date ?? transaction.date)
  )
  const parsedAmount = parseDecimalInput(amount)
  const canAdd =
    description.trim().length > 0 &&
    !!parsedAmount?.greaterThan(0) &&
    parsedAmount!.lessThanOrEqualTo(remaining)

  const saveDetails = (next: FinancialTransactionDetail[]) => onUpdate({ details: next })

  const linkedTransaction = (id: string | undefined) => {
    if (!id) return null
    for (const list of allLists) {
      const linked = list.transactions.find((item) => item.id === id)
      if (linked) return { transaction: linked, tableName: list.name }
    }
    return null
  }

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
    <div className="ml-5 rounded-md bg-[#232323]/50 px-3 py-2 space-y-2">
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
            (remaining.lessThan(0) ? 'text-[#e04040]' : 'text-[#999999]')
          }
        >
          {remaining.lessThan(0)
            ? formatCurrency(remaining.abs(), currency) + ' acima do total'
            : remaining.isZero()
              ? 'Total detalhado'
              : 'Falta detalhar ' + formatCurrency(remaining, currency)}
        </span>
      </div>

      {orderedDetails.length > 0 && (
        <div className="space-y-1.5">
          {orderedDetails.map((detail) => (
            <div
              key={detail.id + ':' + detail.amount + ':' + detail.description}
              className="grid grid-cols-[minmax(0,1fr)_6.5rem_6rem_8rem_1.4rem] gap-2 items-center"
            >
              <input
                defaultValue={detail.description}
                onBlur={(event) => {
                  const value = event.currentTarget.value.trim()
                  if (value) updateDetail(detail.id, { description: value })
                  else event.currentTarget.value = detail.description
                }}
                placeholder="Descrição"
                className="min-w-0 rounded bg-transparent px-1 py-1 text-xs text-[#d4d4d4] hover:bg-[#2a2a2a] focus:bg-[#2a2a2a] focus:outline-none"
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
                className="min-w-0 rounded bg-transparent px-1 py-1 text-xs text-[#999999] hover:bg-[#2a2a2a] focus:bg-[#2a2a2a] focus:outline-none"
                aria-label={'Data de ' + detail.description}
              />
              <DetailCategoryInput
                value={detail.category ?? ''}
                onCommit={(value) => updateDetail(detail.id, { category: value || undefined })}
                className="min-w-0 rounded bg-transparent px-1 py-1 pr-3 text-xs text-[#999999] hover:bg-[#2a2a2a] focus:bg-[#2a2a2a] focus:outline-none"
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
                className="min-w-0 rounded bg-transparent px-1 py-1 text-right text-xs text-[#d4d4d4] tabular-nums hover:bg-[#2a2a2a] focus:bg-[#2a2a2a] focus:outline-none"
                aria-label={'Valor de ' + detail.description}
              />
              <button
                type="button"
                onClick={() => setDeleteDetailId(detail.id)}
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
              {detail.linkedTransactionId && (
                <button
                  type="button"
                  onClick={() => setUnlinkDetailId(detail.id)}
                  title="Desvincular lançamento deste item"
                  className="col-span-5 justify-self-start inline-flex items-center gap-1 rounded bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] text-[#999999] hover:text-[#e04040]"
                >
                  <span aria-hidden="true">↔</span>
                  {(() => {
                    const linked = linkedTransaction(detail.linkedTransactionId)
                    return linked
                      ? `Vinculado a ${linked.transaction.description} · ${linked.tableName} · ${formatDateBR(linked.transaction.date)}`
                      : 'Vinculado a um lançamento de outra tabela'
                  })()}
                  <span className="text-[#666666]">· desvincular</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_6rem_8rem_auto] gap-2 items-center pt-1 border-t border-[#3b3b3b]">
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addDetail()
          }}
          placeholder="Adicionar item..."
          className="min-w-0 bg-[#2a2a2a] rounded px-2 py-1 text-xs text-[#d4d4d4] placeholder-[#555555] focus:outline-none"
        />
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="min-w-0 bg-[#2a2a2a] rounded px-2 py-1 text-xs text-[#999999] focus:outline-none"
          aria-label="Data da compra"
        />
        <CategoryInput
          value={category}
          onChange={setCategory}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addDetail()
          }}
          placeholder="Categoria"
          className="min-w-0 bg-[#2a2a2a] rounded px-2 py-1 pr-3 text-xs text-[#999999] placeholder-[#555555] focus:outline-none"
        />
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addDetail()
          }}
          inputMode="decimal"
          placeholder="Valor"
          className="min-w-0 bg-[#2a2a2a] rounded px-2 py-1 text-right text-xs text-[#d4d4d4] placeholder-[#555555] tabular-nums focus:outline-none"
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
      <ConfirmDialog
        open={unlinkDetailId !== null}
        title="Desvincular item da fatura"
        message="Tem certeza que deseja desvincular este item do lançamento da outra tabela? Os dois registros continuarão existindo."
        confirmLabel="Desvincular"
        onConfirm={() => {
          if (unlinkDetailId) updateDetail(unlinkDetailId, { linkedTransactionId: undefined })
          setUnlinkDetailId(null)
        }}
        onCancel={() => setUnlinkDetailId(null)}
      />
      <ConfirmDialog
        open={deleteDetailId !== null}
        title="Excluir detalhe"
        message="Tem certeza que deseja excluir este detalhe? Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        onConfirm={() => {
          if (deleteDetailId) saveDetails(details.filter((item) => item.id !== deleteDetailId))
          setDeleteDetailId(null)
        }}
        onCancel={() => setDeleteDetailId(null)}
      />
    </div>
  )
}
