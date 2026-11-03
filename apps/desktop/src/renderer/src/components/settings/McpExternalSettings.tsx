import { useEffect, useState, type JSX } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'

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
  'O token dá leitura e escrita de tudo no Sagyou, inclusive excluir e mexer em dinheiro, sem pedir aprovação. Não vence: vale até você revogar.'
export const ACTIVE_SCOPE_TEXT = 'Acesso total, sem prazo'
export const ONCE_TEXT =
  'Este é o único momento em que o token aparece. Guarde o comando ou gere outro depois.'
export const PLAIN_TEXT_WARNING =
  'O Claude Code guarda o token em texto na configuração dele (~/.claude.json), e o comando colado fica no histórico do terminal e da área de transferência (Win+V). Revogar aqui o invalida na hora.'
export const REVOKE_MESSAGE =
  'Revogar o acesso MCP externo? O Claude que usa este token perde o acesso na hora.'
export const NEW_TOKEN_MESSAGE =
  'Gerar um token novo? O atual para de valer na hora e o comando do Claude Code precisa ser trocado.'
export const ALLOW_LOCKED_LABEL = 'Funcionar com o Sagyou bloqueado'
export const ALLOW_LOCKED_WARNING =
  'Com isto ligado, o Claude continua lendo e editando o Sagyou mesmo com a tela na senha. Quem usar sua conta do Windows consegue usar o token (ele fica salvo na configuração do Claude Code), então a proteção passa a ser a senha do Windows.'

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
