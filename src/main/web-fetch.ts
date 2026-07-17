// Fetching a page for the assistant. No Electron here, so the rules are
// testable on their own; index.ts wires this to the ai:web:fetch channel.
//
// This is reachable by the MODEL, and once the model can read web pages a
// fetched page can tell it what to do next (prompt injection). So the URL is
// treated as untrusted input, not as something the user typed: it is checked
// before the request and again after every redirect.

/** Longest slice of a page handed back. Anything past this is elided. */
export const MAX_CONTENT_CHARS = 8000

/** How long a page has to answer before we give up on it. */
export const FETCH_TIMEOUT_MS = 15_000

/** Redirect hops followed before assuming a loop. */
const MAX_REDIRECTS = 5

/** Fetches allowed per RATE_WINDOW_MS before they start queueing. */
export const RATE_LIMIT_MAX = 10

/** The sliding window the limit is measured over. */
export const RATE_WINDOW_MS = 60_000

/**
 * Longest a fetch will sit in the queue before giving up on its turn.
 *
 * Two windows: a burst of ~30 pages still gets through (slowly), which is the
 * shape of a real research task. A model in a loop firing hundreds queues past
 * this and is refused — and refusing *is* right there, because at that point
 * nothing is going to make the request reasonable.
 */
export const MAX_QUEUE_WAIT_MS = 2 * RATE_WINDOW_MS

/**
 * Paces outgoing fetches, by **waiting** rather than refusing.
 *
 * The model can call `buscar_na_web` freely — it needs no approval, and nothing
 * caps how many tool calls one step may contain (only the step count is capped,
 * at 50), so an accidental loop really can hammer a site from the user's own IP.
 *
 * It waits instead of erroring because **the caller is a language model and a
 * model cannot sleep**. An error saying "try again in 42s" reaches something
 * structurally incapable of doing so: its only moves are to retry at once and
 * fail again, or to give up — so a refusal mid-run tends to burn the run's
 * remaining steps and end with no answer. A delay is invisible to it: the fetch
 * simply takes longer, the research still finishes, and a hot loop is throttled
 * to RATE_LIMIT_MAX/min, which is the part that actually protects the site.
 *
 * One slot per **logical fetch**, not per HTTP request: a redirect chain is
 * bounded at MAX_REDIRECTS anyway, so the true ceiling is ~60 requests/min in a
 * pathological case and ~10 in every real one.
 */
export interface RateLimiter {
  /** Resolves when a slot is taken. An error means the queue was hopeless. */
  acquire: () => Promise<FetchErr | null>
}

export function createRateLimiter(opts: {
  max?: number
  windowMs?: number
  maxWaitMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
} = {}): RateLimiter {
  const max = opts.max ?? RATE_LIMIT_MAX
  const windowMs = opts.windowMs ?? RATE_WINDOW_MS
  const maxWaitMs = opts.maxWaitMs ?? MAX_QUEUE_WAIT_MS
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  /** When each of the last `max` fetches started. Oldest first. */
  const hits: number[] = []

  return {
    acquire: async () => {
      const deadline = now() + maxWaitMs
      for (;;) {
        const t = now()
        // Sliding, not fixed: drop what has aged out, so a slot frees the
        // moment its request turns a window old rather than on a tick boundary.
        while (hits.length > 0 && t - hits[0] >= windowMs) hits.shift()
        if (hits.length < max) {
          hits.push(t)
          return null
        }
        // Re-checked after sleeping rather than trusted: another caller may
        // have taken the slot this one was waiting for.
        const freeIn = windowMs - (t - hits[0])
        if (t + freeIn > deadline) {
          return {
            error:
              'Muitas buscas na web em pouco tempo. Responda com o que já tem, ' +
              'ou tente de novo daqui a pouco.'
          }
        }
        await sleep(Math.max(freeIn, 1))
      }
    }
  }
}

/** The process-wide limiter. Shared on purpose: the limit is per machine. */
const defaultLimiter = createRateLimiter()

/** Bytes read before giving up, even if the chars cap hasn't been reached. */
const MAX_BYTES = 5 * 1024 * 1024

export interface FetchOk {
  content: string
  /** Where the content actually came from — after redirects, not what was asked. */
  url: string
  truncated: boolean
}
export interface FetchErr {
  error: string
}
export type FetchResult = FetchOk | FetchErr

/** Content this is worth handing to a language model as text. */
const TEXTUAL = /^(text\/|application\/(json|xml|xhtml\+xml|javascript|x-ndjson))/

function ipv4Private(host: string): boolean | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const [a, b] = m.slice(1).map(Number)
  if (m.slice(1).some((o) => Number(o) > 255)) return true // malformed: refuse
  return (
    a === 0 || // this host
    a === 127 || // loopback
    a === 10 || // private
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a >= 224 // multicast / reserved
  )
}

/**
 * Whether a host is somewhere only this machine or this LAN can reach.
 *
 * The app runs on the user's own computer, so "the network" includes their dev
 * servers, their NAS and their router's admin page. A page the model just read
 * must not be able to steer it into any of that.
 *
 * Caveat: this reads the literal host. A public name that resolves to
 * 127.0.0.1 (DNS rebinding) is not caught — that needs resolution plus a
 * pinning agent, which is a bigger job than this handler.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  // Cloud metadata services, reachable from any VM.
  if (host === 'metadata.google.internal' || host.endsWith('.internal')) return true

  const v4 = ipv4Private(host)
  if (v4 !== null) return v4

  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true
    // IPv4-mapped (::ffff:127.0.0.1) smuggles a v4 address through a v6 literal.
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host)
    if (mapped) return ipv4Private(mapped[1]) ?? true
    const head = host.split(':')[0]
    if (/^f[cd]/.test(head)) return true // fc00::/7 unique-local
    if (/^fe[89ab]/.test(head)) return true // fe80::/10 link-local
  }
  return false
}

/**
 * The URL to fetch, or why we won't.
 *
 * Only http(s): `file:` would read the disk and `data:` would just echo the
 * model's own bytes back at it, both dressed up as "a web page".
 */
export function checkUrl(raw: unknown): { url: URL } | FetchErr {
  const parsed = parseUrl(raw)
  if ('error' in parsed) return parsed
  return urlPolicy(parsed.url) ?? parsed
}

/**
 * Shape only: is this a URL at all? No policy.
 *
 * The parser is the sanitiser, and deliberately the only one. `new URL()`
 * implements the WHATWG rules, which **strip every ASCII tab, newline and
 * carriage return** before parsing: `http://exa\nmple.com/x` parses to
 * example.com, and a CRLF smuggled in for header injection
 * (`http://host/a\r\nX-Injected: 1`) comes out percent-encoded inside the path,
 * where it is inert. `.trim()` covers the surrounding whitespace the spec
 * leaves alone.
 *
 * ⚠️ **Do not add a hand-rolled cleaning pass in front of this** — no stripping
 * characters, no decoding HTML entities. The one invariant that makes any of
 * this hold is that **the URL that is checked is the object that is fetched**:
 * `fetchWeb` validates this `URL` and hands the same `URL` to `fetch`, so no
 * layer ever re-parses a string and reaches a different host. A pre-pass that
 * rewrites the text breaks that in the worst way — whatever it produces is what
 * gets fetched, and it is not what was checked. HTML entities in particular are
 * a different encoding layer entirely: URLs use percent-encoding, and decoding
 * `?a=1&amp;b=2` to `?a=1&b=2` silently fetches a different query.
 */
function parseUrl(raw: unknown): { url: URL } | FetchErr {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'URL vazia' }
  try {
    return { url: new URL(raw.trim()) }
  } catch {
    return { error: 'URL inválida' }
  }
}

/**
 * Whether the URL carries embedded credentials (`http://user:senha@host/`).
 *
 * Read off the parsed URL, never off the string. `@` is perfectly legal in a
 * path or a query — `http://example.com/?x=a@b` has no userinfo at all — so a
 * string test for '@' would refuse ordinary URLs. Only the parser knows which
 * `@` is which, and an empty username with a password (`http://:senha@host/`)
 * is still userinfo, hence both fields.
 */
function hasCredentials(url: URL): boolean {
  return url.username !== '' || url.password !== ''
}

/** The policy: what we refuse to fetch, and why. Null means it's allowed. */
function urlPolicy(url: URL): FetchErr | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: `Protocolo não suportado: ${url.protocol} (use http ou https)` }
  }
  // Refused rather than stripped. Three reasons, in order of weight:
  //
  //  - It is not this app's business to send credentials anywhere. The URL
  //    comes from the model, which may have picked it up off a page it just
  //    read; forwarding a username and password on that basis is a decision
  //    nobody made.
  //  - `http://google.com@evil.com/` reads as google.com to a person glancing
  //    at the chat, and `FetchOk.url` is shown back to the user. The host is
  //    evil.com. Refusing is the only reading that can't mislead.
  //  - Depth. `isPrivateHost(url.hostname)` does resolve
  //    `http://evil.com@127.0.0.1/` correctly today (hostname is 127.0.0.1) —
  //    this is not fixing a live bypass. But every layer that re-parses a URL
  //    is a chance to disagree about where the host ends, and userinfo is where
  //    that disagreement classically happens. Nothing here needs it, so it goes.
  if (hasCredentials(url)) {
    return { error: `Endereço bloqueado: ${url.hostname} tem credenciais embutidas (user@host)` }
  }
  if (isPrivateHost(url.hostname)) {
    return { error: `Endereço bloqueado: ${url.hostname} é da rede local ou da própria máquina` }
  }
  return null
}

/**
 * Read the body as text, stopping once there is enough.
 *
 * The cap is applied while reading, not after: `res.text()` would pull a
 * multi-gigabyte response into memory in full and only then slice it to 8000
 * characters.
 */
async function readCapped(res: Response): Promise<{ content: string; truncated: boolean }> {
  const body = res.body
  if (!body) return { content: '', truncated: false }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let content = ''
  let bytes = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value?.byteLength ?? 0
      content += decoder.decode(value, { stream: true })
      if (content.length > MAX_CONTENT_CHARS || bytes > MAX_BYTES) {
        truncated = true
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  if (content.length > MAX_CONTENT_CHARS) {
    content = content.slice(0, MAX_CONTENT_CHARS)
    truncated = true
  }
  return { content, truncated }
}

export interface FetchDeps {
  /** Re-checked on every hop; a redirect is a fresh URL from an untrusted party. */
  validate?: (url: URL) => FetchErr | null
  timeoutMs?: number
  /** Override the process-wide limiter — tests need their own, and a fake clock. */
  limiter?: RateLimiter
}

/** The real rule — the same policy the entry URL is held to. */
const defaultValidate = (url: URL): FetchErr | null => urlPolicy(url)

/**
 * Fetch a page and return at most MAX_CONTENT_CHARS of its text.
 *
 * Redirects are followed by hand rather than by fetch: a public URL that
 * 302s to 169.254.169.254 would sail past a check done only on the input.
 */
export async function fetchWeb(raw: unknown, deps: FetchDeps = {}): Promise<FetchResult> {
  const validate = deps.validate ?? defaultValidate
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS

  const parsed = parseUrl(raw)
  if ('error' in parsed) return parsed

  // Wait for a slot BEFORE the clock below starts. `timeoutMs` is the page's
  // budget to respond, not the queue's: starting the timer first would abort a
  // queued fetch for "not responding" before it had been sent, and the busier
  // things got the more certain that would be.
  //
  // Shape check first, so junk is rejected without consuming a slot — but the
  // policy check stays inside the loop below, where every hop meets it.
  const blockedByRate = await (deps.limiter ?? defaultLimiter).acquire()
  if (blockedByRate) return blockedByRate

  // The entry URL is vetted by the same `validate` as every redirect, inside
  // the loop below — one rule, one place, no hop exempt.
  let target = parsed.url
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (let hop = 0; ; hop++) {
      if (hop > MAX_REDIRECTS) return { error: 'Redirecionamentos demais' }
      const blocked = validate(target)
      if (blocked) return blocked

      // The request carries nothing of the user's.
      //
      // This is a page the *model* chose to read, on the user's machine and
      // from the user's IP. It is not the user visiting a site, and it must not
      // look like one: no cookies, no credentials, no session, nothing that
      // could identify or authenticate them to whatever the model picked.
      //
      // Measured against a real server, this sends exactly: host, connection,
      // accept (below), accept-language: *, accept-encoding, sec-fetch-mode,
      // and `user-agent: node`. There is no cookie jar in Node's fetch, so a
      // Set-Cookie from one response is not echoed to the next — pinned by a
      // test rather than trusted, since it is a property of the runtime and not
      // of this file.
      //
      // Three things deliberately NOT done:
      //  - **`mode: 'no-cors'`** — the instinct this reads as, and it buys
      //    nothing: measured, Node's fetch ignores `mode` outright (the
      //    response is `basic` with its body intact whatever you pass). It is
      //    a browser concept — there are no origins here — so setting it would
      //    only imply a protection that isn't happening. Worth knowing that in
      //    a *browser* no-cors yields an opaque response, i.e. no body: if this
      //    ever runs anywhere but Node, that line would silently empty it.
      //    `sec-fetch-mode: cors` in the headers is undici's own default and a
      //    hint to the server, not a permission this client is claiming.
      //  - **A branded user-agent** ("Sagyou/3.0"). It reads like the polite
      //    thing to do and is worse: it tells every site the model visits which
      //    app and version the user runs. `node` says only "an automated
      //    client", which is true and identifies nobody.
      //  - **Dropping user-agent entirely** — plenty of servers answer 403 to a
      //    request without one, turning a privacy gesture into a bug report.
      const res = await fetch(target, {
        redirect: 'manual',
        signal: controller.signal,
        // Declarative, not load-bearing — and measured, so the comment doesn't
        // flatter it: Node's fetch has no cookie jar, so nothing is sent here
        // even with `credentials: 'include'`. It is kept as a statement of
        // intent that the type checker holds to, and because it becomes live
        // the moment the client underneath is not Node's fetch — Electron's
        // `net.fetch`, for one, is wired to the session and to real cookies.
        // The guarantee itself is pinned by tests, not by this word.
        credentials: 'omit',
        headers: { accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/*;q=0.8' }
      })

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) return { error: `Redirecionamento sem destino (${res.status})` }
        try {
          target = new URL(location, target)
        } catch {
          return { error: 'Redirecionamento para uma URL inválida' }
        }
        continue
      }

      if (!res.ok) return { error: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}` }

      const type = res.headers.get('content-type') ?? ''
      if (type && !TEXTUAL.test(type)) {
        // Binary as text is noise the model pays for by the token.
        return { error: `Conteúdo não textual (${type.split(';')[0]})` }
      }

      const { content, truncated } = await readCapped(res)
      return { content, url: target.href, truncated }
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { error: `A página não respondeu em ${Math.round(timeoutMs / 1000)}s` }
    }
    return { error: e instanceof Error ? e.message : 'Falha ao buscar a página' }
  } finally {
    clearTimeout(timer)
  }
}
