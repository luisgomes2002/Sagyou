import { useEffect, useRef, useState } from 'react'
import Decimal from 'decimal.js'
import type { ShoppingItem, ShoppingList, Currency } from '../types'
import { CURRENCY_CONFIG } from '../types'
import { useKanbanStore } from '../store/kanban'
import { ConfirmDialog } from './ConfirmDialog'

const CURRENCY_LOCALE: Record<Currency, string> = {
  BRL: 'pt-BR',
  USD: 'en-US',
  JPY: 'ja-JP',
}

function formatCurrency(value: Decimal, currency: Currency): string {
  const { symbol, decimals } = CURRENCY_CONFIG[currency]
  const formatted = value.toNumber().toLocaleString(CURRENCY_LOCALE[currency], {
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

// ── ListSidebar ───────────────────────────────────────────────────────────────

interface SidebarProps {
  lists: ShoppingList[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: (name: string, currency: Currency) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

function ListSidebar({ lists, activeId, onSelect, onCreate, onRename, onDelete }: SidebarProps) {
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

  const startEdit = (list: ShoppingList, e: React.MouseEvent) => {
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
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Listas</p>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {lists.length === 0 && (
          <p className="px-3 py-2 text-xs text-[#8892a4] italic">Nenhuma lista</p>
        )}
        {lists.map((list) => {
          const done = list.items.filter((i) => i.done).length
          return (
            <div
              key={list.id}
              className={`group relative flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors ${
                activeId === list.id ? 'bg-[#f97316]/10' : 'hover:bg-[#1e2235]'
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
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={activeId === list.id ? '#fb923c' : '#8892a4'} strokeWidth="2">
                    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <path d="M16 10a4 4 0 0 1-8 0" />
                  </svg>
                  <span className={`flex-1 text-xs truncate ${activeId === list.id ? 'text-[#fb923c] font-medium' : 'text-[#8892a4]'}`}>
                    {list.name}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[9px] text-[#8892a4]">
                      {done}/{list.items.length}
                    </span>
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
              placeholder="Nome da lista..."
              className="w-full text-xs px-2.5 py-2 rounded bg-[#0d0f18] border border-[#2a2d42] text-[#e2e8f0] placeholder-[#8892a4] focus:outline-none focus:border-[#f97316] transition-colors"
            />
            <div className="flex items-center p-0.5 rounded-lg bg-[#0d0f18] border border-[#2a2d42]">
              {(['BRL', 'USD', 'JPY'] as Currency[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setNewCurrency(c)}
                  className={`flex-1 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    newCurrency === c
                      ? 'bg-[#f97316] text-white'
                      : 'text-[#8892a4] hover:text-[#e2e8f0]'
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
                className="flex-1 px-3 py-2 rounded bg-[#f97316] text-white text-xs font-medium hover:bg-[#ea6c10] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium text-[#f97316] border border-[#f97316]/30 hover:bg-[#f97316]/10 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nova lista
          </button>
        )}
      </div>
    </div>
  )
}

// ── ItemRow ───────────────────────────────────────────────────────────────────

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
          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
            item.done ? 'bg-[#22c55e] border-[#22c55e]' : 'border-[#3a3e58] hover:border-[#f97316]'
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
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={blur}
          className={`w-full bg-transparent text-sm focus:outline-none focus:bg-[#0d0f18] focus:px-1.5 rounded transition-all ${
            item.done ? 'text-[#8892a4] line-through' : 'text-[#e2e8f0]'
          }`}
        />
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

// ── AddItemRow ────────────────────────────────────────────────────────────────

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
          className="p-1 rounded text-[#f97316] hover:bg-[#f97316]/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </td>
    </tr>
  )
}

// ── ShoppingView ──────────────────────────────────────────────────────────────

export function ShoppingView() {
  const lists = useKanbanStore((s) => s.lists)
  const createList = useKanbanStore((s) => s.createList)
  const updateList = useKanbanStore((s) => s.updateList)
  const deleteList = useKanbanStore((s) => s.deleteList)
  const addItem = useKanbanStore((s) => s.addItem)
  const updateItem = useKanbanStore((s) => s.updateItem)
  const deleteItem = useKanbanStore((s) => s.deleteItem)
  const toggleItem = useKanbanStore((s) => s.toggleItem)

  const [activeListId, setActiveListId] = useState<string | null>(null)
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
  const items = activeList?.items ?? []
  const currency: Currency = activeList?.currency ?? 'BRL'

  const totalItems = items.length
  const doneItems = items.filter((i) => i.done).length
  const percent = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0
  const totalPrice = items.reduce((acc, i) => acc.plus(itemTotal(i)), new Decimal(0))
  const donePrice = items.filter((i) => i.done).reduce((acc, i) => acc.plus(itemTotal(i)), new Decimal(0))

  const handleCreateList = (name: string, currency: Currency) => {
    const id = createList(name, currency)
    setActiveListId(id)
  }

  const handleDeleteList = (id: string) => {
    const list = lists.find((l) => l.id === id)
    setConfirm({
      open: true,
      title: 'Deletar lista',
      message: `Deletar "${list?.name}"? Todos os itens serão removidos.`,
      onConfirm: () => { deleteList(id); setConfirm((c) => ({ ...c, open: false })) }
    })
  }

  const handleDeleteItem = (itemId: string) => {
    const item = items.find((i) => i.id === itemId)
    setConfirm({
      open: true,
      title: 'Remover item',
      message: `Remover "${item?.name}" da lista?`,
      onConfirm: () => { deleteItem(activeListId!, itemId); setConfirm((c) => ({ ...c, open: false })) }
    })
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Lists sidebar */}
      <div className="w-44 shrink-0">
        <ListSidebar
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
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-[#e2e8f0] font-medium mb-1">Nenhuma lista selecionada</p>
              <p className="text-sm text-[#8892a4]">Crie uma lista de compras para começar</p>
            </div>
          </div>
        ) : (
          <>
            {/* List header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2d42] shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-[#e2e8f0]">{activeList.name}</h2>
                <span className="text-xs text-[#8892a4]">
                  {totalItems} {totalItems === 1 ? 'item' : 'itens'}
                </span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-[#f97316]/15 text-[#f97316]">
                  {CURRENCY_CONFIG[currency].symbol} {currency}
                </span>
              </div>
              {totalItems > 0 && (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-1.5 rounded-full bg-[#2a2d42] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${percent}%`, backgroundColor: percent === 100 ? '#22c55e' : '#f97316' }}
                      />
                    </div>
                    <span className="text-xs tabular-nums" style={{ color: percent === 100 ? '#22c55e' : '#f97316' }}>
                      {percent}%
                    </span>
                  </div>
                  {totalPrice.greaterThan(0) && (
                    <span className="text-sm font-bold text-[#e2e8f0] tabular-nums">{formatCurrency(totalPrice, currency)}</span>
                  )}
                </div>
              )}
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-[#13151f] z-10">
                  <tr className="border-b border-[#2a2d42]">
                    <th className="pl-4 pr-2 py-2 w-9" />
                    <th className="py-2 pr-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Item</th>
                    <th className="py-2 pr-2 w-16 text-center text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Qtd</th>
                    <th className="py-2 pr-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">Preco/un</th>
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
                      onUpdate={(updates) => updateItem(activeListId!, item.id, updates)}
                      onDelete={() => handleDeleteItem(item.id)}
                      onToggle={() => toggleItem(activeListId!, item.id)}
                    />
                  ))}
                  <AddItemRow currency={currency} onAdd={(data) => addItem(activeListId!, data)} />
                </tbody>
              </table>
            </div>

            {/* Footer */}
            {totalItems > 0 && (
              <div className="border-t border-[#2a2d42] px-5 py-3 shrink-0">
                <div className="flex items-center justify-between gap-6">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-xs text-[#8892a4] shrink-0">
                      {doneItems}/{totalItems} {doneItems === 1 ? 'concluido' : 'concluidos'}
                    </span>
                    <div className="flex-1 max-w-48 h-2 rounded-full bg-[#2a2d42] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${percent}%`, backgroundColor: percent === 100 ? '#22c55e' : '#f97316' }}
                      />
                    </div>
                    <span
                      className="text-xs font-medium tabular-nums shrink-0"
                      style={{ color: percent === 100 ? '#22c55e' : '#f97316' }}
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
