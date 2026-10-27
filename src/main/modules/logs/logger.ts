import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { scrubSecrets } from '../ai/memory'

export const LOG_RETENTION_DAYS = 14
/** Past this size a day's file only takes warnings and errors. */
export const LOG_DAY_BYTE_LIMIT = 5 * 1024 * 1024
const MAX_STRING = 500
const DEFAULT_READ_LIMIT = 100
const MAX_READ_LIMIT = 200
const DAY_MS = 24 * 60 * 60 * 1000
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/

// Keys that could carry user content, money or credentials. Dropped even if a
// caller passes them, so a careless log call can't leak them.
const FORBIDDEN_KEYS = new Set([
  'token',
  'content',
  'body',
  'title',
  'description',
  'amount',
  'value',
  'args',
  'arguments',
  'password'
])

export type LogLevel = 'info' | 'warn' | 'error'
export type LogArea = 'app' | 'store' | 'backup' | 'pty' | 'mcp' | 'delivery'
export type LogData = Record<string, string | number | boolean | null | undefined>

export interface LogEntry {
  ts: string
  level: LogLevel
  area: string
  event: string
  msg?: string
  data?: Record<string, string | number | boolean | null>
}

export interface LogQuery {
  /** 'warn' = warnings and errors; 'error' = errors only; otherwise everything. */
  level?: unknown
  area?: unknown
  /** ISO date, or a relative window like '24h' / '7d'. Defaults to 24h. */
  since?: unknown
  limit?: unknown
}

export interface Logger {
  info: (area: LogArea, event: string, data?: LogData) => void
  warn: (area: LogArea, event: string, data?: LogData) => void
  error: (area: LogArea, event: string, data?: LogData) => void
  readLogs: (query: LogQuery) => { entries: LogEntry[]; truncated: boolean }
  prune: () => void
}

const clean = (text: string): string => scrubSecrets(text).text.slice(0, MAX_STRING)

/** Primitive, non-forbidden values only; strings scrubbed and capped. */
export function sanitizeLogData(data: LogData | undefined): {
  msg?: string
  data?: Record<string, string | number | boolean | null>
} {
  if (!data) return {}
  let msg: string | undefined
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(data)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue
    if (key === 'msg') {
      if (typeof value === 'string') msg = clean(value)
      continue
    }
    if (typeof value === 'string') out[key] = clean(value)
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null)
      out[key] = value
  }
  return {
    ...(msg !== undefined ? { msg } : {}),
    ...(Object.keys(out).length ? { data: out } : {})
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')
/** Local calendar day, matching how the user reads "today's" log. */
const dayOf = (time: number): string => {
  const d = new Date(time)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function sinceTime(since: unknown, now: number): number {
  if (typeof since === 'string') {
    const relative = /^(\d+)([hd])$/.exec(since.trim())
    if (relative) return now - Number(relative[1]) * (relative[2] === 'h' ? 3600_000 : DAY_MS)
    const parsed = Date.parse(since)
    if (!Number.isNaN(parsed)) return parsed
  }
  return now - DAY_MS
}

/**
 * Diagnostic log: one JSONL file per local day under `dir`. Every failure is
 * swallowed — logging must never take the app down with it.
 */
export function createLogger(options: {
  dir: string
  now?: () => number
  echo?: (entry: LogEntry) => void
}): Logger {
  const now = options.now ?? Date.now
  const { dir } = options

  let lastDay: string | null = null

  const write = (level: LogLevel, area: LogArea, event: string, data?: LogData): void => {
    const time = now()
    const entry: LogEntry = {
      ts: new Date(time).toISOString(),
      level,
      area,
      event,
      ...sanitizeLogData(data)
    }
    try {
      options.echo?.(entry)
      mkdirSync(dir, { recursive: true })
      const day = dayOf(time)
      // A long-running app crosses midnight: apply the retention again then.
      if (lastDay !== null && day !== lastDay) prune()
      lastDay = day
      const file = join(dir, `${day}.jsonl`)
      if (level === 'info') {
        try {
          if (statSync(file).size >= LOG_DAY_BYTE_LIMIT) return
        } catch {
          /* no file yet */
        }
      }
      appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
    } catch {
      /* logging is best effort */
    }
  }

  const dayFiles = (): string[] => {
    try {
      return readdirSync(dir).filter((name) => DAY_FILE.test(name))
    } catch {
      return []
    }
  }

  const readLogs = (query: LogQuery): { entries: LogEntry[]; truncated: boolean } => {
    const time = now()
    const from = sinceTime(query.since, time)
    const firstDay = dayOf(from)
    const levels: LogLevel[] =
      query.level === 'error'
        ? ['error']
        : query.level === 'warn'
          ? ['warn', 'error']
          : ['info', 'warn', 'error']
    const area = typeof query.area === 'string' ? query.area : null
    const requested =
      typeof query.limit === 'number' && query.limit >= 1
        ? Math.floor(query.limit)
        : DEFAULT_READ_LIMIT
    const limit = Math.min(requested, MAX_READ_LIMIT)

    const entries: LogEntry[] = []
    for (const name of dayFiles()) {
      if (name.slice(0, 10) < firstDay) continue
      let raw = ''
      try {
        raw = readFileSync(join(dir, name), 'utf8')
      } catch {
        continue
      }
      for (const line of raw.split('\n')) {
        if (!line) continue
        try {
          const entry = JSON.parse(line) as LogEntry
          if (typeof entry.ts !== 'string' || typeof entry.event !== 'string') continue
          if (Date.parse(entry.ts) < from || !levels.includes(entry.level)) continue
          if (area && entry.area !== area) continue
          entries.push(entry)
        } catch {
          /* corrupted line */
        }
      }
    }
    // Stable sort keeps write order for events in the same millisecond; reverse = newest first.
    entries.sort((a, b) => a.ts.localeCompare(b.ts)).reverse()
    return { entries: entries.slice(0, limit), truncated: entries.length > limit }
  }

  const prune = (): void => {
    const oldestKept = dayOf(now() - LOG_RETENTION_DAYS * DAY_MS)
    for (const name of dayFiles()) {
      if (name.slice(0, 10) >= oldestKept) continue
      try {
        unlinkSync(join(dir, name))
      } catch {
        /* ignore */
      }
    }
  }

  return {
    info: (area, event, data) => write('info', area, event, data),
    warn: (area, event, data) => write('warn', area, event, data),
    error: (area, event, data) => write('error', area, event, data),
    readLogs,
    prune
  }
}

let active: Logger | null = null

/** Points the app-wide `log` at a real logger (done once userData is known). */
export function configureLog(logger: Logger | null): void {
  active = logger
}

/** App-wide logger; a no-op until configureLog runs (tests, early startup). */
export const log: Logger = {
  info: (area, event, data) => active?.info(area, event, data),
  warn: (area, event, data) => active?.warn(area, event, data),
  error: (area, event, data) => active?.error(area, event, data),
  readLogs: (query) => active?.readLogs(query) ?? { entries: [], truncated: false },
  prune: () => active?.prune()
}

/**
 * Error → short message for log data, without user content: a JSON syntax
 * error quotes the text around the failure (task titles, amounts), and a
 * file-system error carries the path, so both are reduced to a code.
 */
export const errorMessage = (error: unknown): string => {
  if (error instanceof SyntaxError) return 'invalid_json'
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'string' && /^E[A-Z]+$/.test(code)) return code
  return error instanceof Error ? error.message : String(error)
}
