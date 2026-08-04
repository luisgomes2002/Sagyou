import { useEffect, useMemo, useRef, useState } from 'react'
import type { FinancialTransaction, FinancialTable, Currency } from '../../types'
import { CURRENCY_CONFIG } from '../../types'
import {
  D,
  parseDecimalInput,
  todayISO,
  formatDateBR,
  formatAmountInput,
  formatCurrency,
  YIELD_SUMMARY_CATEGORY
} from './shared'
import { TransactionDetails } from './TransactionDetails'
import { CategoryInput } from './CategoryInput'

// ── AddTransactionRow ─────────────────────────────────────────────────────────

interface AddTransactionRowProps {
  currency: Currency
  onAdd: (data: Omit<FinancialTransaction, 'id'>) => void
}

export function AddTransactionRow({ currency, onAdd }: AddTransactionRowProps) {
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [type, setType] = useState<'income' | 'expense'>('income')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO)
  const [dateEditing, setDateEditing] = useState(false)
  const descRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    if (!description.trim()) return
    const amountDecimal = parseDecimalInput(amount)
    if (amountDecimal === null || amountDecimal.lessThanOrEqualTo(0)) return
    const cat = category.trim()
    onAdd({
      description: description.trim(),
      category: cat && cat !== YIELD_SUMMARY_CATEGORY ? cat : undefined,
      type,
      amount: amountDecimal.toDecimalPlaces(2).toString(),
      date
    })
    setDescription('')
    setCategory('')
    setAmount('')
    setDate(todayISO())
    descRef.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit()
  }

  return (
    <tr className="border-b border-[#3b3b3b] hover:bg-[#2a2a2a] transition-colors">
      <td className="pl-4 pr-2 py-1.5 w-28">
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
            className="w-full bg-transparent text-xs text-[#999999] focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setDateEditing(true)}
            className="inline-flex items-center gap-1 text-xs text-[#999999] tabular-nums bg-[#2a2a2a] px-1.5 py-0.5 rounded hover:text-[#d4d4d4] transition-colors"
          >
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="opacity-50"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {formatDateBR(date)}
          </button>
        )}
      </td>
      <td className="py-1.5 pr-2">
        <input
          ref={descRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={onKey}
          placeholder="Descrição..."
          className="w-full bg-transparent text-sm text-[#d4d4d4] placeholder-[#555555] focus:outline-none"
        />
      </td>
      <td className="py-1.5 pr-2 w-28">
        <CategoryInput
          value={category}
          onChange={setCategory}
          onKeyDown={onKey}
          placeholder="Categoria"
          className="w-full bg-transparent text-xs text-[#999999] placeholder-[#555555] focus:outline-none"
        />
      </td>
      <td className="py-1.5 pr-2 w-20 text-center">
        <button
          onClick={() => setType(type === 'income' ? 'expense' : 'income')}
          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
            type === 'income' ? 'bg-[#20b858]/15 text-[#46d478]' : 'bg-[#e04040]/15 text-[#e04040]'
          }`}
        >
          {type === 'income' ? '↑ Entrada' : '↓ Saída'}
        </button>
      </td>
      <td className="py-1.5 pr-2 w-32">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[#555555] select-none">
            {CURRENCY_CONFIG[currency].symbol}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            placeholder="0"
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={onKey}
            className="w-full bg-transparent text-sm text-[#999999] placeholder-[#555555] focus:outline-none"
          />
        </div>
      </td>
      <td className="py-1.5 pr-3 w-9 text-center">
        <button
          onClick={submit}
          disabled={!description.trim() || !parseDecimalInput(amount)?.greaterThan(0)}
          className="p-1 rounded text-[#7c3aed] hover:bg-[#7c3aed]/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

// ── TransactionRow ────────────────────────────────────────────────────────────

interface TransactionRowProps {
  tx: FinancialTransaction
  currency: Currency
  allLists: FinancialTable[]
  onUpdate: (updates: Partial<Omit<FinancialTransaction, 'id'>>) => void
  onDelete?: () => void
  onUnlink?: () => void
  readOnly?: boolean
}

export function TransactionRow({
  tx,
  currency,
  allLists,
  onUpdate,
  onDelete,
  onUnlink,
  readOnly
}: TransactionRowProps) {
  const [editDate, setEditDate] = useState(tx.date)
  const [editDesc, setEditDesc] = useState(tx.description)
  const [editCat, setEditCat] = useState(tx.category ?? '')
  const [editAmount, setEditAmount] = useState(() => formatAmountInput(tx.amount, currency))
  const [dateEditing, setDateEditing] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState((tx.details?.length ?? 0) > 0)

  useEffect(() => {
    setEditDate(tx.date)
    setEditDesc(tx.description)
    setEditCat(tx.category ?? '')
    setEditAmount(formatAmountInput(tx.amount, currency))
  }, [tx.id])

  const linkedParent = useMemo(() => {
    if (!tx.linkedTransactionId) return null
    for (const list of allLists) {
      const parent = list.transactions.find((t) => t.id === tx.linkedTransactionId)
      if (parent) return { ...parent, tableName: list.name, tableCurrency: list.currency }
    }
    return null
  }, [tx.linkedTransactionId, allLists])

  const linkedChildren = useMemo(() => {
    const children: (FinancialTransaction & { tableName: string; tableCurrency: Currency })[] = []
    for (const list of allLists) {
      for (const t of list.transactions) {
        if (t.linkedTransactionId === tx.id) {
          children.push({ ...t, tableName: list.name, tableCurrency: list.currency })
        }
      }
    }
    return children
  }, [tx.id, allLists])

  const linkedInvoiceDetail = useMemo(() => {
    for (const list of allLists) {
      for (const parent of list.transactions) {
        const detail = parent.details?.find((item) => item.linkedTransactionId === tx.id)
        if (detail) return { detail, parent, tableName: list.name }
      }
    }
    return null
  }, [tx.id, allLists])

  const blur = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
    if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
  }

  const commitDate = () => {
    if (editDate && editDate !== tx.date) onUpdate({ date: editDate })
    else setEditDate(tx.date)
  }
  const commitDesc = () => {
    const v = editDesc.trim()
    if (v && v !== tx.description) onUpdate({ description: v })
    else setEditDesc(tx.description)
  }
  const commitCat = (value = editCat) => {
    const v = value.trim()
    const clean = v && v !== YIELD_SUMMARY_CATEGORY ? v : ''
    if (clean !== (tx.category ?? '')) onUpdate({ category: clean || undefined })
    if (clean !== v) setEditCat(clean)
  }
  const commitAmount = () => {
    const d = parseDecimalInput(editAmount)
    if (d !== null && d.greaterThan(0)) {
      const detailsTotal = (tx.details ?? []).reduce(
        (total, detail) => total.plus(detail.amount),
        D(0)
      )
      if (d.lessThan(detailsTotal)) {
        setEditAmount(formatAmountInput(tx.amount, currency))
        return
      }
      const s = d.toDecimalPlaces(2).toString()
      if (s !== tx.amount) onUpdate({ amount: s })
    } else {
      setEditAmount(formatAmountInput(tx.amount, currency))
    }
  }

  return (
    <>
      <tr className="group border-b border-[#3b3b3b] hover:bg-[#2a2a2a] transition-colors">
        <td className="pl-4 pr-2 py-2 w-28">
          {readOnly ? (
            <span className="text-xs text-[#999999] tabular-nums">{formatDateBR(tx.date)}</span>
          ) : dateEditing ? (
            <input
              autoFocus
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              onBlur={() => {
                commitDate()
                setDateEditing(false)
              }}
              onKeyDown={(e) => {
                blur(e)
                if (e.key === 'Enter' || e.key === 'Escape') setDateEditing(false)
              }}
              className="w-full bg-transparent text-xs text-[#999999] tabular-nums focus:outline-none focus:bg-[#1b1b1b] focus:px-1 rounded transition-all"
            />
          ) : (
            <button
              onClick={() => setDateEditing(true)}
              className="inline-flex items-center gap-1 text-xs text-[#999999] tabular-nums bg-[#2a2a2a] px-1.5 py-0.5 rounded hover:text-[#d4d4d4] transition-colors"
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="opacity-50"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {formatDateBR(editDate)}
            </button>
          )}
        </td>
        <td className="py-2 pr-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {tx.fromShopping && (
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#7c3aed"
                strokeWidth="2"
                className="shrink-0 opacity-60"
              >
                <title>Gerado por compra</title>
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
            )}
            {linkedParent && (
              <span
                className="shrink-0 inline-flex items-center gap-1 rounded bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] text-[#999999] max-w-[220px] group/link"
                title={`Vinculado a: ${linkedParent.description} (${linkedParent.tableName} — ${formatDateBR(linkedParent.date)})`}
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span className="truncate">
                  {linkedParent.description.length > 25
                    ? linkedParent.description.slice(0, 25) + '…'
                    : linkedParent.description}
                </span>
                <span className="text-[#666666] shrink-0">
                  · {linkedParent.tableName} · {formatDateBR(linkedParent.date)}
                </span>
                {onUnlink && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onUnlink()
                    }}
                    className="p-0.5 rounded text-[#666666] hover:text-[#e04040] hover:bg-[#e04040]/10 opacity-0 group-hover/link:opacity-100 transition-all shrink-0 ml-0.5"
                    title="Desvincular"
                  >
                    <svg
                      width="8"
                      height="8"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </span>
            )}
            {linkedInvoiceDetail && (
              <span
                className="shrink-0 inline-flex items-center gap-1 rounded bg-[#2a2a2a] px-1.5 py-0.5 text-[10px] text-[#999999] max-w-[220px]"
                title={`Vinculado ao item ${linkedInvoiceDetail.detail.description} da fatura ${linkedInvoiceDetail.parent.description} — ${linkedInvoiceDetail.tableName}`}
              >
                <span aria-hidden="true">↔</span>
                <span className="truncate">{linkedInvoiceDetail.detail.description}</span>
                <span className="text-[#666666] shrink-0">
                  · {linkedInvoiceDetail.tableName} ·{' '}
                  {formatDateBR(linkedInvoiceDetail.detail.date ?? linkedInvoiceDetail.parent.date)}
                </span>
              </span>
            )}
            {linkedChildren.length > 0 && (
              <span
                className="shrink-0 inline-flex items-center gap-1 text-[10px] text-[#999999] bg-[#2a2a2a] px-1.5 py-0.5 rounded max-w-[220px]"
                title={linkedChildren
                  .map((c) => `${c.description} (${formatDateBR(c.date)}) — ${c.tableName}`)
                  .join('\n')}
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span className="truncate">
                  {linkedChildren.length === 1
                    ? `${
                        linkedChildren[0].description.length > 20
                          ? linkedChildren[0].description.slice(0, 20) + '…'
                          : linkedChildren[0].description
                      } · ${formatDateBR(linkedChildren[0].date)}`
                    : `${linkedChildren.length} vinculadas`}
                </span>
              </span>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => setDetailsOpen((open) => !open)}
                className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[#a080f0] hover:bg-[#7c3aed]/10 transition-colors"
                title="Detalhar esta transação"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 19V5" />
                  <path d="M8 17V9" />
                  <path d="M12 15v-3" />
                  <path d="M16 13V7" />
                  <path d="M20 11V4" />
                </svg>
                {tx.details?.length ? tx.details.length + ' item(ns)' : 'Detalhar'}
              </button>
            )}
            {readOnly ? (
              <span className={`text-sm ${tx.fromShopping ? 'text-[#a080f0]' : 'text-[#d4d4d4]'}`}>
                {tx.description}
              </span>
            ) : (
              <input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onBlur={commitDesc}
                onKeyDown={blur}
                className={`flex-1 min-w-0 bg-transparent text-sm focus:outline-none focus:bg-[#1b1b1b] focus:px-1.5 rounded transition-all ${
                  tx.fromShopping ? 'text-[#a080f0]' : 'text-[#d4d4d4]'
                }`}
              />
            )}
          </div>
        </td>
        <td className="py-2 pr-2 w-28">
          {readOnly ? (
            <span className="text-xs text-[#999999]">{tx.category || '-'}</span>
          ) : (
            <CategoryInput
              value={editCat}
              onChange={setEditCat}
              onCommit={commitCat}
              onKeyDown={blur}
              placeholder="-"
              className="w-full bg-transparent text-xs text-[#999999] placeholder-[#555555] focus:outline-none focus:bg-[#1b1b1b] focus:px-1 rounded transition-all"
            />
          )}
        </td>
        <td className="py-2 pr-2 w-20 text-center">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
              tx.type === 'income'
                ? 'bg-[#20b858]/15 text-[#46d478]'
                : 'bg-[#e04040]/15 text-[#e04040]'
            }`}
          >
            {tx.type === 'income' ? '↑ Entrada' : '↓ Saída'}
          </span>
        </td>
        <td className="py-2 pr-2 w-32 text-right">
          {readOnly ? (
            <span
              className={`text-sm tabular-nums font-medium ${tx.type === 'income' ? 'text-[#46d478]' : 'text-[#d4d4d4]'}`}
            >
              {formatCurrency(tx.amount, currency)}
            </span>
          ) : (
            <div className="flex items-center justify-end gap-1">
              <span className="text-[10px] text-[#555555] select-none">
                {CURRENCY_CONFIG[currency].symbol}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                onBlur={commitAmount}
                onKeyDown={blur}
                className={`w-20 bg-transparent text-sm tabular-nums font-medium text-right focus:outline-none focus:bg-[#1b1b1b] focus:px-1 rounded transition-all ${
                  tx.type === 'income' ? 'text-[#46d478]' : 'text-[#d4d4d4]'
                }`}
              />
            </div>
          )}
        </td>
        <td className="py-2 pr-3 w-9 text-center">
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1 rounded text-[#3b3b3b] hover:text-[#e04040] hover:bg-[#e04040]/10 opacity-0 group-hover:opacity-100 transition-all"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </td>
      </tr>
      {detailsOpen && !readOnly && (
        <tr className="border-b border-[#3b3b3b]">
          <td colSpan={6} className="px-4 py-2.5">
            <TransactionDetails
              transaction={tx}
              currency={currency}
              allLists={allLists}
              onUpdate={onUpdate}
            />
          </td>
        </tr>
      )}
    </>
  )
}
