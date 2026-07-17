import OpenAI from 'openai'

// Reuses the OpenAI client across calls instead of building one per request.
//
// Note on the point of this: it is NOT a speed-up. The client owns no socket,
// agent or connection pool — connection reuse happens in the process-wide fetch
// dispatcher, whether there is one client or a thousand — and constructing one
// measures ~10µs against a model call of ~1000ms. What this buys is a single
// place that decides how a client is built, instead of the same baseURL/apiKey
// dance repeated at every call site.
//
// It's keyed rather than a true singleton on purpose: baseUrl and apiKey are
// editable while the app runs, and a request may override them. Handing back a
// client built with a stale key would keep talking to the old endpoint with the
// old credentials long after the user changed them — a correctness bug traded
// for a microsecond. So the key is the identity: same endpoint and credentials,
// same client; anything else, rebuild.

let cached: { key: string; client: OpenAI } | null = null

/**
 * The SDK throws on an empty apiKey, but keyless local servers are a normal
 * setup here, so they get a placeholder.
 */
function resolveKey(apiKey: string): string {
  return apiKey || 'not-needed'
}

/** A client for this endpoint and key, reusing the last one when they match. */
export function getOpenAIClient(baseURL: string, apiKey: string): OpenAI {
  const key = resolveKey(apiKey)
  // NUL-separated: it can't appear in a URL or a key, so two different configs
  // can never run together into the same string and look like a cache hit.
  const cacheKey = `${baseURL}\u0000${key}`
  if (cached?.key === cacheKey) return cached.client
  const client = new OpenAI({ baseURL, apiKey: key })
  cached = { key: cacheKey, client }
  return client
}

/** Drops the cached client. For tests, and for a hard reset if one is ever needed. */
export function resetOpenAIClient(): void {
  cached = null
}

/**
 * How long to wait for the model to START responding, in ms.
 *
 * The SDK's own default is 10 minutes, which is indistinguishable from a hang.
 * 60s is generous for a first token while still failing in human time.
 *
 * Safe to keep short: the SDK clears its timer once the response headers land
 * (`clearTimeout` sits in fetchWithTimeout's `finally`), so this bounds
 * time-to-first-response and does NOT cut off a long generation. Verified: a
 * stream that takes 2s still completes under a 500ms timeout.
 */
export const DEFAULT_TIMEOUT_MS = 60_000

/** Below this, a slow-but-working provider would never get a chance to answer. */
export const MIN_TIMEOUT_MS = 5_000

/** The SDK's own default, kept as the ceiling — past it, nobody is waiting. */
export const MAX_TIMEOUT_MS = 600_000

/**
 * The configured timeout, or the default when it's absent or nonsense
 * (0, negative, NaN, a string hand-edited into ai-config.json).
 */
export function resolveTimeoutMs(configured: unknown): number {
  if (typeof configured !== 'number' || !Number.isFinite(configured)) return DEFAULT_TIMEOUT_MS
  // Zero or negative is a mistake, not a request for "as short as possible" —
  // treat it as unset. A small positive number is a real intent, so it clamps.
  if (configured <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(Math.round(configured), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
}

/**
 * Per-request options for every model call.
 *
 * `maxRetries: 0` is load-bearing, not a default worth inheriting. The SDK
 * retries twice on its own, and the renderer's agent loop already retries with
 * backoff — layered, those multiply: one answer fired 12 HTTP requests
 * (3 from the SDK × 4 from the agent), each able to burn the full timeout.
 * Retry policy lives in one place (`callModelResilient`), which classifies the
 * status, backs off, tells the user, and stops when they hit Stop; the SDK
 * silently doing its own would undo all of that.
 */
export function requestOptions(configuredTimeout: unknown): {
  timeout: number
  maxRetries: 0
} {
  return { timeout: resolveTimeoutMs(configuredTimeout), maxRetries: 0 }
}
