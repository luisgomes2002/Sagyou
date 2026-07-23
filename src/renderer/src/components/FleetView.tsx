import { useState, useEffect, useCallback } from 'react'
import { useAiRunStore, EMPTY_USAGE, type ChatMessage } from '../store/aiRun'
import { describeToolActivity } from '../ai/tools'
import type { Project } from '../types'

// ---------------------------------------------------------------------------
// Painel de Agentes (FleetView)
//
// Uma visão ao vivo de todos os chat-agents rodando agora, derivada do estado
// desingletonizado da run store (`running` + as coleções por convId). Sem
// polling: lê o store `aiRun`, que já atualiza a cada passo do loop.
//
// Por agente mostra: em qual projeto trabalha, o que está fazendo agora, o
// progresso (passo N/max), o gasto de tokens da run (entrada e saída) e se está
// parado esperando aprovação. Ações: abrir o chat daquele agente, e pará-lo.
// ---------------------------------------------------------------------------

/** Nome de um chat a partir da sua primeira mensagem do usuário. */
function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? 'Conversa'
  return firstUser.slice(0, 60) || 'Conversa'
}

/** Tokens compactos: 980 → "980", 4210 → "4.2k". */
function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

// ---------------------------------------------------------------------------
// Code-agent state (lives in main process, streamed via IPC)
// ---------------------------------------------------------------------------

interface CodeAgentRunUI {
  id: string
  dir: string
  task: string
  model: string
  startedAt: number
  log: string
  hint: { title: string; detail: string; command?: string } | null
  progress: {
    step: number
    maxSteps: number
    promptTokens: number
    completionTokens: number
  } | null
}

function useCodeAgentRuns(): { runs: CodeAgentRunUI[]; stopAgent: (runId: string) => void } {
  const [runs, setRuns] = useState<CodeAgentRunUI[]>([])

  useEffect(() => {
    // 1. Busca o estado inicial
    window.electronAPI.ai.codeAgent.status().then((s) => {
      setRuns(
        s.runs.map((r) => ({
          id: r.id,
          dir: r.dir,
          task: r.task,
          model: r.model ?? r.agent,
          startedAt: r.startedAt,
          log: r.log,
          hint: r.hint,
          progress: r.progress ?? null
        }))
      )
    })

    const sync = (): void => {
      window.electronAPI.ai.codeAgent.status().then((s) => {
        setRuns(
          s.runs.map((r) => ({
            id: r.id,
            dir: r.dir,
            task: r.task,
            model: r.model ?? r.agent,
            startedAt: r.startedAt,
            log: r.log,
            hint: r.hint,
            progress: r.progress ?? null
          }))
        )
      })
    }

    // 2. Um novo agente iniciou
    const offStarted = window.electronAPI.ai.codeAgent.onStarted(
      (_payload: { runId: string; dir: string }) => {
        sync()
      }
    )

    // 3. Output chegou — atualiza o log do run correspondente
    const offOutput = window.electronAPI.ai.codeAgent.onOutput(
      (_payload: { runId: string; chunk: string }) => {
        sync()
      }
    )

    // 4. Progresso mudou
    const offProgress = window.electronAPI.ai.codeAgent.onProgress(
      (_p: { runId: string; step: number; maxSteps: number; promptTokens: number; completionTokens: number }) => {
        sync()
      }
    )

    // 5. Agente terminou
    const offExit = window.electronAPI.ai.codeAgent.onExit(
      (_payload: { runId: string; code: number }) => {
        sync()
      }
    )

    return () => {
      offStarted()
      offOutput()
      offProgress()
      offExit()
    }
  }, [])

  const stopAgent = useCallback((runId: string) => {
    window.electronAPI.ai.codeAgent.stop(runId)
  }, [])

  return { runs, stopAgent }
}

export function FleetView({
  projects,
  onOpenChat
}: {
  projects: Project[]
  /** Troca o App para a view da IA depois de abrir a conversa do agente. */
  onOpenChat: () => void
}): React.JSX.Element {
  const running = useAiRunStore((s) => s.running)
  const runProjects = useAiRunStore((s) => s.runProjects)
  const runUsage = useAiRunStore((s) => s.runUsage)
  const streaming = useAiRunStore((s) => s.streaming)
  const streamingTools = useAiRunStore((s) => s.streamingTools)
  const messages = useAiRunStore((s) => s.messages)
  const conversationId = useAiRunStore((s) => s.conversationId)
  const parked = useAiRunStore((s) => s.parked)
  const pendingApprovals = useAiRunStore((s) => s.pendingApprovals)
  const usage = useAiRunStore((s) => s.usage)
  const openConversation = useAiRunStore((s) => s.openConversation)
  const abort = useAiRunStore((s) => s.abort)

  const { runs: codeRuns, stopAgent } = useCodeAgentRuns()

  // A running agent's transcript/usage is either the one on screen or parked.
  const messagesOf = (id: string): ChatMessage[] =>
    id === conversationId ? messages : (parked[id]?.messages ?? [])
  const usageOf = (id: string): { promptTokens: number; completionTokens: number } =>
    id === conversationId ? usage : (parked[id]?.usage ?? EMPTY_USAGE)

  /** What the agent is doing right now, best-effort from its live state. */
  const activityOf = (id: string): string => {
    const text = streaming[id]
    if (text && text.trim()) return 'Respondendo…'
    const tools = streamingTools[id] ?? []
    if (tools.length > 0) return tools.map((t) => describeToolActivity(t, {})).join(', ')
    const msgs = messagesOf(id)
    const inFlight = [...msgs].reverse().find((m) => m.role === 'status' && m.done === false)
    if (inFlight) return inFlight.content
    const lastStatus = [...msgs].reverse().find((m) => m.role === 'status')
    if (lastStatus) return lastStatus.content
    return 'Pensando…'
  }

  /** The last step badge the run reported (N/max), if any. */
  const progressOf = (id: string): { step: number; maxSteps: number } | null => {
    const withStep = [...messagesOf(id)]
      .reverse()
      .find((m) => m.role === 'status' && m.step !== undefined && m.maxSteps !== undefined)
    return withStep ? { step: withStep.step!, maxSteps: withStep.maxSteps! } : null
  }

  const openAgent = (id: string): void => {
    // The parked/on-screen copy is ahead of disk; openConversation takes the
    // live one. Then switch to the AI view to land on that agent's chat.
    openConversation({ id, messages: messagesOf(id), usage: usageOf(id) })
    onOpenChat()
  }

  // Chat agents (from the run store)
  const chatAgents = [...running]
  // Code agents (from main process)
  const codeAgents = codeRuns

  const agents = chatAgents.length + codeAgents.length

  /** Best-effort project name for a code-agent's working directory. */
  const codeAgentProject = (dir: string): string => {
    const match = projects.find((p) =>
      p.codePaths?.some((cp) => dir.includes(cp.path))
    )
    return match?.name ?? dir.split('/').pop() ?? 'Código'
  }

  return (
    <>
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#2a2d42] shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M 12 7v4" />
          <line x1="8" y1="16" x2="8" y2="16" />
          <line x1="16" y1="16" x2="16" y2="16" />
        </svg>
        <h1 className="text-base font-semibold text-[#e2e8f0]">Agentes</h1>
        <span className="text-xs text-[#8892a4]">
          {agents} {agents === 1 ? 'ativo' : 'ativos'}
          {chatAgents.length > 0 && codeAgents.length > 0 && (
            <> · {chatAgents.length} chat{chatAgents.length !== 1 ? 's' : ''} · {codeAgents.length} código</>
          )}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {chatAgents.length === 0 && codeAgents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-[#1e2235] flex items-center justify-center mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4a5068" strokeWidth="2">
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <circle cx="12" cy="5" r="2" />
                <path d="M12 7v4" />
              </svg>
            </div>
            <p className="text-[#e2e8f0] font-medium mb-1">Nenhum agente ativo</p>
            <p className="text-sm text-[#8892a4] max-w-sm">
              Comece uma conversa na aba <b>IA</b>. Vários agentes podem trabalhar ao mesmo tempo,
              inclusive no mesmo projeto — todos aparecem aqui.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {chatAgents.map((id) => {
              const projectName = projects.find((p) => p.id === runProjects[id])?.name ?? 'Global'
              const tokens = runUsage[id] ?? EMPTY_USAGE
              const progress = progressOf(id)
              const awaiting = pendingApprovals.some((p) => p.convId === id)
              return (
                <div
                  key={id}
                  className="flex flex-col rounded-xl bg-[#13151f] border border-[#2a2d42] p-4 gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#e2e8f0] truncate">
                        {deriveTitle(messagesOf(id))}
                      </p>
                      <p className="text-[11px] text-[#8892a4] truncate">
                        Projeto: <span className="text-[#a5b4fc]">{projectName}</span>
                      </p>
                    </div>
                    {progress && (
                      <span
                        title={`Passo ${progress.step} de ${progress.maxSteps}`}
                        className="shrink-0 px-1.5 py-[1px] rounded text-[10px] font-medium tabular-nums bg-[#1e2235] border border-[#2a2d42] text-[#8892a4]"
                      >
                        {progress.step}/{progress.maxSteps}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 min-w-0">
                    {awaiting ? (
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full bg-amber-400" />
                    ) : (
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full border-[1.5px] border-[#a5b4fc] border-t-transparent animate-spin" />
                    )}
                    <p className="text-xs text-[#8892a4] truncate">
                      {awaiting ? 'Aguardando sua aprovação…' : activityOf(id)}
                    </p>
                  </div>

                  {/* Gasto de tokens desta run: entrada e saída, como pedido. */}
                  <div className="flex items-center gap-3 text-[11px] tabular-nums">
                    <span className="text-[#8892a4]" title="tokens de entrada (prompt) desta execução">
                      ↑ {formatTokens(tokens.promptTokens)} entrada
                    </span>
                    <span className="text-[#8892a4]" title="tokens de saída (resposta) desta execução">
                      ↓ {formatTokens(tokens.completionTokens)} saída
                    </span>
                    <span className="text-[#6b7280]">
                      = {formatTokens(tokens.promptTokens + tokens.completionTokens)} total
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => openAgent(id)}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-[#1e2235] border border-[#2a2d42] text-xs text-[#e2e8f0] font-medium hover:bg-[#2a2d42] transition-colors"
                    >
                      Abrir chat
                    </button>
                    <button
                      onClick={() => abort(id)}
                      title="Parar este agente"
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                      </svg>
                      Parar
                    </button>
                  </div>
                </div>
              )
            })}

            {codeAgents.map((run) => {
              const projectName = codeAgentProject(run.dir)
              return (
                <div
                  key={run.id}
                  className="flex flex-col rounded-xl bg-[#13151f] border border-[#f97316]/30 p-4 gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#e2e8f0] truncate">
                        {run.task.slice(0, 60)}
                      </p>
                      <p className="text-[11px] text-[#8892a4] truncate">
                        Projeto: <span className="text-[#a5b4fc]">{projectName}</span>
                      </p>
                    </div>
                    {run.progress && (
                      <span
                        title={`Passo ${run.progress.step} de ${run.progress.maxSteps}`}
                        className="shrink-0 px-1.5 py-[1px] rounded text-[10px] font-medium tabular-nums bg-[#1e2235] border border-[#2a2d42] text-[#8892a4]"
                      >
                        {run.progress.step}/{run.progress.maxSteps}
                      </span>
                    )}
                  </div>

                  {/* Status line */}
                  <div className="flex items-center gap-2 min-w-0">
                    {run.hint ? (
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full bg-amber-400" />
                    ) : (
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full border-[1.5px] border-[#a5b4fc] border-t-transparent animate-spin" />
                    )}
                    <p className="text-xs text-[#8892a4] truncate">
                      {run.hint
                        ? `⚠️ ${run.hint.title}`
                        : `Agente de código · ${run.model || 'codex'}`}
                    </p>
                  </div>

                  {/* Log preview (last 3 lines) */}
                  {run.log && (
                    <div className="rounded-lg bg-black/40 p-2 max-h-16 overflow-hidden">
                      <pre className="text-[10px] text-[#6b7280] leading-relaxed whitespace-pre-wrap line-clamp-3 font-mono">
                        {run.log.split('\n').filter(Boolean).slice(-3).join('\n')}
                      </pre>
                    </div>
                  )}

                  {/* Tokens if available */}
                  {run.progress && (
                    <div className="flex items-center gap-3 text-[11px] tabular-nums">
                      <span className="text-[#8892a4]">↑ {run.progress.promptTokens.toLocaleString()} entrada</span>
                      <span className="text-[#8892a4]">↓ {run.progress.completionTokens.toLocaleString()} saída</span>
                    </div>
                  )}

                  {/* Actions row */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => onOpenChat()}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-[#1e2235] border border-[#2a2d42] text-xs text-[#e2e8f0] font-medium hover:bg-[#2a2d42] transition-colors"
                    >
                      Abrir IA
                    </button>
                    <button
                      onClick={() => stopAgent(run.id)}
                      title="Parar este agente de código"
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                      </svg>
                      Parar
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
