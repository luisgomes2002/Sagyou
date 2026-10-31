// Rendering a page for the assistant with a real (headless) browser, so SPA
// pages that draw themselves with JavaScript (openai.com/pricing and the like)
// come back as text instead of an empty shell. This is the JS-capable sibling
// of web-fetch.ts; index.ts wires it to ai:web:fetch when `render` is asked.
//
// ⚠️ SECURITY. A browser is a *much* larger attack surface than fetch: it runs
// the page's JavaScript and loads every subresource (img, script, xhr, fetch,
// WebSocket), and NONE of those go through fetch's by-hand redirect check. On
// this app — which runs on the user's own machine, where "the network" is their
// dev servers, NAS and router — an unguarded browser is a straight SSRF: a
// model-chosen page could `<img src="http://169.254.169.254/…">` or
// `fetch('http://127.0.0.1/admin')` and read the user's LAN from their own IP.
//
// So every request the browser makes — main document AND every subresource — is
// run through the SAME `checkUrl` policy that web-fetch enforces per hop (http(s)
// only, no private/loopback/link-local/metadata host, no credentials) via
// `session.webRequest.onBeforeRequest`, and anything it refuses is cancelled.
// The context is ephemeral and cookieless, node access is off, and the window is
// sandboxed. Residual gaps, unavoidable with a real engine, are listed at
// `renderWeb`.
//
// It reuses Electron's already-bundled Chromium through a hidden BrowserWindow —
// no second browser binary shipped, and Electron's webRequest gives the request
// interception natively. Nothing here is importable without Electron, so the one
// piece that carries the security decision (`checkUrl`) lives in web-fetch.ts and
// is unit-tested there; the pure helpers below are tested in web-render.test.ts.

import { BrowserWindow, session, app } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  checkUrl,
  defaultLimiter,
  MAX_CONTENT_CHARS,
  type FetchResult,
  type RateLimiter
} from './web-fetch'

/** Hard ceiling on a render, JS execution and all. */
export const RENDER_TIMEOUT_MS = 20_000

/** Grace after the document loads, for a SPA to hydrate before we read it. */
export const RENDER_SETTLE_MS = 1_500

/**
 * Should the browser be blocked from making this request?
 *
 * This is the whole guard, and it is deliberately the exact same policy the
 * fetch path applies to every redirect hop: `checkUrl` refuses a non-http(s)
 * scheme, a private/loopback/link-local/metadata host, and embedded
 * credentials. Used from `onBeforeRequest`, it runs for the main document and
 * for every subresource the page pulls.
 */
export function shouldCancelRequest(url: string): boolean {
  return 'error' in checkUrl(url)
}

/**
 * Strip this app's identity out of a browser user-agent, leaving a plain-Chrome
 * string.
 *
 * Two tokens give the app away in Electron's default UA — `Electron/<ver>` and
 * `<appName>/<ver>` — and telling every site the model visits which app and
 * version the user runs is the same leak web-fetch refuses when it declines to
 * brand its user-agent. A bare Chrome UA identifies nobody and, unlike `node`,
 * doesn't trip the bot-blocking that would defeat the point of rendering.
 */
export function plainChromeUA(ua: string, appName: string): string {
  const escaped = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let out = ua
  for (const token of ['Electron', escaped]) {
    out = out.replace(new RegExp(`\\s*${token}\\/\\S+`, 'gi'), '')
  }
  return out.replace(/\s{2,}/g, ' ').trim()
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Load a page in a headless browser and return at most MAX_CONTENT_CHARS of its
 * rendered text (`document.body.innerText`), or why we couldn't.
 *
 * Same result shape and same rate limiter as `fetchWeb`, so the two are
 * interchangeable to the caller and paced together per machine.
 *
 * Locked down: an ephemeral in-memory session (no cookie jar, cleared after),
 * `sandbox` on, no node integration, no preload, images off (text is all we
 * want, and it drops a class of requests), popups denied, main-frame
 * navigation/redirects re-checked against the policy, and WebRTC's non-proxied
 * UDP disabled so the page can't probe the LAN that way.
 *
 * ⚠️ Residual risks a real engine can't fully close, documented rather than
 * hidden — the same honesty web-fetch keeps about DNS rebinding:
 *  - **DNS rebinding**: a public name resolving to 127.0.0.1 passes the literal
 *    host check, exactly as in web-fetch. Needs a pinning resolver, out of scope.
 *  - **Subresource redirect**: the guard cancels by the request's URL; a
 *    public→private *redirect* on a subresource relies on onBeforeRequest firing
 *    again for the new URL. The main frame is additionally covered by
 *    will-redirect. Verify in-app before trusting this on a hostile network.
 */
export async function renderWeb(
  raw: unknown,
  deps: { limiter?: RateLimiter; timeoutMs?: number } = {}
): Promise<FetchResult> {
  const entry = checkUrl(raw)
  if ('error' in entry) return entry

  // Paced by the same limiter as fetchWeb — a render is heavier, not exempt.
  const blockedByRate = await (deps.limiter ?? defaultLimiter).acquire()
  if (blockedByRate) return blockedByRate

  const timeoutMs = deps.timeoutMs ?? RENDER_TIMEOUT_MS
  // Unique, no `persist:` prefix → an in-memory session that dies with the
  // window: nothing the page stores survives, and no existing cookie is sent.
  const ses = session.fromPartition(`web-render-${randomUUID()}`, { cache: false })
  ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: shouldCancelRequest(details.url) }))

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      images: false,
      webgl: false
    }
  })
  win.webContents.setUserAgent(plainChromeUA(win.webContents.getUserAgent(), app.getName()))
  // Stop the page probing the LAN over WebRTC, which sidesteps HTTP entirely.
  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const guardNav = (e: { preventDefault: () => void }, u: string): void => {
    if (shouldCancelRequest(u)) e.preventDefault()
  }
  win.webContents.on('will-navigate', guardNav)
  win.webContents.on('will-redirect', guardNav)

  try {
    // A load error (ERR_ABORTED on a cancelled hop, a slow server) is tolerated:
    // whatever rendered so far is still worth extracting. The timeout bounds the
    // whole thing; the settle lets a SPA finish hydrating first.
    await Promise.race([
      win.webContents.loadURL(entry.url.href).catch(() => {}),
      delay(timeoutMs)
    ])
    await delay(RENDER_SETTLE_MS)
    if (win.isDestroyed()) return { error: 'Render cancelado' }

    const text = await win.webContents.executeJavaScript(
      'document.body ? document.body.innerText : ""',
      true
    )
    let content = typeof text === 'string' ? text : ''
    const truncated = content.length > MAX_CONTENT_CHARS
    if (truncated) content = content.slice(0, MAX_CONTENT_CHARS)
    if (!content.trim()) return { error: 'A página não retornou texto após renderizar' }
    return { content, url: win.webContents.getURL(), truncated }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao renderizar a página' }
  } finally {
    if (!win.isDestroyed()) win.destroy()
    await ses.clearStorageData().catch(() => {})
  }
}
