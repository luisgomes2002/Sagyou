import { useEffect, useRef, useState } from 'react'
import type { FinancialTransaction, Currency } from '../../types'
import { CURRENCY_CONFIG } from '../../types'
import { FINANCIAL_CATEGORIES, parseDecimalInput, todayISO, formatDateBR, formatAmountInput } from './shared'

// ── CategoryInput ─────────────────────────────────────────────────────────────

interface CategoryInputProps {
  value: string
  onChange: (v: string) => void
  onCommit?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  className?: string
}

export function CategoryInput({ value, onChange, onCommit, onKeyDown, placeholder, className }: CategoryInputProps) {
  const [open, setOpen] = useState(false)

  const filtered = value.trim()
    ? FINANCIAL_CATEGORIES.filter((c) => c.toLowerCase().includes(value.toLowerCase()))
    : FINANCIAL_CATEGORIES

  const select = (cat: string) => {
    onChange(cat)
    setOpen(false)
    onCommit?.()
  }

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); onCommit?.() }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          onKeyDown?.(e)
        }}
        placeholder={placeholder}
        className={className}
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 top-full mt-0.5 z-50 w-44 max-h-52 overflow-y-auto rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] shadow-xl py-1">
          {filtered.map((cat) => (
            <button
              key={cat}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(cat)}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-[#2a2a2a] ${
                value === cat ? 'text-[#a080f0]' : 'text-[#999999] hover:text-[#d4d4d4]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── AddTransactionRow ─────────────────────────────────────────────────────────

interface AddTransactionRowProps {
  currency: Currency
  onAdd: (data: Omit<FinancialTransaction, 'id'>) => void
}

export function AddTransactionRow({ currency, onAdd }: AddTransactionRowProps) {
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [type, setType] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO)
  const [dateEditing, setDateEditing] = useState(false)
  const descRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    if (!description.trim()) return
    const amountDecimal = parseDecimalInput(amount)
    if (amountDecimal === null || amountDecimal.lessThanOrEqualTo(0)) return
    onAdd({
      description: description.trim(),
      category: category.trim() || undefined,
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
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setDateEditing(false) }}
            className="w-full bg-transparent text-xs text-[#999999] focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setDateEditing(true)}
            className="w-full text-left text-xs text-[#999999] tabular-nums hover:text-[#d4d4d4] transition-colors"
          >
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
          <span className="text-[10px] text-[#555555] select-none">{CURRENCY_CONFIG[currency].symbol}</span>
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
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
  onUpdate: (updates: Partial<Omit<FinancialTransaction, 'id'>>) => void
  onDelete: () => void
}

export function TransactionRow({ tx, currency, onUpdate, onDelete }: TransactionRowProps) {
  const [editDate, setEditDate] = useState(tx.date)
  const [editDesc, setEditDesc] = useState(tx.description)
  const [editCat, setEditCat] = useState(tx.category ?? '')
  const [editAmount, setEditAmount] = useState(() => formatAmountInput(tx.amount, currency))
  const [dateEditing, setDateEditing] = useState(false)

  useEffect(() => {
    setEditDate(tx.date)
    setEditDesc(tx.description)
    setEditCat(tx.category ?? '')
    setEditAmount(formatAmountInput(tx.amount, currency))
  }, [tx.id])

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
  const commitCat = () => {
    const v = editCat.trim()
    if (v !== (tx.category ?? '')) onUpdate({ category: v || undefined })
  }
  const commitAmount = () => {
    const d = parseDecimalInput(editAmount)
    if (d !== null && d.greaterThan(0)) {
      const s = d.toDecimalPlaces(2).toString()
      if (s !== tx.amount) onUpdate({ amount: s })
    } else {
      setEditAmount(formatAmountInput(tx.amount, currency))
    }
  }

  return (
    <tr className="group border-b border-[#3b3b3b] hover:bg-[#2a2a2a] transition-colors">
      <td className="pl-4 pr-2 py-2 w-28">
        {dateEditing ? (
          <input
            autoFocus
            type="date"
            value={editDate}
            onChange={(e) => setEditDate(e.target.value)}
            onBlur={() => { commitDate(); setDateEditing(false) }}
            onKeyDown={(e) => { blur(e); if (e.key === 'Enter' || e.key === 'Escape') setDateEditing(false) }}
            className="w-full bg-transparent text-xs text-[#999999] tabular-nums focus:outline-none focus:bg-[#1b1b1b] focus:px-1 rounded transition-all"
          />
        ) : (
          <button
            onClick={() => setDateEditing(true)}
            className="w-full text-left text-xs text-[#999999] tabular-nums hover:text-[#d4d4d4] transition-colors"
          >
            {formatDateBR(editDate)}
          </button>
        )}
      </td>
      <td className="py-2 pr-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {tx.fromShopping && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" className="shrink-0 opacity-60">
              <title>Gerado por compra</title>
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          )}
          <input
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            onBlur={commitDesc}
            onKeyDown={blur}
            className={`flex-1 min-w-0 bg-transparent text-sm focus:outline-none focus:bg-[#1b1b1b] focus:px-1.5 rounded transition-all ${
              tx.fromShopping ? 'text-[#a080f0]' : 'text-[#d4d4d4]'
            }`}
          />
        </div>
      </td>
      <td className="py-2 pr-2 w-28">
        <CategoryInput
          value={editCat}
          onChange={setEditCat}
          onCommit={commitCat}
          onKeyDown={blur}
          placeholder="-"
          className="w-full bg-transparent text-xs text-[#999999] placeholder-[#555555] focus:outline-none focus:bg-[#1b1b1b] focus:px-1 rounded transition-all"
        />
      </td>
      <td className="py-2 pr-2 w-20 text-center">
        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
          tx.type === 'income' ? 'bg-[#20b858]/15 text-[#46d478]' : 'bg-[#e04040]/15 text-[#e04040]'
        }`}>
          {tx.type === 'income' ? '↑ Entrada' : '↓ Saída'}
        </span>
      </td>
      <td className="py-2 pr-2 w-32 text-right">
        <div className="flex items-center justify-end gap-1">
          <span className="text-[10px] text-[#555555] select-none">{CURRENCY_CONFIG[currency].symbol}</span>
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
      </td>
      <td className="py-2 pr-3 w-9 text-center">
        <button
          onClick={onDelete}
          className="p-1 rounded text-[#3b3b3b] hover:text-[#e04040] hover:bg-[#e04040]/10 opacity-0 group-hover:opacity-100 transition-all"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </td>
    </tr>
  )
}
