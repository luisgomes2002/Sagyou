import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import QRCode from 'qrcode'
import type {
  SyncConflictView,
  SyncStatus,
  SyncVersionView
} from '../../../../main/modules/sync/sync-engine'
import { useKanbanStore } from '../../store/kanban'
import {
  hasLocalData,
  pendingText,
  recordName,
  syncKindLabel,
  syncedAgoText,
  versionLines,
  versionTimeText
} from '../../utils/sync-view'
import { ConfirmDialog } from '../ConfirmDialog'

interface Props {
  onToast: (message: string, type?: 'success' | 'error') => void
  /**
   * True while a secret shown only once is on screen (the authenticator's backup
   * codes, or the recovery code right after activation), so the page around it
   * can avoid unmounting it.
   */
  onOneTimeSecretChange?: (shown: boolean) => void
}

interface Device {
  id: string
  name: string
  current: boolean
  revokedAt: number | null
}

const ACTIVE_STATES: ReadonlySet<SyncStatus['state']> = new Set([
  'ok',
  'offline',
  'paused',
  'update-pending'
])
const TICK_MS = 30000

const fieldClass =
  'mt-1 block w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-[#d4d4d4]'
const primaryClass =
  'rounded-lg bg-[#6d5bb8] px-3 py-2 text-sm text-white hover:bg-[#7b69c6] disabled:opacity-50'
const secondaryClass =
  'rounded-lg bg-[#2a2a30] px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#303036] disabled:opacity-50'
const panelClass = 'space-y-3 rounded-lg border border-[#2b2b31] bg-[#101014] p-4'

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function Subsection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-[#d4d4d4]">{title}</h3>
      {children}
    </div>
  )
}

function VersionCard({
  label,
  version,
  onUse,
  busy
}: {
  label: string
  version: SyncVersionView
  onUse: () => void
  busy: boolean
}): JSX.Element {
  const lines = versionLines(version.payload)
  return (
    <div
      role="group"
      aria-label={label}
      className="min-w-0 flex-1 space-y-2 rounded-lg border border-[#2b2b31] bg-[#16161a] p-3"
    >
      <p className="text-xs text-[#999999]">
        {label} · {versionTimeText(version.at)}
      </p>
      {version.deleted || !version.payload ? (
        <p className="text-sm text-[#ec6a6a]">Apagado</p>
      ) : (
        <ul className="space-y-0.5">
          {lines.map((line) => (
            <li key={line} className="break-words text-xs text-[#d4d4d4]">
              {line}
            </li>
          ))}
        </ul>
      )}
      <button type="button" disabled={busy} onClick={onUse} className={secondaryClass}>
        Usar esta
      </button>
    </div>
  )
}

export function SyncSettings({ onToast, onOneTimeSecretChange }: Props): JSX.Element {
  const hasData = useKanbanStore((s) => hasLocalData(s))
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [devices, setDevices] = useState<Device[]>([])
  const [conflicts, setConflicts] = useState<SyncConflictView[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Turning sync on (state 'off').
  const [serverUrl, setServerUrl] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [askJoinMode, setAskJoinMode] = useState(false)
  // "Perdi todos os aparelhos" (spec 2026-11-08-recuperacao-codigo): the three
  // secrets live only here, never in a log; success clears them, the
  // confirmation's Cancelar keeps them, and leaving Configurações unmounts them.
  const [recoverCode, setRecoverCode] = useState('')
  const [recoverSetup, setRecoverSetup] = useState('')
  const [recoverFactor, setRecoverFactor] = useState('')
  const [askRecover, setAskRecover] = useState(false)
  // The recovery code: right after activation it needs "Guardei o código".
  const [recovery, setRecovery] = useState<{ code: string; mustConfirm: boolean } | null>(null)
  const [savedCode, setSavedCode] = useState(false)
  const [askPassword, setAskPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState<{ code: string; expiresAt: number; qr: string } | null>(null)
  // Pairing asks for the authenticator (spec 2026-11-07, item 6).
  const [inviteFactor, setInviteFactor] = useState('')
  const [confirmDisable, setConfirmDisable] = useState(false)
  // Authenticator and revocation (Task 7b).
  const [uri, setUri] = useState('')
  const [qr, setQr] = useState('')
  const [confirmCode, setConfirmCode] = useState('')
  // The Worker asks for the current factor to replace a confirmed authenticator.
  const [currentFactor, setCurrentFactor] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [target, setTarget] = useState<Device | null>(null)
  const [wipe, setWipe] = useState(false)
  const [factor, setFactor] = useState('')
  const mounted = useRef(true)
  const conflictCount = useRef(-1)

  const oneTimeSecretShown = backupCodes.length > 0 || recovery?.mustConfirm === true
  useEffect(() => {
    onOneTimeSecretChange?.(oneTimeSecretShown)
  }, [oneTimeSecretShown, onOneTimeSecretChange])

  const loadConflicts = useCallback(async (): Promise<void> => {
    const result = await window.electronAPI.sync.conflicts()
    if (mounted.current && result.ok) setConflicts(result.conflicts)
  }, [])

  const applyStatus = useCallback(
    async (next: SyncStatus): Promise<void> => {
      if (!mounted.current) return
      setStatus(next)
      conflictCount.current = next.conflictCount
      if (!ACTIVE_STATES.has(next.state)) {
        setDevices([])
        setConflicts([])
        return
      }
      const [deviceList] = await Promise.all([window.electronAPI.sync.devices(), loadConflicts()])
      if (mounted.current && deviceList.ok) setDevices(deviceList.devices)
    },
    [loadConflicts]
  )

  const refresh = async (): Promise<void> => applyStatus(await window.electronAPI.sync.status())

  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.electronAPI.sync.onStatusChanged?.((next) => {
      if (!mounted.current) return
      setStatus(next)
      // With conflicts open, every status may have closed one and opened
      // another (same count): read the list again.
      if (
        ACTIVE_STATES.has(next.state) &&
        (next.conflictCount !== conflictCount.current || next.conflictCount > 0)
      ) {
        conflictCount.current = next.conflictCount
        void loadConflicts().catch(() => {})
      }
    })
    void window.electronAPI.sync
      .status()
      .then(applyStatus)
      .catch(() => {})
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => {
      mounted.current = false
      unsubscribe?.()
      clearInterval(timer)
    }
  }, [applyStatus, loadConflicts])

  /** Runs one action with the shared busy flag; its thrown message goes to the alert. */
  const act = async (fallback: string, action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      if (mounted.current) setError(messageOf(cause, fallback))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const syncNow = (): Promise<void> =>
    act('Não foi possível sincronizar agora.', async () => {
      const next = await window.electronAPI.sync.now()
      setStatus(next)
      setNow(Date.now())
    })

  const resume = (choice: 'push-local' | 'take-cloud'): Promise<void> =>
    act('Não foi possível retomar a sincronização.', async () => {
      const result = await window.electronAPI.sync.resume(choice)
      if (!result.ok) throw new Error(result.error)
      setStatus(result.status)
      await refresh()
    })

  const activate = (): Promise<void> =>
    act('Não foi possível ativar a sincronização.', async () => {
      const result = await window.electronAPI.sync.activate(
        serverUrl.trim(),
        setupToken.trim(),
        deviceName.trim() || undefined
      )
      if (!result.ok) throw new Error(result.error)
      setSetupToken('')
      setSavedCode(false)
      setRecovery({ code: result.recoveryCode, mustConfirm: true })
      await refresh()
    })

  const join = (mode: 'merge' | 'replace'): Promise<void> =>
    act('Não foi possível parear este aparelho.', async () => {
      const result = await window.electronAPI.sync.join(
        joinCode.trim(),
        mode,
        deviceName.trim() || undefined
      )
      if (!result.ok) throw new Error(result.error)
      setAskJoinMode(false)
      setJoinCode('')
      setStatus(result.status)
      onToast('Aparelho pareado.')
      await refresh()
    })

  const clearRecover = (): void => {
    setRecoverCode('')
    setRecoverSetup('')
    setRecoverFactor('')
    setAskRecover(false)
  }

  const recover = (): Promise<void> =>
    act('Não foi possível recuperar a sincronização.', async () => {
      const result = await window.electronAPI.sync.recover(
        recoverCode.trim(),
        recoverSetup.trim(),
        deviceName.trim() || undefined,
        // "123 456" as typed: the handler only accepts the code without spaces.
        { totp: recoverFactor.replace(/\s+/g, '') }
      )
      if (!result.ok) throw new Error(result.error)
      // A 401 while downloading ends the session: nothing was recovered. The
      // Worker already took the factor, and a backup code works only once.
      if (result.status.state === 'off' || result.status.state === 'disconnected') {
        setRecoverFactor('')
        throw new Error('Não foi possível recuperar a sincronização.')
      }
      clearRecover()
      setStatus(result.status)
      // Paused, the banner with "A nuvem manda" is the next step, not a success.
      if (result.status.state !== 'paused')
        onToast('Sincronização recuperada. Revogue os aparelhos perdidos em Aparelhos.')
      await refresh()
    })

  const startJoin = (): void => {
    if (!joinCode.trim()) return
    if (hasData) setAskJoinMode(true)
    else void join('merge')
  }

  const createInvite = (): Promise<void> =>
    act('Não foi possível criar o convite.', async () => {
      const totp = inviteFactor.trim()
      if (!totp) return
      const result = await window.electronAPI.sync.invite(totp)
      // A TOTP code is good once: never left in the field to be sent again.
      setInviteFactor('')
      if (!result.ok) throw new Error(result.error)
      const image = await QRCode.toDataURL(result.code, { margin: 2, width: 256 })
      setInvite({ code: result.code, expiresAt: result.expiresAt, qr: image })
    })

  const showRecoveryCode = (typedPassword?: string): Promise<void> =>
    act('Não foi possível mostrar o código de recuperação.', async () => {
      const result = await window.electronAPI.sync.recoveryCode(typedPassword)
      if (!result.ok) throw new Error(result.error)
      setAskPassword(false)
      setPassword('')
      setRecovery({ code: result.code, mustConfirm: false })
    })

  const askRecoveryCode = (): Promise<void> =>
    act('Não foi possível mostrar o código de recuperação.', async () => {
      const security = await window.electronAPI.security.status()
      if (security.enabled) {
        setAskPassword(true)
        return
      }
      const result = await window.electronAPI.sync.recoveryCode(undefined)
      if (!result.ok) throw new Error(result.error)
      setRecovery({ code: result.code, mustConfirm: false })
    })

  const disable = (): Promise<void> =>
    act('Não foi possível desativar a sincronização.', async () => {
      setConfirmDisable(false)
      const result = await window.electronAPI.sync.disable()
      if (!result.ok) throw new Error(result.error)
      setInvite(null)
      setRecovery(null)
      onToast('Sincronização desativada.')
      await refresh()
    })

  const resolve = (conflict: SyncConflictView, choice: 'local' | 'remote'): Promise<void> =>
    act('Não foi possível usar esta versão.', async () => {
      const result = await window.electronAPI.sync.resolve(conflict.id, choice)
      if (!result.ok) throw new Error(result.error)
      setConflicts((current) => current.filter((c) => c.id !== conflict.id))
      onToast(conflict.type === 'orphan' ? 'Conflito dispensado.' : 'Versão escolhida.')
    })

  const enroll = (): Promise<void> =>
    act('Não foi possível cadastrar o autenticador.', async () => {
      const current = currentFactor.trim()
      const result = await window.electronAPI.sync.enrollTotp(
        current ? { totp: current } : undefined
      )
      if (!result.ok) throw new Error(result.error)
      const parsed = new URL(result.uri)
      if (parsed.protocol !== 'otpauth:' || !parsed.searchParams.get('secret'))
        throw new Error('Resposta inválida do servidor.')
      setUri(result.uri)
      setQr(await QRCode.toDataURL(result.uri, { margin: 2, width: 192 }))
      setBackupCodes([])
      setCurrentFactor('')
    })

  const confirmTotp = (): Promise<void> =>
    act('Código inválido.', async () => {
      const result = await window.electronAPI.sync.confirmTotp(confirmCode)
      if (!result.ok) throw new Error(result.error)
      setBackupCodes(result.backupCodes)
      setUri('')
      setQr('')
      setConfirmCode('')
      onToast('Autenticador confirmado.')
    })

  const revoke = async (): Promise<void> => {
    if (!target || (wipe && !factor.trim())) return
    await act('Não foi possível revogar o aparelho.', async () => {
      const result = await window.electronAPI.sync.revoke(
        target.id,
        wipe,
        wipe ? { totp: factor.trim() } : undefined
      )
      if (!result.ok) throw new Error(result.error)
      setDevices((current) => current.filter((device) => device.id !== target.id))
      setTarget(null)
      setFactor('')
      setWipe(false)
      onToast('Aparelho revogado.')
    })
  }

  const state = status?.state
  const active = state !== undefined && ACTIVE_STATES.has(state)
  const otherDevices = devices.filter((device) => !device.current && device.revokedAt === null)

  const stateLines = (): ReactNode => {
    if (!status) return null
    const pending =
      status.pendingCount > 0 ? (
        <p className="text-sm text-[#d4d4d4]">{pendingText(status.pendingCount)}</p>
      ) : null
    switch (status.state) {
      case 'ok':
        return (
          <>
            <p className="text-sm text-[#46d478]">
              {status.lastSyncAt === null
                ? 'Aguardando a primeira sincronização'
                : syncedAgoText(status.lastSyncAt, now)}
            </p>
            {pending}
          </>
        )
      case 'offline':
        return (
          <>
            <p className="text-sm text-[#d9a640]">Sem conexão: as alterações ficam guardadas</p>
            {pending}
          </>
        )
      case 'paused':
        return (
          <>
            <p className="text-sm text-[#d9a640]">Pausado: escolha o que vale</p>
            <p className="text-xs text-[#999999]">
              {status.paused === 'restore'
                ? 'Um backup foi restaurado só neste aparelho.'
                : 'A troca pelos dados da nuvem não terminou.'}{' '}
              &quot;A nuvem manda&quot; faz um backup daqui antes de trocar.
            </p>
            <div className="flex flex-wrap gap-2">
              {/* A 'join' pause is an unfinished replace: only the cloud may win. */}
              {status.paused !== 'join' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void resume('push-local')}
                  className={secondaryClass}
                >
                  Este aparelho manda
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void resume('take-cloud')}
                className={secondaryClass}
              >
                A nuvem manda
              </button>
            </div>
            {pending}
          </>
        )
      case 'update-pending':
        return (
          <p className="text-sm text-[#d9a640]">
            Sincronização em espera: começa depois da atualização
          </p>
        )
      case 'disconnected':
        return (
          <p className="text-sm text-[#ec6a6a]">Este aparelho foi desconectado da sincronização</p>
        )
      case 'no-keychain':
        return (
          <p className="text-sm text-[#d9a640]">
            O chaveiro do sistema não está disponível; a sincronização não liga.
          </p>
        )
      case 'off':
        return (
          <p className="text-sm text-[#999999]">A sincronização está desligada neste aparelho.</p>
        )
    }
  }

  const recoveryPanel = recovery && (
    <div className={panelClass}>
      <p className="text-sm text-[#d4d4d4]">Código de recuperação</p>
      <p className="text-xs text-[#999999]">
        Ele é a chave da sincronização. Guarde fora deste computador; quem tiver o código lê seus
        dados.
      </p>
      <pre className="whitespace-pre-wrap break-all rounded-lg bg-[#16161a] p-3 font-mono text-xs text-[#d4d4d4]">
        {recovery.code}
      </pre>
      {recovery.mustConfirm && (
        <label className="flex items-center gap-2 text-sm text-[#d4d4d4]">
          <input
            type="checkbox"
            checked={savedCode}
            onChange={(event) => setSavedCode(event.target.checked)}
          />
          Guardei o código
        </label>
      )}
      <button
        type="button"
        disabled={recovery.mustConfirm && !savedCode}
        onClick={() => setRecovery(null)}
        className={recovery.mustConfirm ? primaryClass : secondaryClass}
      >
        {recovery.mustConfirm ? 'Concluir' : 'Fechar'}
      </button>
    </div>
  )

  return (
    <section className="rounded-xl border border-[#2b2b31] bg-[#16161a] p-5 space-y-5">
      <div role="status" className="space-y-2">
        {stateLines()}
      </div>

      {recovery?.mustConfirm ? (
        recoveryPanel
      ) : (
        <>
          {state === 'off' && (
            <>
              <label className="block text-sm text-[#d4d4d4]">
                Nome deste aparelho
                <input
                  value={deviceName}
                  onChange={(event) => setDeviceName(event.target.value)}
                  maxLength={80}
                  placeholder={status?.deviceName || 'Opcional'}
                  className={fieldClass}
                />
              </label>
              <Subsection title="Primeiro aparelho">
                <label className="block text-sm text-[#d4d4d4]">
                  URL do servidor
                  <input
                    value={serverUrl}
                    onChange={(event) => setServerUrl(event.target.value)}
                    type="url"
                    placeholder="https://…workers.dev"
                    className={fieldClass}
                  />
                </label>
                <label className="block text-sm text-[#d4d4d4]">
                  Token de configuração
                  <input
                    value={setupToken}
                    onChange={(event) => setSetupToken(event.target.value)}
                    type="password"
                    autoComplete="off"
                    className={fieldClass}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !serverUrl.trim() || !setupToken.trim()}
                  onClick={() => void activate()}
                  className={primaryClass}
                >
                  Ativar
                </button>
              </Subsection>
              <Subsection title="Outro aparelho já sincroniza">
                <label className="block text-sm text-[#d4d4d4]">
                  Código para entrar
                  <textarea
                    value={joinCode}
                    onChange={(event) => {
                      setJoinCode(event.target.value)
                      setAskJoinMode(false)
                    }}
                    rows={3}
                    className={`${fieldClass} font-mono text-xs`}
                  />
                </label>
                {askJoinMode ? (
                  <div className={panelClass}>
                    <p className="text-sm text-[#d4d4d4]">
                      Este aparelho já tem dados. Juntar com a nuvem ou substituir pelos da nuvem?
                    </p>
                    <p className="text-xs text-[#999999]">
                      Substituir faz um backup deste aparelho antes.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void join('merge')}
                        className={primaryClass}
                      >
                        Juntar
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void join('replace')}
                        className={secondaryClass}
                      >
                        Substituir
                      </button>
                      <button
                        type="button"
                        onClick={() => setAskJoinMode(false)}
                        className={secondaryClass}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !joinCode.trim()}
                    onClick={startJoin}
                    className={secondaryClass}
                  >
                    Entrar com código
                  </button>
                )}
              </Subsection>
              <Subsection title="Perdi todos os aparelhos">
                <p className="text-sm text-[#999999]">
                  Use quando nenhum aparelho pareado está à mão. Os dados deste PC serão
                  substituídos pelos da nuvem (um backup é feito antes).
                </p>
                <label className="block text-sm text-[#d4d4d4]">
                  Código de recuperação
                  <textarea
                    value={recoverCode}
                    onChange={(event) => setRecoverCode(event.target.value)}
                    rows={3}
                    autoComplete="off"
                    spellCheck={false}
                    className={`${fieldClass} font-mono text-xs`}
                  />
                </label>
                <label className="block text-sm text-[#d4d4d4]">
                  Senha de configuração do Worker
                  <input
                    value={recoverSetup}
                    onChange={(event) => setRecoverSetup(event.target.value)}
                    type="password"
                    autoComplete="off"
                    className={fieldClass}
                  />
                </label>
                <label className="block text-sm text-[#d4d4d4]">
                  Código do autenticador ou reserva
                  <input
                    value={recoverFactor}
                    onChange={(event) => setRecoverFactor(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className={fieldClass}
                  />
                </label>
                {askRecover ? (
                  <div className={panelClass}>
                    <p className="text-sm text-[#d4d4d4]">
                      Os dados deste PC serão substituídos pelos da nuvem. Um backup deste PC é
                      feito antes.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void recover()}
                        className={primaryClass}
                        autoFocus
                      >
                        Recuperar e substituir
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setAskRecover(false)}
                        className={secondaryClass}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !recoverCode.trim() ||
                      !recoverSetup.trim() ||
                      !recoverFactor.trim()
                    }
                    onClick={() => setAskRecover(true)}
                    className={secondaryClass}
                  >
                    Recuperar
                  </button>
                )}
              </Subsection>
            </>
          )}

          {active && (
            <button
              type="button"
              disabled={busy || state === 'paused' || state === 'update-pending'}
              onClick={() => void syncNow()}
              className={secondaryClass}
            >
              Sincronizar agora
            </button>
          )}

          {(active || state === 'disconnected') && (
            <Subsection title="Este aparelho">
              <div className="flex flex-wrap gap-2">
                {active && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void askRecoveryCode()}
                    className={secondaryClass}
                  >
                    Ver código de recuperação
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDisable(true)}
                  className="rounded-lg bg-[#2a2a30] px-3 py-2 text-sm text-[#ec6a6a] hover:bg-[#303036] disabled:opacity-50"
                >
                  Desativar sincronização
                </button>
              </div>
              {askPassword && (
                <div className={panelClass}>
                  <label className="block text-sm text-[#d4d4d4]">
                    Senha do app
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && password) void showRecoveryCode(password)
                      }}
                      className={fieldClass}
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy || !password}
                      onClick={() => void showRecoveryCode(password)}
                      className={primaryClass}
                    >
                      Mostrar código
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAskPassword(false)
                        setPassword('')
                      }}
                      className={secondaryClass}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {recoveryPanel}
            </Subsection>
          )}

          {active && (
            <>
              <Subsection title="Aparelhos">
                {otherDevices.length === 0 && (
                  <p className="text-sm text-[#999999]">Nenhum outro aparelho pareado.</p>
                )}
                {otherDevices.map((device) => (
                  <div
                    key={device.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#2b2b31] bg-[#101014] p-3"
                  >
                    <span className="min-w-0 truncate text-sm text-[#d4d4d4]">{device.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setTarget(device)
                        setWipe(false)
                        setFactor('')
                        setError('')
                      }}
                      className="rounded-lg bg-[#2a2a30] px-3 py-1.5 text-sm text-[#ec6a6a] hover:bg-[#303036]"
                    >
                      Revogar {device.name}
                    </button>
                  </div>
                ))}
                {target && (
                  <div className={panelClass}>
                    <p className="text-sm text-[#d4d4d4]">Revogar {target.name}?</p>
                    <label className="flex items-center gap-2 text-sm text-[#d4d4d4]">
                      <input
                        type="checkbox"
                        checked={wipe}
                        onChange={(event) => setWipe(event.target.checked)}
                      />
                      Também apagar os dados dele
                    </label>
                    {wipe && (
                      <>
                        <p className="text-sm text-[#d9a640]">
                          Os dados deste aparelho serão apagados sem backup; eles continuam na nuvem
                          e nos outros aparelhos.
                        </p>
                        <label className="block text-sm text-[#d4d4d4]">
                          Código do autenticador ou reserva
                          <input
                            value={factor}
                            onChange={(event) => setFactor(event.target.value)}
                            autoComplete="one-time-code"
                            className={fieldClass}
                          />
                        </label>
                      </>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy || (wipe && !factor.trim())}
                        onClick={() => void revoke()}
                        className={primaryClass}
                      >
                        Confirmar revogação
                      </button>
                      <button
                        type="button"
                        onClick={() => setTarget(null)}
                        className={secondaryClass}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                <label className="block text-sm text-[#d4d4d4]">
                  Código do autenticador
                  <input
                    value={inviteFactor}
                    onChange={(event) => setInviteFactor(event.target.value)}
                    autoComplete="one-time-code"
                    aria-describedby="sync-invite-factor-help"
                    className={fieldClass}
                  />
                </label>
                <p id="sync-invite-factor-help" className="text-xs text-[#999999]">
                  Ou um código reserva.
                </p>
                <button
                  type="button"
                  disabled={busy || !inviteFactor.trim()}
                  onClick={() => void createInvite()}
                  className={secondaryClass}
                >
                  Parear novo aparelho
                </button>
                {invite && (
                  <div className={panelClass}>
                    <img
                      src={invite.qr}
                      alt="QR para parear um aparelho"
                      className="h-48 w-48 rounded bg-white"
                    />
                    <label className="block text-sm text-[#d4d4d4]">
                      Código de pareamento
                      <textarea
                        readOnly
                        value={invite.code}
                        rows={3}
                        onFocus={(event) => event.currentTarget.select()}
                        className={`${fieldClass} font-mono text-xs`}
                      />
                    </label>
                    <p className="text-xs text-[#999999]">
                      No outro aparelho, cole em &quot;Entrar com código&quot;. Vale uma vez, até{' '}
                      {new Date(invite.expiresAt).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                      .
                    </p>
                    <button
                      type="button"
                      onClick={() => setInvite(null)}
                      className={secondaryClass}
                    >
                      Fechar
                    </button>
                  </div>
                )}
              </Subsection>

              <Subsection title="Google Authenticator">
                <label className="block text-sm text-[#d4d4d4]">
                  Código atual do autenticador ou reserva
                  <input
                    value={currentFactor}
                    onChange={(event) => setCurrentFactor(event.target.value)}
                    autoComplete="one-time-code"
                    className={fieldClass}
                  />
                  <span className="mt-1 block text-xs text-[#999999]">
                    Só para trocar um autenticador já cadastrado. No primeiro cadastro, deixe em
                    branco.
                  </span>
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void enroll()}
                  className={secondaryClass}
                >
                  Cadastrar ou trocar autenticador
                </button>
                {uri && (
                  <div className={panelClass}>
                    {qr && (
                      <img src={qr} alt="QR para cadastrar o autenticador" className="h-48 w-48" />
                    )}
                    <p className="break-all text-xs text-[#999999]">
                      {new URL(uri).searchParams.get('secret')}
                    </p>
                    <label className="block text-sm text-[#d4d4d4]">
                      Código de confirmação
                      <input
                        value={confirmCode}
                        onChange={(event) => setConfirmCode(event.target.value)}
                        inputMode="numeric"
                        maxLength={6}
                        className={fieldClass}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy || !/^\d{6}$/.test(confirmCode)}
                      onClick={() => void confirmTotp()}
                      className={primaryClass}
                    >
                      Confirmar código
                    </button>
                  </div>
                )}
                {backupCodes.length > 0 && (
                  <div className={panelClass}>
                    <p className="text-sm text-[#d9a640]">
                      Guarde estes códigos reserva. Cada um funciona uma vez.
                    </p>
                    <p className="break-all font-mono text-xs text-[#d4d4d4]">
                      {backupCodes.join(' · ')}
                    </p>
                  </div>
                )}
              </Subsection>
            </>
          )}

          {active && conflicts.length > 0 && (
            <Subsection title="Conflitos">
              <ul className="space-y-3">
                {conflicts.map((conflict) => {
                  const name =
                    recordName(conflict.remote.payload) ?? recordName(conflict.local.payload)
                  return (
                    <li key={conflict.id} className={panelClass}>
                      <p className="break-words text-sm text-[#d4d4d4]">
                        {syncKindLabel(conflict.kind)}
                        {name ? `: ${name}` : ''}
                      </p>
                      {conflict.type === 'orphan' ? (
                        <>
                          <p className="text-sm text-[#d9a640]">
                            Removido: o item de origem foi apagado em outro aparelho
                          </p>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void resolve(conflict, 'local')}
                            className={secondaryClass}
                          >
                            Dispensar
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <VersionCard
                            label="Versão deste aparelho"
                            version={conflict.local}
                            busy={busy}
                            onUse={() => void resolve(conflict, 'local')}
                          />
                          <VersionCard
                            label={`Versão de ${conflict.remote.deviceName}`}
                            version={conflict.remote}
                            busy={busy}
                            onUse={() => void resolve(conflict, 'remote')}
                          />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Subsection>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-[#ec6a6a]">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmDisable}
        title="Desativar sincronização?"
        message={
          'Este aparelho deixa de sincronizar e sai da lista de aparelhos.\n\nOs dados daqui continuam neste aparelho, e os da nuvem continuam nos outros.'
        }
        confirmLabel="Desativar"
        onConfirm={() => void disable()}
        onCancel={() => setConfirmDisable(false)}
      />
    </section>
  )
}
