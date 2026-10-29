import { useState } from 'react'
import type { Project } from '../../../types'

export type Harness = Awaited<ReturnType<typeof window.electronAPI.ai.harnesses.status>>[number]

/** Where and with what a session opens. */
export interface SessionRequest {
  projectId: string | null
  rootPath: string
  harnessId: Harness['id'] | ''
}

function harnessReady(harness: Harness): boolean {
  const c = harness.capabilities
  return (
    harness.installed &&
    (!c ||
      (c.createSession === 'available' &&
        c.interactiveTerminal === 'available' &&
        c.mcp === 'available'))
  )
}

/**
 * Inline "new session" form. It replaces the old modal because the three
 * choices (project, root, harness) are what the user is reasoning about next
 * to the list of sessions that already exist, not an interruption.
 */
export function NewSessionPanel({
  projects,
  harnesses,
  starting,
  error,
  onStart,
  onCancel
}: {
  projects: Project[]
  harnesses: Harness[]
  starting: boolean
  error: string
  onStart: (request: SessionRequest) => void
  onCancel?: () => void
}): React.JSX.Element {
  const [projectId, setProjectId] = useState<string | null>(null)
  const [rootPath, setRootPath] = useState('')
  const [harnessId, setHarnessId] = useState<Harness['id'] | ''>('')

  const project = projects.find((item) => item.id === projectId)
  const roots = (project?.codePaths ?? []).filter((root) =>
    (project?.activeCodePathIds ?? []).includes(root.id)
  )
  const chosen = harnesses.find((item) => item.id === harnessId)
  const harnessBlocked = Boolean(chosen && !harnessReady(chosen))

  return (
    <div className="mx-auto flex h-full w-full max-w-xl flex-col justify-center px-6 py-8">
      <h2 className="text-lg font-semibold text-[#ededed]">Nova sessão de código</h2>
      <p className="mt-1 text-sm text-[#8a8a92]">
        O agente trabalha num worktree isolado. Nada chega ao seu projeto sem a sua aprovação, e o
        MCP do Sagyou fica ligado só enquanto a sessão durar.
      </p>

      <div className="mt-6 space-y-4">
        <label className="block text-sm text-[#d4d4d4]">
          Projeto
          <select
            aria-label="Projeto da sessão"
            value={projectId ?? ''}
            onChange={(event) => {
              const id = event.target.value || null
              const next = projects.find((item) => item.id === id)
              const nextRoots = (next?.codePaths ?? []).filter((root) =>
                (next?.activeCodePathIds ?? []).includes(root.id)
              )
              setProjectId(id)
              setRootPath(nextRoots[0]?.path ?? '')
            }}
            className="mt-1 w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2"
          >
            <option value="">Sessão geral (sem projeto)</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {!projectId && (
            <span className="mt-1 block text-xs text-[#8a8a92]">
              Sem projeto, o agente usa um espaço privado e o MCP lê todos os projetos.
            </span>
          )}
        </label>

        {projectId && (
          <label className="block text-sm text-[#d4d4d4]">
            Pasta de código
            <select
              aria-label="Pasta de código"
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2"
            >
              <option value="">Sem pasta de código</option>
              {roots.map((root) => (
                <option key={root.id} value={root.path}>
                  {root.label || root.path}
                </option>
              ))}
            </select>
            {!rootPath && (
              <span className="mt-1 block text-xs text-[#d9a640]">
                Sem pasta de código: o agente usará um espaço privado. O MCP continuará vinculado a este projeto.
              </span>
            )}
          </label>
        )}

        <label className="block text-sm text-[#d4d4d4]">
          Executor
          <select
            aria-label="Executor"
            value={harnessId}
            onChange={(event) => setHarnessId(event.target.value as Harness['id'] | '')}
            className="mt-1 w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2"
          >
            <option value="">Padrão das configurações</option>
            {harnesses.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {item.installed ? '' : ' (não instalado)'}
              </option>
            ))}
          </select>
          {chosen && (
            <span className={`mt-1 block text-xs ${harnessBlocked ? 'text-[#d9a640]' : 'text-[#8a8a92]'}`}>
              {!chosen.installed
                ? 'Não encontrado nesta máquina.'
                : harnessBlocked
                  ? 'Sessão interativa com MCP indisponível nesta versão.'
                  : `${chosen.version ? `v${chosen.version} · ` : ''}${
                      chosen.authentication === 'authenticated'
                        ? 'autenticado'
                        : chosen.authentication === 'unauthenticated'
                          ? 'login necessário'
                          : 'autenticação não verificada'
                    }`}
            </span>
          )}
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-[#ec6a6a]">
          {error}
        </p>
      )}

      <div className="mt-6 flex items-center justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-[#999]">
            Cancelar
          </button>
        )}
        <button
          type="button"
          onClick={() => onStart({ projectId, rootPath, harnessId })}
          disabled={starting || harnessBlocked}
          className="rounded-lg bg-[#6d5bb8] px-4 py-2 text-sm font-medium text-white hover:bg-[#7b69c6] disabled:opacity-40"
        >
          {starting ? 'Abrindo…' : 'Abrir sessão'}
        </button>
      </div>
    </div>
  )
}
