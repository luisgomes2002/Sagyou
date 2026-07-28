import Decimal from 'decimal.js'
import type { ShoppingItem, Currency } from '../../types'
import { CURRENCY_CONFIG } from '../../types'
import { D, moneyStr } from '../../utils/money'
export { D, moneyStr }
export { todayUTCISO as todayISO, formatDateBR } from '../../utils/dates'

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
  'Reembolso', 'Devolução', 'Bônus', 'Venda', 'Saldo', 'Rendimento Mensal', 'Outros'
]

export const CAT_COLORS = [
  '#a080f0', '#c098e0', '#e098d4', '#eca8c0', '#ecb060', '#e8b810',
  '#60c080', '#48c0d0', '#68a8d8', '#d48888', '#50c0a0', '#a0c868',
  '#e890ac', '#60b8d4', '#e8b848'
]

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

export function formatAmountInput(value: number | string, currency: Currency): string {
  const { decimals } = CURRENCY_CONFIG[currency]
  const fixed = D(value).toFixed(decimals)
  return currency === 'USD' ? fixed : fixed.replace('.', ',')
}
