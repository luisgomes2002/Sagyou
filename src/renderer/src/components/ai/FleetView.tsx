import { useState, useEffect, useMemo } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Project } from '../../types'
import { SessionRail, type SessionItem } from './fleet/SessionRail'
import { NewSessionPanel, type Harness, type SessionRequest } from './fleet/NewSessionPanel'
import { LiveRunWorkspace } from './fleet/Workspaces'
import { useCodeAgentRuns } from './fleet/useCodeAgentRuns'

// ---------------------------------------------------------------------------
// Sessões de código
//
// Um workspace em três partes: a lista de sessões (à esquerda), a sessão
// selecionada (centro: terminal ou diff) e um inspetor com atividade, alterações
// e contexto. Tudo é derivado do estado dos agentes em main (código) e da run
// store; a view não guarda cópia de nenhum deles.
// ---------------------------------------------------------------------------

const NEW = 'new'

// FleetView is unmounted when the user visits another area. The PTY belongs to
// main, not React, so only the selection is remembered; the next mount selects
// the same session again instead of treating navigation as a new request.
let retainedSelection: string | null = null

export function FleetView({
  projects,
  retainThread = false
}: {
  projects: Project[]
  /** App opts in because it owns navigation; isolated mounts start clean. */
  retainThread?: boolean
}): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(retainThread ? retainedSelection : null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [harnesses, setHarnesses] = useState<Harness[]>([])
  const [removalNotice, setRemovalNotice] = useState<string | null>(null)

  const {
    runs: codeRuns,
    hydrated,
    stopAgent,
    setAuto,
    approveAgent,
    terminalInput,
    terminalResize
  } = useCodeAgentRuns()

  useEffect(() => {
    void window.electronAPI.ai.harnesses
      ?.status()
      .then(setHarnesses)
      .catch(() => {})
  }, [])

  // One-time notice that the retired chat history was removed (main hands it
  // out until the user dismisses it).
  useEffect(() => {
    void window.electronAPI.legacyChat
      ?.notice()
      .then((notice) => setRemovalNotice(notice?.snapshotDir ?? null))
      .catch(() => {})
  }, [])

  const dismissNotice = (): void => {
    setRemovalNotice(null)
    void window.electronAPI.legacyChat?.dismiss().catch(() => {})
  }

  // ── Derived helpers ────────────────────────────────────────────────────────
  const projectNameOf = (dir: string, projectId?: string | null): string => {
    const byId = projectId ? projects.find((p) => p.id === projectId) : undefined
    if (byId) return byId.name
    const byPath = projects.find((p) => p.codePaths?.some((cp) => dir.includes(cp.path)))
    return byPath?.name ?? (projectId === null ? 'Geral' : (dir.split(/[\\/]/).pop() ?? 'Código'))
  }

  const harnessLabelOf = (id?: string, fallback = 'Harness'): string =>
    harnesses.find((h) => h.id === id)?.label ?? fallback

  // ── Session list ───────────────────────────────────────────────────────────
  const items = useMemo<SessionItem[]>(() => {
    const live: SessionItem[] = codeRuns.map((run) => ({
      key: `run:${run.id}`,
      kind: 'run',
      title:
        run.interactive && /^Abra uma sessão interativa/.test(run.task)
          ? 'Sessão interativa'
          : run.task,
      subtitle: `${projectNameOf(run.dir, run.projectId)} · ${harnessLabelOf(run.harness, run.model)}`,
      status: run.approvals.length || run.questions.length ? 'attention' : 'running'
    }))
    return live
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeRuns, projects, harnesses])

  // Resolve what is on screen. A selection whose session ended falls back to
  // the first available one, but only once main has answered: an empty first
  // render is normal while the IPC snapshot is in flight.
  const effective = useMemo(() => {
    if (selected === NEW) return NEW
    if (selected && items.some((item) => item.key === selected)) return selected
    if (selected?.startsWith('run:') && !hydrated) return selected
    return items[0]?.key ?? NEW
  }, [selected, items, hydrated])

  useEffect(() => {
    if (retainThread && hydrated) retainedSelection = effective === NEW ? null : effective
  }, [effective, hydrated, retainThread])

  // ── Actions ────────────────────────────────────────────────────────────────
  const startSession = async (request: SessionRequest): Promise<void> => {
    if (starting) return
    const project = projects.find((item) => item.id === request.projectId)
    const root = (project?.codePaths ?? []).find((item) => item.path === request.rootPath)
    if (request.projectId && !root) {
      setStartError('Selecione uma raiz de código autorizada para o projeto.')
      return
    }
    setStartError('')
    setStarting(true)
    try {
      if (request.harnessId) {
        // Main picks the executable from the persisted selection, so the choice
        // made here has to be the persisted one.
        const config = await window.electronAPI.ai.config.get()
        await window.electronAPI.ai.config.set({ ...config, codeHarness: request.harnessId })
      }
      const result = await window.electronAPI.ai.codeAgent.run({
        path: root?.path ?? '',
        task: '',
        blank: true,
        projectId: request.projectId,
        sessionId: uuidv4()
      })
      if (!result.success || !result.runId || !result.dir) {
        setStartError(result.error ?? 'Não foi possível iniciar o terminal.')
        return
      }
      setSelected(`run:${result.runId}`)
    } catch (reason) {
      setStartError(
        reason instanceof Error ? reason.message : 'Não foi possível iniciar o terminal.'
      )
    } finally {
      setStarting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const renderMain = (): React.JSX.Element => {
    if (effective === NEW) {
      return (
        <div className="h-full overflow-y-auto">
          {items.length === 0 && !starting && (
            <p className="px-6 pt-6 text-center text-sm text-[#8a8a92]">Nenhum agente ativo</p>
          )}
          <NewSessionPanel
            projects={projects}
            harnesses={harnesses}
            starting={starting}
            error={startError}
            onStart={(request) => void startSession(request)}
            onCancel={items.length ? () => setSelected(items[0].key) : undefined}
          />
        </div>
      )
    }
    const [kind, ...rest] = effective.split(':')
    const id = rest.join(':')
    if (kind === 'run') {
      const run = codeRuns.find((item) => item.id === id)
      if (!run) return <p className="p-6 text-sm text-[#8a8a92]">Conectando à sessão…</p>
      return (
        <LiveRunWorkspace
          run={run}
          harness={harnesses.find((h) => h.id === run.harness)}
          projectName={projectNameOf(run.dir, run.projectId)}
          onApprove={approveAgent}
          onStop={stopAgent}
          onSetAuto={setAuto}
          onTerminalInput={terminalInput}
          onTerminalResize={terminalResize}
        />
      )
    }
    return <p className="p-6 text-sm text-[#8a8a92]">Sessão encerrada.</p>
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {removalNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-b border-[#2b2b31] bg-[#1b1b20] px-4 py-2 text-xs text-[#d4d4d4]"
        >
          <p>{`O histórico de conversas foi removido. Um backup foi salvo em ${removalNotice}.`}</p>
          <button
            type="button"
            onClick={dismissNotice}
            className="shrink-0 rounded border border-[#2b2b31] px-2 py-1 text-[#d4d4d4] hover:bg-[#2a2a30]"
          >
            Fechar aviso
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <SessionRail
          items={items}
          selectedKey={effective === NEW ? null : effective}
          onSelect={setSelected}
          onNew={() => {
            setStartError('')
            setSelected(NEW)
          }}
          starting={starting}
        />
        <main className="min-h-0 min-w-0 flex-1 bg-[#0f0f13]">{renderMain()}</main>
      </div>
    </div>
  )
}
