// AI usage log — the rules, with no Electron or fs in sight so they can be
// tested directly. index.ts owns the file IO and calls in here.

/** Tokens billed by a single model call. */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  /**
   * Of `promptTokens`, how many the provider served from its own prompt cache
   * (DeepSeek's `prompt_cache_hit_tokens`, OpenAI's
   * `prompt_tokens_details.cached_tokens`). Absent means the provider didn't
   * report a cache figure at all — unknown, not zero: a provider that stays
   * silent about caching is not the same as one confirming a 0% hit rate.
   */
  cachedPromptTokens?: number
}

/** USD per 1M tokens, as configured by the user. */
export interface Prices {
  inputPricePer1M?: number
  outputPricePer1M?: number
}

export interface UsageLogEntry {
  /** ISO timestamp of the call. */
  at: string
  model: string
  promptTokens: number
  completionTokens: number
  /**
   * USD, priced with the config as it stood WHEN THE CALL WAS MADE. Frozen on
   * purpose: re-pricing history against today's numbers would rewrite what past
   * calls actually cost. Absent means no prices were configured then — unknown,
   * not free.
   */
  cost?: number
  /** See TokenUsage.cachedPromptTokens — absent means the provider reported none. */
  cachedPromptTokens?: number
}

export interface UsageBucket {
  calls: number
  promptTokens: number
  completionTokens: number
  /** USD over the priced calls only — see unpricedCalls. */
  cost: number
  /** Calls with no price attached. Their spend is unknown, not zero. */
  unpricedCalls: number
  /** Sum of cachedPromptTokens over calls whose provider reported a cache figure. */
  cachedPromptTokens: number
  /**
   * Of promptTokens, the portion belonging to calls that reported a cache
   * figure — the denominator for a hit rate. Calls from a provider that never
   * reports caching contribute 0 here too, so they don't drag the rate down;
   * see cacheHitRate.
   */
  cacheReportedPromptTokens: number
}

export interface UsageSummary {
  today: UsageBucket
  last30: UsageBucket
  total: UsageBucket
  byModel: { model: string; bucket: UsageBucket }[]
  recent: UsageLogEntry[]
}

/** Entries kept on disk; older ones drop off so the file can't grow forever. */
export const MAX_USAGE_ENTRIES = 5000

/** How many recent calls the summary carries back to the UI. */
const RECENT_LIMIT = 30

/** Compact token count for display: "999", "47.2k", "1.2M". Display only. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

/**
 * The end-of-run token/cost/efficiency block for the agent log. Pure, so the
 * exact wording is pinned by a test. `cost` absent (prices unset) drops the
 * money line; `steps` of 0 drops the efficiency line rather than dividing by it.
 */
export function formatRunSummary(usage: TokenUsage, steps: number, cost: number | undefined): string {
  const total = usage.promptTokens + usage.completionTokens
  const lines = [
    `Tokens: ${formatTokens(usage.promptTokens)} prompt | ${formatTokens(usage.completionTokens)} completion | ${formatTokens(total)} total`
  ]
  if (typeof cost === 'number') lines.push(`Custo estimado: ~$${cost.toFixed(2)} USD`)
  if (steps > 0) {
    lines.push(`Eficiência: ${steps} passo(s), ${formatTokens(Math.round(total / steps))} tokens/passo`)
  }
  return lines.join('\n')
}

/**
 * What a call cost at the given prices, or undefined when they aren't both set.
 * Pricing with only one would charge half the tokens at zero. Mirrors
 * estimateCost() in the renderer's AIView — separate bundles, same rule.
 */
export function costAt(usage: TokenUsage, prices: Prices): number | undefined {
  const { inputPricePer1M: inP, outputPricePer1M: outP } = prices
  if (typeof inP !== 'number' || typeof outP !== 'number') return undefined
  if (!Number.isFinite(inP) || !Number.isFinite(outP)) return undefined
  return (usage.promptTokens / 1e6) * inP + (usage.completionTokens / 1e6) * outP
}

/** The local calendar day an instant falls on — spend is read in local days. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** One entry for a billed call, priced as of now. */
export function newEntry(
  model: string,
  usage: TokenUsage,
  prices: Prices,
  at: Date = new Date()
): UsageLogEntry {
  return {
    at: at.toISOString(),
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cost: costAt(usage, prices),
    ...(typeof usage.cachedPromptTokens === 'number' && {
      cachedPromptTokens: usage.cachedPromptTokens
    })
  }
}

/** Append, dropping the oldest entries past the cap. */
export function appendEntry(list: UsageLogEntry[], entry: UsageLogEntry): UsageLogEntry[] {
  return [...list, entry].slice(-MAX_USAGE_ENTRIES)
}

export function bucket(entries: UsageLogEntry[]): UsageBucket {
  return entries.reduce<UsageBucket>(
    (acc, e) => ({
      calls: acc.calls + 1,
      promptTokens: acc.promptTokens + e.promptTokens,
      completionTokens: acc.completionTokens + e.completionTokens,
      cost: acc.cost + (e.cost ?? 0),
      // Counted, never folded in as zero: a total that hides unpriced calls
      // reads as "this is what you spent" when it isn't.
      unpricedCalls: acc.unpricedCalls + (typeof e.cost === 'number' ? 0 : 1),
      cachedPromptTokens: acc.cachedPromptTokens + (e.cachedPromptTokens ?? 0),
      // Only calls that actually reported a cache figure count toward the
      // denominator — an entry from a provider that never reports caching must
      // not dilute the hit rate as if it were a confirmed miss.
      cacheReportedPromptTokens:
        acc.cacheReportedPromptTokens + (typeof e.cachedPromptTokens === 'number' ? e.promptTokens : 0)
    }),
    {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      unpricedCalls: 0,
      cachedPromptTokens: 0,
      cacheReportedPromptTokens: 0
    }
  )
}

/**
 * Share of prompt tokens served from cache, over calls that reported a cache
 * figure at all. Null when nothing in the bucket reported one — "no data",
 * never "0%".
 */
export function cacheHitRate(b: UsageBucket): number | null {
  if (b.cacheReportedPromptTokens <= 0) return null
  return b.cachedPromptTokens / b.cacheReportedPromptTokens
}

/** Spend broken down for the UI. `now` is injectable so the buckets are testable. */
export function summarize(list: UsageLogEntry[], now: Date = new Date()): UsageSummary {
  const todayStr = localDay(now)
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - 29) // today plus the 29 days before it
  const cutoffStr = localDay(cutoff)

  const dayOf = (e: UsageLogEntry): string => localDay(new Date(e.at))
  const models = [...new Set(list.map((e) => e.model))]

  return {
    today: bucket(list.filter((e) => dayOf(e) === todayStr)),
    last30: bucket(list.filter((e) => dayOf(e) >= cutoffStr)),
    total: bucket(list),
    byModel: models
      .map((model) => ({ model, bucket: bucket(list.filter((e) => e.model === model)) }))
      .sort((a, b) => b.bucket.cost - a.bucket.cost || b.bucket.calls - a.bucket.calls),
    recent: list.slice(-RECENT_LIMIT).reverse()
  }
}
