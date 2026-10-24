import { useState, useEffect, useCallback } from 'react'

/** Label for a tool call of the native code agent (legacy executor). */
function describeToolActivity(name: string, args: Record<string, unknown>): string {
  const str = (v: unknown): string => (typeof v === 'string' && v.trim() !== '' ? v : '')
  switch (name) {
    case 'listar_arquivos': {
      const sub = str(args.subpasta)
      return sub ? `Listando os arquivos em ${sub}` : 'Listando os arquivos do projeto'
    }
    case 'ler_arquivo': {
      const caminho = str(args.caminho)
      return caminho ? `Lendo ${caminho}` : 'Lendo um arquivo'
    }
    case 'buscar_no_codigo': {
      const termo = str(args.termo)
      return termo ? `Buscando "${termo}" no código` : 'Buscando no código'
    }
    case 'escrever_arquivo': {
      const caminho = str(args.caminho)
      return caminho ? `Escrevendo ${caminho}` : 'Escrevendo um arquivo'
    }
    case 'executar_comando': {
      const comando = str(args.comando)
      return comando ? `Executando ${comando}` : 'Executando um comando'
    }
    default:
      return name
  }
}

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
  /** Structured activity emitted for every tool call and result. */
  events: {
    id: string
    name: string
    detail: string
    phase: 'call' | 'result'
    at: number
  }[]
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

  const sync = useCallback((): void => {
    window.electronAPI.ai.codeAgent.status().then((s) => {
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
            events: existing?.events ?? [],
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
    const offStarted = window.electronAPI.ai.codeAgent.onStarted(
      () => {
        sync()
      }
    )

    // 3. Output chegou — atualiza o log do run correspondente
    const offOutput = window.electronAPI.ai.codeAgent.onOutput(
      () => {
        sync()
      }
    )

    // 4. Progresso mudou
    const offProgress = window.electronAPI.ai.codeAgent.onProgress(
      () => {
        sync()
      }
    )

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

    // 8. Tool events are more useful than raw output for a live UI: they tell
    // the user what the agent is doing even when the model emits no prose.
    const offToolEvent = window.electronAPI.ai.codeAgent.onToolEvent((event) => {
      const detail =
        event.phase === 'result'
          ? event.summary || 'Etapa concluída'
          : describeToolActivity(event.name, event.args ?? {})
      setRuns((prev) =>
        prev.map((run) =>
          run.id === event.runId
            ? {
                ...run,
                events: [
                  ...run.events.slice(-23),
                  {
                    id: `${event.name}-${event.phase}-${Date.now()}-${Math.random()}`,
                    name: event.name,
                    detail,
                    phase: event.phase,
                    at: Date.now()
                  }
                ]
              }
            : run
        )
      )
    })

    // 9. Questions also appear on the run card, not only in the modal, so the
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

    // 10. Environment hint mid-run (sandbox blocked, etc.)
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
      offStarted()
      offOutput()
      offProgress()
      offExit()
      offAutoChanged()
      offApproveRequest()
      offToolEvent()
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
