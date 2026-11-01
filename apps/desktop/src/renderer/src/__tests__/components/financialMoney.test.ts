import { describe, expect, it } from 'vitest'
import {
  formatAmountInput,
  formatCurrency,
  parseDecimalInput
} from '../../components/financial/shared'

describe('financial currency formatting', () => {
  it('shows rounded whole yen while edits keep existing fractions', () => {
    expect(formatCurrency('20015', 'JPY')).toBe('¥20.015')
    expect(formatCurrency('1000000', 'JPY')).toBe('¥1.000.000')
    expect(formatCurrency('662.2', 'JPY')).toBe('¥662')
    expect(formatCurrency('662.7', 'JPY')).toBe('¥663')
    expect(formatAmountInput('20015', 'JPY')).toBe('20.015')
    expect(formatAmountInput('1000000', 'JPY')).toBe('1.000.000')
    expect(formatAmountInput('662.2', 'JPY')).toBe('662.2')
    expect(formatAmountInput('1.123', 'JPY')).toBe('1.1230')
  })

  it('keeps BRL and USD separators distinct', () => {
    expect(formatCurrency('20015.5', 'BRL')).toBe('R$ 20.015,50')
    expect(formatCurrency('1000.32', 'BRL')).toBe('R$ 1.000,32')
    expect(formatCurrency('20015.5', 'USD')).toBe('$ 20,015.50')
    expect(formatAmountInput('1826.12', 'BRL')).toBe('1.826,12')
    expect(formatAmountInput('1000.32', 'BRL')).toBe('1.000,32')
    expect(formatAmountInput('20015.5', 'USD')).toBe('20,015.50')
  })

  it('reads the displayed input back to the same decimal amount', () => {
    expect(parseDecimalInput(formatAmountInput('20015.5', 'BRL'), 'BRL')?.toString()).toBe(
      '20015.5'
    )
    expect(parseDecimalInput(formatAmountInput('20015.5', 'USD'), 'USD')?.toString()).toBe(
      '20015.5'
    )
    expect(parseDecimalInput(formatAmountInput('1.234', 'BRL'), 'BRL')?.toString()).toBe('1.234')
    expect(parseDecimalInput(formatAmountInput('662.2', 'JPY'), 'JPY')?.toString()).toBe('662.2')
    expect(parseDecimalInput(formatAmountInput('20015', 'JPY'), 'JPY')?.toString()).toBe('20015')
    expect(parseDecimalInput(formatAmountInput('1.123', 'JPY'), 'JPY')?.toString()).toBe('1.123')
    expect(parseDecimalInput('1.000.000', 'JPY')?.toString()).toBe('1000000')
    expect(parseDecimalInput('20.015', 'JPY')?.toString()).toBe('20015')
    expect(parseDecimalInput('20.015', 'BRL')?.toString()).toBe('20015')
  })
})
