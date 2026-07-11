import Decimal from 'decimal.js'
import type { ShoppingItem, Currency } from '../../types'
import { CURRENCY_CONFIG } from '../../types'

export const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]

export const FINANCIAL_CATEGORIES = [
  // Despesas
  'Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer',
  'Vestuário', 'Serviços', 'Assinaturas', 'Impostos', 'Taxa', 'Família',
  'Viagem', 'Intercâmbio', 'Investimentos', 'Pet', 'Cartão', 'Empréstimo',
  // Tech / Negócio
  'AI', 'ADS', 'Servidor', 'Marketing', 'Segurança Cloud', 'Domínio',
  'AI Programação', 'AI Tokens', 'Canva', 'Streaming', 'Contador', 'Advogado',
  // Receitas
  'Salário', 'Freelance', 'Trabalho', 'Aluguel Recebido', 'Dividendos',
  'Reembolso', 'Bônus', 'Venda', 'Rendimento Mensal', 'Outros'
]

export const CAT_COLORS = [
  '#818cf8', '#a78bfa', '#c084fc', '#f472b6', '#fb923c', '#facc15',
  '#4ade80', '#22d3ee', '#60a5fa', '#f87171', '#34d399', '#a3e635',
  '#e879f9', '#38bdf8', '#fbbf24'
]

// Safe Decimal constructor — treats null/undefined/'' as 0.
export function D(value: Decimal.Value | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0)
  try {
    const d = new Decimal(value)
    return d.isNaN() || !d.isFinite() ? new Decimal(0) : d
  } catch {
    return new Decimal(0)
  }
}

export function formatCurrency(value: Decimal | number | string, currency: Currency): string {
  const { symbol, decimals } = CURRENCY_CONFIG[currency]
  const num = value instanceof Decimal ? value.toNumber() : typeof value === 'string' ? D(value).toNumber() : value
  const abs = Math.abs(num)
  const fixed = abs.toFixed(decimals)
  const [intPart, decPart] = fixed.split('.')

  let formatted: string
  if (currency === 'USD') {
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    formatted = decPart !== undefined ? `${intFormatted}.${decPart}` : intFormatted
  } else {
    // BRL and JPY: dot as thousands separator, comma as decimal
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    formatted = decPart !== undefined ? `${intFormatted},${decPart}` : intFormatted
  }

  return `${num < 0 ? '-' : ''}${symbol} ${formatted}`
}

export function itemTotal(item: ShoppingItem): Decimal {
  return new Decimal(item.qty).times(D(item.price))
}

export function parseDecimalInput(raw: string): Decimal | null {
  const normalized = raw.trim().replace(',', '.')
  if (normalized === '') return null
  try {
    const d = new Decimal(normalized)
    return d.isNaN() || !d.isFinite() ? null : d
  } catch {
    return null
  }
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function formatDateBR(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function formatAmountInput(value: number | string, currency: Currency): string {
  const { decimals } = CURRENCY_CONFIG[currency]
  const fixed = D(value).toFixed(decimals)
  return currency === 'USD' ? fixed : fixed.replace('.', ',')
}
