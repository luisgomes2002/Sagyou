// IPC of the remote control (spec docs/specs/2026-11-03-controle-remoto-app.md),
// plus the two bridges main needs: the remote unlock effect and the Fleet cards
// that also go to the phone. Registered after protectDataIpc: nothing here runs
// with the Sagyou locked.
import type { IpcMain } from 'electron'
import { ControlError, type ControlClient } from '@sagyou/core/control/client'
import { newEsp32Key, newSigningKeys } from '@sagyou/core/control/crypto'
import { CONTROL_TEXT } from '@sagyou/core/control/texts'
import { toBase64, toHex } from '@sagyou/core/sync/bytes'
import type { SyncSecondFactor } from '@sagyou/core/sync/engine'
import { log } from '../modules/logs/logger'
import {
  parkMcpApproval,
  resolveMcpApproval,
  type PendingMcpApproval
} from '../modules/agent/mcp-approval'
import { sealSecret, type RemoteConfig } from '../modules/remote/remote-config'
import type { PendingAuthorization, RemoteService } from '../modules/remote/remote-service'
import type { SafeStorageLike } from '../modules/sync/sync-config'

export const REMOTE_TEXT = {
  windowsOnly: 'Só funciona no Windows.',
  needPassword: 'Configure a senha do Sagyou antes.',
  needSync: 'Ative a sincronização antes.',
  wrongPassword: 'Senha incorreta.',
  expired: 'O pedido expirou.',
  invalidNames: 'Nomes inválidos.',
  factor: 'Código do autenticador inválido.',
  locked: 'Muitas tentativas. Tente de novo em 15 minutos.',
  generic: 'Não foi possível concluir a operação do controle remoto.'
} as const

export const MAX_SERVER_NAME = 64
export const MAX_SERVERS = 50

export type RemoteResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string }

export interface RemoteStatusView {
  supported: boolean
  enabled: boolean
  running: boolean
  syncActive: boolean
  error: string | null
  suspendedUntil: number | null
  controllers: { id: string; name: string; since: string }[]
  servers: { name: string; up: boolean }[]
  pending: PendingAuthorization[]
  hasEsp32Key: boolean
}

export interface RemoteHandlerDeps {
  service: RemoteService
  client: ControlClient
  config: () => RemoteConfig
  save: (config: RemoteConfig) => void
  safe: SafeStorageLike
  platform: NodeJS.Platform
  hasPassword: () => boolean
  syncActive: () => boolean
  /** Last scan of the Remote Control servers (names in the configured order). */
  servers: () => { name: string; up: boolean }[]
  now: () => number
  emitStatus: (status: RemoteStatusView) => void
}

function errorText(error: unknown): string {
  if (error instanceof ControlError) {
    if (error.code === 'not-deployed') return CONTROL_TEXT.notDeployed
    if (error.code === 'factor') return REMOTE_TEXT.factor
    if (error.code === 'locked') return REMOTE_TEXT.locked
    if (error.code === 'offline') return CONTROL_TEXT.offline
  }
  return REMOTE_TEXT.generic
}

async function run<T extends object>(
  action: string,
  fn: () => Promise<RemoteResult<T>> | RemoteResult<T>
): Promise<RemoteResult<T>> {
  try {
    return await fn()
  } catch (error) {
    log.warn('remote', 'ipc_failed', {
      action,
      code: error instanceof ControlError ? error.code : 'unknown'
    })
    return { ok: false, error: errorText(error) }
  }
}

function factorOf(value: unknown): SyncSecondFactor | undefined {
  if (!value || typeof value !== 'object') return undefined
  const totp = (value as { totp?: unknown }).totp
  return typeof totp === 'string' && /^[0-9A-Za-z-]{1,32}$/.test(totp) ? { totp } : undefined
}

const id = (value: unknown): string | null =>
  typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) ? value : null

/** Trimmed names, 1–64 characters, at most 50, without repeating (any case); null if invalid. */
export function serverNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SERVERS) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string') return null
    const name = raw.trim()
    if (!name || name.length > MAX_SERVER_NAME) return null
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
  }
  return out
}

export function registerRemoteHandlers(ipcMain: IpcMain, deps: RemoteHandlerDeps): () => RemoteStatusView {
  const { service, client } = deps

  const view = (): RemoteStatusView => {
    const cfg = deps.config()
    const syncActive = deps.syncActive()
    const code = service.lastError()
    const now = deps.now()
    return {
      supported: deps.platform === 'win32',
      enabled: cfg.enabled,
      running: service.running(),
      syncActive,
      error: !cfg.enabled
        ? null
        : !syncActive
          ? CONTROL_TEXT.syncInactive
          : code
            ? errorText(new ControlError(code))
            : null,
      suspendedUntil: cfg.suspendedUntil !== null && cfg.suspendedUntil > now ? cfg.suspendedUntil : null,
      controllers: cfg.controllers.map(({ id: cid, name, since }) => ({ id: cid, name, since })),
      servers: deps.servers(),
      pending: service.pendingAuthorizations(),
      hasEsp32Key: cfg.esp32KeyCipher !== null
    }
  }
  const changed = (): void => deps.emitStatus(view())

  ipcMain.handle('remote:status', () => view())

  ipcMain.handle('remote:enable', (_, factor: unknown) =>
    run('enable', async () => {
      if (deps.platform !== 'win32') return { ok: false, error: REMOTE_TEXT.windowsOnly }
      if (!deps.hasPassword()) return { ok: false, error: REMOTE_TEXT.needPassword }
      if (!deps.syncActive()) return { ok: false, error: REMOTE_TEXT.needSync }
      await client.setPc(factorOf(factor) ?? {})
      let cfg = deps.config()
      if (!cfg.pcKeys) {
        const keys = newSigningKeys()
        cfg = {
          ...cfg,
          pcKeys: {
            publicKey: toBase64(keys.publicKey),
            privateCipher: sealSecret(deps.safe, keys.privateKey)
          }
        }
      }
      deps.save({ ...cfg, enabled: true })
      service.start()
      log.info('remote', 'enabled')
      changed()
      return { ok: true }
    })
  )

  ipcMain.handle('remote:disable', () =>
    run('disable', () => {
      deps.save({ ...deps.config(), enabled: false })
      service.stop()
      log.info('remote', 'disabled')
      changed()
      return { ok: true }
    })
  )

  ipcMain.handle('remote:authorizations', () => service.pendingAuthorizations())

  ipcMain.handle('remote:authorize', (_, rawId: unknown, password: unknown) =>
    run('authorize', async () => {
      const target = id(rawId)
      if (!target || typeof password !== 'string' || password.length > 1024) {
        return { ok: false, error: REMOTE_TEXT.expired }
      }
      const result = await service.authorize(target, password)
      if (result === 'wrong-password') return { ok: false, error: REMOTE_TEXT.wrongPassword }
      if (result === 'expired') {
        changed()
        return { ok: false, error: REMOTE_TEXT.expired }
      }
      changed()
      return { ok: true }
    })
  )

  ipcMain.handle('remote:refuse', (_, rawId: unknown) =>
    run('refuse', async () => {
      const target = id(rawId)
      if (target) await service.refuse(target)
      changed()
      return { ok: true }
    })
  )

  ipcMain.handle('remote:revoke', (_, rawId: unknown) =>
    run('revoke', async () => {
      const target = id(rawId)
      if (target) await service.revokeController(target)
      changed()
      return { ok: true }
    })
  )

  ipcMain.handle('remote:servers:set', (_, names: unknown) =>
    run('servers', () => {
      const list = serverNames(names)
      if (!list) return { ok: false, error: REMOTE_TEXT.invalidNames }
      deps.save({ ...deps.config(), servers: list })
      changed()
      return { ok: true }
    })
  )

  /** Token and key are returned once; only the key is kept, encrypted. */
  ipcMain.handle('remote:esp32:create', (_, factor: unknown) =>
    run<{ token: string; key: string }>('esp32', async () => {
      const token = await client.createPowerToken(factorOf(factor) ?? {})
      const key = newEsp32Key()
      deps.save({ ...deps.config(), esp32KeyCipher: sealSecret(deps.safe, key) })
      try {
        await service.publishEsp32Key()
      } catch (error) {
        // The phones also get it on their next authorization.
        log.warn('remote', 'esp32_publish_failed', {
          code: error instanceof ControlError ? error.code : 'unknown'
        })
      }
      changed()
      return { ok: true, token, key: toHex(key) }
    })
  )

  return view
}

// ── Bridges used by main/index.ts ───────────────────────────────────────────────

/**
 * The phone's unlock: the same flag a right password sets, and a notice to the
 * renderer, which leaves the lock screen without loading the store again.
 * Never with a corrupt password file (that one needs the explicit recovery).
 */
export function remoteUnlock(deps: {
  canUnlock: () => boolean
  setUnlocked: () => void
  refreshTray: () => void
  send: (channel: string) => void
}): void {
  if (!deps.canUnlock()) return
  deps.setUnlocked()
  deps.refreshTray()
  deps.send('security:remote-unlocked')
}

interface CardRequest {
  id: string
  name: string
  resumo?: string
  expiresAt?: string
}

/**
 * Fleet cards that also go to the authorized phones. The first answer (PC or
 * phone) wins; whatever closes the card (an answer, the deadline, a lock, a
 * stopped run) tells both screens to drop it.
 */
export function createRemoteCards(deps: {
  maps: () => Iterable<Map<string, { resolve: (approved: boolean) => void }>>
  service: () => RemoteService | null
  send: (channel: string, payload: unknown) => void
}): {
  park<R extends CardRequest>(
    pending: Map<string, PendingMcpApproval<R>>,
    request: R,
    toRenderer: (card: R) => void,
    session: string
  ): Promise<boolean>
  answer(id: string, approved: boolean): boolean
} {
  return {
    park(pending, request, toRenderer, session) {
      return parkMcpApproval(pending, request, (card) => {
        toRenderer(card)
        const service = deps.service()
        if (!service) return
        void service
          .sendCard({
            id: card.id,
            session,
            tool: card.name.replace(/^mcp:/, ''),
            resumo: card.resumo ?? '',
            expiresAt: card.expiresAt ? Date.parse(card.expiresAt) : Date.now()
          })
          .catch(() => {})
      }).then((approved) => {
        deps.send('ai:code-agent:approval-closed', request.id)
        void deps.service()?.closeCard(request.id).catch(() => {})
        return approved
      })
    },
    answer: (cardId, approved) => resolveMcpApproval(deps.maps(), cardId, approved)
  }
}
