import { useEffect, useMemo, useState } from 'react'
import type { Project } from '../../types'
import { ModalBase } from '../ModalBase'

type Harness = Awaited<ReturnType<typeof window.electronAPI.ai.harnesses.status>>[number]
type HarnessId = Harness['id']

interface Props {
  projects: Project[]
  projectId: string | null
  skillCount: number
  sessionId: string | null
  /** Renders inside the session view instead of taking over the window. */
  inline?: boolean
  onClose: () => void
  onStarted: (session: {
    runId: string
    dir: string
    task: string
    agent: string
    projectId: string
    sessionId: string | null
  }) => void
  onUseHarness: (harness: HarnessId) => void
}

/**
 * Starts the terminal-owned Codex flow without turning an ordinary chat into a
 * code-agent conversation. Only roots explicitly enabled in the project can
 * be sent to main; main validates the same boundary before it creates a run.
 */
export function CodeAgentLauncher({
  projects,
  projectId,
  skillCount,
  sessionId,
  inline = false,
  onClose,
  onStarted,
  onUseHarness
}: Props): React.JSX.Element {
  const project = projects.find((item) => item.id === projectId) ?? null
  const roots = useMemo(
    () =>
      (project?.codePaths ?? []).filter((root) =>
        (project?.activeCodePathIds ?? []).includes(root.id)
      ),
    [project]
  )
  const [rootPath, setRootPath] = useState(roots[0]?.path ?? '')
  const [task, setTask] = useState('')
  const [harnesses, setHarnesses] = useState<Harness[]>([])
  const [harnessId, setHarnessId] = useState<HarnessId>('codex')
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const harness = harnesses.find((item) => item.id === harnessId)
  const harnessLabel =
    harness?.label ??
    (harnessId === 'claude-code' ? 'Claude Code' : harnessId === 'opencode' ? 'OpenCode' : 'Codex')
  const capabilities = harness?.capabilities
  // Older persisted/preload clients lack this additive field; they can still
  // launch their known harness, while current clients must obey the snapshot.
  const canStart =
    harness?.installed &&
    (!capabilities ||
      (capabilities.createSession === 'available' &&
        capabilities.interactiveTerminal === 'available' &&
        capabilities.mcp === 'available'))

  useEffect(() => {
    // The project can change while the dialog is open; never retain a root
    // that is no longer authorised for the conversation's project.
    setRootPath(roots[0]?.path ?? '')
  }, [roots])

  const refresh = (): void => {
    setLoading(true)
    setError('')
    void window.electronAPI.ai.harnesses
      .status(true)
      .then(setHarnesses)
      .catch(() => setError('Não foi possível verificar os harnesses nesta máquina.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
  }, [])

  const start = async (): Promise<void> => {
    if (!rootPath || !task.trim() || !canStart || !project) return
    setStarting(true)
    setError('')
    try {
      // The main process chooses the executable, but its persisted harness
      // selection must agree with this explicitly-labelled harness action.
      const currentConfig = await window.electronAPI.ai.config.get()
      await window.electronAPI.ai.config.set({ ...currentConfig, codeHarness: harnessId })
      onUseHarness(harnessId)
      const result = await window.electronAPI.ai.codeAgent.run({
        path: rootPath,
        task: task.trim(),
        projectId: project.id,
        sessionId: sessionId ?? undefined
      })
      if (!result.success) {
        setError(result.error ?? `Não foi possível iniciar ${harness?.label ?? 'o harness'}.`)
        return
      }
      if (!result.runId || !result.dir) {
        setError('O harness iniciou sem identificar a sessão.')
        return
      }
      onStarted({
        runId: result.runId,
        dir: result.dir,
        task: task.trim(),
        agent: harnessLabel,
        projectId: project.id,
        sessionId
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar o harness.')
    } finally {
      setStarting(false)
    }
  }

  const panel = (
    <div className="w-full max-w-xl space-y-4 rounded-xl border border-[#2b2b31] bg-[#16161a] p-5 shadow-2xl">
        <div>
          <h2 className="text-base font-semibold text-[#ededed]">Executar com {harnessLabel}</h2>
          <p className="mt-1 text-xs text-[#999]">
            Este fluxo abre um agente de código separado da conversa. Ele trabalha em um worktree
            isolado e o diff só chega ao projeto após sua aprovação.
          </p>
        </div>

        <label className="block text-xs text-[#999]">
          Harness
          <select value={harnessId} onChange={(event) => setHarnessId(event.target.value as HarnessId)} className="mt-1 w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#ededed]">
            {harnesses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>

        <div className="rounded-lg border border-[#2b2b31] bg-[#101014] p-3 text-xs">
          <p className="font-medium text-[#ededed]">{harness?.label ?? 'Harness'}</p>
          <p className={harness?.installed ? 'mt-1 text-emerald-300' : 'mt-1 text-amber-300'}>
            {loading
              ? 'Verificando…'
              : harness?.installed
                ? `Instalado${harness.version ? ` · ${harness.version}` : ''}`
                : 'Não instalado'}
          </p>
          {harness?.installed && (
            <p className="mt-1 text-[#999]">
              {harness.authentication === 'authenticated'
                ? 'Autenticado'
                : harness.authentication === 'unauthenticated'
                  ? 'Login necessário'
                  : 'Autenticação não verificada'}
            </p>
          )}
          {harness?.installed && !canStart && (
            <p className="mt-1 text-amber-300">Sessão MCP interativa indisponível nesta versão.</p>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-[#999]">
          <span>MCP Sagyou é conectado somente durante esta execução; parar revoga o acesso.</span>
          <button type="button" onClick={refresh} className="text-violet-300 hover:text-violet-200">
            Verificar novamente
          </button>
        </div>

        <label className="block text-xs text-[#999]">
          Raiz de código autorizada
          <select
            value={rootPath}
            onChange={(event) => setRootPath(event.target.value)}
            disabled={!roots.length}
            className="mt-1 w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#ededed] disabled:opacity-50"
          >
            {!roots.length && <option value="">Marque uma pasta de código no projeto primeiro</option>}
            {roots.map((root) => (
              <option key={root.id} value={root.path}>
                {root.label || root.path}
              </option>
            ))}
          </select>
          {project && !roots.length && (
            <span className="mt-1 block text-amber-300">
              Nenhuma raiz autorizada em “{project.name}”. Gerencie as pastas no projeto.
            </span>
          )}
          {!project && (
            <span className="mt-1 block text-amber-300">
              Selecione um projeto para escolher uma raiz de código autorizada.
            </span>
          )}
        </label>

        <label className="block text-xs text-[#999]">
          Tarefa para o {harnessLabel}
          <textarea
            value={task}
            onChange={(event) => setTask(event.target.value)}
            rows={5}
            placeholder="Descreva a alteração, o resultado esperado e as restrições."
            className="mt-1 w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#ededed] placeholder:text-[#666]"
          />
        </label>

        <p className="text-xs text-[#999]">
          {skillCount
            ? `${skillCount} skill(s) local(is) do Sagyou serão anexadas ao briefing.`
            : 'Não há skills locais do Sagyou para anexar ao briefing.'}
        </p>
        {error && <p className="text-xs text-red-300">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-[#999]">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting || !task.trim() || !rootPath || !canStart || !project}
            className="rounded-lg bg-violet-700 px-3 py-2 text-sm text-white hover:bg-violet-600 disabled:opacity-40"
          >
            {starting ? 'Iniciando…' : `Iniciar ${harnessLabel}`}
          </button>
        </div>
    </div>
  )
  return inline ? panel : <ModalBase open onClose={onClose}>{panel}</ModalBase>
}
