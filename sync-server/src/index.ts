// Cloudflare Worker entry: binds D1 and the SETUP_TOKEN secret to the routes.
import { D1SyncDb, type D1Database } from './db'
import { handle } from './routes'

export interface Env {
  DB: D1Database
  SETUP_TOKEN?: string
  TOTP_ENC_KEY?: string
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, {
      db: new D1SyncDb(env.DB),
      setupToken: env.SETUP_TOKEN,
      totpEncKey: env.TOTP_ENC_KEY,
      now: () => Date.now()
    })
  }
}
