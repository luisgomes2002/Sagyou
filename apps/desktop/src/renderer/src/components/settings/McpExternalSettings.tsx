import { useCallback, useEffect, useState, type JSX } from 'react'
import { useKanbanStore } from '../../store/kanban'
import { ConfirmDialog } from '../ConfirmDialog'

type Mode = 'read' | 'read-write'

interface ExternalStatus {
  state: 'none' | 'active' | 'expired'
  createdAt?: number
  expiresAt?: number
  lastUsedAt?: number | null
  scope?: { projectId: string | null; financialProfileId: string; mode: Mode }
}

interface Props {
  onToast: (message: string, type?: 'success' | 'error') => void
}

export const NONE_TEXT = 'Nenhum acesso externo.'
export const ONCE_TEXT =
  'Este é o único momento em que o token aparece. Guarde o comando ou gere outro depois.'
export const PLAIN_TEXT_WARNING =
  'O Claude Code guarda o token em texto na configuração dele (~/.claude.json). Revogar aqui o invalida na hora.'
export const REVOKE_MESSAGE =
  'Revogar o acesso MCP externo? O Claude que usa este token perde o acesso na hora.'

const MODE_LABELS: Record<Mode, string> = {
  read: 'Só leitura',
  'read-write': 'Leitura e escrita'
}

const fieldClass =
  'mt-1 block w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#d4d4d4]'
const primaryClass =
  'rounded-lg bg-[#6d5bb8] px-3 py-2 text-sm text-white hover:bg-[#7b69c6] disabled:opacity-50'
const secondaryClass =
  'rounded-lg bg-[#2a2a30] px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#303036] disabled:opacity-50'
const panelClass = 'space-y-3 rounded-lg border border-[#2b2b31] bg-[#101014] p-4'

const formatDate = (ms: number): string => new Date(ms).toLocaleString('pt-BR')

/** Configurações → Acesso MCP externo: a 30-day token for a Claude outside the Fleet. */
export function McpExternalSettings({ onToast }: Props): JSX.Element {
  const projects = useKanbanStore((s) => s.projects)
  const profiles = useKanbanStore((s) => s.financialProfiles)
  const activeProfileId = useKanbanStore((s) => s.activeFinancialProfileId)
  const [status, setStatus] = useState<ExternalStatus | null>(null)
  const [projectId, setProjectId] = useState('')
  const [profileId, setProfileId] = useState(activeProfileId)
  const [mode, setMode] = useState<Mode>('read')
  const [issued, setIssued] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setStatus(await window.electronAPI.mcpExternal.status())
  }, [])

  useEffect(() => {
    void refresh().catch(() => setError('Não foi possível ler o acesso MCP externo.'))
  }, [refresh])

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const take = (
    result: { ok: true; command: string; status: ExternalStatus } | { ok: false; error: string }
  ): void => {
    if (!result.ok) {
      setError(result.error)
      return
    }
    setIssued(result.command)
    setStatus(result.status)
  }

  const create = (): Promise<void> =>
    run(async () =>
      take(
        await window.electronAPI.mcpExternal.create({
          projectId: projectId || null,
          financialProfileId: profileId,
          mode
        })
      )
    )

  const renew = (): Promise<void> =>
    run(async () => take(await window.electronAPI.mcpExternal.renew()))

  const revoke = (): Promise<void> =>
    run(async () => {
      setConfirmRevoke(false)
      setIssued(null)
      setStatus(await window.electronAPI.mcpExternal.revoke())
      onToast('Acesso MCP externo revogado.')
    })

  const copy = async (): Promise<void> => {
    if (!issued) return
    try {
      await navigator.clipboard.writeText(issued)
      onToast('Comando copiado.')
    } catch {
      onToast('Não foi possível copiar o comando.', 'error')
    }
  }

  const projectName = (id: string | null): string =>
    id ? (projects.find((p) => p.id === id)?.name ?? 'projeto removido') : 'Nenhum'
  const profileName = (id: string): string => profiles.find((p) => p.id === id)?.name ?? id

  return (
    <div className="space-y-5">
      <p className="text-sm text-[#999999]">
        Para um Claude Code fora do Fleet (por exemplo, com o Remote Control) ler e editar o Sagyou
        neste PC. Só funciona com o Sagyou aberto e desbloqueado, e escritas arriscadas (excluir,
        dinheiro, arquivar) são sempre recusadas por este acesso.
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
          <label className="block text-sm text-[#999999]">
            Projeto padrão
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={fieldClass}
            >
              <option value="">Nenhum</option>
              {projects
                .filter((p) => !p.archivedAt)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm text-[#999999]">
            Perfil financeiro
            <select
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              className={fieldClass}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-[#999999]">
            Acesso
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className={fieldClass}
            >
              <option value="read">{MODE_LABELS.read}</option>
              <option value="read-write">{MODE_LABELS['read-write']}</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !profileId}
            onClick={() => void create()}
            className={primaryClass}
          >
            Gerar acesso
          </button>
        </div>
      )}

      {status && status.state !== 'none' && status.scope && (
        <div className={panelClass}>
          <p className="text-sm text-[#d4d4d4]">
            {status.state === 'active'
              ? `Válido até ${formatDate(status.expiresAt ?? 0)}`
              : `Vencido em ${formatDate(status.expiresAt ?? 0)}`}
          </p>
          <p className="text-sm text-[#999999]">
            {status.lastUsedAt ? `Último uso: ${formatDate(status.lastUsedAt)}` : 'Nunca usado'}
          </p>
          <p className="text-sm text-[#999999]">
            {`Projeto: ${projectName(status.scope.projectId)} · Perfil: ${profileName(
              status.scope.financialProfileId
            )} · ${MODE_LABELS[status.scope.mode]}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void renew()}
              className={primaryClass}
            >
              Renovar
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
