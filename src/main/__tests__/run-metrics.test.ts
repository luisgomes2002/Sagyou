import { describe, it, expect } from 'vitest'
import {
  newRunMetric,
  appendRunMetric,
  summarizeRunMetrics,
  MAX_RUN_METRICS,
  type RunMetric,
  type RunMetricInput
} from '../run-metrics'

const input = (over: Partial<RunMetricInput> = {}): RunMetricInput => ({
  model: 'flash',
  steps: 4,
  calls: 4,
  promptTokens: 800,
  completionTokens: 200,
  totalTokens: 1000,
  redundantSearches: 0,
  repeatedReads: 0,
  hitStepCap: false,
  ...over
})

const metric = (over: Partial<RunMetric> = {}): RunMetric => ({
  at: new Date('2026-07-01T12:00:00Z').toISOString(),
  ...input(),
  ...over
})

describe('newRunMetric', () => {
  it('stamps the time and carries the fields through', () => {
    const at = new Date('2026-07-21T09:00:00Z')
    const m = newRunMetric(input({ model: 'pro', steps: 7 }), at)
    expect(m.at).toBe(at.toISOString())
    expect(m).toMatchObject({ model: 'pro', steps: 7, totalTokens: 1000 })
  })

  it('coerces nonsense numbers to 0 (the input crosses IPC)', () => {
    const m = newRunMetric(
      input({ steps: NaN, totalTokens: -5, promptTokens: 'x' as unknown as number })
    )
    expect(m.steps).toBe(0)
    expect(m.totalTokens).toBe(0)
    expect(m.promptTokens).toBe(0)
  })

  it('treats only an explicit true as hitStepCap', () => {
    expect(newRunMetric(input({ hitStepCap: 1 as unknown as boolean })).hitStepCap).toBe(false)
    expect(newRunMetric(input({ hitStepCap: true })).hitStepCap).toBe(true)
  })
})

describe('appendRunMetric', () => {
  it('appends in order', () => {
    const list = appendRunMetric([metric({ model: 'a' })], metric({ model: 'b' }))
    expect(list.map((m) => m.model)).toEqual(['a', 'b'])
  })

  it('drops the oldest past the cap', () => {
    let list: RunMetric[] = []
    for (let i = 0; i < MAX_RUN_METRICS + 10; i++) list = appendRunMetric(list, metric({ steps: i }))
    expect(list).toHaveLength(MAX_RUN_METRICS)
    // The oldest 10 fell off — the first kept is step 10.
    expect(list[0].steps).toBe(10)
  })
})

describe('summarizeRunMetrics', () => {
  it('averages per model and ranks the heaviest first', () => {
    const list = [
      metric({ model: 'flash', steps: 10, totalTokens: 5000 }),
      metric({ model: 'flash', steps: 10, totalTokens: 3000 }),
      metric({ model: 'pro', steps: 5, totalTokens: 6000 })
    ]
    const s = summarizeRunMetrics(list)
    expect(s.runs).toBe(3)
    // pro's average (6000) beats flash's (4000), so it sorts first.
    expect(s.byModel.map((m) => m.model)).toEqual(['pro', 'flash'])
    const flash = s.byModel.find((m) => m.model === 'flash')!
    expect(flash.runs).toBe(2)
    expect(flash.avgTotalTokens).toBe(4000)
    expect(flash.avgSteps).toBe(10)
    // 8000 tokens over 20 steps.
    expect(flash.avgTokensPerStep).toBe(400)
  })

  it('never divides tokens by zero steps', () => {
    const s = summarizeRunMetrics([metric({ model: 'flash', steps: 0, totalTokens: 1200 })])
    expect(s.byModel[0].avgTokensPerStep).toBe(0)
  })

  it('reports the capped-run rate and averages the waste signals', () => {
    const list = [
      metric({ model: 'flash', hitStepCap: true, redundantSearches: 2, repeatedReads: 1 }),
      metric({ model: 'flash', hitStepCap: false, redundantSearches: 0, repeatedReads: 3 })
    ]
    const flash = summarizeRunMetrics(list).byModel[0]
    expect(flash.cappedRate).toBe(0.5)
    expect(flash.avgRedundantSearches).toBe(1)
    expect(flash.avgRepeatedReads).toBe(2)
  })

  it('returns the most recent runs first', () => {
    const list = [metric({ steps: 1 }), metric({ steps: 2 }), metric({ steps: 3 })]
    expect(summarizeRunMetrics(list).recent.map((m) => m.steps)).toEqual([3, 2, 1])
  })
})
