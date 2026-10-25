// What an automatic run is likely to cost, from what the user's own calls have
// cost so far. Pure so it can be tested without the view.
//
// The point of this number is to be *shown before* the user hands the agent
// permission to chain N paid calls unattended. That makes honesty about its
// error the whole job: an estimate quoted with false confidence is worse than
// no estimate, because it is the thing the decision gets made on.

/** The shape this needs out of a UsageSummary bucket. */
export interface SpendBucket {
  calls: number
  /** USD summed over the priced calls only — see unpricedCalls. */
  cost: number
  /** Calls with no price attached; their spend is unknown, not zero. */
  unpricedCalls: number
}

export interface AutoRunEstimate {
  /** Mean USD per priced call in the history. */
  perCall: number
  /** perCall × steps. A floor, not a ceiling — see `understates`. */
  total: number
  /** How many priced calls the mean is drawn from. */
  sample: number
  /**
   * Always true, and stated rather than hidden: a run's later steps resend the
   * whole accumulated history, so they cost more than its first. An average
   * taken over past calls — most of which were early, cheap steps — therefore
   * sits *below* what a long run actually costs. The UI must not present this
   * as a budget ceiling.
   */
  understates: boolean
}

/**
 * Estimate the cost of a run of `steps` paid calls, or null when there is no
 * honest basis for one.
 *
 * Null on a sample of zero priced calls: with no prices configured, or no
 * history yet, there is nothing to extrapolate from. Returning 0 there would
 * read as "this is free", which is the one wrong answer — the app talks to paid
 * providers and free local ones alike, and cannot tell which from an empty log.
 * `unpricedCalls` are excluded from the mean rather than counted as zero, for
 * the same reason.
 */
export function estimateAutoRun(
  bucket: SpendBucket | null | undefined,
  steps: number
): AutoRunEstimate | null {
  if (!bucket || !Number.isFinite(steps) || steps < 1) return null
  const sample = bucket.calls - bucket.unpricedCalls
  if (sample < 1 || !Number.isFinite(bucket.cost) || bucket.cost <= 0) return null
  const perCall = bucket.cost / sample
  return { perCall, total: perCall * steps, sample, understates: true }
}

/** The shape this needs out of a UsageSummary bucket, for a cache hit rate. */
export interface CacheBucket {
  cachedPromptTokens: number
  cacheReportedPromptTokens: number
}

/**
 * Share of prompt tokens served from the provider's own cache (DeepSeek's
 * prompt_cache_hit_tokens, OpenAI's prompt_tokens_details.cached_tokens),
 * over calls that reported a cache figure at all.
 *
 * Null when nothing in the bucket reported one — "no data yet", never "0%".
 * A provider that never reports caching (or one the user hasn't called since
 * this was added) must not read as confirmed misses.
 */
export function cacheHitRate(b: CacheBucket | null | undefined): number | null {
  if (!b || !Number.isFinite(b.cacheReportedPromptTokens) || b.cacheReportedPromptTokens <= 0) {
    return null
  }
  return b.cachedPromptTokens / b.cacheReportedPromptTokens
}
