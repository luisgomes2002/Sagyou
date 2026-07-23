import { describe, it, expect } from 'vitest'
import {
  costAt,
  formatTokens,
  formatRunSummary,
  newEntry,
  appendEntry,
  bucket,
  cacheHitRate,
  summarize,
  localDay,
  MAX_USAGE_ENTRIES,
  type UsageLogEntry
} from '../usage'

const usage = { promptTokens: 1_000_000, completionTokens: 1_000_000 }
const prices = { inputPricePer1M: 0.15, outputPricePer1M: 0.6 }

/** A logged call on the given local day. */
const entry = (
  day: string,
  over: Partial<UsageLogEntry> = {}
): UsageLogEntry => ({
  at: new Date(`${day}T12:00:00`).toISOString(),
  model: 'gpt-4o-mini',
  promptTokens: 1000,
  completionTokens: 100,
  cost: 0.01,
  ...over
})

describe('formatTokens', () => {
  it('renders k/M above a thousand and a plain integer below', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(47_200)).toBe('47.2k')
    expect(formatTokens(60_000)).toBe('60.0k')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })

  it('degrades garbage to 0 rather than "NaNk"', () => {
    expect(formatTokens(NaN)).toBe('0')
    expect(formatTokens(-5)).toBe('0')
  })
})

describe('formatRunSummary', () => {
  it('carries tokens, cost, and efficiency when all are available', () => {
    const s = formatRunSummary({ promptTokens: 47_200, completionTokens: 12_800 }, 18, 0.18)
    expect(s).toContain('Tokens: 47.2k prompt | 12.8k completion | 60.0k total')
    expect(s).toContain('Custo estimado: ~$0.18 USD')
    expect(s).toContain('Eficiência: 18 passo(s), 3.3k tokens/passo')
  })

  it('drops the cost line when prices are unset', () => {
    const s = formatRunSummary({ promptTokens: 1000, completionTokens: 500 }, 2, undefined)
    expect(s).not.toContain('Custo')
    expect(s).toContain('Tokens')
  })

  it('drops the efficiency line rather than dividing by zero steps', () => {
    const s = formatRunSummary({ promptTokens: 1000, completionTokens: 500 }, 0, 0.01)
    expect(s).not.toContain('Eficiência')
  })
})

describe('costAt', () => {
  it('prices input and output separately', () => {
    expect(costAt(usage, prices)).toBeCloseTo(0.75, 10)
  })

  it('refuses to price when either half is missing', () => {
    // Pricing with one would charge the other half at zero.
    expect(costAt(usage, { inputPricePer1M: 0.15 })).toBeUndefined()
    expect(costAt(usage, { outputPricePer1M: 0.6 })).toBeUndefined()
    expect(costAt(usage, {})).toBeUndefined()
  })

  it('refuses nonsense prices from a hand-edited config', () => {
    expect(costAt(usage, { inputPricePer1M: NaN, outputPricePer1M: 0.6 })).toBeUndefined()
    expect(costAt(usage, { inputPricePer1M: 0.15, outputPricePer1M: Infinity })).toBeUndefined()
  })

  it('prices a free local model at zero when told it is free', () => {
    // Explicit 0 is a real answer, unlike an absent price.
    expect(costAt(usage, { inputPricePer1M: 0, outputPricePer1M: 0 })).toBe(0)
  })
})

describe('newEntry', () => {
  it('freezes the cost at the prices of the moment', () => {
    const e = newEntry('m', usage, prices, new Date('2026-07-16T12:00:00Z'))
    expect(e).toMatchObject({ model: 'm', promptTokens: 1_000_000, at: '2026-07-16T12:00:00.000Z' })
    expect(e.cost).toBeCloseTo(0.75, 10)
  })

  it('leaves cost unknown when nothing was priced', () => {
    // Not 0 — that would claim the call was free.
    expect(newEntry('m', usage, {}).cost).toBeUndefined()
  })

  it('carries cachedPromptTokens through when the provider reported one', () => {
    const e = newEntry('m', { ...usage, cachedPromptTokens: 900_000 }, prices)
    expect(e.cachedPromptTokens).toBe(900_000)
  })

  it('leaves cachedPromptTokens absent when the provider reported none', () => {
    expect(newEntry('m', usage, prices).cachedPromptTokens).toBeUndefined()
  })
})

describe('appendEntry', () => {
  it('drops the oldest once the cap is hit, keeping the newest', () => {
    const many = Array.from({ length: MAX_USAGE_ENTRIES }, (_, i) =>
      entry('2026-07-01', { model: `m${i}` })
    )
    const next = appendEntry(many, entry('2026-07-02', { model: 'newest' }))

    expect(next).toHaveLength(MAX_USAGE_ENTRIES)
    expect(next.at(-1)?.model).toBe('newest')
    expect(next[0].model).toBe('m1') // m0 fell off the front
  })
})

describe('bucket', () => {
  it('counts unpriced calls instead of folding them in as free', () => {
    const b = bucket([
      entry('2026-07-16', { cost: 0.02 }),
      entry('2026-07-16', { cost: undefined }),
      entry('2026-07-16', { cost: 0.03 })
    ])

    expect(b.calls).toBe(3)
    expect(b.cost).toBeCloseTo(0.05, 10)
    // The 3rd call cost *something*; the UI needs to know the total is partial.
    expect(b.unpricedCalls).toBe(1)
  })

  it('sums tokens across calls', () => {
    const b = bucket([entry('2026-07-16'), entry('2026-07-16')])
    expect(b.promptTokens).toBe(2000)
    expect(b.completionTokens).toBe(200)
  })

  it('is all zeros for no calls', () => {
    expect(bucket([])).toEqual({
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      unpricedCalls: 0,
      cachedPromptTokens: 0,
      cacheReportedPromptTokens: 0
    })
  })

  it('sums cachedPromptTokens and counts only calls that reported one toward the denominator', () => {
    const b = bucket([
      entry('2026-07-16', { promptTokens: 10_000, cachedPromptTokens: 9_000 }),
      entry('2026-07-16', { promptTokens: 5_000 }), // provider reported nothing
      entry('2026-07-16', { promptTokens: 2_000, cachedPromptTokens: 0 }) // reported an explicit miss
    ])

    expect(b.cachedPromptTokens).toBe(9_000)
    // Only the two calls that reported a figure count — the silent one is excluded.
    expect(b.cacheReportedPromptTokens).toBe(12_000)
  })
})

describe('cacheHitRate', () => {
  it('is null when nothing in the bucket reported a cache figure', () => {
    const b = bucket([entry('2026-07-16')])
    expect(cacheHitRate(b)).toBeNull()
  })

  it('divides cached tokens by the tokens of calls that reported one', () => {
    const b = bucket([
      entry('2026-07-16', { promptTokens: 8_000, cachedPromptTokens: 6_000 }),
      entry('2026-07-16', { promptTokens: 2_000, cachedPromptTokens: 2_000 })
    ])
    expect(cacheHitRate(b)).toBeCloseTo(0.8, 10)
  })
})

describe('summarize', () => {
  const now = new Date('2026-07-16T15:00:00')

  it('splits today from the last 30 days from all time', () => {
    const list = [
      entry('2025-01-01'), // ancient
      entry('2026-06-01'), // outside 30 days
      entry('2026-07-10'), // inside 30 days
      entry('2026-07-16'), // today
      entry('2026-07-16')
    ]

    const s = summarize(list, now)

    expect(s.today.calls).toBe(2)
    expect(s.last30.calls).toBe(3)
    expect(s.total.calls).toBe(5)
  })

  it('counts the 30-day window as today plus the 29 before it', () => {
    const s = summarize([entry('2026-06-17'), entry('2026-06-16')], now)
    // 17 Jun is day 30 counting back from 16 Jul; 16 Jun is one too far.
    expect(s.last30.calls).toBe(1)
  })

  it('groups by model, dearest first', () => {
    const s = summarize(
      [
        entry('2026-07-16', { model: 'cheap', cost: 0.01 }),
        entry('2026-07-16', { model: 'dear', cost: 5 }),
        entry('2026-07-16', { model: 'cheap', cost: 0.01 })
      ],
      now
    )

    expect(s.byModel.map((m) => m.model)).toEqual(['dear', 'cheap'])
    expect(s.byModel[0].bucket.cost).toBe(5)
    expect(s.byModel[1].bucket.calls).toBe(2)
  })

  it('returns recent calls newest first', () => {
    const s = summarize([entry('2026-07-14', { model: 'old' }), entry('2026-07-16', { model: 'new' })], now)
    expect(s.recent.map((e) => e.model)).toEqual(['new', 'old'])
  })

  it('caps the recent list well under the log size', () => {
    const list = Array.from({ length: 100 }, () => entry('2026-07-16'))
    expect(summarize(list, now).recent.length).toBeLessThanOrEqual(30)
    // …while the totals still see everything.
    expect(summarize(list, now).total.calls).toBe(100)
  })

  it('handles an empty log', () => {
    const s = summarize([], now)
    expect(s.total.calls).toBe(0)
    expect(s.byModel).toEqual([])
    expect(s.recent).toEqual([])
  })
})

describe('localDay', () => {
  it('reads the local day, not the UTC one', () => {
    // The suite pins TZ to UTC-3: 00:30Z on the 17th is still the 16th here.
    expect(new Date().getTimezoneOffset()).toBe(180)
    expect(localDay(new Date('2026-07-17T00:30:00.000Z'))).toBe('2026-07-16')
  })
})
