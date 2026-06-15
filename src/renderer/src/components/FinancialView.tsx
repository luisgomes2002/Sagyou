import { useEffect, useRef, useState } from 'react'
import Decimal from 'decimal.js'
import type { ShoppingItem, FinancialTable, FinancialTransaction, FinancialGoal, Currency } from '../types'
import { CURRENCY_CONFIG } from '../types'
import { useKanbanStore } from '../store/kanban'
import { ConfirmDialog } from './ConfirmDialog'

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]

const CURRENCY_LOCALE: Record<Currency, string> = {
  BRL: 'pt-BR',
  USD: 'en-US',
  JPY: 'ja-JP',
}

function formatCurrency(value: Decimal | number, currency: Currency): string {
  const { symbol, decimals } = CURRENCY_CONFIG[currency]
  const num = value instanceof Decimal ? value.toNumber() : value
  const formatted = num.toLocaleString(CURRENCY_LOCALE[currency], {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${symbol} ${formatted}`
}

function itemTotal(item: ShoppingItem): Decimal {
  return new Decimal(item.qty).times(item.price ?? 0)
}

function parseDecimalInput(raw: string): Decimal | null {
  const normalized = raw.trim().replace(',', '.')
  if (normalized === '') return null
  try {
    const d = new Decimal(normalized)
    return d.isNaN() || !d.isFinite() ? null : d
  } catch {
    return null
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

const FINANCIAL_CATEGORIES = [
  // Despesas
  'Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação',
  'Lazer', 'Vestuário', 'Serviços', 'Assinaturas', 'Impostos',
  'Taxa', 'Família', 'Viagem', 'Intercâmbio', 'Investimentos', 'Pet',
  // Receitas
  'Salário', 'Freelance', 'Trabalho', 'Aluguel Recebido',
  'Dividendos', 'Reembolso', 'Bônus', 'Venda', 'Pensão', 'Outros',
]

const CAT_COLORS = [
  '#818cf8', '#a78bfa', '#c084fc', '#f472b6', '#fb923c',
  '#facc15', '#4ade80', '#22d3ee', '#60a5fa', '#f87171',
  '#34d399', '#a3e635', '#e879f9', '#38bdf8', '#fbbf24',
]

// ── TableSidebar ──────────────────────────────────────────────────────────────

interface SidebarProps {
  lists: FinancialTable[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string, currency: Currency) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

function TableSidebar({ lists, activeId, onSelect, onCreate, onRename, onDelete }: SidebarProps) {
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCurrency, setNewCurrency] = useState<Currency>('BRL')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const handleCreate = () => {
    if (!newName.trim()) return
    onCreate(newName.trim(), newCurrency)
    setNewName('')
    setNewCurrency('BRL')
    setShowNew(false)
  }

  const startEdit = (list: FinancialTable, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(list.id)
    setEditName(list.name)
  }

  const commitEdit = () => {
    if (editingId && editName.trim()) onRename(editingId, editName.trim())
    setEditingId(null)
  }

  return (
    <div className="flex flex-col h-full border-r border-[#2a2d42] bg-[#0f1120]">
      <div className="px-3 py-3 border-b border-[#2a2d42]">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Tabelas</p>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {lists.length === 0 && (
          <p className="px-3 py-2 text-xs text-[#8892a4] italic">Nenhuma tabela</p>
        )}
        {lists.map((list) => {
          const done = list.items.filter((i) => i.done).length
          return (
            <div
              key={list.id}
              className={`group relative flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
                activeId === list.id ? 'bg-[#6366f1]/10' : 'hover:bg-[#1e2235]'
              }`}
              onClick={() => onSelect(list.id)}
            >
              {editingId === list.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') setEditingId(null)
                    e.stopPropagation()
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 text-xs bg-[#0d0f18] border border-[#6366f1] rounded px-1.5 py-0.5 text-[#e2e8f0] focus:outline-none"
                />
              ) : (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={activeId === list.id ? '#a5b4fc' : '#8892a4'} strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                  <span className={`flex-1 text-xs truncate ${activeId === list.id ? 'text-[#a5b4fc] font-medium' : 'text-[#8892a4]'}`}>
                    {list.name}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[9px] text-[#8892a4]">{done}/{list.items.length}</span>
                    <button
                      onClick={(e) => startEdit(list, e)}
                      className="p-0.5 rounded text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(list.id) }}
                      className="p-0.5 rounded text-[#8892a4] hover:text-red-400 transition-colors"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="p-3 border-t border-[#2a2d42] bg-[#0f1120]">
        {showNew ? (
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') { setShowNew(false); setNewName(''); setNewCurrency('BRL') }
              }}
              placeholder="Nome da tabela..."
              className="w-full text-xs px-2.5 py-2 rounded bg-[#0d0f18] border border-[#2a2d42] text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#6366f1] transition-colors"
            />
            <div className="flex items-center p-0.5 rounded-lg bg-[#0d0f18] border border-[#2a2d42]">
              {(['BRL', 'USD', 'JPY'] as Currency[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setNewCurrency(c)}
                  className={`flex-1 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    newCurrency === c ? 'bg-[#6366f1] text-white' : 'text-[#8892a4] hover:text-[#e2e8f0]'
                  }`}
                >
                  {CURRENCY_CONFIG[c].symbol} {c}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="flex-1 px-3 py-2 rounded bg-[#6366f1] text-white text-xs font-medium hover:bg-[#5254c5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Criar
              </button>
              <button
                onClick={() => { setShowNew(false); setNewName(''); setNewCurrency('BRL') }}
                className="flex-1 px-3 py-2 rounded border border-[#2a2d42] text-[#8892a4] text-xs font-medium hover:bg-[#1e2235] transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowNew(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium text-[#6366f1] border border-[#6366f1]/30 hover:bg-[#6366f1]/10 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nova tabela
          </button>
        )}
      </div>
    </div>
  )
}

// ── ShoppingTab ───────────────────────────────────────────────────────────────

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
  const [price, setPrice] = useState(item.price != null ? item.price.toString() : '')
  const [link, setLink] = useState(item.link ?? '')

  useEffect(() => {
    setName(item.name)
    setQty(item.qty.toString())
    setPrice(item.price != null ? item.price.toString() : '')
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
      const n = d.toDecimalPlaces(2).toNumber()
      if (n !== item.price) onUpdate({ price: n })
    } else {
      setPrice(item.price != null ? item.price.toString() : '')
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
    <tr className={`group border-b border-[#1a1d2e] transition-colors ${item.done ? 'opacity-60' : 'hover:bg-[#1a1c2c]'}`}>
      <td className="pl-4 pr-2 py-2">
        <button
          onClick={onToggle}
          title={item.done ? 'Desmarcar (remove lançamento em Finanças)' : 'Marcar como comprado (lança em Finanças)'}
          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
            item.done ? 'bg-[#22c55e] border-[#22c55e]' : 'border-[#3a3e58] hover:border-[#6366f1]'
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
            className={`flex-1 bg-transparent text-sm focus:outline-none focus:bg-[#0d0f18] focus:px-1.5 rounded transition-all ${
              item.done ? 'text-[#8892a4] line-through' : 'text-[#e2e8f0]'
            }`}
          />
          {item.done && item.linkedTransactionId && (
            <span className="text-[9px] text-[#6366f1]/70 shrink-0">→ Finanças</span>
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
          className="w-full bg-transparent text-sm text-center text-[#e2e8f0] focus:outline-none focus:bg-[#0d0f18] rounded transition-all"
        />
      </td>
      <td className="py-1.5 pr-2 w-28">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[#3a3e58] select-none">{CURRENCY_CONFIG[currency].symbol}</span>
          <input
            type="text"
            inputMode="decimal"
            value={price}
            placeholder="—"
            onChange={(e) => setPrice(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={blur}
            className="w-full bg-transparent text-sm text-[#e2e8f0] placeholder-[#3a3e58] focus:outline-none focus:bg-[#0d0f18] rounded transition-all"
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
            className="min-w-0 flex-1 bg-transparent text-xs text-[#6366f1] placeholder-[#3a3e58] focus:outline-none focus:bg-[#0d0f18] rounded truncate transition-all"
          />
          {item.link && (
            <button
              onClick={() => window.open(item.link, '_blank')}
              title={item.link}
              className="shrink-0 text-[#6366f1] hover:text-[#a5b4fc] transition-colors"
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
          <span className="text-sm tabular-nums text-[#e2e8f0]">{formatCurrency(total, currency)}</span>
        ) : (
          <span className="text-sm text-[#2a2d42]">—</span>
        )}
      </td>
      <td className="py-1.5 pr-3 w-9 text-center">
        <button
          onClick={onDelete}
          className="p-1 rounded text-[#2a2d42] hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

interface AddItemRowProps {
  currency: Currency
  onAdd: (data: { name: string; qty: number; price?: number; link?: string }) => void
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
        ? priceDecimal.toDecimalPlaces(2).toNumber()
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
    <tr className="border-b border-[#1a1d2e] hover:bg-[#1a1c2c] transition-colors">
      <td className="pl-4 pr-2 py-2">
        <div className="w-4 h-4 rounded border border-dashed border-[#2a2d42] flex items-center justify-center">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#2a2d42" strokeWidth="3">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
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
          className="w-full bg-transparent text-sm text-[#e2e8f0] placeholder-[#3a3e58] focus:outline-none"
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
          className="w-full bg-transparent text-sm text-center text-[#8892a4] focus:outline-none"
        />
      </td>
      <td className="py-1.5 pr-2 w-28">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[#3a3e58] select-none">{CURRENCY_CONFIG[currency].symbol}</span>
          <input
            type="text"
            inputMode="decimal"
            value={price}
            placeholder="—"
            onChange={(e) => setPrice(e.target.value)}
            onKeyDown={onKey}
            className="w-full bg-transparent text-sm text-[#8892a4] placeholder-[#3a3e58] focus:outline-none"
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
          className="w-full bg-transparent text-xs text-[#8892a4] placeholder-[#3a3e58] focus:outline-none truncate"
        />
      </td>
      <td className="py-1.5 pr-2 w-24" />
      <td className="py-1.5 pr-3 w-9 text-center">
        <button
          onClick={submit}
          disabled={!name.trim()}
          className="p-1 rounded text-[#6366f1] hover:bg-[#6366f1]/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
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
  onAdd: (data: { name: string; qty: number; price?: number; link?: string }) => void
}

function ShoppingTab({ list, onUpdate, onDelete, onToggle, onAdd }: ShoppingTabProps) {
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
        <div className="flex items-center justify-end gap-4 px-5 py-2 border-b border-[#2a2d42] shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-32 h-1.5 rounded-full bg-[#2a2d42] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${percent}%`, backgroundColor: percent === 100 ? '#22c55e' : '#6366f1' }}
              />
            </div>
            <span className="text-xs tabular-nums" style={{ color: percent === 100 ? '#22c55e' : '#6366f1' }}>
              {percent}%
            </span>
          </div>
          {totalPrice.greaterThan(0) && (
            <span className="text-sm font-bold text-[#e2e8f0] tabular-nums">{formatCurrency(totalPrice, currency)}</span>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-[#13151f] z-10">
            <tr className="border-b border-[#2a2d42]">
              <th className="pl-4 pr-2 py-2 w-9" />
              <th className="py-2 pr-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Item</th>
              <th className="py-2 pr-2 w-16 text-center text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Qtd</th>
              <th className="py-2 pr-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Preço/un</th>
              <th className="py-2 pr-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Link</th>
              <th className="py-2 pr-2 w-24 text-right text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Total</th>
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
        <div className="border-t border-[#2a2d42] px-5 py-3 shrink-0">
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-3 flex-1">
              <span className="text-xs text-[#8892a4] shrink-0">
                {doneItems}/{totalItems} {doneItems === 1 ? 'concluído' : 'concluídos'}
              </span>
              <div className="flex-1 max-w-48 h-2 rounded-full bg-[#2a2d42] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${percent}%`, backgroundColor: percent === 100 ? '#22c55e' : '#6366f1' }}
                />
              </div>
              <span
                className="text-xs font-medium tabular-nums shrink-0"
                style={{ color: percent === 100 ? '#22c55e' : '#6366f1' }}
              >
                {percent}%
              </span>
            </div>
            {totalPrice.greaterThan(0) && (
              <div className="flex items-end gap-6 shrink-0">
                {donePrice.greaterThan(0) && donePrice.lessThan(totalPrice) && (
                  <div className="text-right">
                    <p className="text-[10px] text-[#8892a4] uppercase tracking-wider mb-0.5">Gasto</p>
                    <p className="text-sm font-semibold text-[#22c55e] tabular-nums">{formatCurrency(donePrice, currency)}</p>
                  </div>
                )}
                <div className="text-right">
                  <p className="text-[10px] text-[#8892a4] uppercase tracking-wider mb-0.5">Total</p>
                  <p className="text-base font-bold text-[#e2e8f0] tabular-nums">{formatCurrency(totalPrice, currency)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── GoalModal ─────────────────────────────────────────────────────────────────

interface GoalModalProps {
  open: boolean
  goal?: FinancialGoal
  onSave: (data: Omit<FinancialGoal, 'id'>) => void
  onClose: () => void
}

function GoalModal({ open, goal, onSave, onClose }: GoalModalProps) {
  const now = new Date()
  const [name, setName] = useState('')
  const [targetAmount, setTargetAmount] = useState('')
  const [targetMonth, setTargetMonth] = useState(now.getMonth() + 1)
  const [targetYear, setTargetYear] = useState(now.getFullYear())

  useEffect(() => {
    if (open) {
      setName(goal?.name ?? '')
      setTargetAmount(goal?.targetAmount.toString() ?? '')
      setTargetMonth(goal?.targetMonth ?? now.getMonth() + 1)
      setTargetYear(goal?.targetYear ?? now.getFullYear())
    }
  }, [open])

  if (!open) return null

  const amount = parseDecimalInput(targetAmount)
  const valid = name.trim().length > 0 && amount !== null && amount.greaterThan(0) && targetYear >= now.getFullYear()

  const handleSubmit = () => {
    if (!valid || !amount) return
    onSave({ name: name.trim(), targetAmount: amount.toNumber(), targetMonth, targetYear })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-80 rounded-xl border border-[#2a2d42] bg-[#13151f] shadow-2xl p-5">
        <h3 className="text-sm font-semibold text-[#e2e8f0] mb-4">
          {goal ? 'Editar meta' : 'Nova meta financeira'}
        </h3>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] block mb-1">Nome</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="ex: Aluguel agosto"
              className="w-full px-3 py-2 rounded-lg bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#6366f1] transition-colors"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] block mb-1">Valor necessário</label>
            <input
              type="text"
              inputMode="decimal"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="0"
              className="w-full px-3 py-2 rounded-lg bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#6366f1] transition-colors"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] block mb-1">Prazo</label>
            <div className="flex gap-2">
              <select
                value={targetMonth}
                onChange={(e) => setTargetMonth(Number(e.target.value))}
                className="flex-1 px-2 py-2 rounded-lg bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] focus:outline-none focus:border-[#6366f1] transition-colors"
              >
                {MONTH_NAMES.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
              <input
                type="number"
                value={targetYear}
                min={now.getFullYear()}
                onChange={(e) => setTargetYear(Number(e.target.value))}
                className="w-20 px-2 py-2 rounded-lg bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] focus:outline-none focus:border-[#6366f1] transition-colors text-center"
              />
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button
            onClick={handleSubmit}
            disabled={!valid}
            className="flex-1 py-2 rounded-lg bg-[#6366f1] text-sm text-white font-medium hover:bg-[#5254c5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {goal ? 'Salvar' : 'Criar'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#2a2d42] text-sm text-[#8892a4] hover:bg-[#1e2235] transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── FinancialGoalCard ─────────────────────────────────────────────────────────

interface FinancialGoalCardProps {
  goal: FinancialGoal
  accBalance: number
  currency: Currency
  onEdit: () => void
  onDelete: () => void
}

function FinancialGoalCard({ goal, accBalance, currency, onEdit, onDelete }: FinancialGoalCardProps) {
  const now = new Date()
  const progress = goal.targetAmount > 0 ? Math.min(Math.max(accBalance / goal.targetAmount, 0), 1) : 0
  const percent = Math.round(progress * 100)
  const achieved = accBalance >= goal.targetAmount
  const savedAmount = Math.min(Math.max(accBalance, 0), goal.targetAmount)
  const remaining = Math.max(goal.targetAmount - accBalance, 0)

  const monthsLeft = Math.max(
    (goal.targetYear - now.getFullYear()) * 12 + (goal.targetMonth - (now.getMonth() + 1)),
    0
  )
  const isOverdue = !achieved && monthsLeft === 0
  const isUrgent = !achieved && monthsLeft > 0 && monthsLeft <= 2
  const monthlyNeeded = monthsLeft > 0 && !achieved ? remaining / monthsLeft : 0

  const R = 30
  const circ = 2 * Math.PI * R
  const ringColor = achieved ? '#22c55e' : isOverdue ? '#ef4444' : isUrgent ? '#fb923c' : '#6366f1'
  const ringGlow = achieved ? '#22c55e' : isOverdue ? '#ef4444' : isUrgent ? '#fb923c' : '#818cf8'

  return (
    <div
      className={`rounded-xl border p-4 group transition-all duration-200 ${
        achieved
          ? 'border-[#22c55e]/25 bg-[#22c55e]/5'
          : isOverdue
          ? 'border-red-500/25 bg-red-500/5'
          : 'border-[#2a2d42] bg-[#1e2235] hover:border-[#3a3e58]'
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Ring */}
        <div className="relative shrink-0 w-[76px] h-[76px]">
          <svg width="76" height="76" viewBox="0 0 76 76">
            <circle cx="38" cy="38" r={R} fill="none" stroke="#2a2d42" strokeWidth="5" />
            <circle
              cx="38" cy="38" r={R}
              fill="none"
              stroke={ringColor}
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${progress * circ} ${circ}`}
              transform="rotate(-90 38 38)"
              style={{ transition: 'stroke-dasharray 0.6s ease', filter: achieved ? `drop-shadow(0 0 4px ${ringGlow}60)` : 'none' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-0.5">
            <span className="text-sm font-bold leading-none tabular-nums" style={{ color: ringColor }}>
              {percent}%
            </span>
            {achieved && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={ringColor} strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-[#e2e8f0] leading-snug truncate">{goal.name}</h4>
              <p className="text-[10px] text-[#8892a4] mt-0.5">
                Prazo: {MONTH_NAMES[goal.targetMonth - 1]} {goal.targetYear}
              </p>
            </div>
            {achieved && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#22c55e]/15 text-[#22c55e] text-[10px] font-semibold shrink-0">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Alcançado
              </span>
            )}
            {isOverdue && (
              <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[10px] font-semibold shrink-0">
                Vencido
              </span>
            )}
            {isUrgent && (
              <span className="px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 text-[10px] font-semibold shrink-0">
                {monthsLeft}m restante{monthsLeft !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[#8892a4] mb-0.5">Acumulado</p>
              <p className="text-xs font-bold text-[#4ade80] tabular-nums">{formatCurrency(savedAmount, currency)}</p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[#8892a4] mb-0.5">Faltam</p>
              <p className="text-xs font-bold text-[#e2e8f0] tabular-nums">{formatCurrency(remaining, currency)}</p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[#8892a4] mb-0.5">Meta total</p>
              <p className="text-xs font-bold text-[#e2e8f0] tabular-nums">{formatCurrency(goal.targetAmount, currency)}</p>
            </div>
          </div>

          {/* Monthly hint */}
          {!achieved && monthsLeft > 0 && (
            <div className="mt-2.5 pt-2.5 border-t border-[#2a2d42]">
              <p className="text-[10px] text-[#8892a4] leading-relaxed">
                Economizar{' '}
                <span className="text-[#a5b4fc] font-semibold">{formatCurrency(monthlyNeeded, currency)}/mês</span>
                {' '}para atingir no prazo
              </p>
            </div>
          )}
          {achieved && (
            <div className="mt-2.5 pt-2.5 border-t border-[#22c55e]/20">
              <p className="text-[10px] text-[#22c55e]/60 leading-relaxed">
                Saldo excede a meta em{' '}
                <span className="text-[#4ade80] font-semibold">{formatCurrency(accBalance - goal.targetAmount, currency)}</span>
              </p>
            </div>
          )}
          {isOverdue && (
            <div className="mt-2.5 pt-2.5 border-t border-red-500/20">
              <p className="text-[10px] text-red-400/60 leading-relaxed">
                Faltam{' '}
                <span className="text-red-400 font-semibold">{formatCurrency(remaining, currency)}</span>
                {' '}para concluir esta meta
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-1 justify-end mt-3 pt-2.5 border-t border-[#2a2d42]/50 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#2a2d42] transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Editar
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium text-[#8892a4] hover:text-red-400 hover:bg-red-400/10 transition-colors"
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
          Deletar
        </button>
      </div>
    </div>
  )
}

// ── AddTransactionRow ─────────────────────────────────────────────────────────

interface AddTransactionRowProps {
  currency: Currency
  onAdd: (data: Omit<FinancialTransaction, 'id'>) => void
}

function AddTransactionRow({ currency, onAdd }: AddTransactionRowProps) {
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [type, setType] = useState<'income' | 'expense'>('expense')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO)
  const descRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    if (!description.trim()) return
    const amountDecimal = parseDecimalInput(amount)
    if (amountDecimal === null || amountDecimal.lessThanOrEqualTo(0)) return
    onAdd({
      description: description.trim(),
      category: category.trim() || undefined,
      type,
      amount: amountDecimal.toNumber(),
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
    <tr className="border-b border-[#1a1d2e] hover:bg-[#1a1c2c] transition-colors">
      <td className="pl-4 pr-2 py-1.5 w-28">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full bg-transparent text-xs text-[#8892a4] focus:outline-none"
        />
      </td>
      <td className="py-1.5 pr-2">
        <input
          ref={descRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={onKey}
          placeholder="Descrição..."
          className="w-full bg-transparent text-sm text-[#e2e8f0] placeholder-[#3a3e58] focus:outline-none"
        />
      </td>
      <td className="py-1.5 pr-2 w-28">
        <input
          list="fin-categories"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          onKeyDown={onKey}
          placeholder="Categoria"
          className="w-full bg-transparent text-xs text-[#8892a4] placeholder-[#3a3e58] focus:outline-none"
        />
      </td>
      <td className="py-1.5 pr-2 w-20 text-center">
        <button
          onClick={() => setType(type === 'income' ? 'expense' : 'income')}
          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
            type === 'income'
              ? 'bg-[#22c55e]/15 text-[#4ade80]'
              : 'bg-red-500/15 text-red-400'
          }`}
        >
          {type === 'income' ? '↑ Entrada' : '↓ Saída'}
        </button>
      </td>
      <td className="py-1.5 pr-2 w-32">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[#3a3e58] select-none">{CURRENCY_CONFIG[currency].symbol}</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            placeholder="0"
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={onKey}
            className="w-full bg-transparent text-sm text-[#8892a4] placeholder-[#3a3e58] focus:outline-none"
          />
        </div>
      </td>
      <td className="py-1.5 pr-3 w-9 text-center">
        <button
          onClick={submit}
          disabled={!description.trim() || !parseDecimalInput(amount)?.greaterThan(0)}
          className="p-1 rounded text-[#6366f1] hover:bg-[#6366f1]/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
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

function TransactionRow({ tx, currency, onUpdate, onDelete }: TransactionRowProps) {
  const [editDate, setEditDate] = useState(tx.date)
  const [editDesc, setEditDesc] = useState(tx.description)
  const [editCat, setEditCat] = useState(tx.category ?? '')
  const [editAmount, setEditAmount] = useState(tx.amount.toString())

  useEffect(() => {
    setEditDate(tx.date)
    setEditDesc(tx.description)
    setEditCat(tx.category ?? '')
    setEditAmount(tx.amount.toString())
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
      const n = d.toDecimalPlaces(2).toNumber()
      if (n !== tx.amount) onUpdate({ amount: n })
    } else {
      setEditAmount(tx.amount.toString())
    }
  }

  return (
    <tr className="group border-b border-[#1a1d2e] hover:bg-[#1a1c2c] transition-colors">
      <td className="pl-4 pr-2 py-2 w-28">
        <input
          type="date"
          value={editDate}
          onChange={(e) => setEditDate(e.target.value)}
          onBlur={commitDate}
          onKeyDown={blur}
          className="w-full bg-transparent text-xs text-[#8892a4] tabular-nums focus:outline-none focus:bg-[#0d0f18] focus:px-1 rounded transition-all"
        />
      </td>
      <td className="py-2 pr-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {tx.fromShopping && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" className="shrink-0 opacity-60">
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
            className={`flex-1 min-w-0 bg-transparent text-sm focus:outline-none focus:bg-[#0d0f18] focus:px-1.5 rounded transition-all ${
              tx.fromShopping ? 'text-[#a5b4fc]' : 'text-[#e2e8f0]'
            }`}
          />
        </div>
      </td>
      <td className="py-2 pr-2 w-28">
        <input
          list="fin-categories"
          value={editCat}
          onChange={(e) => setEditCat(e.target.value)}
          onBlur={commitCat}
          onKeyDown={blur}
          placeholder="—"
          className="w-full bg-transparent text-xs text-[#8892a4] placeholder-[#3a3e58] focus:outline-none focus:bg-[#0d0f18] focus:px-1 rounded transition-all"
        />
      </td>
      <td className="py-2 pr-2 w-20 text-center">
        <button
          onClick={() => onUpdate({ type: tx.type === 'income' ? 'expense' : 'income' })}
          title="Clique para alternar tipo"
          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
            tx.type === 'income'
              ? 'bg-[#22c55e]/15 text-[#4ade80] hover:bg-[#22c55e]/25'
              : 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
          }`}
        >
          {tx.type === 'income' ? '↑ Entrada' : '↓ Saída'}
        </button>
      </td>
      <td className="py-2 pr-2 w-32 text-right">
        <div className="flex items-center justify-end gap-1">
          <span className="text-[10px] text-[#3a3e58] select-none">{CURRENCY_CONFIG[currency].symbol}</span>
          <input
            type="text"
            inputMode="decimal"
            value={editAmount}
            onChange={(e) => setEditAmount(e.target.value)}
            onBlur={commitAmount}
            onKeyDown={blur}
            className={`w-20 bg-transparent text-sm tabular-nums font-medium text-right focus:outline-none focus:bg-[#0d0f18] focus:px-1 rounded transition-all ${
              tx.type === 'income' ? 'text-[#4ade80]' : 'text-[#e2e8f0]'
            }`}
          />
        </div>
      </td>
      <td className="py-2 pr-3 w-9 text-center">
        <button
          onClick={onDelete}
          className="p-1 rounded text-[#2a2d42] hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

// ── FinanceTab ────────────────────────────────────────────────────────────────

interface FinanceTabProps {
  list: FinancialTable
  onAddTransaction: (data: Omit<FinancialTransaction, 'id'>) => void
  onUpdateTransaction: (txId: string, updates: Partial<Omit<FinancialTransaction, 'id'>>) => void
  onDeleteTransaction: (txId: string) => void
  onAddGoal: (data: Omit<FinancialGoal, 'id'>) => void
  onUpdateGoal: (goalId: string, updates: Partial<Omit<FinancialGoal, 'id'>>) => void
  onDeleteGoal: (goalId: string) => void
}

function FinanceTab({
  list,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  onAddGoal,
  onUpdateGoal,
  onDeleteGoal
}: FinanceTabProps) {
  const currency = list.currency
  const now = new Date()
  const [activeMonth, setActiveMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [goalModal, setGoalModal] = useState<{ open: boolean; goal?: FinancialGoal }>({ open: false })
  const [deleteGoalConfirm, setDeleteGoalConfirm] = useState<{ open: boolean; goalId: string; name: string }>({
    open: false, goalId: '', name: ''
  })

  const prevMonth = () => {
    setActiveMonth((m) => {
      if (m.month === 1) return { year: m.year - 1, month: 12 }
      return { ...m, month: m.month - 1 }
    })
  }

  const nextMonth = () => {
    setActiveMonth((m) => {
      if (m.month === 12) return { year: m.year + 1, month: 1 }
      return { ...m, month: m.month + 1 }
    })
  }

  const monthTxs = list.transactions.filter((t) => {
    const [y, m] = t.date.split('-').map(Number)
    return y === activeMonth.year && m === activeMonth.month
  }).sort((a, b) => b.date.localeCompare(a.date))

  const monthIncome = monthTxs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const monthExpense = monthTxs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const monthBalance = monthIncome - monthExpense

  const accBalance = list.transactions.reduce((s, t) => t.type === 'income' ? s + t.amount : s - t.amount, 0)

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* Month navigator */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#2a2d42]">
          <button
            onClick={prevMonth}
            className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="text-sm font-medium text-[#e2e8f0] min-w-32 text-center">
            {MONTH_NAMES[activeMonth.month - 1]} {activeMonth.year}
          </span>
          <button
            onClick={nextMonth}
            className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button
            onClick={() => setActiveMonth({ year: now.getFullYear(), month: now.getMonth() + 1 })}
            className="ml-1 text-[10px] text-[#8892a4] hover:text-[#6366f1] transition-colors"
          >
            Hoje
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3 px-5 py-4 border-b border-[#2a2d42]">
          <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-1">Entradas</p>
            <p className="text-sm font-bold text-[#4ade80] tabular-nums">{formatCurrency(monthIncome, currency)}</p>
          </div>
          <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-1">Saídas</p>
            <p className="text-sm font-bold text-red-400 tabular-nums">{formatCurrency(monthExpense, currency)}</p>
          </div>
          <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-1">Saldo do Mês</p>
            <p className={`text-sm font-bold tabular-nums ${monthBalance >= 0 ? 'text-[#e2e8f0]' : 'text-red-400'}`}>
              {formatCurrency(monthBalance, currency)}
            </p>
          </div>
          <div className="rounded-lg bg-[#6366f1]/10 border border-[#6366f1]/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a5b4fc] mb-1">Saldo Acumulado</p>
            <p className={`text-sm font-bold tabular-nums ${accBalance >= 0 ? 'text-[#a5b4fc]' : 'text-red-400'}`}>
              {formatCurrency(accBalance, currency)}
            </p>
          </div>
        </div>

        {/* Goals */}
        <div className="px-5 pt-4 pb-5 border-b border-[#2a2d42]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
              </svg>
              <p className="text-xs font-semibold text-[#e2e8f0]">Objetivos Financeiros</p>
              {list.goals.length > 0 && (
                <span className="text-[10px] text-[#8892a4]">
                  ({list.goals.filter((g) => accBalance >= g.targetAmount).length}/{list.goals.length} alcançados)
                </span>
              )}
            </div>
            <button
              onClick={() => setGoalModal({ open: true })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium text-[#6366f1] border border-[#6366f1]/30 hover:bg-[#6366f1]/10 transition-colors"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Novo objetivo
            </button>
          </div>

          {list.goals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 rounded-xl border border-dashed border-[#2a2d42]">
              <div className="w-12 h-12 rounded-full bg-[#1e2235] flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3a3e58" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-[#8892a4]">Nenhum objetivo criado</p>
                <p className="text-[10px] text-[#3a3e58] mt-0.5">Defina metas de economia com prazo e valor alvo</p>
              </div>
              <button
                onClick={() => setGoalModal({ open: true })}
                className="px-3 py-1.5 rounded-lg bg-[#6366f1]/15 text-[10px] font-medium text-[#a5b4fc] hover:bg-[#6366f1]/25 transition-colors"
              >
                Criar primeiro objetivo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {list.goals.map((goal) => (
                <FinancialGoalCard
                  key={goal.id}
                  goal={goal}
                  accBalance={accBalance}
                  currency={currency}
                  onEdit={() => setGoalModal({ open: true, goal })}
                  onDelete={() => setDeleteGoalConfirm({ open: true, goalId: goal.id, name: goal.name })}
                />
              ))}
            </div>
          )}
        </div>

        {/* Transactions */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs font-semibold text-[#e2e8f0] mb-3">
            Transações — {MONTH_NAMES[activeMonth.month - 1]} {activeMonth.year}
            <span className="ml-2 text-[#8892a4] font-normal">({monthTxs.length})</span>
          </p>
        </div>
        <datalist id="fin-categories">
          {FINANCIAL_CATEGORIES.map((c) => <option key={c} value={c} />)}
        </datalist>
        <table className="w-full">
          <thead className="sticky top-0 bg-[#13151f] z-10">
            <tr className="border-b border-[#2a2d42]">
              <th className="pl-4 pr-2 py-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Data</th>
              <th className="py-2 pr-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Descrição</th>
              <th className="py-2 pr-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Categoria</th>
              <th className="py-2 pr-2 w-20 text-center text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Tipo</th>
              <th className="py-2 pr-2 w-32 text-right text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Valor</th>
              <th className="py-2 pr-3 w-9" />
            </tr>
          </thead>
          <tbody>
            <AddTransactionRow currency={currency} onAdd={onAddTransaction} />
            {monthTxs.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                currency={currency}
                onUpdate={(updates) => onUpdateTransaction(tx.id, updates)}
                onDelete={() => onDeleteTransaction(tx.id)}
              />
            ))}
            {monthTxs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-xs text-[#8892a4] italic">
                  Nenhuma transação em {MONTH_NAMES[activeMonth.month - 1]}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <GoalModal
        open={goalModal.open}
        goal={goalModal.goal}
        onSave={(data) => {
          if (goalModal.goal) onUpdateGoal(goalModal.goal.id, data)
          else onAddGoal(data)
        }}
        onClose={() => setGoalModal({ open: false })}
      />

      <ConfirmDialog
        open={deleteGoalConfirm.open}
        title="Deletar objetivo"
        message={`Deletar o objetivo "${deleteGoalConfirm.name}"?`}
        confirmLabel="Deletar"
        onConfirm={() => {
          onDeleteGoal(deleteGoalConfirm.goalId)
          setDeleteGoalConfirm((s) => ({ ...s, open: false }))
        }}
        onCancel={() => setDeleteGoalConfirm((s) => ({ ...s, open: false }))}
      />
    </div>
  )
}

// ── AnalyticsTab ──────────────────────────────────────────────────────────────

function AnalyticsTab({ list }: { list: FinancialTable }) {
  const { currency, transactions } = list
  const allYears = [...new Set(transactions.map((t) => t.date.slice(0, 4)))].sort().reverse()
  const [selectedYear, setSelectedYear] = useState<string>('all')
  const [catView, setCatView] = useState<'expense' | 'income'>('expense')

  const filtered = selectedYear === 'all' ? transactions : transactions.filter((t) => t.date.startsWith(selectedYear))
  const expenses = filtered.filter((t) => t.type === 'expense')
  const incomes = filtered.filter((t) => t.type === 'income')
  const totalExpense = expenses.reduce((s, t) => s + t.amount, 0)
  const totalIncome = incomes.reduce((s, t) => s + t.amount, 0)
  const totalBalance = totalIncome - totalExpense

  const buildCatEntries = (txs: FinancialTransaction[]) => {
    const map: Record<string, number> = {}
    for (const t of txs) {
      const cat = t.category || 'Sem categoria'
      map[cat] = (map[cat] ?? 0) + t.amount
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }

  const expCatEntries = buildCatEntries(expenses)
  const incCatEntries = buildCatEntries(incomes)
  const activeCatEntries = catView === 'expense' ? expCatEntries : incCatEntries
  const activeTotal = catView === 'expense' ? totalExpense : totalIncome
  const activeMax = activeCatEntries[0]?.[1] ?? 1

  const byMonth: Record<string, { income: number; expense: number; balance: number }> = {}
  for (const t of filtered) {
    const key = t.date.slice(0, 7)
    if (!byMonth[key]) byMonth[key] = { income: 0, expense: 0, balance: 0 }
    if (t.type === 'income') byMonth[key].income += t.amount
    else byMonth[key].expense += t.amount
  }
  for (const k of Object.keys(byMonth)) {
    byMonth[k].balance = byMonth[k].income - byMonth[k].expense
  }
  const monthEntries = Object.entries(byMonth)
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => a.key.localeCompare(b.key))

  const maxMonthBar = Math.max(...monthEntries.map((m) => Math.max(m.income, m.expense)), 1)
  const avgMonthlyExpense = monthEntries.length > 0 ? totalExpense / monthEntries.length : 0

  const bestMonth = monthEntries.length > 1
    ? monthEntries.reduce((best, m) => m.balance > best.balance ? m : best)
    : null
  const worstMonth = monthEntries.length > 1
    ? monthEntries.reduce((worst, m) => m.balance < worst.balance ? m : worst)
    : null

  const topExpCat = expCatEntries[0]
  const topIncCat = incCatEntries[0]

  function monthLabel(key: string): string {
    const [y, m] = key.split('-')
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 text-[#8892a4]">
        <p className="text-sm">Sem transações para analisar</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
      {/* Year filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setSelectedYear('all')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            selectedYear === 'all'
              ? 'bg-[#6366f1]/15 text-[#a5b4fc]'
              : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
          }`}
        >
          Todos
        </button>
        {allYears.map((y) => (
          <button
            key={y}
            onClick={() => setSelectedYear(y)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              selectedYear === y
                ? 'bg-[#6366f1]/15 text-[#a5b4fc]'
                : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-1">Total Entradas</p>
          <p className="text-sm font-bold text-[#4ade80] tabular-nums">{formatCurrency(totalIncome, currency)}</p>
        </div>
        <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-1">Total Saídas</p>
          <p className="text-sm font-bold text-red-400 tabular-nums">{formatCurrency(totalExpense, currency)}</p>
        </div>
        <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-1">Saldo Geral</p>
          <p className={`text-sm font-bold tabular-nums ${totalBalance >= 0 ? 'text-[#e2e8f0]' : 'text-red-400'}`}>
            {totalBalance >= 0 ? '+' : ''}{formatCurrency(totalBalance, currency)}
          </p>
        </div>
        <div className="rounded-lg bg-[#6366f1]/10 border border-[#6366f1]/30 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a5b4fc] mb-1">Média/Mês Gastos</p>
          <p className="text-sm font-bold text-[#a5b4fc] tabular-nums">{formatCurrency(avgMonthlyExpense, currency)}</p>
        </div>
      </div>

      {/* Highlights: 2×2 grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-[#22c55e]/25 bg-[#22c55e]/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#22c55e]/60 mb-1.5">Melhor Mês</p>
          {bestMonth ? (
            <>
              <p className="text-sm font-bold text-[#4ade80]">{monthLabel(bestMonth.key)}</p>
              <p className="text-xs tabular-nums text-[#4ade80]/70 mt-0.5">
                {bestMonth.balance >= 0 ? '+' : ''}{formatCurrency(bestMonth.balance, currency)}
              </p>
            </>
          ) : <p className="text-xs text-[#4a5068]">Dados insuficientes</p>}
        </div>
        <div className="rounded-lg border border-[#6366f1]/25 bg-[#6366f1]/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a5b4fc]/60 mb-1.5">Maior Gasto</p>
          {topExpCat ? (
            <>
              <p className="text-sm font-bold text-[#a5b4fc] truncate">{topExpCat[0]}</p>
              <p className="text-xs tabular-nums text-[#a5b4fc]/70 mt-0.5">
                {formatCurrency(topExpCat[1], currency)}
                {totalExpense > 0 ? ` · ${Math.round(topExpCat[1] / totalExpense * 100)}%` : ''}
              </p>
            </>
          ) : <p className="text-xs text-[#4a5068]">—</p>}
        </div>
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400/60 mb-1.5">Pior Mês</p>
          {worstMonth ? (
            <>
              <p className="text-sm font-bold text-red-400">{monthLabel(worstMonth.key)}</p>
              <p className="text-xs tabular-nums text-red-400/70 mt-0.5">
                {worstMonth.balance >= 0 ? '+' : ''}{formatCurrency(worstMonth.balance, currency)}
              </p>
            </>
          ) : <p className="text-xs text-[#4a5068]">Dados insuficientes</p>}
        </div>
        <div className="rounded-lg border border-[#22c55e]/25 bg-[#22c55e]/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#22c55e]/60 mb-1.5">Maior Ganho</p>
          {topIncCat ? (
            <>
              <p className="text-sm font-bold text-[#4ade80] truncate">{topIncCat[0]}</p>
              <p className="text-xs tabular-nums text-[#4ade80]/70 mt-0.5">
                {formatCurrency(topIncCat[1], currency)}
                {totalIncome > 0 ? ` · ${Math.round(topIncCat[1] / totalIncome * 100)}%` : ''}
              </p>
            </>
          ) : <p className="text-xs text-[#4a5068]">—</p>}
        </div>
      </div>

      {/* Category ranking with toggle */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-[#e2e8f0]">Ranking por Categoria</p>
          <div className="flex items-center p-0.5 rounded-lg bg-[#1e2235] border border-[#2a2d42]">
            <button
              onClick={() => setCatView('expense')}
              className={`px-3 py-1 rounded-md text-[10px] font-medium transition-colors ${
                catView === 'expense'
                  ? 'bg-[#2a2d42] text-red-400'
                  : 'text-[#8892a4] hover:text-[#e2e8f0]'
              }`}
            >
              ↓ Gastos
            </button>
            <button
              onClick={() => setCatView('income')}
              className={`px-3 py-1 rounded-md text-[10px] font-medium transition-colors ${
                catView === 'income'
                  ? 'bg-[#2a2d42] text-[#4ade80]'
                  : 'text-[#8892a4] hover:text-[#e2e8f0]'
              }`}
            >
              ↑ Ganhos
            </button>
          </div>
        </div>

        {activeCatEntries.length === 0 ? (
          <p className="text-xs text-[#4a5068] italic">
            Sem {catView === 'expense' ? 'gastos' : 'ganhos'} com categorias registradas
          </p>
        ) : (
          <div className="space-y-2.5">
            {activeCatEntries.map(([cat, amount], i) => {
              const color = CAT_COLORS[i % CAT_COLORS.length]
              const pct = activeTotal > 0 ? Math.round(amount / activeTotal * 100) : 0
              return (
                <div key={cat} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-[#4a5068] w-5 shrink-0 text-right">#{i + 1}</span>
                  <span className="text-xs text-[#8892a4] w-28 truncate shrink-0">{cat}</span>
                  <div className="flex-1 h-2 rounded-full bg-[#0d0f18] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${(amount / activeMax) * 100}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-[#e2e8f0] w-24 text-right shrink-0 font-medium">{formatCurrency(amount, currency)}</span>
                  <span className="text-[10px] text-[#8892a4] w-8 text-right shrink-0">{pct}%</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Monthly history */}
      {monthEntries.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[#e2e8f0] mb-3">Histórico Mensal</p>
          <div className="space-y-2">
            {[...monthEntries].reverse().map((m) => {
              const isBest = bestMonth && m.key === bestMonth.key
              const isWorst = worstMonth && m.key === worstMonth.key
              return (
                <div
                  key={m.key}
                  className={`rounded-lg p-3 border transition-colors ${
                    isBest
                      ? 'border-[#22c55e]/25 bg-[#22c55e]/5'
                      : isWorst
                      ? 'border-red-500/25 bg-red-500/5'
                      : 'border-[#2a2d42] bg-[#1e2235]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[#e2e8f0]">{monthLabel(m.key)}</span>
                      {isBest && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#22c55e]/15 text-[#4ade80] font-semibold">Melhor</span>
                      )}
                      {isWorst && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-semibold">Pior</span>
                      )}
                    </div>
                    <span className={`text-xs font-bold tabular-nums ${m.balance >= 0 ? 'text-[#4ade80]' : 'text-red-400'}`}>
                      {m.balance >= 0 ? '+' : ''}{formatCurrency(m.balance, currency)}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-[#4ade80] w-12 shrink-0">Entradas</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[#0d0f18] overflow-hidden">
                        <div className="h-full rounded-full bg-[#22c55e]" style={{ width: `${(m.income / maxMonthBar) * 100}%` }} />
                      </div>
                      <span className="text-[9px] tabular-nums text-[#4ade80] w-24 text-right shrink-0">{formatCurrency(m.income, currency)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-red-400 w-12 shrink-0">Saídas</span>
                      <div className="flex-1 h-1.5 rounded-full bg-[#0d0f18] overflow-hidden">
                        <div className="h-full rounded-full bg-red-500" style={{ width: `${(m.expense / maxMonthBar) * 100}%` }} />
                      </div>
                      <span className="text-[9px] tabular-nums text-red-400 w-24 text-right shrink-0">{formatCurrency(m.expense, currency)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── FinancialView ─────────────────────────────────────────────────────────────

export function FinancialView() {
  const lists = useKanbanStore((s) => s.lists)
  const createList = useKanbanStore((s) => s.createList)
  const updateList = useKanbanStore((s) => s.updateList)
  const deleteList = useKanbanStore((s) => s.deleteList)
  const addItem = useKanbanStore((s) => s.addItem)
  const updateItem = useKanbanStore((s) => s.updateItem)
  const deleteItem = useKanbanStore((s) => s.deleteItem)
  const toggleItem = useKanbanStore((s) => s.toggleItem)
  const addTransaction = useKanbanStore((s) => s.addTransaction)
  const updateTransaction = useKanbanStore((s) => s.updateTransaction)
  const deleteTransaction = useKanbanStore((s) => s.deleteTransaction)
  const addFinancialGoal = useKanbanStore((s) => s.addFinancialGoal)
  const updateFinancialGoal = useKanbanStore((s) => s.updateFinancialGoal)
  const deleteFinancialGoal = useKanbanStore((s) => s.deleteFinancialGoal)

  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'shopping' | 'finance' | 'analytics'>('shopping')
  const [confirm, setConfirm] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({
    open: false, title: '', message: '', onConfirm: () => {}
  })

  useEffect(() => {
    if (!activeListId && lists.length > 0) {
      setActiveListId(lists[0].id)
      return
    }
    if (activeListId && !lists.find((l) => l.id === activeListId)) {
      setActiveListId(lists[0]?.id ?? null)
    }
  }, [lists, activeListId])

  const activeList = lists.find((l) => l.id === activeListId) ?? null
  const currency: Currency = activeList?.currency ?? 'BRL'

  const handleCreateList = (name: string, cur: Currency) => {
    const id = createList(name, cur)
    setActiveListId(id)
  }

  const handleDeleteList = (id: string) => {
    const list = lists.find((l) => l.id === id)
    setConfirm({
      open: true,
      title: 'Deletar tabela',
      message: `Deletar "${list?.name}"? Todos os itens e transações serão removidos.`,
      onConfirm: () => { deleteList(id); setConfirm((c) => ({ ...c, open: false })) }
    })
  }

  const handleDeleteItem = (itemId: string) => {
    const item = activeList?.items.find((i) => i.id === itemId)
    setConfirm({
      open: true,
      title: 'Remover item',
      message: `Remover "${item?.name}" da lista?`,
      onConfirm: () => { deleteItem(activeListId!, itemId); setConfirm((c) => ({ ...c, open: false })) }
    })
  }

  const handleDeleteTransaction = (txId: string) => {
    setConfirm({
      open: true,
      title: 'Remover transação',
      message: 'Remover esta transação?',
      onConfirm: () => { deleteTransaction(activeListId!, txId); setConfirm((c) => ({ ...c, open: false })) }
    })
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-44 shrink-0">
        <TableSidebar
          lists={lists}
          activeId={activeListId}
          onSelect={setActiveListId}
          onCreate={handleCreateList}
          onRename={updateList}
          onDelete={handleDeleteList}
        />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!activeList ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-[#1e2235] border border-[#2a2d42] flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8892a4" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-[#e2e8f0] font-medium mb-1">Nenhuma tabela selecionada</p>
              <p className="text-sm text-[#8892a4]">Crie uma tabela financeira para começar</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2d42] shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-[#e2e8f0]">{activeList.name}</h2>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-[#6366f1]/15 text-[#a5b4fc]">
                  {CURRENCY_CONFIG[currency].symbol} {currency}
                </span>
              </div>
              {/* Tab switcher */}
              <div className="flex items-center p-0.5 rounded-lg bg-[#1e2235] border border-[#2a2d42]">
                <button
                  onClick={() => setActiveTab('shopping')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'shopping' ? 'bg-[#2a2d42] text-[#e2e8f0]' : 'text-[#8892a4] hover:text-[#e2e8f0]'
                  }`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <path d="M16 10a4 4 0 0 1-8 0" />
                  </svg>
                  Compras
                </button>
                <button
                  onClick={() => setActiveTab('finance')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'finance' ? 'bg-[#2a2d42] text-[#e2e8f0]' : 'text-[#8892a4] hover:text-[#e2e8f0]'
                  }`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                  Finanças
                </button>
                <button
                  onClick={() => setActiveTab('analytics')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'analytics' ? 'bg-[#2a2d42] text-[#e2e8f0]' : 'text-[#8892a4] hover:text-[#e2e8f0]'
                  }`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
                    <path d="M22 12A10 10 0 0 0 12 2v10z" />
                  </svg>
                  Análise
                </button>
              </div>
            </div>

            {activeTab === 'shopping' && (
              <ShoppingTab
                list={activeList}
                onUpdate={(itemId, updates) => updateItem(activeListId!, itemId, updates)}
                onDelete={handleDeleteItem}
                onToggle={(itemId) => toggleItem(activeListId!, itemId)}
                onAdd={(data) => addItem(activeListId!, data)}
              />
            )}
            {activeTab === 'finance' && (
              <FinanceTab
                list={activeList}
                onAddTransaction={(data) => addTransaction(activeListId!, data)}
                onUpdateTransaction={(txId, updates) => updateTransaction(activeListId!, txId, updates)}
                onDeleteTransaction={handleDeleteTransaction}
                onAddGoal={(data) => addFinancialGoal(activeListId!, data)}
                onUpdateGoal={(goalId, updates) => updateFinancialGoal(activeListId!, goalId, updates)}
                onDeleteGoal={(goalId) => deleteFinancialGoal(activeListId!, goalId)}
              />
            )}
            {activeTab === 'analytics' && (
              <AnalyticsTab list={activeList} />
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel="Deletar"
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm((c) => ({ ...c, open: false }))}
      />
    </div>
  )
}
