import { describe, expect, it } from 'vitest'
import { balanceAxisLabelY, balanceAxisTicks } from '../../components/financial/balanceAxis'

describe('eixo da evolução do saldo', () => {
  it('mostra extremos exatos, zero e marcas proporcionais para milhares', () => {
    const ticks = balanceAxisTicks([744.6, -1303.48, 11500])
    expect(ticks).toContain(11500)
    expect(ticks).toContain(-1303.48)
    expect(ticks).toContain(0)
    expect(ticks.some((value) => value > 0 && value < 11500)).toBe(true)
  })

  it('ajusta marcas intermediárias à grandeza dos valores', () => {
    const thousands = balanceAxisTicks([0, 10000])
    const hundredThousands = balanceAxisTicks([0, 100000])
    expect(thousands).toContain(5000)
    expect(hundredThousands).toContain(50000)
    expect(hundredThousands).toContain(80000)
  })

  it('mantém os rótulos de mínimo e zero legíveis quando estão próximos', () => {
    const ticks = balanceAxisTicks([-100, 0, 10000])
    const labels = balanceAxisLabelY(ticks, (value) => 12 + ((10000 - value) / 10100) * 135, 150)
    for (let index = 1; index < labels.length; index++) {
      expect(labels[index] - labels[index - 1]).toBeGreaterThanOrEqual(13)
    }
    expect(labels.at(-1)).toBeLessThanOrEqual(150)
  })
})
