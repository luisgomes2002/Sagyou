// Push notifications through Firebase Cloud Messaging (HTTP v1).
//
// The Worker only ever sends one of three fixed texts, chosen by a code; nothing
// the PC writes reaches the notification. The content of an approval card is
// read in the app, decrypted on the phone. Without FCM_SERVICE_ACCOUNT nothing is
// sent and the remote control works without push.
import type { NotifyCode } from './control-routes'

export const PUSH_TEXT: Record<NotifyCode, string> = {
  ready: 'PC pronto.',
  approval: 'Aprovação pendente no Sagyou.',
  'shutdown-failed': 'O PC não foi desligado.'
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'

export interface PushDeps {
  serviceAccount?: string
  fetch: typeof fetch
  now: () => number
}

interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
}

function parseAccount(json: string): ServiceAccount | null {
  try {
    const a = JSON.parse(json) as Record<string, unknown>
    if (
      typeof a.project_id === 'string' &&
      typeof a.client_email === 'string' &&
      typeof a.private_key === 'string'
    ) {
      return { project_id: a.project_id, client_email: a.client_email, private_key: a.private_key }
    }
  } catch {
    // fall through
  }
  return null
}

function base64Url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(body)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** RS256 JWT for the OAuth2 service-account grant. */
export async function serviceJwt(account: ServiceAccount, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600
    })
  )
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signed = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key,
      new TextEncoder().encode(`${header}.${claims}`)
    )
  )
  return `${header}.${claims}.${base64Url(signed)}`
}

/** Never throws: a push that fails is just not delivered. */
export async function sendPush(deps: PushDeps, tokens: string[], code: NotifyCode): Promise<void> {
  if (!deps.serviceAccount || tokens.length === 0) return
  const account = parseAccount(deps.serviceAccount)
  if (!account) return
  try {
    const assertion = await serviceJwt(account, deps.now())
    const tokenRes = await deps.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`
    })
    if (!tokenRes.ok) return
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string }
    if (!accessToken) return
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`
    await Promise.all(
      tokens.map((token) =>
        deps
          .fetch(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
            body: JSON.stringify({
              message: {
                token,
                notification: { title: 'Sagyou', body: PUSH_TEXT[code] },
                data: { open: 'pc' },
                android: { priority: 'high' }
              }
            })
          })
          .catch(() => undefined)
      )
    )
  } catch {
    // A broken key or network: no push, the app still shows everything when opened.
  }
}
