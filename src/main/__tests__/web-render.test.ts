// @vitest-environment node
//
// The headless render (renderWeb) drives a real BrowserWindow, so it can't run
// under vitest — it needs the Electron runtime, and must be verified in-app. But
// the two pieces that carry the security and privacy decisions are pure: the
// per-request guard and the user-agent scrub. Those are pinned here.
//
// electron is only touched inside renderWeb, never at import time, so a stub mock
// is enough to load the module.
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, session: {}, app: { getName: () => 'sagyou' } }))

const { shouldCancelRequest, plainChromeUA } = await import('../web-render')

describe('shouldCancelRequest (the browser SSRF guard)', () => {
  it('cancels exactly what the fetch path refuses — the local machine and LAN', () => {
    // These are the requests a hostile page would make to read the user's own
    // network from their IP; onBeforeRequest must kill every one.
    for (const url of [
      'http://127.0.0.1/admin',
      'http://localhost:8080/',
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://metadata.google.internal/',
      'http://[::1]/',
      'http://something.local/'
    ]) {
      expect(shouldCancelRequest(url)).toBe(true)
    }
  })

  it('cancels non-http(s) schemes a page might use to exfiltrate or read disk', () => {
    for (const url of ['file:///etc/passwd', 'ws://evil.example/sock', 'data:text/html,x']) {
      expect(shouldCancelRequest(url)).toBe(true)
    }
  })

  it('allows an ordinary public request', () => {
    expect(shouldCancelRequest('https://example.com/app.js')).toBe(false)
    expect(shouldCancelRequest('http://example.com/style.css')).toBe(false)
  })
})

describe('plainChromeUA', () => {
  const DEFAULT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'sagyou/3.1.0 Chrome/126.0.6478.0 Electron/31.0.0 Safari/537.36'

  it('strips the app and Electron tokens, leaving a plain-Chrome string', () => {
    const ua = plainChromeUA(DEFAULT, 'sagyou')
    expect(ua).not.toMatch(/Electron/i)
    expect(ua).not.toMatch(/sagyou/i)
    // Still a believable Chrome UA — the point is to not get bot-blocked.
    expect(ua).toContain('Chrome/126.0.6478.0')
    expect(ua).toContain('Safari/537.36')
    // No double spaces left where tokens were removed.
    expect(ua).not.toMatch(/\s{2,}/)
  })

  it('does not leak which app the user runs', () => {
    // The whole reason to scrub it: a branded UA tells every site the model
    // visits the app and version, the same leak web-fetch refuses.
    expect(plainChromeUA(DEFAULT, 'sagyou').toLowerCase()).not.toContain('sagyou')
  })
})
