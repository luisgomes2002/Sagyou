import { join } from 'path'
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'

interface CachedRate {
  rate: string
  date: string
  source: 'awesomeapi' | 'frankfurter' | 'cache' | 'identity'
  fetchedAt: string
}

interface RatesFile {
  [pair: string]: CachedRate
}

const RATES_PATH = (): string => join(app.getPath('userData'), 'financial-rates.json')

const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day

const AWESOMEAPI_BASE = 'https://economia.awesomeapi.com.br'

function loadRates(): RatesFile {
  try {
    if (!existsSync(RATES_PATH())) return {}
    const raw = readFileSync(RATES_PATH(), 'utf-8')
    return JSON.parse(raw) as RatesFile
  } catch {
    return {}
  }
}

function saveRates(rates: RatesFile): void {
  try {
    writeFileSync(RATES_PATH(), JSON.stringify(rates, null, 2))
  } catch {
    // best-effort — failing to cache just means we re-fetch next time
  }
}

function isFresh(cached: CachedRate): boolean {
  return Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS
}

async function fetchAwesomeApi(pair: string): Promise<CachedRate | null> {
  const url = `${AWESOMEAPI_BASE}/last/${pair}`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = (await res.json()) as Record<
      string,
      { bid: string; code: string; codein: string; create_date: string }
    >
    const key = Object.keys(data)[0]
    if (!key || !data[key]) return null
    const entry = data[key]
    const date = entry.create_date.slice(0, 10) // "2026-07-28 12:00:00" → "2026-07-28"
    return {
      rate: entry.bid,
      date,
      source: 'awesomeapi',
      fetchedAt: new Date().toISOString()
    }
  } catch {
    return null
  }
}

async function fetchFrankfurter(pair: string): Promise<CachedRate | null> {
  const [from, to] = pair.split('-')
  const url = `https://api.frankfurter.app/latest?from=${from}&to=${to}`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = (await res.json()) as { rates: Record<string, number>; date: string }
    if (!data.rates || data.rates[to] === undefined) return null
    return {
      rate: data.rates[to].toString(),
      date: data.date,
      source: 'frankfurter',
      fetchedAt: new Date().toISOString()
    }
  } catch {
    return null
  }
}

export async function getExchangeRate(pair: string): Promise<CachedRate> {
  const [from, to] = pair.split('-')
  if (from === to) {
    return { rate: '1', date: '', source: 'identity', fetchedAt: new Date().toISOString() }
  }

  const rates = loadRates()
  const cached = rates[pair]

  // If cache is fresh AND from the preferred source, return immediately.
  // Otherwise, try AwesomeAPI first — even a fresh cache from a fallback
  // source should be upgraded when the preferred API is back.
  if (cached && isFresh(cached) && cached.source === 'awesomeapi') {
    return cached
  }

  // Try AwesomeAPI first, fall back to Frankfurter
  let result: CachedRate | null = null
  try {
    result = await fetchAwesomeApi(pair)
  } catch {
    // best-effort, try fallback
  }

  if (!result) {
    try {
      result = await fetchFrankfurter(pair)
    } catch {
      // best-effort, will use cached
    }
  }

  if (result) {
    rates[pair] = result
    saveRates(rates)
    return result
  }

  // Both APIs failed. Return stale cache if it exists.
  if (cached) {
    return { ...cached, source: 'cache' }
  }

  throw new Error(`Não foi possível obter a cotação para ${pair}`)
}
