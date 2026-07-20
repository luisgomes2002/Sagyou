import { describe, it, expect } from 'vitest'
import { estimateAutoRun } from '../../utils/spend'

const bucket = (over: Partial<Parameters<typeof estimateAutoRun>[0] & object> = {}) => ({
  calls: 10,
  cost: 1,
  unpricedCalls: 0,
  ...over
})

describe('estimateAutoRun', () => {
  it('averages the priced calls and scales by the step cap', () => {
    const e = estimateAutoRun(bucket({ calls: 4, cost: 0.8 }), 15)
    expect(e?.perCall).toBeCloseTo(0.2)
    expect(e?.total).toBeCloseTo(3)
    expect(e?.sample).toBe(4)
  })

  // Unpriced calls cost an unknown amount, not zero. Averaging them in as zero
  // would quote a number below what the user will actually be charged — on the
  // one screen where they decide whether to authorise the spend.
  it('excludes unpriced calls from the mean', () => {
    const e = estimateAutoRun(bucket({ calls: 10, cost: 1, unpricedCalls: 8 }), 10)
    expect(e?.sample).toBe(2)
    expect(e?.perCall).toBeCloseTo(0.5)
  })

  // Null, never 0: this app talks to paid providers and free local models alike,
  // and an empty log cannot tell them apart. "$0.00" would read as "this is
  // free" — the one answer that is affirmatively misleading.
  it('returns null when there is no honest basis', () => {
    expect(estimateAutoRun(null, 15)).toBeNull()
    expect(estimateAutoRun(undefined, 15)).toBeNull()
    expect(estimateAutoRun(bucket({ calls: 0, cost: 0 }), 15)).toBeNull()
    // Every call unpriced: a full log, no sample.
    expect(estimateAutoRun(bucket({ calls: 9, cost: 0, unpricedCalls: 9 }), 15)).toBeNull()
    // Priced calls exist but summed to nothing — no basis to extrapolate.
    expect(estimateAutoRun(bucket({ calls: 5, cost: 0 }), 15)).toBeNull()
  })

  it('refuses a nonsense step count rather than inventing a total', () => {
    expect(estimateAutoRun(bucket(), 0)).toBeNull()
    expect(estimateAutoRun(bucket(), -3)).toBeNull()
    expect(estimateAutoRun(bucket(), NaN)).toBeNull()
  })

  // The flag drives the "conte com mais" line. It must never be dropped: an
  // average over past calls is mostly early, cheap steps, so it sits below what
  // a long run costs — the estimate is a floor and the UI has to say so.
  it('always reports that it understates', () => {
    expect(estimateAutoRun(bucket(), 15)?.understates).toBe(true)
  })
})
