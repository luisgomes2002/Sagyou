// Cloudflare Worker entry: binds D1 and the secrets to the routes.
import { D1ControlDb } from './control-db'
import { D1SyncDb, type D1Database } from './db'
import { sendPush } from './push'
import { handle } from './routes'
import { runWatchdog } from './watchdog'

export interface Env {
  DB: D1Database
  SETUP_TOKEN?: string
  TOTP_ENC_KEY?: string
  /** Firebase service account JSON; without it the remote control sends no push. */
  FCM_SERVICE_ACCOUNT?: string
}

interface ScheduledEvent {
  scheduledTime: number
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

function pushDeps(env: Env): { serviceAccount?: string; fetch: typeof fetch; now: () => number } {
  return {
    serviceAccount: env.FCM_SERVICE_ACCOUNT,
    fetch: (u, i) => fetch(u, i),
    now: () => Date.now()
  }
}

export default {
  // Every 5 minutes (wrangler.toml): "PC sem sinal".
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): void {
    const control = new D1ControlDb(env.DB)
    ctx.waitUntil(
      runWatchdog(
        control,
        async (ids, code) => sendPush(pushDeps(env), await control.pushTokens(ids), code),
        Date.now()
      )
    )
  },

  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const control = new D1ControlDb(env.DB)
    return handle(request, {
      db: new D1SyncDb(env.DB),
      control,
      setupToken: env.SETUP_TOKEN,
      totpEncKey: env.TOTP_ENC_KEY,
      now: () => Date.now(),
      defer: (p) => ctx.waitUntil(p),
      notify: async (ids, code) =>
        sendPush(
          {
            serviceAccount: env.FCM_SERVICE_ACCOUNT,
            fetch: (u, i) => fetch(u, i),
            now: () => Date.now()
          },
          await control.pushTokens(ids),
          code
        )
    })
  }
}
