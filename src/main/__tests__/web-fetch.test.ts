/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'http'
import {
  checkUrl,
  isPrivateHost,
  fetchWeb,
  createRateLimiter,
  MAX_CONTENT_CHARS,
  type RateLimiter,
  RATE_LIMIT_MAX,
  RATE_WINDOW_MS,
  type FetchOk,
  type FetchErr
} from '../web-fetch'

const isOk = (r: FetchOk | FetchErr): r is FetchOk => !('error' in r)

describe('isPrivateHost', () => {
  it('rejects this machine', () => {
    for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '0.0.0.0']) {
      expect(isPrivateHost(h)).toBe(true)
    }
  })

  it('rejects the LAN — the user’s router and NAS live there', () => {
    for (const h of ['192.168.1.1', '10.0.0.5', '172.16.0.1', '172.31.255.255']) {
      expect(isPrivateHost(h)).toBe(true)
    }
  })

  it('rejects cloud metadata, which hands out credentials', () => {
    expect(isPrivateHost('169.254.169.254')).toBe(true)
    expect(isPrivateHost('metadata.google.internal')).toBe(true)
  })

  it('rejects an IPv4 address smuggled inside an IPv6 literal', () => {
    // ::ffff:127.0.0.1 is loopback wearing a different hat.
    expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateHost('[::ffff:169.254.169.254]')).toBe(true)
  })

  it('rejects unique-local and link-local IPv6', () => {
    expect(isPrivateHost('fd00::1')).toBe(true)
    expect(isPrivateHost('fe80::1')).toBe(true)
  })

  it('allows ordinary public hosts', () => {
    for (const h of ['example.com', 'api.github.com', '8.8.8.8', '172.32.0.1', '192.169.0.1']) {
      expect(isPrivateHost(h)).toBe(false)
    }
  })
})

describe('checkUrl', () => {
  it('accepts http and https', () => {
    expect(checkUrl('https://example.com/a')).toMatchObject({ url: expect.any(URL) })
    expect(checkUrl('http://example.com')).toMatchObject({ url: expect.any(URL) })
  })

  it('refuses schemes that are not the web', () => {
    // file: would read the disk; data: just echoes the model's own bytes back.
    // The rule is an allowlist, so this list is illustrative, not exhaustive —
    // a scheme nobody thought of is refused by default rather than by name.
    for (const u of [
      'file:///etc/passwd',
      'data:text/html,<b>x</b>',
      'ftp://example.com',
      'javascript:alert(1)'
    ]) {
      expect(checkUrl(u)).toMatchObject({ error: expect.stringContaining('Protocolo') })
    }
  })

  it('refuses a local address', () => {
    expect(checkUrl('http://localhost:8080/admin')).toMatchObject({
      error: expect.stringContaining('bloqueado')
    })
  })

  it('refuses embedded credentials', () => {
    // Not this app's business to send a username and password anywhere: the URL
    // comes from the model, quite possibly copied off a page it just read.
    for (const u of [
      'http://user:senha@example.com/',
      'http://user@example.com/',
      'http://:senha@example.com/'
    ]) {
      expect(checkUrl(u)).toMatchObject({ error: expect.stringContaining('credenciais') })
    }
  })

  it('refuses a host disguised by userinfo', () => {
    // Reads as google.com at a glance, and FetchOk.url is shown back to the
    // user. The host is evil.com.
    expect(checkUrl('http://google.com@evil.com/')).toMatchObject({
      error: expect.stringContaining('credenciais')
    })
  })

  it('still resolves the real host behind userinfo, credentials aside', () => {
    // The private-host check was never fooled by this — hostname is 127.0.0.1,
    // not evil.com. Worth pinning: it is the reason the rule above is depth and
    // not a fix for a live bypass.
    expect(new URL('http://evil.com@127.0.0.1/').hostname).toBe('127.0.0.1')
  })

  it('allows an @ that is not userinfo', () => {
    // The guard reads url.username/password, not the string. A test for '@'
    // would refuse these, which are ordinary URLs.
    expect(checkUrl('http://example.com/?x=a@b')).toMatchObject({ url: expect.any(URL) })
    expect(checkUrl('http://example.com/path@notuserinfo')).toMatchObject({ url: expect.any(URL) })
    expect(checkUrl('http://example.com/u/@perfil')).toMatchObject({ url: expect.any(URL) })
  })

  it('strips newlines and tabs by parsing, not by hand', () => {
    // WHATWG removes ASCII tab/newline/CR before parsing, so this is already
    // example.com — and the CRLF that was meant to inject a header ends up
    // percent-encoded inside the path, inert.
    const clean = checkUrl('http://exa\nmple.com/x')
    expect(clean).toMatchObject({ url: expect.any(URL) })
    expect((clean as { url: URL }).url.hostname).toBe('example.com')

    const crlf = checkUrl('http://example.com/a\r\nX-Injected: 1')
    expect((crlf as { url: URL }).url.href).not.toContain('\n')
  })

  it('a newline cannot smuggle a blocked host past the check', () => {
    // The check reads the parsed host, so the stripping happens before the
    // policy, not after it.
    expect(checkUrl('http://127.0.0\n.1/')).toMatchObject({
      error: expect.stringContaining('bloqueado')
    })
  })

  it('trims surrounding whitespace', () => {
    expect(checkUrl('  http://example.com/  ')).toMatchObject({ url: expect.any(URL) })
  })

  it('does not decode HTML entities, which would fetch a different URL', () => {
    // `&amp;` is HTML's encoding layer, not the URL's. Decoding it here would
    // turn one query into another — and whatever a cleaning pass produced would
    // be what gets fetched, while what was checked was something else.
    const res = checkUrl('http://example.com/?a=1&amp;b=2')
    expect((res as { url: URL }).url.search).toBe('?a=1&amp;b=2')
  })

  it('refuses junk', () => {
    for (const u of ['', '   ', 'not a url', null, 42]) {
      expect(checkUrl(u)).toHaveProperty('error')
    }
  })
})

// --- the fetch mechanics, against a real server ------------------------------
//
// The host guard would block 127.0.0.1, so these pass a permissive `validate`.
// The guard itself is covered above; what's under test here is the HTTP work.

describe('fetchWeb', () => {
  let server: http.Server
  let base: string
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void

  // Its own limiter, wide open. The real one is process-wide module state, so
  // without this the tests below would spend each other's slots and then queue
  // for a minute. The limiter itself is covered in its own describe.
  const noLimit = (): { acquire: () => Promise<null> } => ({ acquire: async () => null })
  const allowLocal = { validate: () => null, limiter: noLimit() }

  beforeAll(async () => {
    server = http.createServer((req, res) => handler(req, res))
    await new Promise<void>((r) => server.listen(0, r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(() => server.close())

  it('returns the page text, its url and no truncation', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('conteúdo da página')
    }

    const res = await fetchWeb(`${base}/a`, allowLocal)

    expect(isOk(res)).toBe(true)
    expect(res).toMatchObject({ content: 'conteúdo da página', url: `${base}/a`, truncated: false })
  })

  it('caps a long page at the limit and says so', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('x'.repeat(50_000))
    }

    const res = await fetchWeb(`${base}/big`, allowLocal)

    expect(isOk(res) && res.content).toHaveLength(MAX_CONTENT_CHARS)
    expect(isOk(res) && res.truncated).toBe(true)
  })

  it('stops reading rather than downloading it all first', async () => {
    // res.text() would pull the whole thing into memory and only then slice.
    let written = 0
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      const chunk = 'y'.repeat(64 * 1024)
      const pump = (): void => {
        // 100 MB if nobody stops it.
        if (written >= 100 * 1024 * 1024 || res.writableEnded) return void res.end()
        written += chunk.length
        if (res.write(chunk)) setImmediate(pump)
        else res.once('drain', pump)
      }
      res.on('close', () => res.destroy())
      pump()
    }

    const res = await fetchWeb(`${base}/endless`, allowLocal)

    expect(isOk(res) && res.truncated).toBe(true)
    expect(isOk(res) && res.content).toHaveLength(MAX_CONTENT_CHARS)
    // It gave up early instead of swallowing the whole stream.
    expect(written).toBeLessThan(100 * 1024 * 1024)
  })

  it('gives up on a server that never answers', async () => {
    handler = () => {
      /* deliberately no response */
    }

    const res = await fetchWeb(`${base}/hang`, { ...allowLocal, timeoutMs: 300 })

    expect(res).toMatchObject({ error: expect.stringContaining('não respondeu') })
  })

  it('reports an HTTP error instead of returning the error page as content', async () => {
    handler = (_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/html' })
      res.end('<h1>Not Found</h1>')
    }
    expect(await fetchWeb(`${base}/missing`, allowLocal)).toMatchObject({
      error: expect.stringContaining('404')
    })
  })

  it('refuses binary, which is only noise to a model', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    }
    expect(await fetchWeb(`${base}/img.png`, allowLocal)).toMatchObject({
      error: expect.stringContaining('não textual')
    })
  })

  it('accepts json and html', async () => {
    for (const type of ['application/json', 'text/html; charset=utf-8']) {
      handler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': type })
        res.end('{"a":1}')
      }
      expect(isOk(await fetchWeb(`${base}/x`, allowLocal))).toBe(true)
    }
  })

  it('follows a redirect and reports where it ended up', async () => {
    handler = (req, res) => {
      if (req.url === '/from') {
        res.writeHead(302, { Location: '/to' })
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('destino')
    }

    const res = await fetchWeb(`${base}/from`, allowLocal)

    // The final url matters: the model should cite where the text came from.
    expect(res).toMatchObject({ content: 'destino', url: `${base}/to` })
  })

  it('re-checks the host after a redirect', async () => {
    // The real attack: a page the model was told to read 302s to the cloud
    // metadata service, which hands out credentials.
    //
    // The entry URL has to be *allowed* for this to test anything: with the
    // real policy the local test server is itself blocked, so the run would
    // stop before the redirect and the test would pass without ever proving a
    // hop is re-checked. So the stand-in treats only the test origin as public
    // and applies the real policy to everything else.
    const publicBase = {
      validate: (u: URL) => {
        if (u.origin === base) return null
        const checked = checkUrl(u.href)
        return 'error' in checked ? checked : null
      },
      timeoutMs: 2000,
      limiter: noLimit()
    }
    let reachedMetadata = false
    handler = (req, res) => {
      if (req.url?.includes('meta-data')) reachedMetadata = true
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' })
      res.end()
    }

    const res = await fetchWeb(`${base}/evil`, publicBase)

    expect(res).toMatchObject({ error: expect.stringContaining('bloqueado') })
    expect(reachedMetadata).toBe(false)
  })

  it('re-checks a redirect that lands on credentials', async () => {
    // The policy is one function applied to every hop, so this rule is not an
    // entry-URL rule. A public page 302ing into user:senha@host would otherwise
    // hand credentials to whatever it chose.
    const publicBase = {
      validate: (u: URL) => {
        if (u.origin === base) return null
        const checked = checkUrl(u.href)
        return 'error' in checked ? checked : null
      },
      timeoutMs: 2000,
      limiter: noLimit()
    }
    handler = (_req, res) => {
      res.writeHead(302, { Location: 'http://user:senha@example.com/' })
      res.end()
    }

    expect(await fetchWeb(`${base}/to-creds`, publicBase)).toMatchObject({
      error: expect.stringContaining('credenciais')
    })
  })

  it('re-checks a redirect that hops to a different scheme', async () => {
    const publicBase = {
      validate: (u: URL) => {
        if (u.origin === base) return null
        const checked = checkUrl(u.href)
        return 'error' in checked ? checked : null
      },
      timeoutMs: 2000,
      limiter: noLimit()
    }
    handler = (_req, res) => {
      res.writeHead(302, { Location: 'file:///etc/passwd' })
      res.end()
    }

    expect(await fetchWeb(`${base}/to-file`, publicBase)).toMatchObject({
      error: expect.stringContaining('Protocolo')
    })
  })

  it('gives up on a redirect loop', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { Location: `${base}/loop` })
      res.end()
    }
    expect(await fetchWeb(`${base}/loop`, allowLocal)).toMatchObject({
      error: expect.stringContaining('Redirecionamentos demais')
    })
  })

  it('vets the entry URL before making any request', async () => {
    let hit = false
    handler = (_req, res) => {
      hit = true
      res.end('ok')
    }

    expect(await fetchWeb('http://localhost:1/x')).toMatchObject({ error: expect.any(String) })
    expect(await fetchWeb('file:///etc/passwd')).toMatchObject({ error: expect.any(String) })
    expect(hit).toBe(false)
  })

  it('reports a connection failure as an error, not a crash', async () => {
    const res = await fetchWeb('http://127.0.0.1:1/nope', allowLocal)
    expect(res).toHaveProperty('error')
  })
})

// --- pacing the model's fetches ----------------------------------------------

/**
 * The limiter waits rather than refuses, because the caller is a language model
 * and a model cannot sleep. An error telling it to "try again in 40s" reaches
 * something that can only retry at once and fail again, or give up — so a
 * refusal mid-run tends to burn the run's remaining steps and answer nothing.
 * A delay it never even sees.
 *
 * Driven by an injected clock: real waits would make this suite take minutes,
 * and the point is the arithmetic, not the sleeping.
 */
describe('rate limiter', () => {
  /** A limiter on a clock the test drives by hand. */
  function onFakeClock(opts: { max?: number; windowMs?: number; maxWaitMs?: number } = {}): {
    limiter: RateLimiter
    slept: number[]
    at: () => number
    advance: (ms: number) => number
  } {
    let clock = 0
    const slept: number[] = []
    const limiter = createRateLimiter({
      ...opts,
      now: () => clock,
      // Sleeping *is* advancing the clock here, so a wait resolves rather than
      // deadlocking on a clock nobody moves.
      sleep: async (ms) => {
        slept.push(ms)
        clock += ms
      }
    })
    return { limiter, slept, at: () => clock, advance: (ms: number) => (clock += ms) }
  }

  it('lets a normal burst straight through', async () => {
    const { limiter, slept } = onFakeClock()
    for (let i = 0; i < RATE_LIMIT_MAX; i++) expect(await limiter.acquire()).toBeNull()

    // Nothing waited: the limit is a ceiling on abuse, not a tax on ordinary use.
    expect(slept).toEqual([])
  })

  it('makes the one over the limit wait for a slot, not fail', async () => {
    const { limiter, slept } = onFakeClock()
    for (let i = 0; i < RATE_LIMIT_MAX; i++) await limiter.acquire()

    // The model never learns this happened — the fetch just took longer.
    expect(await limiter.acquire()).toBeNull()
    expect(slept).toEqual([RATE_WINDOW_MS])
  })

  it('slides: a slot frees as its request ages out, not on a tick', async () => {
    const { limiter, slept, advance } = onFakeClock()
    for (let i = 0; i < RATE_LIMIT_MAX; i++) await limiter.acquire()

    // Most of the window has already passed, so the wait is only the remainder.
    advance(RATE_WINDOW_MS - 1000)
    expect(await limiter.acquire()).toBeNull()
    expect(slept).toEqual([1000])
  })

  it('costs nothing once the window has rolled by', async () => {
    const { limiter, slept, advance } = onFakeClock()
    for (let i = 0; i < RATE_LIMIT_MAX; i++) await limiter.acquire()

    advance(RATE_WINDOW_MS)
    for (let i = 0; i < RATE_LIMIT_MAX; i++) expect(await limiter.acquire()).toBeNull()
    expect(slept).toEqual([])
  })

  it('lets a long research burst through, slowly, instead of failing it', async () => {
    // "Read these 12 pages and summarise" is an ordinary request. Refusing at
    // the 11th would waste everything spent getting there.
    const { limiter } = onFakeClock()
    for (let i = 0; i < 12; i++) expect(await limiter.acquire()).toBeNull()
  })

  it('refuses only when the wait itself would be hopeless', async () => {
    // Reachable mainly when callers pile up concurrently. A sequential caller —
    // which is what the agent is, running tools one at a time — waits at most
    // one window and is always served, so in ordinary use this never fires. It
    // is the safety valve, not the protection: the throttling is.
    const { limiter } = onFakeClock({ maxWaitMs: 0 })
    for (let i = 0; i < RATE_LIMIT_MAX; i++) expect(await limiter.acquire()).toBeNull()

    const refused = await limiter.acquire()

    // And it asks the model to do the one thing it can: answer. Not to wait —
    // waiting is precisely what a model cannot do.
    expect(refused).toMatchObject({ error: expect.stringContaining('Responda com o que já tem') })
    expect(refused).not.toMatchObject({ error: expect.stringContaining('Aguarde') })
  })

  it('serves a sequential caller however long the queue, rather than refusing it', async () => {
    // The case the "delay, don't reject" choice is for: 30 pages, one after
    // another. Every one is served; they are merely paced.
    const { limiter } = onFakeClock()
    for (let i = 0; i < 30; i++) expect(await limiter.acquire()).toBeNull()
  })

  it('recovers after a runaway instead of staying poisoned', async () => {
    const { limiter, advance } = onFakeClock({ maxWaitMs: RATE_WINDOW_MS })
    for (let i = 0; i < RATE_LIMIT_MAX; i++) await limiter.acquire()
    for (let i = 0; i < 40; i++) await limiter.acquire()

    // Quiet again: the next honest request is served normally.
    advance(RATE_WINDOW_MS * 3)
    expect(await limiter.acquire()).toBeNull()
  })
})

describe('fetchWeb + the limiter', () => {
  let server: http.Server
  let base: string

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
    })
    await new Promise<void>((r) => server.listen(0, r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(() => server.close())

  it('waits for its slot before starting the response clock', async () => {
    // The bug this guards: timeoutMs is the page's budget to answer, not the
    // queue's. Start the timer first and a queued fetch aborts for "not
    // responding" before it was ever sent — and the busier things get, the more
    // certain that becomes.
    let waited = false
    const limiter = {
      acquire: async () => {
        await new Promise((r) => setTimeout(r, 60))
        waited = true
        return null
      }
    }

    // A timeout shorter than the queue wait: it must still succeed.
    const res = await fetchWeb(`${base}/a`, { validate: () => null, limiter, timeoutMs: 40 })

    expect(waited).toBe(true)
    expect(res).toMatchObject({ content: 'ok' })
  })

  it('passes the limiter’s refusal back as the fetch result', async () => {
    const limiter = { acquire: async () => ({ error: 'Muitas buscas na web em pouco tempo.' }) }

    expect(await fetchWeb(`${base}/a`, { validate: () => null, limiter })).toMatchObject({
      error: expect.stringContaining('Muitas buscas')
    })
  })

  it('does not spend a slot on a URL that was never going to be fetched', async () => {
    let taken = 0
    const limiter = {
      acquire: async () => {
        taken++
        return null
      }
    }

    await fetchWeb('não é uma url', { validate: () => null, limiter })

    // Junk is rejected on shape alone. Charging it a slot would let a model
    // exhaust the budget without a single request leaving the machine.
    expect(taken).toBe(0)
  })
})

// --- what the request carries -------------------------------------------------

/**
 * A page the *model* chose to read, fetched from the user's machine and IP.
 * That is not the user visiting a site and must not look like one.
 *
 * These pin a property of the runtime, not of our code — which is exactly why
 * they are worth having. A comment claiming "Node's fetch is clean" is true
 * today and unenforced tomorrow: a Node release with a cookie jar, a refactor
 * onto Electron's `net.fetch` (wired to the session, and so to the user's real
 * cookies), or one added header would all pass code review in silence.
 */
describe('the fetch carries nothing of the user’s', () => {
  let server: http.Server
  let base: string
  let seen: http.IncomingHttpHeaders = {}
  let hits = 0

  const noLimit = { acquire: async () => null }
  const clean = { validate: () => null, limiter: noLimit }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen = req.headers
      hits++
      // Every response tries to plant one, the way a real site does.
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Set-Cookie': 'sessao=segredo123; Path=/; HttpOnly'
      })
      res.end('ok')
    })
    await new Promise<void>((r) => server.listen(0, r))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(() => server.close())

  beforeEach(() => {
    seen = {}
    hits = 0
  })

  it('never sends a cookie, however hard the site tries to set one', async () => {
    await fetchWeb(`${base}/um`, clean)
    await fetchWeb(`${base}/dois`, clean)

    // The second request is the test: the first response set a cookie, and a
    // client with a jar would hand it straight back.
    expect(hits).toBe(2)
    expect(seen.cookie).toBeUndefined()
  })

  it('sends no credential or identity headers at all', async () => {
    await fetchWeb(`${base}/a`, clean)

    for (const h of ['cookie', 'authorization', 'proxy-authorization', 'x-api-key']) {
      expect(seen[h]).toBeUndefined()
    }
  })

  it('sends no referer, so one page cannot tell the next where it was sent from', async () => {
    await fetchWeb(`${base}/a`, clean)
    expect(seen.referer).toBeUndefined()
  })

  it('carries nothing across a redirect either', async () => {
    // Redirects are followed by hand, so each hop is a fresh request built here
    // — this checks the second one isn't quietly richer than the first.
    const hop = http.createServer((_req, res) => {
      res.writeHead(302, { Location: `${base}/destino`, 'Set-Cookie': 'a=b' })
      res.end()
    })
    await new Promise<void>((r) => hop.listen(0, r))
    const hopBase = `http://127.0.0.1:${(hop.address() as { port: number }).port}`

    await fetchWeb(`${hopBase}/inicio`, clean)

    expect(seen.cookie).toBeUndefined()
    expect(seen.referer).toBeUndefined()
    expect(seen.authorization).toBeUndefined()
    hop.close()
  })

  it('does not announce which app or which user this is', async () => {
    await fetchWeb(`${base}/a`, clean)

    // 'node' is honest and identifies nobody. A branded UA would tell every
    // site the model visits what the user runs — the opposite of the point.
    expect(seen['user-agent']).not.toMatch(/sagyou/i)
    expect(seen['accept-language']).toBe('*') // not the user's real locale
  })

  it('asks only for text, and keeps the header set small', async () => {
    await fetchWeb(`${base}/a`, clean)

    expect(seen.accept).toContain('text/html')
    // A guard against drift: anything new arriving here is a decision someone
    // should have to make on purpose.
    const allowed = new Set([
      'host',
      'connection',
      'accept',
      'accept-language',
      'accept-encoding',
      'sec-fetch-mode',
      'user-agent'
    ])
    expect(Object.keys(seen).filter((h) => !allowed.has(h))).toEqual([])
  })

  it('still returns the body, with all of the above in place', async () => {
    // A smoke test, and honest about its reach: it does NOT catch someone
    // adding `mode: 'no-cors'`, because Node ignores `mode` and hands the body
    // back regardless (measured). In a browser that same line would return an
    // opaque response and empty this out — which is why the reasoning lives in
    // a comment at the call site rather than pretending to be pinned here.
    expect(await fetchWeb(`${base}/a`, clean)).toMatchObject({ content: 'ok' })
  })
})
