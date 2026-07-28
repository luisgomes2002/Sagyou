import { useState, useEffect, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useAiRunStore, EMPTY_USAGE, type ChatMessage } from '../store/aiRun'
import { describeToolActivity } from '../ai/tools'
import type { Project } from '../types'
import { CodeDiff, type CodeAgentDiff } from './CodeDiff'
import { AgentTerminal } from './AgentTerminal'
import type { AgentRunMeta } from './AgentRunPicker'
import { whenLabel } from './AgentRunPicker'

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

/** What the inline chat needs to know about the session it belongs to. */
interface ChatSession {
  id: string
  dir: string
  task: string
  agent: string
  /** convId that links multiple runs into one conversation. */
  sessionId: string
  /** Live runId while a continuation is running. Null when idle. */
  runId: string | null
}

// ---------------------------------------------------------------------------
// Code-agent state (lives in main process, streamed via IPC)
// ---------------------------------------------------------------------------

interface CodeAgentRunUI {
  id: string
  dir: string
  task: string
  model: string
  convId: string | null
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

function useCodeAgentRuns(): {
  runs: CodeAgentRunUI[]
  stopAgent: (runId: string) => void
  setAuto: (runId: string, enabled: boolean) => void
  approveAgent: (runId: string, id: string, approved: boolean) => void
} {
  const [runs, setRuns] = useState<CodeAgentRunUI[]>([])

  const sync = useCallback((): void => {
    window.electronAPI.ai.codeAgent.status().then((s) => {
      setRuns((prev) =>
        s.runs.map((r) => {
          // Preserve approvals state from the live UI — the status call doesn't
          // carry pending approvals (they live as IPC events, not in the summary).
          const existing = prev.find((p) => p.id === r.id)
          return {
            id: r.id,
            dir: r.dir,
            task: r.task,
            model: r.model ?? r.agent,
            convId: r.convId ?? null,
            startedAt: r.startedAt,
            log: r.log,
            hint: r.hint,
            progress: r.progress ?? null,
            autoApprove: r.autoApprove ?? false,
            approvals: existing?.approvals ?? []
          }
        })
      )
    })
  }, [])

  useEffect(() => {
    // 1. Busca o estado inicial
    sync()

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
        setRuns((prev) =>
          prev.map((r) =>
            r.id === _payload.runId ? { ...r, approvals: [] } : r
          )
        )
        sync()
      }
    )

    // 6. Auto-approval toggled for a run
    const offAutoChanged = window.electronAPI.ai.codeAgent.onAutoChanged(
      (payload: { runId: string; autoApprove: boolean }) => {
        setRuns((prev) =>
          prev.map((r) =>
            r.id === payload.runId ? { ...r, autoApprove: payload.autoApprove } : r
          )
        )
      }
    )

    // 7. Approval request — the loop is paused waiting for the user
    const offApproveRequest = window.electronAPI.ai.codeAgent.onApproveRequest(
      (req) => {
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
      }
    )

    // 8. Environment hint mid-run (sandbox blocked, etc.)
    const offHint = window.electronAPI.ai.codeAgent.onHint(
      (hint) => {
        setRuns((prev) =>
          prev.map((r) =>
            r.id === hint.runId
              ? { ...r, hint: { title: hint.title, detail: hint.detail, command: hint.command } }
              : r
          )
        )
      }
    )

    return () => {
      offStarted()
      offOutput()
      offProgress()
      offExit()
      offAutoChanged()
      offApproveRequest()
      offHint()
    }
  }, [sync])

  const stopAgent = useCallback((runId: string) => {
    window.electronAPI.ai.codeAgent.stop(runId)
  }, [])

  const setAuto = useCallback((runId: string, enabled: boolean): void => {
    window.electronAPI.ai.codeAgent.setAuto(runId, enabled).then(() => { sync() })
  }, [sync])

  const approveAgent = useCallback((runId: string, id: string, approved: boolean): void => {
    window.electronAPI.ai.codeAgent.approve(id, approved)
    setRuns((prev) =>
      prev.map((r) =>
        r.id === runId ? { ...r, approvals: (r.approvals ?? []).filter((a) => a.id !== id) } : r
      )
    )
  }, [])

  return { runs, stopAgent, setAuto, approveAgent }
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

  const { runs: codeRuns, stopAgent, setAuto } = useCodeAgentRuns()

  // ── Archived runs (finished code agents, last 24h) ──────────────────────────
  const [archivedRuns, setArchivedRuns] = useState<AgentRunMeta[]>([])
  const [runCache, setRunCache] = useState<Map<string, { log: string; diff: CodeAgentDiff }>>(new Map())
  // ── Active agent chat ────────────────────────────────────────────────────────
  const [chatSession, setChatSession] = useState<ChatSession | null>(null)
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'agent'; text: string; diff?: CodeAgentDiff; log?: string; runId?: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const chatSessionRef = useRef<ChatSession | null>(null)
  chatSessionRef.current = chatSession

  // Load archived runs on mount and when codeRuns changes (a run just finished).
  useEffect(() => {
    window.electronAPI.ai.codeAgent.runs().then((runs) => setArchivedRuns(runs.sort((a: AgentRunMeta, b: AgentRunMeta) => b.startedAt - a.startedAt)))
  }, [codeRuns.length])

  // When a run finishes and gets archived, auto-fetch its diff/log and append
  // to the conversation. Also link the session by convId so future runs with the
  // same convId accumulate in the same inline chat.
  useEffect(() => {
    const offArchived = window.electronAPI.ai.codeAgent.onArchived(
      async (payload) => {
        const session = chatSessionRef.current
        // If the archived run's convId matches the current session's sessionId,
        // accumulate its results. Also link the session by runId for backward compat.
        const matchesSession =
          session &&
          (payload.runId === session.runId ||
            (payload.convId && payload.convId === session.sessionId))
        if (!matchesSession) return
        try {
          const snap = await window.electronAPI.ai.codeAgent.runGet(payload.id)
          if (snap) {
            const diff = (snap.diff as CodeAgentDiff) ?? { patch: '', files: [], truncated: false, omittedNewFiles: [] }
            const log = snap.log ?? ''
            setChatMessages((prev) => {
              // Don't duplicate if the last agent message already has this run's output.
              const last = prev[prev.length - 1]
              if (last && last.role === 'agent' && last.runId === payload.id) return prev
              return [
                ...prev,
                {
                  role: 'agent' as const,
                  text: snap.exitCode === 0 ? 'Agente concluiu.' : `Agente encerrou com código ${snap.exitCode}.`,
                  diff,
                  log,
                  runId: payload.id
                }
              ]
            })
            // Also add to runCache so the CodeDiff in the header can show it
            setRunCache((prev) => {
              const next = new Map(prev)
              next.set(payload.id, { log, diff })
              return next
            })
          }
        } catch {
          /* best-effort */
        }
        setChatSession((prev) => (prev ? { ...prev, runId: null } : null))
      }
    )
    return () => offArchived()
  }, [])

  // Auto-save the inline chat to the conversation so the history persists.
  // Converts FleetView's chatMessages format to the standard ChatMessage format,
  // keeping diff/log in the run archive (already persisted there).
  useEffect(() => {
    if (!chatSession || chatMessages.length === 0 || !chatSession.sessionId) return
    const timer = setTimeout(() => {
      const msgs = chatMessages.map((m) => ({
        role: m.role === 'user' ? 'user' as const : 'assistant' as const,
        content: m.text
      }))
      const title = chatSession.task.slice(0, 60) || 'Agente de código'
      window.electronAPI.ai.conversations
        .save({ id: chatSession.sessionId, title, messages: msgs, usage: undefined })
        .catch(() => {
          /* best-effort persistence */
        })
    }, 600)
    return () => clearTimeout(timer)
  }, [chatMessages, chatSession])

  const toggleRun = useCallback(async (id: string): Promise<void> => {
    if (runCache.has(id)) {
      setRunCache((prev) => { const next = new Map(prev); next.delete(id); return next })
      return
    }
    const snap = await window.electronAPI.ai.codeAgent.runGet(id)
    if (!snap) return
    setRunCache((prev) => {
      const next = new Map(prev)
      next.set(id, {
        log: snap.log ?? '',
        diff: (snap.diff as CodeAgentDiff) ?? { patch: '', files: [], truncated: false, omittedNewFiles: [] }
      })
      return next
    })
  }, [runCache])

  /**
   * Load the full conversation history (chat messages + archived code-agent runs)
   * for a given convId, merging them into chatMessages in chronological order.
   * This keeps everything — user messages, agent results, diffs, logs — in one
   * consolidated inline chat, keyed by convId.
   */
  const loadChatSessionHistory = useCallback(
    async (convId: string): Promise<void> => {
      try {
        // 1. Chat conversation (text messages between user and agent)
        const conv = await window.electronAPI.ai.conversations.get(convId)
        const textMsgs: { role: 'user' | 'agent'; text: string; ts: number }[] = []
        if (conv) {
          let lastUser = ''
          for (const m of conv.messages) {
            if (m.role === 'user') {
              lastUser = m.content
            } else if (m.role === 'assistant' && lastUser) {
              textMsgs.push({ role: 'user', text: lastUser, ts: 0 })
              textMsgs.push({ role: 'agent', text: m.content, ts: 0 })
              lastUser = ''
            }
          }
          if (lastUser && !textMsgs.some((x) => x.text === lastUser)) {
            textMsgs.push({ role: 'user', text: lastUser, ts: 0 })
          }
        }

        // 2. Archived code-agent runs for this conversation
        const pastRuns = await window.electronAPI.ai.codeAgent.runs(convId)
        const runCacheNext = new Map<string, { log: string; diff: CodeAgentDiff }>()
        const agentMsgs: { role: 'agent'; text: string; diff?: CodeAgentDiff; log?: string; runId: string; ts: number }[] = []

        for (const r of pastRuns) {
          const snap = await window.electronAPI.ai.codeAgent.runGet(r.id)
          if (!snap) continue
          const diff = (snap.diff as CodeAgentDiff) ?? { patch: '', files: [], truncated: false, omittedNewFiles: [] }
          const log = snap.log ?? ''
          runCacheNext.set(r.id, { log, diff })
          agentMsgs.push({
            role: 'agent',
            text: snap.exitCode === 0 ? 'Agente concluiu.' : `Agente encerrou com código ${snap.exitCode}.`,
            diff,
            log,
            runId: r.id,
            ts: r.endedAt
          })
        }

        setRunCache((prev) => {
          const next = new Map(prev)
          for (const [k, v] of runCacheNext) next.set(k, v)
          return next
        })

        // 3. Merge: sort by timestamp, agent results go after their context
        agentMsgs.sort((a, b) => a.ts - b.ts)
        setChatMessages([...textMsgs, ...agentMsgs])
      } catch {
        /* history loading is best-effort; the inline chat still works without it */
      }
    },
    []
  )

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
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#3b3b3b] shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a080f0" strokeWidth="2">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M 12 7v4" />
          <line x1="8" y1="16" x2="8" y2="16" />
          <line x1="16" y1="16" x2="16" y2="16" />
        </svg>
        {chatSession ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button
              onClick={() => { setChatSession(null); setChatMessages([]) }}
              className="text-[11px] text-[#999999] hover:text-[#d4d4d4] shrink-0"
            >
              ← Agentes
            </button>
            <h1 className="text-base font-semibold text-[#d4d4d4] truncate">
              {chatSession.task.slice(0, 60)}
            </h1>
            <span className="text-xs text-[#999999] shrink-0">{chatSession.agent}</span>
          </div>
        ) : (
          <>
            <h1 className="text-base font-semibold text-[#d4d4d4]">Agentes</h1>
            <span className="text-xs text-[#999999]">
              {agents} {agents === 1 ? 'ativo' : 'ativos'}
              {chatAgents.length > 0 && codeAgents.length > 0 && (
                <> · {chatAgents.length} chat{chatAgents.length !== 1 ? 's' : ''} · {codeAgents.length} código</>
              )}
            </span>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
      {chatSession ? (
        <div className="flex flex-col h-full">
          {(() => {
            const data = runCache.get(chatSession.id)
            return (
              <div className="mb-4 p-3 rounded-xl bg-[#232323] border border-[#3b3b3b]">
                <p className="text-xs font-medium text-[#d4d4d4] mb-1">Tarefa original</p>
                <p className="text-[11px] text-[#999999] mb-2">{chatSession.task}</p>
                {data && <CodeDiff diff={data.diff} />}
              </div>
            )
          })()}
          <div className="flex-1 space-y-3 mb-3 overflow-y-auto">
            {chatMessages.map((m, i) => (
              <div key={i} className={`p-3 rounded-xl ${m.role === 'user' ? 'bg-[#3b3b3b] border border-[#3b3b3b] ml-8' : 'bg-[#232323] border border-[#3b3b3b] mr-8'}`}>
                <p className="text-xs text-[#d4d4d4] whitespace-pre-wrap">{m.text}</p>
                {m.diff && (
                  <div className="mt-2"><CodeDiff diff={m.diff} /></div>
                )}
                {m.log && (
                  <details className="group mt-2">
                    <summary className="text-[10px] text-[#7c3aed] cursor-pointer">Log</summary>
                    <div className="mt-1"><AgentTerminal log={m.log} running={false} /></div>
                  </details>
                )}
              </div>
            ))}
            {chatSending && (
              <div className="mr-8 p-3 rounded-xl bg-[#232323] border border-[#3b3b3b]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full border-[1.5px] border-[#a080f0] border-t-transparent animate-spin" />
                  <span className="text-xs text-[#999999]">Agente trabalhando…</span>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  const msg = chatInput.trim()
                  if (!msg || chatSending || !chatSession) return
                  setChatInput('')
                  setChatSending(true)
                  setChatMessages((prev) => [...prev, { role: 'user', text: msg }])
                  try {
                    const task = `(Continuação da tarefa anterior: "${chatSession.task}")\n\n${msg}`
                    const result = await window.electronAPI.ai.codeAgent.run({
                      path: chatSession.dir,
                      task,
                      files: undefined,
                      projectId: undefined,
                      convId: chatSession.sessionId
                    })
                    if (result.runId) {
                      setChatSession((prev) => (prev ? { ...prev, runId: result.runId ?? null } : prev))
                    }
                  } finally {
                    setChatSending(false)
                  }
                }
              }}
              placeholder="Digite uma mensagem para o agente de código…"
              disabled={chatSending}
              className="flex-1 px-3 py-2 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed] disabled:opacity-50"
            />
            <button
              onClick={async () => {
                const msg = chatInput.trim()
                if (!msg || chatSending || !chatSession) return
                setChatInput('')
                setChatSending(true)
                setChatMessages((prev) => [...prev, { role: 'user', text: msg }])
                try {
                  const task = `(Continuação da tarefa anterior: "${chatSession.task}")\n\n${msg}`
                  const result = await window.electronAPI.ai.codeAgent.run({
                    path: chatSession.dir,
                    task,
                    files: undefined,
                    projectId: undefined,
                    convId: chatSession.sessionId
                  })
                  if (result.runId) {
                    setChatSession((prev) => (prev ? { ...prev, runId: result.runId ?? null } : prev))
                  }
                } finally {
                  setChatSending(false)
                }
              }}
              disabled={chatSending}
              className="px-4 py-2 rounded-lg bg-[#7c3aed] text-sm text-white font-medium hover:bg-[#6d28d9] disabled:opacity-40 transition-colors shrink-0"
            >
              {chatSending ? '…' : 'Enviar'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {chatAgents.length === 0 && codeAgents.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-[#2a2a2a] flex items-center justify-center mb-3">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#666666" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <circle cx="12" cy="5" r="2" />
                  <path d="M 12 7v4" />
                </svg>
              </div>
              <p className="text-[#d4d4d4] font-medium mb-1">Nenhum agente ativo</p>
              <p className="text-sm text-[#999999] max-w-sm">
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
                  className="flex flex-col rounded-xl bg-[#232323] border border-[#3b3b3b] p-4 gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#d4d4d4] truncate">
                        {deriveTitle(messagesOf(id))}
                      </p>
                      <p className="text-[11px] text-[#999999] truncate">
                        Projeto: <span className="text-[#a080f0]">{projectName}</span>
                      </p>
                    </div>
                    {progress && (
                      <span
                        title={`Passo ${progress.step} de ${progress.maxSteps}`}
                        className="shrink-0 px-1.5 py-[1px] rounded text-[10px] font-medium tabular-nums bg-[#2a2a2a] border border-[#3b3b3b] text-[#999999]"
                      >
                        {progress.step}/{progress.maxSteps}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 min-w-0">
                    {awaiting ? (
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full bg-[#f0b820]" />
                    ) : (
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full border-[1.5px] border-[#a080f0] border-t-transparent animate-spin" />
                    )}
                    <p className="text-xs text-[#999999] truncate">
                      {awaiting ? 'Aguardando sua aprovação…' : activityOf(id)}
                    </p>
                  </div>

                  {/* Gasto de tokens desta run: entrada e saída, como pedido. */}
                  <div className="flex items-center gap-3 text-[11px] tabular-nums">
                    <span className="text-[#999999]" title="tokens de entrada (prompt) desta execução">
                      ↑ {formatTokens(tokens.promptTokens)} entrada
                    </span>
                    <span className="text-[#999999]" title="tokens de saída (resposta) desta execução">
                      ↓ {formatTokens(tokens.completionTokens)} saída
                    </span>
                    <span className="text-[#999999]">
                      = {formatTokens(tokens.promptTokens + tokens.completionTokens)} total
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => openAgent(id)}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] text-xs text-[#d4d4d4] font-medium hover:bg-[#3b3b3b] transition-colors"
                    >
                      Abrir chat
                    </button>
                    <button
                      onClick={() => abort(id)}
                      title="Parar este agente"
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e04040]/30 text-xs text-[#e04040] hover:bg-[#e04040]/10 transition-colors"
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
              const hasApproval = run.approvals.length > 0
              const hasHint = run.hint !== null
              return (
                <div
                  key={run.id}
                  className="flex flex-col rounded-xl bg-[#232323] border border-[#f06c10]/30 p-4 gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#d4d4d4] truncate">
                        {run.task.slice(0, 60)}
                      </p>
                      <p className="text-[11px] text-[#999999] truncate">
                        Projeto: <span className="text-[#a080f0]">{projectName}</span>
                      </p>
                    </div>
                    {run.progress && (
                      <span
                        title={`Passo ${run.progress.step} de ${run.progress.maxSteps}`}
                        className="shrink-0 px-1.5 py-[1px] rounded text-[10px] font-medium tabular-nums bg-[#2a2a2a] border border-[#3b3b3b] text-[#999999]"
                      >
                        {run.progress.step}/{run.progress.maxSteps}
                      </span>
                    )}
                  </div>

                  {/* Status line with detailed step info */}
                  <div className="flex items-center gap-2 min-w-0">
                    {hasApproval ? (
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full bg-[#f0b820] animate-pulse" title="Aguardando aprovação" />
                    ) : hasHint ? (
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full bg-[#f0b820]" title={run.hint!.detail} />
                    ) : run.progress ? (
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full border-[1.5px] border-[#a080f0] border-t-transparent animate-spin" title={`Passo ${run.progress.step}/${run.progress.maxSteps}`} />
                    ) : (
                      <span className="w-2.5 h-2.5 shrink-0 rounded-full border-[1.5px] border-[#a080f0] border-t-transparent animate-spin" title="Iniciando…" />
                    )}
                    <p className="text-xs text-[#999999] truncate flex items-center gap-1.5">
                      {run.autoApprove && (
                        <span className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium bg-[#f0b820]/15 text-[#f0b820] shrink-0">
                          Auto
                        </span>
                      )}
                      {hasApproval ? (
                        <span className="text-[#f0b820] font-medium">
                          Aguardando sua aprovação ({run.approvals.length})
                        </span>
                      ) : hasHint ? (
                        <span className="text-[#f0b820]">{run.hint!.title}</span>
                      ) : run.progress ? (
                        <span className="text-[#a080f0]">
                          {run.model || 'codex'} · passo {run.progress.step}/{run.progress.maxSteps}
                          {run.progress.promptTokens + run.progress.completionTokens > 0 && (
                            <span className="text-[#999999] ml-1">
                              · {(run.progress.promptTokens + run.progress.completionTokens).toLocaleString()} tok
                            </span>
                          )}
                        </span>
                      ) : (
                        <span>Iniciando…</span>
                      )}
                    </p>
                  </div>

                  {/* Log preview (last 3 lines) */}
                  {run.log && (
                    <div className="rounded-lg bg-black/40 p-2 max-h-16 overflow-hidden">
                      <pre className="text-[10px] text-[#999999] leading-relaxed whitespace-pre-wrap line-clamp-3 font-mono">
                        {run.log.split('\n').filter(Boolean).slice(-3).join('\n')}
                      </pre>
                    </div>
                  )}

                  {/* Tokens if available */}
                  {run.progress && (
                    <div className="flex items-center gap-3 text-[11px] tabular-nums">
                      <span className="text-[#999999]">↑ {run.progress.promptTokens.toLocaleString()} entrada</span>
                      <span className="text-[#999999]">↓ {run.progress.completionTokens.toLocaleString()} saída</span>
                    </div>
                  )}

                  {/* Actions row */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => {
                        void (async () => {
                          const sid = run.convId || uuidv4()
                          setChatSession({
                            id: run.id,
                            dir: run.dir,
                            task: run.task,
                            agent: run.model || 'codex',
                            sessionId: sid,
                            runId: run.id
                          })
                          setChatMessages([])
                          setChatInput('')
                          setChatSending(false)
                          // Load past context if this is a real convId
                          if (run.convId) {
                            await loadChatSessionHistory(sid)
                          }
                        })()
                      }}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] text-xs text-[#d4d4d4] font-medium hover:bg-[#3b3b3b] transition-colors"
                    >
                      Abrir chat
                    </button>
                    <button
                      onClick={() => setAuto(run.id, !run.autoApprove)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        run.autoApprove
                          ? 'bg-[#f0b820]/15 border-[#f0b820]/40 text-[#f0b820]'
                          : 'bg-[#2a2a2a] border-[#3b3b3b] text-[#999999] hover:text-[#d4d4d4]'
                      }`}
                    >
                      Auto {run.autoApprove ? 'Sim' : ''}
                    </button>
                    <button
                      onClick={() => stopAgent(run.id)}
                      title="Parar este agente de código"
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e04040]/30 text-xs text-[#e04040] hover:bg-[#e04040]/10 transition-colors"
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

            {/* ── Archived runs (finished agents) ───────────────────────────── */}
            {archivedRuns.length > 0 && (
              <div className="mt-6 pt-4 border-t border-[#3b3b3b]">
                <h2 className="text-xs font-medium text-[#999999] mb-3 px-1">
                  Execuções anteriores (últimas 24h)
                </h2>
                <div className="space-y-2">
                  {archivedRuns.slice(0, 10).map((run) => (
                    <div
                      key={run.id}
                      className={`rounded-xl border p-3 transition-colors ${
                        runCache.has(run.id)
                          ? 'bg-[#3b3b3b] border-[#7c3aed]'
                          : 'bg-[#232323] border-[#3b3b3b] hover:border-[#555555]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                run.exitCode === 0 ? 'bg-[#46d478]' : 'bg-[#e04040]'
                              }`}
                            />
                            <p className="text-xs font-medium text-[#d4d4d4] truncate">
                              {run.task.slice(0, 80)}
                            </p>
                          </div>
                          <p className="text-[10px] text-[#999999] mt-1">
                            {run.agent} · {run.fileCount} {run.fileCount === 1 ? 'arquivo' : 'arquivos'}
                            {run.tokens && ` · ${((run.tokens.promptTokens + run.tokens.completionTokens) / 1000).toFixed(0)}k tok`}
                            {run.endedAt && ` · ${whenLabel(run.endedAt)}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={async () => {
                          await window.electronAPI.ai.codeAgent.runRenew(run.id)
                          const sid = run.convId || uuidv4()
                          setChatSession({
                            id: run.id,
                            dir: run.dir,
                            task: run.task,
                            agent: run.agent,
                            sessionId: sid,
                            runId: null
                          })
                          setChatMessages([])
                          setChatInput('')
                          setChatSending(false)
                          // Load past context if this is a real convId
                          if (run.convId) {
                            await loadChatSessionHistory(sid)
                          }
                        }}
                        title="Continuar conversando com este agente"
                            className="px-2.5 py-1.5 rounded-lg bg-[#7c3aed]/20 border border-[#7c3aed]/40 text-[10px] text-[#a080f0] font-medium hover:bg-[#7c3aed]/30 transition-colors"
                          >
                            Continuar
                          </button>
                          <button
                            onClick={() => toggleRun(run.id)}
                            title={runCache.has(run.id) ? 'Fechar detalhes' : 'Ver diff e log'}
                            className="px-2.5 py-1.5 rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] text-[10px] text-[#d4d4d4] hover:bg-[#7c3aed] hover:border-[#7c3aed] transition-colors"
                          >
                            {runCache.has(run.id) ? 'Fechar' : 'Detalhes'}
                          </button>
                        </div>
                      </div>

                      {(() => {
                        const data = runCache.get(run.id)
                        if (!data) return null
                        return (
                          <div className="mt-3 space-y-3">
                            <CodeDiff diff={data.diff} />
                            <details className="group">
                              <summary className="text-[10px] text-[#7c3aed] cursor-pointer hover:text-[#a080f0] select-none">
                                Log completo ({data.log.split('\n').length} linhas)
                              </summary>
                              <div className="mt-2">
                                <AgentTerminal log={data.log} running={false} />
                              </div>
                            </details>
                          </div>
                        )
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
