import Decimal from 'decimal.js'
import type { ShoppingItem, Currency } from '../../types'
import { CURRENCY_CONFIG } from '../../types'
import { D, moneyStr } from '../../utils/money'
export { D, moneyStr }
export { todayLocalISO as todayISO, formatDateBR } from '../../utils/dates'

export const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro'
]

export const FINANCIAL_CATEGORIES = [
  'ADS',
  'AI',
  'AI Programação',
  'AI Tokens',
  'Advogado',
  'Academia',
  'Alimentação',
  'Aluguel',
  'Aluguel Recebido',
  'Assinaturas',
  'Auto Escola',
  'Barbeiro',
  'Bônus',
  'Canva',
  'Cartão',
  'Compras',
  'Conta de Água',
  'Conta de Gás',
  'Conta de Internet',
  'Conta de Luz',
  'Contador',
  'Curso',
  'Delivery',
  'Devolução',
  'Dividendos',
  'Domínio',
  'Educação',
  'Empréstimo',
  'Família',
  'Freelance',
  'Fatura',
  'Gasolina',
  'Impostos',
  'Intercâmbio',
  'Investimentos',
  'Juros',
  'Lazer',
  'Marketing',
  'Marketplace',
  'Moradia',
  'Muay Thai',
  'Outros',
  'Parcelamento',
  'Parcelamento de Fatura',
  'Pet',
  'Pix no crédito',
  'Recarga e plano de celular',
  'Reembolso',
  'Salário',
  'Saldo',
  'Saúde',
  'Segurança Cloud',
  'Serviços',
  'Servidor',
  'Streaming',
  'Taxa',
  'Taxa de câmbio / spread cambial',
  'Taxas de transferência internacional',
  'Trabalho',
  'Transferência entre contas',
  'Transferência entre contas internacionais',
  'Transferência internacional',
  'Transporte',
  'Venda',
  'Vestuário',
  'Viagem',
  'IOF'
]

export const YIELD_SUMMARY_CATEGORY = 'Rendimento Mensal'

export const CAT_COLORS = [
  '#a080f0',
  '#c098e0',
  '#e098d4',
  '#eca8c0',
  '#ecb060',
  '#e8b810',
  '#60c080',
  '#48c0d0',
  '#68a8d8',
  '#d48888',
  '#50c0a0',
  '#a0c868',
  '#e890ac',
  '#60b8d4',
  '#e8b848'
]

export function formatCurrency(value: Decimal | number | string, currency: Currency): string {
  const { symbol, decimals } = CURRENCY_CONFIG[currency]
  const amount = D(value)
  // Summary values use whole yen. Keep historical fractions in stored values
  // and edit fields so merely opening a transaction cannot change its amount.
  const fixed = amount.abs().toFixed(decimals)
  const [intPart, decPart] = fixed.split('.')
  const group = currency === 'USD' ? ',' : '.'
  const decimal = currency === 'BRL' ? ',' : '.'
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group)
  const formatted = decPart === undefined ? intFormatted : `${intFormatted}${decimal}${decPart}`
  const sign = amount.lessThan(0) && fixed !== '0' ? '-' : ''
  return `${sign}${symbol}${currency === 'JPY' ? '' : ' '}${formatted}`
}

export function itemTotal(item: ShoppingItem): Decimal {
  return new Decimal(item.qty).times(D(item.price))
}

export function parseDecimalInput(raw: string, currency: Currency = 'BRL'): Decimal | null {
  const input = raw.trim()
  if (input === '') return null
  if (currency === 'JPY') {
    // A dot between groups of three digits means thousands in yen fields.
    // Decimal fractions remain accepted for historical amounts and must not
    // change when an unchanged edit field blurs.
    const grouped = /^[+-]?\d{1,3}(?:\.\d{3})+$/.test(input)
    const decimal = /^[+-]?\d+(?:\.\d+)?$/.test(input)
    if (!grouped && !decimal) return null
    try {
      return new Decimal(grouped ? input.replace(/\./g, '') : input)
    } catch {
      return null
    }
  }
  const localPattern =
    currency === 'BRL'
      ? /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/
      : /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/
  let normalized: string
  if (localPattern.test(input)) {
    normalized =
      currency === 'BRL' ? input.replace(/\./g, '').replace(',', '.') : input.replace(/,/g, '')
  } else if (/^[+-]?\d+[.,]\d+$/.test(input)) {
    // Accept the other decimal separator when it cannot be a grouped number.
    normalized = input.replace(',', '.')
  } else {
    return null
  }
  try {
    const d = new Decimal(normalized)
    return d.isNaN() || !d.isFinite() ? null : d
  } catch {
    return null
  }
}

export function formatAmountInput(value: number | string, currency: Currency): string {
  const { decimals } = CURRENCY_CONFIG[currency]
  if (currency === 'JPY') {
    const [integer, fraction] = D(value).toFixed().split('.')
    if (fraction !== undefined) {
      // "1.123" means ¥1,123; an extra trailing zero makes a legacy
      // fractional value of 1.123 unambiguous when it is shown for editing.
      const unambiguousFraction =
        /^[-+]?\d{1,3}$/.test(integer) && fraction.length === 3 ? `${fraction}0` : fraction
      return `${integer}.${unambiguousFraction}`
    }
    return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  }
  const [integer, fraction = ''] = D(value).toFixed().split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, currency === 'BRL' ? '.' : ',')
  const separator = currency === 'BRL' ? ',' : '.'
  return `${grouped}${separator}${fraction.padEnd(decimals, '0')}`
}
