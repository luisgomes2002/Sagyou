import { useEffect, useState, type JSX } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'
import { RESTORE_ACCESS_LABEL, accessCutPcText } from '../../utils/remoteControlText'

interface ExternalStatus {
  state: 'none' | 'active'
  createdAt?: number
  lastUsedAt?: number | null
  allowWhileLocked?: boolean
}

interface Props {
  onToast: (message: string, type?: 'success' | 'error') => void
}

export const NONE_TEXT = 'Nenhum acesso externo.'
export const FULL_ACCESS_WARNING =
  'O token dá leitura e escrita de tudo no Sagyou. Não vence: vale até você revogar.'
// Spec 2026-11-07, item 1: the risky writes of the external token ask first.
export const CARD_NOTICE =
  'Excluir, mexer em dinheiro e em tabelas ou perfis financeiros pede aprovação no PC ou no celular.'
export const ACTIVE_SCOPE_TEXT = 'Acesso total, sem prazo'
export const ONCE_TEXT =
  'Este é o único momento em que o token aparece. Guarde o comando ou gere outro depois.'
export const PLAIN_TEXT_WARNING =
  'O Claude Code guarda o token em texto na configuração dele (~/.claude.json), e o comando colado fica no histórico do terminal e da área de transferência (Win+V). Revogar aqui o invalida na hora.'
export const REVOKE_MESSAGE =
  'Revogar o acesso MCP externo? O Claude que usa este token perde o acesso na hora.'
export const NEW_TOKEN_MESSAGE =
  'Gerar um token novo? O atual para de valer na hora e o comando do Claude Code precisa ser trocado.'
export const ALLOW_LOCKED_LABEL = 'Ler com o Sagyou bloqueado'
export const ALLOW_LOCKED_WARNING =
  'Com o Sagyou bloqueado, o Claude externo continua lendo seus dados, mas não escreve. Para escrever, desbloqueie no PC ou pelo celular.'

const primaryClass =
  'rounded-lg bg-[#6d5bb8] px-3 py-2 text-sm text-white hover:bg-[#7b69c6] disabled:opacity-50'
const secondaryClass =
  'rounded-lg bg-[#2a2a30] px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#303036] disabled:opacity-50'
const panelClass = 'space-y-3 rounded-lg border border-[#2b2b31] bg-[#101014] p-4'

const formatDate = (ms: number): string => new Date(ms).toLocaleString('pt-BR')

/**
 * Configurações → Acesso MCP externo: one token, no expiry and full access,
 * for a Claude outside the Fleet (spec docs/specs/2026-11-03-acesso-remoto.md).
 */
export function McpExternalSettings({ onToast }: Props): JSX.Element {
  const [status, setStatus] = useState<ExternalStatus | null>(null)
  const [hasPassword, setHasPassword] = useState(false)
  const [issued, setIssued] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [confirmNew, setConfirmNew] = useState(false)
  // "Cortar acesso" from a phone suspends the token (read from the remote control).
  const [accessCutAt, setAccessCutAt] = useState<number | null>(null)

  useEffect(() => {
    const remote = window.electronAPI.remote
    if (!remote) return
    remote
      .status()
      .then((s) => setAccessCutAt(s.accessCutAt ?? null))
      .catch(() => setAccessCutAt(null))
    return remote.onStatusChanged((s) => setAccessCutAt(s.accessCutAt ?? null))
  }, [])

  useEffect(() => {
    window.electronAPI.mcpExternal
      .status()
      .then(setStatus)
      .catch(() => setError('Não foi possível ler o acesso MCP externo.'))
    // The option only matters with an app password: without one, nothing locks.
    void window.electronAPI.security
      ?.status()
      .then((security) => setHasPassword(security.enabled))
      .catch(() => setHasPassword(false))
  }, [])

  const run = async (action: () => Promise<void>, fallback: string): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch {
      setError(fallback)
    } finally {
      setBusy(false)
    }
  }

  const create = (): Promise<void> =>
    run(async () => {
      setConfirmNew(false)
      const result = await window.electronAPI.mcpExternal.create()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setIssued(result.command)
      setStatus(result.status)
    }, 'Não foi possível gerar o acesso MCP externo.')

  const revoke = (): Promise<void> =>
    run(async () => {
      setConfirmRevoke(false)
      setIssued(null)
      setStatus(await window.electronAPI.mcpExternal.revoke())
      onToast('Acesso MCP externo revogado.')
    }, 'Não foi possível revogar o acesso MCP externo.')

  const setAllowLocked = (value: boolean): Promise<void> =>
    run(async () => {
      setStatus(await window.electronAPI.mcpExternal.setAllowLocked(value))
    }, 'Não foi possível mudar o acesso com o Sagyou bloqueado.')

  const restoreAccess = (): Promise<void> =>
    run(async () => {
      const result = await window.electronAPI.remote.restoreAccess()
      if (!result.ok) {
        setError(result.error)
        return
      }
      const s = await window.electronAPI.remote.status()
      setAccessCutAt(s.accessCutAt ?? null)
    }, 'Não foi possível restaurar o acesso.')

  const copy = async (): Promise<void> => {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued)
      onToast('Comando copiado.')
    } catch {
      onToast('Não foi possível copiar o comando.', 'error')
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-[#999999]">
        Para um Claude Code fora do Fleet (por exemplo, com o Remote Control) ler e editar o Sagyou
        neste PC. Só funciona com o Sagyou aberto.
      </p>

      {accessCutAt !== null && (
        <div className={panelClass}>
          <p role="status" className="text-sm text-[#d9a640]">
            {accessCutPcText(accessCutAt)}
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

      {issued && (
        <div className={panelClass}>
          <p className="text-sm text-[#d9a640]">{ONCE_TEXT}</p>
          <p className="break-all font-mono text-xs text-[#d4d4d4]">{issued}</p>
          <p className="text-xs text-[#999999]">{PLAIN_TEXT_WARNING}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className={primaryClass}>
              Copiar comando
            </button>
            <button type="button" onClick={() => setIssued(null)} className={secondaryClass}>
              Pronto
            </button>
          </div>
        </div>
      )}

      {status?.state === 'none' && (
        <div className={panelClass}>
          <p className="text-sm text-[#d4d4d4]">{NONE_TEXT}</p>
          <p className="text-sm text-[#d9a640]">{FULL_ACCESS_WARNING}</p>
          <p className="text-sm text-[#999999]">{CARD_NOTICE}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void create()}
            className={primaryClass}
          >
            Gerar acesso
          </button>
        </div>
      )}

      {status?.state === 'active' && (
        <div className={panelClass}>
          <p className="text-sm text-[#d4d4d4]">{`Ativo desde ${formatDate(status.createdAt ?? 0)}`}</p>
          <p className="text-sm text-[#999999]">
            {status.lastUsedAt ? `Último uso: ${formatDate(status.lastUsedAt)}` : 'Nunca usado'}
          </p>
          <p className="text-sm text-[#999999]">{ACTIVE_SCOPE_TEXT}</p>
          <p className="text-sm text-[#999999]">{CARD_NOTICE}</p>
          {hasPassword && (
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm text-[#d4d4d4]">
                <input
                  type="checkbox"
                  checked={status.allowWhileLocked === true}
                  disabled={busy}
                  onChange={(event) => void setAllowLocked(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[#6d5bb8]"
                />
                {ALLOW_LOCKED_LABEL}
              </label>
              <p className="text-xs text-[#999999]">{ALLOW_LOCKED_WARNING}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmNew(true)}
              className={primaryClass}
            >
              Gerar novo token
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmRevoke(true)}
              className={secondaryClass}
            >
              Revogar
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-[#ec6a6a]">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirmNew}
        title="Gerar novo token"
        message={NEW_TOKEN_MESSAGE}
        confirmLabel="Gerar novo token"
        onConfirm={() => void create()}
        onCancel={() => setConfirmNew(false)}
      />
      <ConfirmDialog
        open={confirmRevoke}
        title="Revogar acesso"
        message={REVOKE_MESSAGE}
        confirmLabel="Revogar"
        onConfirm={() => void revoke()}
        onCancel={() => setConfirmRevoke(false)}
      />
    </div>
  )
}
