import { useEffect, useRef, useState } from 'react'
import Decimal from 'decimal.js'
import type { ShoppingItem, FinancialTable, Currency } from '../../types'
import { CURRENCY_CONFIG } from '../../types'
import { formatCurrency, itemTotal, parseDecimalInput, formatAmountInput } from './shared'

interface ItemRowProps {
  item: ShoppingItem
  currency: Currency
  onUpdate: (updates: Partial<Pick<ShoppingItem, 'name' | 'qty' | 'price' | 'done' | 'link'>>) => void
  onDelete: () => void
  onToggle: () => void
}

function ItemRow({ item, currency, onUpdate, onDelete, onToggle }: ItemRowProps) {
  const [name, setName] = useState(item.name)
  const [qty, setQty] = useState(item.qty.toString())
  const [price, setPrice] = useState(() => item.price != null ? formatAmountInput(item.price, currency) : '')
  const [link, setLink] = useState(item.link ?? '')

  useEffect(() => {
    setName(item.name)
    setQty(item.qty.toString())
    setPrice(item.price != null ? formatAmountInput(item.price, currency) : '')
    setLink(item.link ?? '')
  }, [item.id])

  const total = itemTotal(item)

  const commitName = () => {
    const v = name.trim()
    if (v && v !== item.name) onUpdate({ name: v })
    else setName(item.name)
  }

  const commitQty = () => {
    const d = parseDecimalInput(qty)
    if (d !== null && d.greaterThan(0)) {
      const n = d.toNumber()
      if (n !== item.qty) onUpdate({ qty: n })
    } else {
      setQty(item.qty.toString())
    }
  }

  const commitPrice = () => {
    const d = parseDecimalInput(price)
    if (price.trim() === '' || price.trim().replace(',', '.') === '') {
      if (item.price != null) onUpdate({ price: undefined })
    } else if (d !== null && d.greaterThanOrEqualTo(0)) {
      const s = d.toDecimalPlaces(2).toString()
      if (s !== item.price) onUpdate({ price: s })
    } else {
      setPrice(item.price != null ? formatAmountInput(item.price, currency) : '')
    }
  }

  const commitLink = () => {
    const v = link.trim()
    if (v !== (item.link ?? '')) onUpdate({ link: v || undefined })
  }

  const blur = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  }

  return (
    <tr className={`group border-b border-[#3b3b3b] transition-colors ${item.done ? 'opacity-60' : 'hover:bg-[#2a2a2a]'}`}>
      <td className="pl-4 pr-2 py-2">
        <button
          onClick={onToggle}
          title={item.done ? 'Desmarcar (remove lançamento em Finanças)' : 'Marcar como comprado (lança em Finanças)'}
          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
            item.done ? 'bg-[#20b858] border-[#20b858]' : 'border-[#555555] hover:border-[#7c3aed]'
          }`}
        >
          {item.done && (
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>
      </td>
      <td className="py-1.5 pr-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={blur}
            className={`flex-1 bg-transparent text-sm focus:outline-none focus:bg-[#1b1b1b] focus:px-1.5 rounded transition-all ${
              item.done ? 'text-[#999999] line-through' : 'text-[#d4d4d4]'
            }`}
          />
          {item.done && item.linkedTransactionId && (
            <span className="text-[9px] text-[#7c3aed]/70 shrink-0">→ Finanças</span>
          )}
        </div>
      </td>
      <td className="py-1.5 pr-2 w-16">
        <input
          type="number"
          value={qty}
          min="0"
          step="any"
          onChange={(e) => setQty(e.target.value)}
          onBlur={commitQty}
          onKeyDown={blur}
          className="w-full bg-transparent text-sm text-center text-[#d4d4d4] focus:outline-none focus:bg-[#1b1b1b] rounded transition-all"
        />
      </td>
      <td className="py-1.5 pr-2 w-28">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[#555555] select-none">{CURRENCY_CONFIG[currency].symbol}</span>
          <input
            type="text"
            inputMode="decimal"
            value={price}
            placeholder="-"
            onChange={(e) => setPrice(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={blur}
            className="w-full bg-transparent text-sm text-[#d4d4d4] placeholder-[#555555] focus:outline-none focus:bg-[#1b1b1b] rounded transition-all"
          />
        </div>
      </td>
      <td className="py-1.5 pr-2 w-28">
        <div className="flex items-center gap-1 min-w-0">
          <input
            type="text"
            value={link}
            placeholder="URL"
            onChange={(e) => setLink(e.target.value)}
            onBlur={commitLink}
            onKeyDown={blur}
            className="min-w-0 flex-1 bg-transparent text-xs text-[#7c3aed] placeholder-[#555555] focus:outline-none focus:bg-[#1b1b1b] rounded truncate transition-all"
          />
          {item.link && (
            <button
              onClick={() => window.open(item.link, '_blank')}
              title={item.link}
              className="shrink-0 text-[#7c3aed] hover:text-[#a080f0] transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          )}
        </div>
      </td>
      <td className="py-1.5 pr-2 w-24 text-right">
        {total.greaterThan(0) ? (
          <span className="text-sm tabular-nums text-[#d4d4d4]">{formatCurrency(total, currency)}</span>
        ) : (
          <span className="text-sm text-[#3b3b3b]">-</span>
        )}
      </td>
      <td className="py-1.5 pr-3 w-9 text-center">
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

interface AddItemRowProps {
  currency: Currency
  onAdd: (data: { name: string; qty: number; price?: string; link?: string }) => void
}

function AddItemRow({ currency, onAdd }: AddItemRowProps) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [link, setLink] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    if (!name.trim()) return
    const qtyDecimal = parseDecimalInput(qty)
    const priceDecimal = parseDecimalInput(price)
    onAdd({
      name: name.trim(),
      qty: qtyDecimal !== null && qtyDecimal.greaterThan(0) ? qtyDecimal.toNumber() : 1,
      price: priceDecimal !== null && priceDecimal.greaterThanOrEqualTo(0)
        ? priceDecimal.toDecimalPlaces(2).toString()
        : undefined,
      link: link.trim() || undefined
    })
    setName('')
    setQty('1')
    setPrice('')
    setLink('')
    nameRef.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit()
  }

  return (
    <tr className="border-b border-[#3b3b3b] hover:bg-[#2a2a2a] transition-colors">
      <td className="pl-4 pr-2 py-2">
        <div className="w-4 h-4 rounded border border-dashed border-[#3b3b3b] flex items-center justify-center">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#3b3b3b" strokeWidth="3">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </div>
      </td>
      <td className="py-1.5 pr-2">
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKey}
          placeholder="Adicionar item..."
          className="w-full bg-transparent text-sm text-[#d4d4d4] placeholder-[#555555] focus:outline-none"
        />
      </td>
      <td className="py-1.5 pr-2 w-16">
        <input
          type="number"
          value={qty}
          min="0.01"
          step="any"
          onChange={(e) => setQty(e.target.value)}
          onKeyDown={onKey}
          className="w-full bg-transparent text-sm text-center text-[#999999] focus:outline-none"
        />
      </td>
      <td className="py-1.5 pr-2 w-28">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[#555555] select-none">{CURRENCY_CONFIG[currency].symbol}</span>
          <input
            type="text"
            inputMode="decimal"
            value={price}
            placeholder="-"
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={onKey}
            className="w-full bg-transparent text-sm text-[#999999] placeholder-[#555555] focus:outline-none"
          />
        </div>
      </td>
      <td className="py-1.5 pr-2 w-28">
        <input
          type="text"
          value={link}
          placeholder="URL"
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={onKey}
          className="w-full bg-transparent text-xs text-[#999999] placeholder-[#555555] focus:outline-none truncate"
        />
      </td>
      <td className="py-1.5 pr-2 w-24" />
      <td className="py-1.5 pr-3 w-9 text-center">
        <button
          onClick={submit}
          disabled={!name.trim()}
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

interface ShoppingTabProps {
  list: FinancialTable
  onUpdate: (itemId: string, updates: Partial<Pick<ShoppingItem, 'name' | 'qty' | 'price' | 'done' | 'link'>>) => void
  onDelete: (itemId: string) => void
  onToggle: (itemId: string) => void
  onAdd: (data: { name: string; qty: number; price?: string; link?: string }) => void
}

export function ShoppingTab({ list, onUpdate, onDelete, onToggle, onAdd }: ShoppingTabProps) {
  const items = list.items
  const currency = list.currency
  const totalItems = items.length
  const doneItems = items.filter((i) => i.done).length
  const percent = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0
  const totalPrice = items.reduce((acc, i) => acc.plus(itemTotal(i)), new Decimal(0))
  const donePrice = items.filter((i) => i.done).reduce((acc, i) => acc.plus(itemTotal(i)), new Decimal(0))

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {totalItems > 0 && (
        <div className="flex items-center justify-end gap-4 px-5 py-2 border-b border-[#3b3b3b] shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-32 h-1.5 rounded-full bg-[#3b3b3b] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${percent}%`, backgroundColor: percent === 100 ? '#20b858' : '#7c3aed' }}
              />
            </div>
            <span className="text-xs tabular-nums" style={{ color: percent === 100 ? '#20b858' : '#7c3aed' }}>
              {percent}%
            </span>
          </div>
          {totalPrice.greaterThan(0) && (
            <span className="text-sm font-bold text-[#d4d4d4] tabular-nums">
              {formatCurrency(totalPrice, currency)}
            </span>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-[#232323] z-10">
            <tr className="border-b border-[#3b3b3b]">
              <th className="pl-4 pr-2 py-2 w-9" />
              <th className="py-2 pr-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[#999999]">Item</th>
              <th className="py-2 pr-2 w-16 text-center text-[10px] font-semibold uppercase tracking-wider text-[#999999]">Qtd</th>
              <th className="py-2 pr-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#999999]">Preço/un</th>
              <th className="py-2 pr-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#999999]">Link</th>
              <th className="py-2 pr-2 w-24 text-right text-[10px] font-semibold uppercase tracking-wider text-[#999999]">Total</th>
              <th className="py-2 pr-3 w-9" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                currency={currency}
                onUpdate={(updates) => onUpdate(item.id, updates)}
                onDelete={() => onDelete(item.id)}
                onToggle={() => onToggle(item.id)}
              />
            ))}
            <AddItemRow currency={currency} onAdd={onAdd} />
          </tbody>
        </table>
      </div>

      {totalItems > 0 && (
        <div className="border-t border-[#3b3b3b] px-5 py-3 shrink-0">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-3 flex-1">
              <span className="text-xs text-[#999999] shrink-0">
                {doneItems}/{totalItems} {doneItems === 1 ? 'concluído' : 'concluídos'}
              </span>
              <div className="flex-1 max-w-48 h-2 rounded-full bg-[#3b3b3b] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${percent}%`, backgroundColor: percent === 100 ? '#20b858' : '#7c3aed' }}
                />
              </div>
              <span className="text-xs font-medium tabular-nums shrink-0" style={{ color: percent === 100 ? '#20b858' : '#7c3aed' }}>
                {percent}%
              </span>
            </div>
            {totalPrice.greaterThan(0) && (
              <div className="flex items-end gap-6 shrink-0">
                {donePrice.greaterThan(0) && donePrice.lessThan(totalPrice) && (
                  <div className="text-right">
                    <p className="text-[10px] text-[#999999] uppercase tracking-wider mb-0.5">Gasto</p>
                    <p className="text-sm font-semibold text-[#20b858] tabular-nums">{formatCurrency(donePrice, currency)}</p>
                  </div>
                )}
                <div className="text-right">
                  <p className="text-[10px] text-[#999999] uppercase tracking-wider mb-0.5">Total</p>
                  <p className="text-base font-bold text-[#d4d4d4] tabular-nums">{formatCurrency(totalPrice, currency)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
