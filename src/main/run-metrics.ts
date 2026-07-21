// AI run metrics — one record per agent run, so the efficiency of one model can
// be compared against another over time (does Flash burn more tokens than Pro
// for the same kind of task?). No Electron or fs in here, so the rules are
// testable; index.ts owns the file IO and calls in here. Sibling of ./usage,
// which logs per *call*; this logs per *run* (the aggregate a run adds up to,
// plus the waste signals — redundant searches, repeated reads — that only the
// renderer's agent loop can see).

/** What a run reports; `at` is stamped by the main process on append. */
export interface RunMetricInput {
  /** The model the run actually used (after routeModel picked it). */
  model: string
  /** Tool rounds executed (loop iterations), not counting the forced final answer. */
  steps: number
  /** Billed model calls the provider reported usage for. */
  calls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Fuzzy-duplicate searches the run warned on (buscar_no_codigo substring). */
  redundantSearches: number
  /** Read brakes that fired (an identical or blind whole-file re-read). */
  repeatedReads: number
  /** True when the run stopped at the step cap rather than concluding on its own. */
  hitStepCap: boolean
}

/** A stored run metric: the input plus the timestamp the main process stamped. */
export interface RunMetric extends RunMetricInput {
  /** ISO timestamp of when the run finished. */
  at: string
}

/** One model's efficiency, averaged over its runs — the comparison the log exists for. */
export interface ModelEfficiency {
  model: string
  runs: number
  avgSteps: number
  avgTotalTokens: number
  /** Tokens per step — the fairest cross-model number, since runs vary in length. */
  avgTokensPerStep: number
  /** Waste signals, averaged per run so models with different run counts compare. */
  avgRedundantSearches: number
  avgRepeatedReads: number
  /** Share of this model's runs that hit the step cap (0..1). */
  cappedRate: number
}

export interface RunMetricsSummary {
  runs: number
  byModel: ModelEfficiency[]
  recent: RunMetric[]
}

/** Entries kept on disk; older ones drop off so the file can't grow forever. */
export const MAX_RUN_METRICS = 2000

/** How many recent runs the summary carries back. */
const RECENT_LIMIT = 30

/** Coerce a value to a finite, non-negative number (the input crosses IPC). */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/** Build a stored entry from a run's report, stamping the time. */
export function newRunMetric(input: RunMetricInput, at: Date = new Date()): RunMetric {
  return {
    at: at.toISOString(),
    model: typeof input.model === 'string' ? input.model : '',
    steps: num(input.steps),
    calls: num(input.calls),
    promptTokens: num(input.promptTokens),
    completionTokens: num(input.completionTokens),
    totalTokens: num(input.totalTokens),
    redundantSearches: num(input.redundantSearches),
    repeatedReads: num(input.repeatedReads),
    hitStepCap: input.hitStepCap === true
  }
}

/** Append, dropping the oldest entries past the cap. */
export function appendRunMetric(list: RunMetric[], entry: RunMetric): RunMetric[] {
  return [...list, entry].slice(-MAX_RUN_METRICS)
}

/** Roll the log up per model, with per-run averages so models compare fairly. */
export function summarizeRunMetrics(list: RunMetric[]): RunMetricsSummary {
  const models = [...new Set(list.map((e) => e.model))]
  const byModel: ModelEfficiency[] = models
    .map((model) => {
      const rows = list.filter((e) => e.model === model)
      const n = rows.length
      const sum = (f: (e: RunMetric) => number): number => rows.reduce((a, e) => a + f(e), 0)
      const steps = sum((e) => e.steps)
      const tokens = sum((e) => e.totalTokens)
      return {
        model,
        runs: n,
        avgSteps: n ? steps / n : 0,
        avgTotalTokens: n ? tokens / n : 0,
        // Guard the denominator: a run that reported no steps mustn't divide by 0.
        avgTokensPerStep: steps ? tokens / steps : 0,
        avgRedundantSearches: n ? sum((e) => e.redundantSearches) / n : 0,
        avgRepeatedReads: n ? sum((e) => e.repeatedReads) / n : 0,
        cappedRate: n ? rows.filter((e) => e.hitStepCap).length / n : 0
      }
    })
    // Heaviest average first — the model to look at when trimming cost.
    .sort((a, b) => b.avgTotalTokens - a.avgTotalTokens || b.runs - a.runs)
  return { runs: list.length, byModel, recent: list.slice(-RECENT_LIMIT).reverse() }
}
