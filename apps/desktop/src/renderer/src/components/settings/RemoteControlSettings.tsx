import { useEffect, useState, type JSX } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'
import {
  ENABLE_DESCRIPTION,
  ENABLE_LABEL,
  ESP32_ONCE_TEXT,
  ESP32_SUGGESTION,
  RESTORE_ACCESS_LABEL,
  accessCutPcText,
  requestText,
  revokeMessage,
  suspendedText
} from '../../utils/remoteControlText'

interface PendingAuthorization {
  id: string
  name: string
  code: string
  expiresAt: number
}

interface RemoteStatus {
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
  accessCutAt?: number | null
}

interface Props {
  onToast: (message: string, type?: 'success' | 'error') => void
  /** Names of the projects that have a code folder, offered as server names. */
  suggestions?: string[]
}

const primaryClass =
  'rounded-lg bg-[#6d5bb8] px-3 py-2 text-sm text-white hover:bg-[#7b69c6] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6d5bb8] disabled:opacity-50'
const secondaryClass =
  'rounded-lg bg-[#2a2a30] px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#303036] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6d5bb8] disabled:opacity-50'
const panelClass = 'space-y-3 rounded-lg border border-[#2b2b31] bg-[#101014] p-4'
const inputClass =
  'w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus-visible:border-[#6d5bb8] focus-visible:ring-1 focus-visible:ring-[#6d5bb8]'
const headingClass = 'text-sm font-medium text-[#d4d4d4]'

/** Configurações → Controle remoto (spec docs/specs/2026-11-03-controle-remoto-app.md). */
export function RemoteControlSettings({ onToast, suggestions = [] }: Props): JSX.Element {
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [enableCode, setEnableCode] = useState('')
  const [askEnable, setAskEnable] = useState(false)
  const [passwords, setPasswords] = useState<Record<string, string>>({})
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({})
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null)
  const [revokedHint, setRevokedHint] = useState(false)
  const [newServer, setNewServer] = useState('')
  const [espCode, setEspCode] = useState('')
  const [askEsp, setAskEsp] = useState(false)
  // Shown once; dropped when this section unmounts.
  const [issued, setIssued] = useState<{ token: string; key: string } | null>(null)

  useEffect(() => {
    const api = window.electronAPI.remote
    api
      .status()
      .then(setStatus)
      .catch(() => setError('Não foi possível ler o controle remoto.'))
    return api.onStatusChanged(setStatus)
  }, [])

  const refresh = async (): Promise<void> => setStatus(await window.electronAPI.remote.status())

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch {
      setError('Não foi possível concluir a operação do controle remoto.')
    } finally {
      setBusy(false)
    }
  }

  const enable = (): Promise<void> =>
    run(async () => {
      const result = await window.electronAPI.remote.enable({ totp: enableCode.trim() })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAskEnable(false)
      setEnableCode('')
      await refresh()
    })

  const restoreAccess = (): Promise<void> =>
    run(async () => {
      const result = await window.electronAPI.remote.restoreAccess()
      if (!result.ok) setError(result.error)
      await refresh()
    })

  const disable = (): Promise<void> =>
    run(async () => {
      const result = await window.electronAPI.remote.disable()
      if (!result.ok) setError(result.error)
      await refresh()
    })

  const authorize = (p: PendingAuthorization): Promise<void> =>
    run(async () => {
      const result = await window.electronAPI.remote.authorize(p.id, passwords[p.id] ?? '')
      if (!result.ok) {
        setRequestErrors((prev) => ({ ...prev, [p.id]: result.error }))
        return
      }
      setPasswords((prev) => ({ ...prev, [p.id]: '' }))
      setRequestErrors((prev) => ({ ...prev, [p.id]: '' }))
      onToast(`${p.name} autorizado.`)
      await refresh()
    })

  const refuse = (p: PendingAuthorization): Promise<void> =>
    run(async () => {
      await window.electronAPI.remote.refuse(p.id)
      await refresh()
    })

  const revoke = (): Promise<void> =>
    run(async () => {
      if (!revoking) return
      const target = revoking
      setRevoking(null)
      await window.electronAPI.remote.revoke(target.id)
      setRevokedHint(true)
      onToast(`${target.name} revogado.`)
      await refresh()
    })

  const saveServers = (names: string[]): Promise<void> =>
    run(async () => {
      const result = await window.electronAPI.remote.setServers(names)
      if (!result.ok) {
        setError(result.error)
        return
      }
      await refresh()
    })

  const addServer = async (): Promise<void> => {
    const name = newServer.trim()
    if (!name || !status) return
    await saveServers([...status.servers.map((s) => s.name), name])
    setNewServer('')
  }

  const createEsp = (): Promise<void> =>
    run(async () => {
      const result = await window.electronAPI.remote.createEsp32({ totp: espCode.trim() })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setIssued({ token: result.token, key: result.key })
      setAskEsp(false)
      setEspCode('')
      setRevokedHint(false)
      await refresh()
    })

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      onToast(`${label} copiado.`)
    } catch {
      onToast(`Não foi possível copiar o ${label.toLowerCase()}.`, 'error')
    }
  }

  if (!status) {
    return (
      <div className="space-y-3">
        {error ? (
          <p role="alert" className="text-sm text-[#ec6a6a]">
            {error}
          </p>
        ) : (
          <p className="text-sm text-[#999999]">Carregando…</p>
        )}
      </div>
    )
  }

  const serverNames = status.servers.map((s) => s.name.toLowerCase())
  const freeSuggestions = suggestions.filter((name) => !serverNames.includes(name.toLowerCase()))

  return (
    <div className="space-y-5">
      <div className={panelClass}>
        <label className="flex items-center gap-2 text-sm text-[#d4d4d4]">
          <input
            type="checkbox"
            checked={status.enabled || askEnable}
            disabled={busy || !status.supported}
            onChange={(event) => {
              if (event.target.checked) setAskEnable(true)
              else if (status.enabled) void disable()
              else setAskEnable(false)
            }}
            className="h-3.5 w-3.5 accent-[#6d5bb8] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6d5bb8]"
          />
          {ENABLE_LABEL}
        </label>
        <p className="text-xs text-[#999999]">{ENABLE_DESCRIPTION}</p>
        {!status.supported && <p className="text-sm text-[#999999]">Só funciona no Windows.</p>}
        {askEnable && !status.enabled && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1 text-xs text-[#999999]">
              <span>Código do autenticador</span>
              <input
                value={enableCode}
                onChange={(event) => setEnableCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                className={inputClass}
              />
            </label>
            <button
              type="button"
              disabled={busy || !enableCode.trim()}
              onClick={() => void enable()}
              className={primaryClass}
            >
              Ativar
            </button>
          </div>
        )}
        {status.accessCutAt != null && (
          <div className="space-y-2">
            <p role="status" className="text-sm text-[#d9a640]">
              {accessCutPcText(status.accessCutAt)}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void restoreAccess()}
              className={primaryClass}
            >
              {RESTORE_ACCESS_LABEL}
            </button>
          </div>
        )}
        {status.enabled && status.error && (
          <p role="alert" className="text-sm text-[#d9a640]">
            {status.error}
          </p>
        )}
        {status.enabled && status.suspendedUntil !== null && (
          <p role="alert" className="text-sm text-[#ec6a6a]">
            {suspendedText(status.suspendedUntil)}
          </p>
        )}
      </div>

      {status.enabled && (
        <>
          {status.pending.length > 0 && (
            <section className="space-y-3">
              <h3 className={headingClass}>Pedidos de autorização</h3>
              {status.pending.map((p) => (
                <div key={p.id} className={panelClass}>
                  <p className="break-words text-sm text-[#d4d4d4]">{requestText(p)}</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-0 flex-1 space-y-1 text-xs text-[#999999]">
                      <span>Senha do Sagyou</span>
                      <input
                        type="password"
                        value={passwords[p.id] ?? ''}
                        onChange={(event) =>
                          setPasswords((prev) => ({ ...prev, [p.id]: event.target.value }))
                        }
                        className={inputClass}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy || !(passwords[p.id] ?? '')}
                      onClick={() => void authorize(p)}
                      className={primaryClass}
                    >
                      Autorizar
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void refuse(p)}
                      className={secondaryClass}
                    >
                      Recusar
                    </button>
                  </div>
                  {requestErrors[p.id] && (
                    <p role="alert" className="text-sm text-[#ec6a6a]">
                      {requestErrors[p.id]}
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}

          <section className="space-y-3">
            <h3 className={headingClass}>Celulares autorizados</h3>
            {status.controllers.length === 0 ? (
              <p className="text-sm text-[#999999]">
                Nenhum celular. No celular, abra Ajustes → Controlar o PC → Pedir autorização.
              </p>
            ) : (
              <ul className="space-y-2">
                {status.controllers.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#2b2b31] bg-[#16161a] px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm text-[#d4d4d4]">{c.name}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRevoking({ id: c.id, name: c.name })}
                      className={secondaryClass}
                    >
                      Revogar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {revokedHint && <p className="text-sm text-[#d9a640]">{ESP32_SUGGESTION}</p>}
          </section>

          <section className="space-y-3">
            <h3 className={headingClass}>Servidores de Remote Control</h3>
            <p className="text-xs text-[#999999]">
              O PC só fica &quot;Pronto&quot; quando todos estes rodam (o nome passado em --name).
            </p>
            {status.servers.length > 0 && (
              <ul className="space-y-2">
                {status.servers.map((s) => (
                  <li
                    key={s.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#2b2b31] bg-[#16161a] px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm text-[#d4d4d4]">{s.name}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className={`text-xs ${s.up ? 'text-[#46d478]' : 'text-[#999999]'}`}>
                        {s.up ? 'Rodando' : 'Parado'}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remover ${s.name}`}
                        disabled={busy}
                        onClick={() =>
                          void saveServers(
                            status.servers.map((x) => x.name).filter((n) => n !== s.name)
                          )
                        }
                        className="rounded px-2 py-1 text-xs text-[#999999] hover:bg-[#222227] hover:text-[#d4d4d4] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6d5bb8]"
                      >
                        Remover
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 space-y-1 text-xs text-[#999999]">
                <span>Nome do servidor</span>
                <input
                  value={newServer}
                  maxLength={64}
                  list="remote-server-suggestions"
                  onChange={(event) => setNewServer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void addServer()
                  }}
                  className={inputClass}
                />
              </label>
              <datalist id="remote-server-suggestions">
                {freeSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <button
                type="button"
                disabled={busy || !newServer.trim()}
                onClick={() => void addServer()}
                className={secondaryClass}
              >
                Adicionar
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className={headingClass}>Token do ESP32</h3>
            {issued && (
              <div className={panelClass}>
                <p className="text-sm text-[#d9a640]">{ESP32_ONCE_TEXT}</p>
                <div className="space-y-1">
                  <p className="text-xs text-[#999999]">Token</p>
                  <p className="break-all font-mono text-xs text-[#d4d4d4]">{issued.token}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-[#999999]">Chave</p>
                  <p className="break-all font-mono text-xs text-[#d4d4d4]">{issued.key}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void copy(issued.token, 'Token')}
                    className={secondaryClass}
                  >
                    Copiar token
                  </button>
                  <button
                    type="button"
                    onClick={() => void copy(issued.key, 'Chave')}
                    className={secondaryClass}
                  >
                    Copiar chave
                  </button>
                  <button type="button" onClick={() => setIssued(null)} className={primaryClass}>
                    Pronto
                  </button>
                </div>
              </div>
            )}
            {!askEsp ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setAskEsp(true)}
                className={secondaryClass}
              >
                {status.hasEsp32Key ? 'Gerar novo' : 'Gerar'}
              </button>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1 space-y-1 text-xs text-[#999999]">
                  <span>Código do autenticador</span>
                  <input
                    value={espCode}
                    onChange={(event) => setEspCode(event.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className={inputClass}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !espCode.trim()}
                  onClick={() => void createEsp()}
                  className={primaryClass}
                >
                  {status.hasEsp32Key ? 'Gerar novo' : 'Gerar'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAskEsp(false)
                    setEspCode('')
                  }}
                  className={secondaryClass}
                >
                  Cancelar
                </button>
              </div>
            )}
          </section>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-[#ec6a6a]">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={revoking !== null}
        title="Revogar celular"
        message={revoking ? revokeMessage(revoking.name) : ''}
        confirmLabel="Revogar"
        onConfirm={() => void revoke()}
        onCancel={() => setRevoking(null)}
      />
    </div>
  )
}
