import { useState, useEffect, useCallback, useRef } from 'react'

export interface CodeAgentRunUI {
  id: string
  dir: string
  task: string
  model: string
  harness?: 'codex' | 'claude-code' | 'opencode'
  worktreeDir?: string | null
  localInstructions?: string[]
  localSkills?: string[]
  sessionId: string | null
  projectId: string | null
  financialProfileId?: string
  codeRoot?: string
  startedAt: number
  log: string
  hint: { title: string; detail: string; command?: string } | null
  progress: {
    step: number
    maxSteps: number
    promptTokens: number
    completionTokens: number
  } | null
  autoApprove: boolean
  allowedWritePaths?: string[]
  readOnlyRoots?: { id: string; nome: string; path: string }[]
  interactive: boolean
  terminalCols?: number
  terminalRows?: number
  /** Questions pause a run until the user supplies an answer. */
  questions: { id: string; question: string }[]
  /** Pending approval requests — shown inline until the user acts on them. */
  approvals: {
    id: string
    name: string
    args: Record<string, unknown>
    resumo: string
    conteudo?: string
    comando?: string
    diff?: { kind: 'add' | 'del' | 'ctx' | 'meta'; text: string }[]
    diffTruncated?: boolean
    irreversivel?: boolean
  }[]
}

/** Mirrors main's MAX_AGENT_LOG: the same bounded tail status() returns. */
const MAX_AGENT_LOG = 8000
/** Output is coalesced so a chatty CLI re-renders the Fleet a few times a second, not per chunk. */
const OUTPUT_FLUSH_MS = 50

export function useCodeAgentRuns(): {
  runs: CodeAgentRunUI[]
  hydrated: boolean
  stopAgent: (runId: string) => void
  setAuto: (runId: string, enabled: boolean) => void
  approveAgent: (runId: string, id: string, approved: boolean) => void
  terminalInput: (runId: string, input: string) => Promise<void>
  terminalResize: (runId: string, cols: number, rows: number) => Promise<void>
} {
  const [runs, setRuns] = useState<CodeAgentRunUI[]>([])
  const [hydrated, setHydrated] = useState(false)
  // Chunks not yet folded into `runs`, per run.
  const pendingOutput = useRef(new Map<string, string>())
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sync = useCallback((): void => {
    window.electronAPI.ai.codeAgent.status().then((s) => {
      // Main sends every chunk already in its log before answering, so what is
      // pending here is part of this snapshot.
      pendingOutput.current.clear()
      if (flushTimer.current) clearTimeout(flushTimer.current)
      flushTimer.current = null
      setRuns((prev) =>
        s.runs.map((r) => {
          // Status is the source of truth, so a remount cannot hide a parked approval.
          const existing = prev.find((p) => p.id === r.id)
          return {
            id: r.id,
            dir: r.dir,
            task: r.task,
            model: r.model ?? r.agent,
            harness: r.harness,
            worktreeDir: r.worktreeDir,
            localInstructions: r.localInstructions,
            localSkills: r.localSkills,
            sessionId: r.sessionId ?? r.convId ?? null,
            projectId: r.projectId ?? null,
            financialProfileId: r.financialProfileId,
            codeRoot: r.codeRoot,
            startedAt: r.startedAt,
            log: r.log,
            hint: r.hint,
            progress: r.progress ?? null,
            autoApprove: r.autoApprove ?? false,
            allowedWritePaths: r.allowedWritePaths,
            readOnlyRoots: r.readOnlyRoots,
            interactive: r.interactive === true,
            terminalCols: r.terminalCols,
            terminalRows: r.terminalRows,
            questions: r.questions ?? existing?.questions ?? [],
            approvals: r.approvals ?? existing?.approvals ?? []
          }
        })
      )
      setHydrated(true)
    })
  }, [])

  useEffect(() => {
    // 1. Busca o estado inicial
    sync()

    // 2. Um novo agente iniciou
    const offStarted = window.electronAPI.ai.codeAgent.onStarted(() => {
      sync()
    })

    // 3. Output chegou — anexa ao log do run correspondente. Refazer o status a
    // cada chunk trazia todos os runs e todos os logs pelo IPC: cada terminal a
    // mais deixava os outros mais lentos.
    const pending = pendingOutput.current
    const flushOutput = (): void => {
      flushTimer.current = null
      const chunks = new Map(pending)
      pending.clear()
      setRuns((prev) =>
        prev.map((r) => {
          const chunk = chunks.get(r.id)
          return chunk ? { ...r, log: (r.log + chunk).slice(-MAX_AGENT_LOG) } : r
        })
      )
    }
    const offOutput = window.electronAPI.ai.codeAgent.onOutput(({ runId, chunk }) => {
      pending.set(runId, (pending.get(runId) ?? '') + chunk)
      flushTimer.current ??= setTimeout(flushOutput, OUTPUT_FLUSH_MS)
    })

    // 4. Progresso mudou
    const offProgress = window.electronAPI.ai.codeAgent.onProgress(() => {
      sync()
    })

    // 5. Agente terminou
    const offExit = window.electronAPI.ai.codeAgent.onExit(
      (_payload: { runId: string; code: number }) => {
        setRuns((prev) => prev.map((r) => (r.id === _payload.runId ? { ...r, approvals: [] } : r)))
        sync()
      }
    )

    // 6. Auto-approval toggled for a run
    const offAutoChanged = window.electronAPI.ai.codeAgent.onAutoChanged(
      (payload: { runId: string; autoApprove: boolean; resolvedApprovalIds?: string[] }) => {
        setRuns((prev) =>
          prev.map((r) =>
            r.id === payload.runId
              ? {
                  ...r,
                  autoApprove: payload.autoApprove,
                  approvals: (r.approvals ?? []).filter(
                    (a) => !payload.resolvedApprovalIds?.includes(a.id)
                  )
                }
              : r
          )
        )
      }
    )

    // 7. Approval request — the loop is paused waiting for the user
    const offApproveRequest = window.electronAPI.ai.codeAgent.onApproveRequest((req) => {
      setRuns((prev) =>
        prev.map((r) =>
          r.id === req.runId
            ? {
                ...r,
                approvals: [
                  ...(r.approvals ?? []).filter((a) => a.id !== req.id),
                  {
                    id: req.id,
                    name: req.name,
                    args: req.args,
                    resumo: req.resumo,
                    conteudo: req.conteudo,
                    comando: req.comando,
                    diff: req.diff,
                    diffTruncated: req.diffTruncated,
                    irreversivel: req.irreversivel
                  }
                ]
              }
            : r
        )
      )
    })

    // 8. Questions also appear on the run card, not only in the modal, so the
    // user can tell why that agent is paused when several are active.
    const offQuestion = window.electronAPI.ai.codeAgent.onQuestion((question) => {
      setRuns((prev) =>
        prev.map((run) =>
          run.id === question.runId
            ? {
                ...run,
                questions: [
                  ...run.questions.filter((pending) => pending.id !== question.id),
                  { id: question.id, question: question.question }
                ]
              }
            : run
        )
      )
    })

    // 9. Environment hint mid-run (sandbox blocked, etc.)
    const offHint = window.electronAPI.ai.codeAgent.onHint((hint) => {
      setRuns((prev) =>
        prev.map((r) =>
          r.id === hint.runId
            ? { ...r, hint: { title: hint.title, detail: hint.detail, command: hint.command } }
            : r
        )
      )
    })

    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current)
      flushTimer.current = null
      pending.clear()
      offStarted()
      offOutput()
      offProgress()
      offExit()
      offAutoChanged()
      offApproveRequest()
      offQuestion()
      offHint()
    }
  }, [sync])

  const stopAgent = useCallback((runId: string) => {
    window.electronAPI.ai.codeAgent.stop(runId)
  }, [])

  const setAuto = useCallback(
    (runId: string, enabled: boolean): void => {
      window.electronAPI.ai.codeAgent.setAuto(runId, enabled).then(() => {
        sync()
      })
    },
    [sync]
  )

  const approveAgent = useCallback((runId: string, id: string, approved: boolean): void => {
    window.electronAPI.ai.codeAgent.approve(id, approved)
    setRuns((prev) =>
      prev.map((r) =>
        r.id === runId ? { ...r, approvals: (r.approvals ?? []).filter((a) => a.id !== id) } : r
      )
    )
  }, [])

  const terminalInput = useCallback(async (runId: string, input: string): Promise<void> => {
    const result = await window.electronAPI.ai.codeAgent.terminalInput(runId, input)
    if (!result.success) throw new Error(result.error || 'Não foi possível enviar ao terminal.')
  }, [])
  const terminalResize = useCallback(
    async (runId: string, cols: number, rows: number): Promise<void> => {
      const result = await window.electronAPI.ai.codeAgent.terminalResize(runId, cols, rows)
      if (!result.success)
        throw new Error(result.error || 'Não foi possível redimensionar o terminal.')
    },
    []
  )

  return {
    runs,
    hydrated,
    stopAgent,
    setAuto,
    approveAgent,
    terminalInput,
    terminalResize
  }
}
