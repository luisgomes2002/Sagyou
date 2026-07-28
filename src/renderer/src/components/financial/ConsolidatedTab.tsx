import React, { useEffect, useMemo, useState } from 'react'
import Decimal from 'decimal.js'
import type { FinancialTable, FinancialTransaction, Currency } from '../../types'
import { CURRENCY_CONFIG } from '../../types'
import { MONTH_NAMES, FINANCIAL_CATEGORIES, formatCurrency, formatDateBR, D } from './shared'
import { ConfirmDialog } from '../ConfirmDialog'
import { EmptyState } from '../EmptyState'

interface ConsolidatedTabProps {
  lists: FinancialTable[]
  activeMonth: { year: number; month: number }
  onMonthChange: (month: { year: number; month: number }) => void
  categoryFilter: string | null
  onCategoryFilterChange: (cat: string | null) => void
  onLinkTransaction: (
    sourceListId: string,
    sourceTxId: string,
    targetTxId: string
  ) => void
}

interface AugmentedTransaction extends FinancialTransaction {
  tableId: string
  tableName: string
  tableCurrency: Currency
}

interface RateInfo {
  rate: string
  date: string
  source: 'awesomeapi' | 'frankfurter' | 'cache' | 'identity'
  loaded: boolean
  error?: string
}

const REFERENCE_CURRENCY: Currency = 'BRL'

export function ConsolidatedTab({
  lists,
  activeMonth,
  onMonthChange,
  categoryFilter,
  onCategoryFilterChange,
  onLinkTransaction
}: ConsolidatedTabProps) {
  const now = new Date()
  const [rates, setRates] = useState<Record<string, RateInfo>>({})
  const [linkingTx, setLinkingTx] = useState<{
    tableId: string
    txId: string
  } | null>(null)
  const [unlinkConfirm, setUnlinkConfirm] = useState<{
    open: boolean
    tableId: string
    txId: string
    desc: string
  }>({ open: false, tableId: '', txId: '', desc: '' })
  const [refCurrency, setRefCurrency] = useState<Currency>(() => {
    const activeCurrencies = new Set<Currency>()
    for (const list of lists) {
      if (list.transactions.length > 0) activeCurrencies.add(list.currency)
    }
    if (activeCurrencies.has(REFERENCE_CURRENCY)) return REFERENCE_CURRENCY
    if (activeCurrencies.size > 0) return [...activeCurrencies][0]
    const tableCurrencies = new Set(lists.map((l) => l.currency))
    if (tableCurrencies.has(REFERENCE_CURRENCY)) return REFERENCE_CURRENCY
    return lists[0]?.currency ?? ('BRL' as Currency)
  })

  const allTableCurrencies: Currency[] = useMemo(() => {
    const set = new Set(lists.map((l) => l.currency))
    return [...set]
  }, [lists])

  const currencies: Currency[] = useMemo(() => {
    const set = new Set<Currency>()
    for (const list of lists) {
      if (list.transactions.length > 0) {
        set.add(list.currency)
      }
    }
    return [...set]
  }, [lists])

  useEffect(() => {
    let cancelled = false
    const pairs: string[] = []
    for (const cur of allTableCurrencies) {
      if (cur !== refCurrency) {
        pairs.push(`${cur}-${refCurrency}`)
      }
    }
    // Always fetch common pairs for display even if no table uses those currencies
    const commonPairs = ['USD-BRL', 'BRL-USD', 'JPY-BRL', 'BRL-JPY']
    for (const pair of commonPairs) {
      const [from, to] = pair.split('-') as [Currency, Currency]
      if (from !== to && !pairs.includes(pair) && (from === refCurrency || to === refCurrency)) {
        pairs.push(pair)
      }
    }
    if (pairs.length === 0) return

    async function fetchRates() {
      const result: Record<string, RateInfo> = {}
      for (const pair of pairs) {
        try {
          if (!window.electronAPI?.financial?.fetchExchangeRate) continue
          const res = await window.electronAPI.financial.fetchExchangeRate(pair)
          if (cancelled) return
          if ('error' in res) {
            result[pair] = { rate: '0', date: '', source: 'cache', loaded: true, error: res.error }
          } else {
            result[pair] = { ...res, loaded: true }
          }
        } catch {
          if (cancelled) return
          result[pair] = { rate: '0', date: '', source: 'cache', loaded: true, error: 'Falha ao buscar' }
        }
      }
      setRates(result)
    }

    fetchRates()
    return () => { cancelled = true }
  }, [currencies, refCurrency])

  const singleCurrency: Currency = currencies[0] ?? refCurrency

  const allTransactions = useMemo(() => {
    const result: AugmentedTransaction[] = []
    for (const list of lists) {
      for (const tx of list.transactions) {
        result.push({ ...tx, tableId: list.id, tableName: list.name, tableCurrency: list.currency })
      }
    }
    result.sort((a, b) => b.date.localeCompare(a.date) || a.tableName.localeCompare(b.tableName))
    return result
  }, [lists])

  const monthTxs = useMemo(() => {
    return allTransactions.filter((t) => {
      const [y, m] = t.date.split('-').map(Number)
      if (y !== activeMonth.year || m !== activeMonth.month) return false
      if (categoryFilter && (t.category ?? '') !== categoryFilter) return false
      return true
    })
  }, [allTransactions, activeMonth, categoryFilter])

  const { netIncome, netExpense, linkedCount } = useMemo(() => {
    const linkedIds = new Set(monthTxs.filter((t) => t.linkedTransactionId).map((t) => t.linkedTransactionId!))
    const deduped = monthTxs.filter((t) => !linkedIds.has(t.id))
    const income = deduped
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s.plus(t.amount), new Decimal(0))
    const expense = deduped
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s.plus(t.amount), new Decimal(0))
    return { netIncome: income, netExpense: expense, linkedCount: monthTxs.length - deduped.length }
  }, [monthTxs])

  const netBalance = netIncome.minus(netExpense)

  const accBalanceAll = useMemo(() => {
    const linkedIds = new Set(allTransactions.filter((t) => t.linkedTransactionId).map((t) => t.linkedTransactionId!))
    return allTransactions
      .filter((t) => !linkedIds.has(t.id))
      .reduce((s, t) => (t.type === 'income' ? s.plus(t.amount) : s.minus(t.amount)), new Decimal(0))
  }, [allTransactions])

  const byCurrency = useMemo(() => {
    const map: Record<string, { currency: Currency; income: Decimal; expense: Decimal }> = {}
    const linkedIds = new Set(monthTxs.filter((t) => t.linkedTransactionId).map((t) => t.linkedTransactionId!))
    for (const t of monthTxs) {
      if (linkedIds.has(t.id)) continue
      const key = t.tableCurrency
      if (!map[key]) map[key] = { currency: t.tableCurrency, income: new Decimal(0), expense: new Decimal(0) }
      if (t.type === 'income') map[key].income = map[key].income.plus(t.amount)
      else map[key].expense = map[key].expense.plus(t.amount)
    }
    return Object.values(map).sort((a, b) => a.currency.localeCompare(b.currency))
  }, [monthTxs])

  const convertedTotal = useMemo(() => {
    let total = new Decimal(0)
    for (const g of byCurrency) {
      const bal = g.income.minus(g.expense)
      if (g.currency === refCurrency) {
        total = total.plus(bal)
      } else {
        const pair = `${g.currency}-${refCurrency}`
        const r = rates[pair]
        if (r && r.loaded && !r.error) {
          total = total.plus(bal.times(r.rate))
        }
      }
    }
    return total
  }, [byCurrency, refCurrency, rates])

  const convertAmount = (amount: Decimal, fromCurrency: Currency): Decimal | null => {
    if (fromCurrency === refCurrency) return amount
    const pair = `${fromCurrency}-${refCurrency}`
    const r = rates[pair]
    if (r && r.loaded && !r.error) return amount.times(r.rate)
    const reversePair = `${refCurrency}-${fromCurrency}`
    const r2 = rates[reversePair]
    if (r2 && r2.loaded && !r2.error) return amount.div(r2.rate)
    return null
  }

  const convertedIncome = useMemo(() => {
    let total = new Decimal(0)
    for (const g of byCurrency) {
      const c = convertAmount(g.income, g.currency)
      if (c !== null) total = total.plus(c)
    }
    return total
  }, [byCurrency, refCurrency, rates])

  const convertedExpense = useMemo(() => {
    let total = new Decimal(0)
    for (const g of byCurrency) {
      const c = convertAmount(g.expense, g.currency)
      if (c !== null) total = total.plus(c)
    }
    return total
  }, [byCurrency, refCurrency, rates])

  const convertedAccumulated = useMemo(() => {
    const linkedIds = new Set(allTransactions.filter((t) => t.linkedTransactionId).map((t) => t.linkedTransactionId!))
    let total = new Decimal(0)
    for (const t of allTransactions) {
      if (linkedIds.has(t.id)) continue
      const amount = t.type === 'income' ? D(t.amount) : D(t.amount).negated()
      const c = convertAmount(amount, t.tableCurrency)
      if (c !== null) total = total.plus(c)
    }
    return total
  }, [allTransactions, refCurrency, rates])

  const ratesLoaded = useMemo(() => {
    const nonRef = currencies.filter((c) => c !== refCurrency)
    if (nonRef.length === 0) return true
    return nonRef.every((c) => {
      const pair = `${c}-${refCurrency}`
      return rates[pair]?.loaded
    })
  }, [currencies, refCurrency, rates])

  const perTable = useMemo(() => {
    const map: Record<string, { name: string; currency: Currency; income: Decimal; expense: Decimal }> = {}
    for (const t of monthTxs) {
      if (!map[t.tableId]) {
        map[t.tableId] = { name: t.tableName, currency: t.tableCurrency, income: new Decimal(0), expense: new Decimal(0) }
      }
      if (t.type === 'income') map[t.tableId].income = map[t.tableId].income.plus(t.amount)
      else map[t.tableId].expense = map[t.tableId].expense.plus(t.amount)
    }
    return Object.entries(map)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [monthTxs])

  const prevMonth = () => {
    onCategoryFilterChange(null)
    onMonthChange(
      activeMonth.month === 1
        ? { year: activeMonth.year - 1, month: 12 }
        : { ...activeMonth, month: activeMonth.month - 1 }
    )
  }

  const nextMonth = () => {
    onCategoryFilterChange(null)
    onMonthChange(
      activeMonth.month === 12
        ? { year: activeMonth.year + 1, month: 1 }
        : { ...activeMonth, month: activeMonth.month + 1 }
    )
  }

  const showConverted = allTableCurrencies.length > 1 && ratesLoaded

  if (lists.length === 0) {
    return (
      <EmptyState
        icon={
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#999999" strokeWidth="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        }
        title="Nenhuma tabela financeira criada"
      />
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* Month navigator */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#3b3b3b]">
          <button
            onClick={prevMonth}
            className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="text-sm font-medium text-[#d4d4d4] min-w-32 text-center">
            {MONTH_NAMES[activeMonth.month - 1]} {activeMonth.year}
          </span>
          <button
            onClick={nextMonth}
            className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button
            onClick={() =>
              onMonthChange({ year: now.getFullYear(), month: now.getMonth() + 1 })
            }
            className="ml-1 text-[10px] text-[#999999] hover:text-[#7c3aed] transition-colors"
          >
            Hoje
          </button>
          {allTableCurrencies.length > 1 && (
            <div className="ml-auto flex items-center p-0.5 rounded-lg bg-[#2a2a2a] border border-[#3b3b3b]">
              {allTableCurrencies.map((c) => (
                <button
                  key={c}
                  onClick={() => setRefCurrency(c)}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    refCurrency === c
                      ? 'bg-[#7c3aed] text-white'
                      : 'text-[#999999] hover:text-[#d4d4d4]'
                  }`}
                >
                  {CURRENCY_CONFIG[c].symbol} {c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Exchange rate display */}
        {(() => {
          const visibleRates: { pair: string; r: RateInfo }[] = []
          for (const [pair, r] of Object.entries(rates)) {
            if (r.loaded && !r.error && r.source !== 'identity') {
              const [from] = pair.split('-') as [Currency, Currency]
              // Only show X -> refCurrency, skip refCurrency -> X (redundant)
              if (from !== refCurrency) {
                visibleRates.push({ pair, r })
              }
            }
          }
          if (visibleRates.length === 0) return null
          return (
            <div className="flex items-center gap-3 px-5 py-1.5 border-b border-[#3b3b3b] text-[10px] text-[#999999]">
              <span className="font-semibold uppercase tracking-wider text-[#666666] shrink-0">
                Cotações
              </span>
              {visibleRates.map(({ pair, r }) => {
                const [from, to] = pair.split('-') as [Currency, Currency]
                return (
                  <span key={pair} className="tabular-nums">
                    1 {from} = {CURRENCY_CONFIG[to].symbol} {r.rate}
                  </span>
                )
              })}
              <span className="text-[#666666] ml-auto">
                {(() => {
                  const sources = [...new Set(visibleRates.map((v) => v.r.source))]
                  const label = sources[0] === 'awesomeapi' ? 'AwesomeAPI' : sources[0] === 'frankfurter' ? 'Frankfurter' : 'cache'
                  const date = visibleRates.find((v) => v.r.date)?.r.date
                  if (sources[0] === 'cache') return date ? `offline (${formatDateBR(date)})` : 'offline'
                  return date ? `${label} · ${formatDateBR(date)}` : label
                })()}
              </span>
            </div>
          )
        })()}

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3 px-5 py-4 border-b border-[#3b3b3b]">
          <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-1">
              Entradas
            </p>
            <p className="text-sm font-bold text-[#46d478] tabular-nums">
              {showConverted
                ? formatCurrency(convertedIncome, refCurrency)
                : formatCurrency(netIncome, singleCurrency)}
            </p>
          </div>
          <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-1">
              Saídas
            </p>
            <p className="text-sm font-bold text-[#e04040] tabular-nums">
              {showConverted
                ? formatCurrency(convertedExpense, refCurrency)
                : formatCurrency(netExpense, singleCurrency)}
            </p>
          </div>
          <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-1">
              Saldo do Mês
            </p>
            <p
              className={`text-sm font-bold tabular-nums ${(showConverted ? convertedTotal : netBalance).gte(0) ? 'text-[#d4d4d4]' : 'text-[#e04040]'}`}
            >
              {showConverted
                ? formatCurrency(convertedTotal, refCurrency)
                : formatCurrency(netBalance, singleCurrency)}
            </p>
          </div>
          <div className="rounded-lg bg-[#7c3aed]/10 border border-[#7c3aed]/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a080f0] mb-1">
              Saldo Acumulado
            </p>
            <p
              className={`text-sm font-bold tabular-nums ${(showConverted ? convertedAccumulated : accBalanceAll).gte(0) ? 'text-[#a080f0]' : 'text-[#e04040]'}`}
            >
              {showConverted
                ? formatCurrency(convertedAccumulated, refCurrency)
                : formatCurrency(accBalanceAll, singleCurrency)}
            </p>
          </div>
        </div>

        {/* Per-table cards */}
        {perTable.length > 1 && (
          <div className="px-5 py-3 border-b border-[#3b3b3b]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-2">
              Por tabela — {MONTH_NAMES[activeMonth.month - 1]}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {perTable.map((t) => {
                const bal = t.income.minus(t.expense)
                return (
                  <div
                    key={t.id}
                    className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-2.5"
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-xs font-medium text-[#d4d4d4] truncate">{t.name}</span>
                      <span className="text-[9px] text-[#a080f0]">
                        {CURRENCY_CONFIG[t.currency].symbol}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                      <span className="text-[9px] text-[#999999]">Entradas</span>
                      <span className="text-[9px] tabular-nums text-[#46d478] text-right">
                        {formatCurrency(t.income, t.currency)}
                      </span>
                      <span className="text-[9px] text-[#999999]">Saídas</span>
                      <span className="text-[9px] tabular-nums text-[#e04040] text-right">
                        {formatCurrency(t.expense, t.currency)}
                      </span>
                      <span className="text-[9px] text-[#999999]">Saldo</span>
                      <span
                        className={`text-[9px] tabular-nums font-medium text-right ${bal.gte(0) ? 'text-[#d4d4d4]' : 'text-[#e04040]'}`}
                      >
                        {formatCurrency(bal, t.currency)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Transactions header */}
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-[#d4d4d4]">
            Transações — {MONTH_NAMES[activeMonth.month - 1]} {activeMonth.year}
            <span className="ml-2 text-[#999999] font-normal">({monthTxs.length})</span>
          </p>
          {linkedCount > 0 && (
            <span className="text-[10px] text-[#a080f0]">
              {linkedCount} vinculada{linkedCount !== 1 ? 's' : ''} omitida{linkedCount !== 1 ? 's' : ''} do total
            </span>
          )}
        </div>

        {/* Category filter */}
        <div className="px-5 pb-3">
          <select
            value={categoryFilter ?? ''}
            onChange={(e) => onCategoryFilterChange(e.target.value || null)}
            className="w-full bg-[#2a2a2a] border border-[#3b3b3b] text-[#d4d4d4] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#7c3aed]"
          >
            <option value="">Todos</option>
            {FINANCIAL_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Transactions table */}
        <table className="w-full">
          <thead className="sticky top-0 bg-[#232323] z-10">
            <tr className="border-b border-[#3b3b3b]">
              <th className="pl-4 pr-2 py-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                Data
              </th>
              <th className="py-2 pr-2 text-left text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                Descrição
              </th>
              <th className="py-2 pr-2 w-28 text-left text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                Categoria
              </th>
              <th className="py-2 pr-2 w-20 text-center text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                Tipo
              </th>
              <th className="py-2 pr-2 w-32 text-right text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                Valor
              </th>
              <th className="py-2 pr-2 w-24 text-left text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                Tabela
              </th>
              <th className="py-2 pr-3 w-9" />
            </tr>
          </thead>
          <tbody>
            {monthTxs.map((tx) => {
              const isParent = allTransactions.some((t) => t.linkedTransactionId === tx.id)
              const parent = tx.linkedTransactionId
                ? allTransactions.find((t) => t.id === tx.linkedTransactionId)
                : null
              const children = allTransactions.filter((t) => t.linkedTransactionId === tx.id)
              const isLinking = linkingTx?.tableId === tx.tableId && linkingTx?.txId === tx.id

              const linkableTxs = !isLinking
                ? []
                : allTransactions
                    .filter(
                      (t) =>
                        t.tableId !== tx.tableId &&
                        !t.linkedTransactionId &&
                        t.id !== tx.id
                    )
                    .sort((a, b) => b.date.localeCompare(a.date))

              const canLink =
                !tx.linkedTransactionId && !isParent && lists.length > 1

              return (
                <React.Fragment key={`${tx.tableId}:${tx.id}`}>
                  <tr
                    className={`group border-b border-[#3b3b3b] hover:bg-[#2a2a2a] transition-colors ${
                      isParent ? 'opacity-40' : ''
                    }`}
                  >
                    <td className="pl-4 pr-2 py-2 w-28">
                      <span className="inline-flex items-center gap-1 text-xs text-[#999999] tabular-nums bg-[#2a2a2a] px-1.5 py-0.5 rounded">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        {formatDateBR(tx.date)}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {tx.linkedTransactionId && (
                          <>
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#a080f0"
                              strokeWidth="2"
                              className="shrink-0"
                            >
                              <title>
                                {parent
                                  ? `Vinculado a: ${parent.description} (${parent.tableName} — ${formatDateBR(parent.date)})`
                                  : 'Vinculado a outra transação'}
                              </title>
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                            {parent && (
                              <span className="text-[10px] text-[#a080f0] truncate max-w-[150px]">
                                {parent.description.length > 20
                                  ? parent.description.slice(0, 20) + '…'
                                  : parent.description}
                                <span className="text-[#a080f0]/60"> · {formatDateBR(parent.date)}</span>
                              </span>
                            )}
                            <button
                              onClick={() =>
                                setUnlinkConfirm({
                                  open: true,
                                  tableId: tx.tableId,
                                  txId: tx.id,
                                  desc: tx.description
                                })
                              }
                              className="p-0.5 rounded text-[#a080f0] hover:text-[#e04040] hover:bg-[#e04040]/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                              title="Desvincular"
                            >
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </>
                        )}
                        <span className="text-sm text-[#d4d4d4] truncate">{tx.description}</span>
                        {isParent && children.length > 0 && (
                          <span className="text-[9px] text-[#a080f0] bg-[#a080f0]/10 px-1.5 py-0.5 rounded shrink-0" title={children.map((c) => `${c.description} (${formatDateBR(c.date)}) — ${c.tableName}`).join('\n')}>
                            {children.length === 1
                              ? `${children[0].description.slice(0, 20)}${children[0].description.length > 20 ? '…' : ''} · ${formatDateBR(children[0].date)}`
                              : `${children.length} vinculadas`}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-2 w-28 text-xs text-[#999999]">
                      {tx.category || '-'}
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
                      <span
                        className={`text-sm tabular-nums font-medium ${
                          tx.type === 'income' ? 'text-[#46d478]' : 'text-[#d4d4d4]'
                        }`}
                      >
                        {formatCurrency(D(tx.amount), tx.tableCurrency)}
                      </span>
                    </td>
                    <td className="py-2 pr-2 w-24">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[#2a2a2a] text-[#999999] truncate block max-w-[80px]">
                        {tx.tableName}
                      </span>
                    </td>
                    <td className="py-2 pr-3 w-10">
                      {canLink && (
                        <button
                          onClick={() =>
                            setLinkingTx(
                              isLinking ? null : { tableId: tx.tableId, txId: tx.id }
                            )
                          }
                          className={`p-1 rounded border transition-colors ${
                            isLinking
                              ? 'border-[#a080f0] text-[#a080f0] bg-[#a080f0]/10'
                              : 'border-[#3b3b3b] text-[#666666] hover:text-[#a080f0] hover:border-[#a080f0]/50'
                          }`}
                          title="Vincular a transação de outra tabela"
                        >
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                  {isLinking && (
                    <tr key={`${tx.tableId}:${tx.id}:link`} className="border-b border-[#3b3b3b] bg-[#1b1b1b]/50">
                      <td colSpan={7} className="px-4 py-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-[#999999]">
                            Vincular "{tx.description}" a:
                          </p>
                          <button
                            onClick={() => setLinkingTx(null)}
                            className="text-[10px] text-[#666666] hover:text-[#999999]"
                          >
                            Cancelar
                          </button>
                        </div>
                        {linkableTxs.length === 0 ? (
                          <p className="text-[10px] text-[#666666] italic mt-1">
                            Nenhuma transação disponível para vincular em outras tabelas
                          </p>
                        ) : (
                          <div className="mt-1 space-y-0.5">
                            {linkableTxs.map((candidate) => (
                              <button
                                key={`${candidate.tableId}:${candidate.id}`}
                                onClick={() => {
                                  onLinkTransaction(tx.tableId, tx.id, candidate.id)
                                  setLinkingTx(null)
                                }}
                                className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-[#2a2a2a] transition-colors text-left"
                              >
                                <span className="text-[10px] tabular-nums text-[#999999] w-20 shrink-0">
                                  {formatDateBR(candidate.date)}
                                </span>
                                <span className="text-xs text-[#d4d4d4] truncate flex-1">
                                  {candidate.description}
                                </span>
                                <span
                                  className={`text-[10px] tabular-nums font-medium shrink-0 ${
                                    candidate.type === 'income' ? 'text-[#46d478]' : 'text-[#d4d4d4]'
                                  }`}
                                >
                                  {formatCurrency(D(candidate.amount), candidate.tableCurrency)}
                                </span>
                                <span className="text-[9px] text-[#666666] shrink-0 w-16 truncate">
                                  {candidate.tableName}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {monthTxs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-xs text-[#999999] italic">
                  Nenhuma transação em {MONTH_NAMES[activeMonth.month - 1]}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={unlinkConfirm.open}
        title="Desvincular transação"
        message={`Desvincular "${unlinkConfirm.desc}"? A transação relacionada não será afetada.`}
        confirmLabel="Desvincular"
        onConfirm={() => {
          onLinkTransaction(unlinkConfirm.tableId, unlinkConfirm.txId, '')
          setUnlinkConfirm((s) => ({ ...s, open: false }))
        }}
        onCancel={() => setUnlinkConfirm((s) => ({ ...s, open: false }))}
      />
    </div>
  )
}
