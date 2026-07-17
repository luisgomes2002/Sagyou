/**
 * This is main-process code, so it runs in Node — not the suite's default jsdom.
 * The SDK refuses to construct under a browser-like global on purpose (it guards
 * against shipping an API key to a browser), and jsdom looks exactly like one.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getOpenAIClient,
  resetOpenAIClient,
  resolveTimeoutMs,
  requestOptions,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS
} from '../openai-client'

// Reusing a client is only safe if it stops being reused the moment the config
// changes. Everything here is about that: the cache must never outlive the
// endpoint or credentials it was built for.

describe('resolveTimeoutMs', () => {
  it('defaults when nothing is configured', () => {
    expect(resolveTimeoutMs(undefined)).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('is far below the SDK default, which is a hang in disguise', () => {
    // The SDK waits 10 minutes out of the box; nobody is still there.
    expect(DEFAULT_TIMEOUT_MS).toBeLessThan(600_000)
  })

  it('honours a configured value', () => {
    expect(resolveTimeoutMs(30_000)).toBe(30_000)
  })

  it('clamps to the floor and the ceiling', () => {
    // A 1ms timeout would fail every call; a 1h one is indistinguishable from
    // hanging forever.
    expect(resolveTimeoutMs(1)).toBe(MIN_TIMEOUT_MS)
    expect(resolveTimeoutMs(3_600_000)).toBe(MAX_TIMEOUT_MS)
  })

  it('falls back rather than trusting nonsense from a hand-edited config', () => {
    for (const bad of [NaN, Infinity, -5, '30000', null, {}]) {
      expect(resolveTimeoutMs(bad)).toBe(DEFAULT_TIMEOUT_MS)
    }
  })
})

describe('requestOptions', () => {
  it('disables the SDK retries, because the agent loop owns retry', () => {
    // Layered, they multiply: the SDK's 3 attempts × the agent's 4 = 12 HTTP
    // requests for one answer, each able to burn the full timeout.
    expect(requestOptions(undefined).maxRetries).toBe(0)
    expect(requestOptions(30_000).maxRetries).toBe(0)
  })

  it('carries the resolved timeout', () => {
    expect(requestOptions(30_000).timeout).toBe(30_000)
    expect(requestOptions(undefined).timeout).toBe(DEFAULT_TIMEOUT_MS)
    expect(requestOptions(1).timeout).toBe(MIN_TIMEOUT_MS)
  })
})

describe('getOpenAIClient', () => {
  beforeEach(resetOpenAIClient)

  it('hands back the same client while the config is unchanged', () => {
    const a = getOpenAIClient('http://x/v1', 'k')
    const b = getOpenAIClient('http://x/v1', 'k')
    expect(b).toBe(a)
  })

  it('rebuilds when the endpoint changes', () => {
    const a = getOpenAIClient('http://x/v1', 'k')
    const b = getOpenAIClient('http://y/v1', 'k')
    expect(b).not.toBe(a)
    expect(b.baseURL).toBe('http://y/v1')
  })

  it('rebuilds when the API key changes', () => {
    // The bug this guards: rotating your key and still sending the old one.
    const a = getOpenAIClient('http://x/v1', 'old-key')
    const b = getOpenAIClient('http://x/v1', 'new-key')
    expect(b).not.toBe(a)
    expect(b.apiKey).toBe('new-key')
  })

  it('does not confuse two configs that concatenate alike', () => {
    // Without a separator, "http://x" + "ab" and "http://xa" + "b" collide.
    const a = getOpenAIClient('http://x', 'ab')
    const b = getOpenAIClient('http://xa', 'b')
    expect(b).not.toBe(a)
    expect(b.baseURL).toBe('http://xa')
  })

  it('substitutes a placeholder key, since the SDK rejects an empty one', () => {
    // Keyless local servers are a normal setup here.
    expect(() => getOpenAIClient('http://localhost:1234/v1', '')).not.toThrow()
    expect(getOpenAIClient('http://localhost:1234/v1', '').apiKey).toBe('not-needed')
  })

  it('treats an empty key as one config, not a new one each call', () => {
    const a = getOpenAIClient('http://localhost:1234/v1', '')
    const b = getOpenAIClient('http://localhost:1234/v1', '')
    expect(b).toBe(a)
  })

  it('rebuilds after switching away and back', () => {
    const first = getOpenAIClient('http://x/v1', 'k')
    getOpenAIClient('http://y/v1', 'k')
    const again = getOpenAIClient('http://x/v1', 'k')
    // One slot, so this is a fresh client — correct, just not reused.
    expect(again).not.toBe(first)
    expect(again.baseURL).toBe('http://x/v1')
  })
})
