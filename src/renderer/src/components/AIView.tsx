import { useState, useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useKanbanStore } from '../store/kanban'
import { PRIORITY_CONFIG, AI_TASK_PROMPT_TEMPLATE } from '../types'
import type { AITaskInput, Priority, Project } from '../types'
import { describeToolCall } from '../ai/tools'
import { runAgent, callModel, type AIConfig, type PendingCall } from '../ai/agent'
import { ChatMarkdown } from './ChatMarkdown'
import { ConfirmDialog } from './ConfirmDialog'

// Config is persisted via ai:config in the main process (see effects below);
// AIConfig and the tool-calling loop live in ../ai/agent.
const DEFAULT_CONFIG: AIConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini'
}

// The visible chat transcript (user prompts + assistant answers). The
// tool-calling loop and wire types (ApiMessage) live in ../ai/agent.
//
// 'status' is a display-only trace of the agent's intermediate work ("Lendo
// src/App.tsx"). It's kept in the transcript and persisted, but it is NOT a
// chat turn: `toApiMessages` strips it before anything goes to the model.
interface ChatMessage {
  role: 'user' | 'assistant' | 'status'
  content: string
}

/** The transcript as the model should see it — status lines are not turns. */
function toApiMessages(messages: ChatMessage[]): { role: 'user' | 'assistant'; content: string }[] {
  return messages.filter(
    (m): m is { role: 'user' | 'assistant'; content: string } => m.role !== 'status'
  )
}

/**
 * List the models the provider exposes (GET /models), proxied through the main
 * process so the dropdown doesn't hit CORS on hosted providers.
 */
async function fetchModels(cfg: AIConfig): Promise<string[]> {
  const res = await window.electronAPI.ai.models({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey })
  if (!res.success || !res.models) {
    throw new Error(res.error || 'Falha ao carregar modelos')
  }
  return res.models
}

/** Extract the first balanced JSON object from arbitrary model text. */
function extractTasks(text: string): AITaskInput[] {
  const start = text.indexOf('{')
  if (start === -1) throw new Error('Nenhum JSON encontrado na resposta')

  let depth = 0
  let inStr = false
  let escaped = false
  let end = -1
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) throw new Error('JSON incompleto na resposta')

  const parsed = JSON.parse(text.slice(start, end + 1))
  if (!parsed || !Array.isArray(parsed.tasks)) throw new Error('JSON sem a lista "tasks"')
  return parsed.tasks.filter(
    (t: unknown): t is AITaskInput =>
      !!t && typeof (t as AITaskInput).title === 'string' && (t as AITaskInput).title.trim() !== ''
  )
}

/**
 * A step of the agent's work, rendered as quiet inline text instead of a chat
 * bubble — it's a trace of what happened, not something that was said.
 */
function StatusLine({ text, live = false }: { text: string; live?: boolean }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 px-1 text-[#8892a4]">
      <span
        className={`mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 ${
          live ? 'bg-[#a5b4fc] animate-pulse' : 'bg-[#3a3e58]'
        }`}
      />
      <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">{text}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AIView({ projects }: { projects: Project[] }) {
  const activeProjectId = useKanbanStore((s) => s.activeProjectId)
  const importTasksFromAIChat = useKanbanStore((s) => s.importTasksFromAIChat)

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  const [config, setConfig] = useState<AIConfig>(DEFAULT_CONFIG)
  const [showConfig, setShowConfig] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Text of the answer being typed out right now (empty until the first chunk).
  const [streaming, setStreaming] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Confirmation modal state (Gerar Tasks)
  const [proposed, setProposed] = useState<AITaskInput[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // Approval modal state (agent write actions)
  const [pendingApproval, setPendingApproval] = useState<{
    writes: PendingCall[]
    selected: Set<string>
  } | null>(null)
  const approvalResolver = useRef<((ids: Set<string>) => void) | null>(null)

  // Auto-approve mode: when on, write actions run without the modal (the agent
  // chains actions autonomously). Off by default; resets when the view remounts.
  const [autoApprove, setAutoApprove] = useState(false)
  const autoApproveRef = useRef(false)
  const abortRef = useRef(false)
  const setAuto = (v: boolean): void => {
    autoApproveRef.current = v
    setAutoApprove(v)
  }

  // External code-agent output (streamed from the main process)
  const [agentLog, setAgentLog] = useState('')
  const [agentRunning, setAgentRunning] = useState(false)

  // Persisted conversation history
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<
    { id: string; title: string; updatedAt: string }[]
  >([])
  const [showHistory, setShowHistory] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  // Guards the persist effect so we don't overwrite the stored config with the
  // defaults before the initial async load has completed.
  const configLoaded = useRef(false)
  const configReady = config.baseUrl.trim() !== '' && config.model.trim() !== ''

  // Load the persisted config from the main process once on mount.
  useEffect(() => {
    let cancelled = false
    window.electronAPI.ai.config
      .get()
      .then((stored) => {
        if (cancelled) return
        // Empty fields (first run, no ai-config.json) fall back to the defaults.
        setConfig({
          baseUrl: stored.baseUrl || DEFAULT_CONFIG.baseUrl,
          apiKey: stored.apiKey || DEFAULT_CONFIG.apiKey,
          model: stored.model || DEFAULT_CONFIG.model
        })
      })
      .finally(() => {
        if (!cancelled) configLoaded.current = true
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Persist config whenever it changes (after the initial load).
  useEffect(() => {
    if (!configLoaded.current) return
    window.electronAPI.ai.config.set(config).catch(() => {
      /* persistence failure is non-fatal */
    })
  }, [config])

  // Keep the chat scrolled to the latest message. While an answer streams in
  // this fires on every chunk, so only follow along when the user is already at
  // the bottom — otherwise scrolling up to re-read would be yanked back down.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (atBottom) el.scrollTo({ top: el.scrollHeight })
  }, [messages, busy, streaming])

  // Stream the external code agent's output into the panel.
  useEffect(() => {
    const offOutput = window.electronAPI.ai.codeAgent.onOutput((chunk) => {
      setAgentRunning(true)
      setAgentLog((l) => (l + chunk).slice(-8000)) // cap to keep the panel light
    })
    const offExit = window.electronAPI.ai.codeAgent.onExit((code) => {
      setAgentRunning(false)
      setAgentLog((l) => l + `\n[agente encerrado — código ${code}]\n`)
    })
    return () => {
      offOutput()
      offExit()
    }
  }, [])

  const refreshConversations = (): void => {
    window.electronAPI.ai.conversations.list().then(setConversations)
  }

  // Load the conversation list on mount.
  useEffect(() => {
    refreshConversations()
  }, [])

  // Auto-save the current conversation whenever it changes (debounced). The id
  // is minted on the first message; the title is the first user message.
  useEffect(() => {
    if (messages.length === 0) return
    const id = conversationId ?? uuidv4()
    if (!conversationId) setConversationId(id)
    const firstUser = messages.find((m) => m.role === 'user')?.content ?? 'Conversa'
    const title = firstUser.slice(0, 60)
    const timer = setTimeout(() => {
      window.electronAPI.ai.conversations.save({ id, title, messages }).then(refreshConversations)
    }, 600)
    return () => clearTimeout(timer)
  }, [messages, conversationId])

  const handleNewConversation = (): void => {
    setMessages([])
    setConversationId(null)
    setError(null)
    setProposed(null)
    setShowHistory(false)
  }

  const handleLoadConversation = async (id: string): Promise<void> => {
    const conv = await window.electronAPI.ai.conversations.get(id)
    if (conv) {
      setMessages(conv.messages)
      setConversationId(conv.id)
      setError(null)
      setProposed(null)
    }
    setShowHistory(false)
  }

  const handleDeleteConversation = (id: string, title: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    setShowHistory(false)
    setConfirmDelete({ id, title })
  }

  const confirmDeleteConversation = async (): Promise<void> => {
    if (!confirmDelete) return
    const { id } = confirmDelete
    await window.electronAPI.ai.conversations.delete(id)
    if (id === conversationId) handleNewConversation()
    setConfirmDelete(null)
    refreshConversations()
  }

  const handleLoadModels = async () => {
    if (loadingModels || config.baseUrl.trim() === '') return
    setLoadingModels(true)
    setModelsError(null)
    try {
      const list = await fetchModels(config)
      setModels(list)
      if (list.length > 0 && !list.includes(config.model)) {
        setConfig((c) => ({ ...c, model: list[0] }))
      }
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Falha ao carregar modelos')
    } finally {
      setLoadingModels(false)
    }
  }

  // Auto-load the model list the first time the config panel is opened
  useEffect(() => {
    if (showConfig && models.length === 0 && config.baseUrl.trim() !== '') handleLoadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showConfig])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setError(null)
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setBusy(true)
    setStreaming('')
    abortRef.current = false
    try {
      // Status lines land in the transcript as they happen, so append to the
      // latest state rather than to the `next` snapshot taken above.
      const reply = await runAgent(config, toApiMessages(next), requestApproval, {
        maxSteps: autoApproveRef.current ? 40 : 6,
        shouldAbort: () => abortRef.current,
        onStream: setStreaming,
        onStatus: (text) => setMessages((prev) => [...prev, { role: 'status', content: text }])
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao contatar o modelo')
    } finally {
      setStreaming('')
      setBusy(false)
    }
  }

  // Shows the approval card and resolves when the user decides (agent loop awaits
  // this). In auto mode it resolves immediately, approving every write action.
  const requestApproval = (writes: PendingCall[]): Promise<Set<string>> => {
    if (autoApproveRef.current) {
      return Promise.resolve(new Set(writes.map((w) => w.id)))
    }
    return new Promise((resolve) => {
      approvalResolver.current = resolve
      setPendingApproval({ writes, selected: new Set(writes.map((w) => w.id)) })
    })
  }

  const resolveApproval = (ids: Set<string>): void => {
    approvalResolver.current?.(ids)
    approvalResolver.current = null
    setPendingApproval(null)
  }

  const toggleApproval = (id: string): void => {
    setPendingApproval((prev) => {
      if (!prev) return prev
      const next = new Set(prev.selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...prev, selected: next }
    })
  }

  const handleGenerate = async () => {
    if (busy) return
    const description = input.trim()
    if (messages.length === 0 && !description) {
      setError('Descreva o projeto no chat antes de gerar tasks')
      return
    }
    setError(null)
    setInput('')
    // Show a compact marker in the chat; send the full template behind it.
    const marker: ChatMessage = {
      role: 'user',
      content: 'Gerar tasks' + (description ? `: ${description}` : ' a partir da conversa')
    }
    const sent = [
      ...toApiMessages(messages),
      {
        role: 'user' as const,
        content:
          AI_TASK_PROMPT_TEMPLATE +
          '\n\nDescrição do projeto:\n' +
          (description || '(use a conversa acima como descrição)')
      }
    ]
    setMessages([...messages, marker])
    setBusy(true)
    try {
      const reply = (await callModel(config, sent)).content ?? ''
      const tasks = extractTasks(reply)
      if (tasks.length === 0) {
        setError('O modelo não retornou nenhuma task válida')
        setMessages([...messages, marker, { role: 'assistant', content: reply }])
        return
      }
      setMessages([
        ...messages,
        marker,
        {
          role: 'assistant',
          content: `Gerei ${tasks.length} task(s). Revise e confirme quais criar.`
        }
      ])
      setProposed(tasks)
      setSelected(new Set(tasks.map((_, i) => i)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gerar tasks')
    } finally {
      setBusy(false)
    }
  }

  const toggleSelected = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const [createdCount, setCreatedCount] = useState<number | null>(null)

  const handleConfirmCreate = () => {
    if (!proposed || !activeProject) return
    const selectedTasks = proposed.filter((_, i) => selected.has(i))
    const count = importTasksFromAIChat(activeProject.id, selectedTasks)
    setProposed(null)
    setSelected(new Set())
    setCreatedCount(count)
    setTimeout(() => setCreatedCount(null), 4000)
  }

  const field = (label: string, key: keyof AIConfig, type = 'text', placeholder = '') => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-[#8892a4]">{label}</span>
      <input
        type={type}
        value={config[key]}
        placeholder={placeholder}
        onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))}
        className="px-2.5 py-1.5 rounded-md bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] placeholder:text-[#4a5068] focus:outline-none focus:border-[#6366f1]"
      />
    </label>
  )

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d42] shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-[#e2e8f0]">Assistente IA</h1>
            <span className="text-xs text-[#8892a4]">
              {activeProject ? activeProject.name : 'Nenhum projeto selecionado'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAuto(!autoApprove)}
              title={
                autoApprove
                  ? 'Modo automático LIGADO — ações rodam sem aprovação. Clique para exigir aprovação.'
                  : 'Aprovar cada ação. Clique para ligar o modo automático (roda sem perguntar).'
              }
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                autoApprove
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
              }`}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M13 2 3 14h9l-1 8 10-12h-9z" />
              </svg>
              {autoApprove ? 'Auto: ON' : 'Auto'}
            </button>

            <button
              onClick={handleNewConversation}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Nova
            </button>

            <div className="relative">
              <button
                onClick={() => setShowHistory((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  showHistory
                    ? 'bg-[#6366f1]/20 text-[#a5b4fc]'
                    : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
                }`}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 3v5h5" />
                  <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
                  <path d="M12 7v5l4 2" />
                </svg>
                Histórico
              </button>

              {showHistory && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowHistory(false)} />
                  <div className="absolute right-0 top-full mt-1 z-40 w-72 max-h-80 overflow-y-auto rounded-lg border border-[#2a2d42] bg-[#0d0f18] shadow-2xl py-1">
                    {conversations.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-[#4a5068] italic text-center">
                        Nenhuma conversa salva
                      </p>
                    ) : (
                      conversations.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => handleLoadConversation(c.id)}
                          className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                            c.id === conversationId ? 'bg-[#6366f1]/10' : 'hover:bg-[#1e2235]'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-[#e2e8f0] truncate">{c.title}</p>
                            <p className="text-[10px] text-[#4a5068]">
                              {new Date(c.updatedAt).toLocaleString('pt-BR')}
                            </p>
                          </div>
                          <button
                            onClick={(e) => handleDeleteConversation(c.id, c.title, e)}
                            title="Apagar conversa"
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-[#8892a4] hover:text-red-400 shrink-0"
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            </svg>
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => setShowConfig((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showConfig
                  ? 'bg-[#6366f1]/20 text-[#a5b4fc]'
                  : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
              }`}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Configuração
            </button>
          </div>
        </div>

        {/* Config panel */}
        {showConfig && (
          <div className="px-6 py-4 border-b border-[#2a2d42] bg-[#13151f] shrink-0">
            <div className="grid grid-cols-3 gap-3">
              {field('Base URL', 'baseUrl', 'text', 'https://api.openai.com/v1')}
              {field('API Key', 'apiKey', 'password', 'sk-...')}
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[#8892a4]">Model</span>
                <div className="flex gap-1.5">
                  <select
                    value={config.model}
                    onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] focus:outline-none focus:border-[#6366f1]"
                  >
                    {models.length === 0 && (
                      <option value={config.model}>{config.model || 'Carregue os modelos…'}</option>
                    )}
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleLoadModels}
                    disabled={loadingModels || config.baseUrl.trim() === ''}
                    title="Carregar modelos do endpoint"
                    className="shrink-0 px-2 py-1.5 rounded-md bg-[#1e2235] border border-[#2a2d42] text-[#8892a4] hover:text-[#e2e8f0] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {loadingModels ? (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-[#6366f1] border-t-transparent animate-spin" />
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="23 4 23 10 17 10" />
                        <polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                    )}
                  </button>
                </div>
              </label>
            </div>
            {modelsError ? (
              <p className="mt-2 text-[11px] text-red-400">Modelos: {modelsError}</p>
            ) : (
              <p className="mt-2 text-[11px] text-[#4a5068]">
                Endpoint compatível com OpenAI (<code>/chat/completions</code>). Os modelos vêm de{' '}
                <code>/models</code> — clique em atualizar para listar. A chave é salva localmente
                neste dispositivo.
              </p>
            )}
          </div>
        )}

        {/* Chat */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div>
                <p className="text-[#e2e8f0] font-medium mb-1">Converse com o modelo</p>
                <p className="text-sm text-[#8892a4]">
                  Descreva o projeto e use <b>Gerar Tasks</b> para criar tarefas.
                </p>
              </div>
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === 'status' ? (
                // The last one, while the agent is still working, is the step
                // happening right now.
                <StatusLine key={i} text={m.content} live={busy && i === messages.length - 1} />
              ) : (
                <div
                  key={i}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`px-3.5 py-2 rounded-2xl text-sm break-words ${
                      m.role === 'user'
                        ? 'max-w-[75%] whitespace-pre-wrap bg-[#6366f1] text-white rounded-br-sm'
                        : 'max-w-[88%] bg-[#1e2235] text-[#e2e8f0] border border-[#2a2d42] rounded-bl-sm'
                    }`}
                  >
                    {m.role === 'user' ? m.content : <ChatMarkdown content={m.content} />}
                  </div>
                </div>
              )
            )
          )}
          {busy && (
            <div className="flex flex-col items-start gap-1.5">
              {streaming ? (
                // The answer typing itself out — same bubble as a finished
                // message, with a caret trailing the text.
                <div className="max-w-[88%] px-3.5 py-2 rounded-2xl rounded-bl-sm text-sm break-words bg-[#1e2235] text-[#e2e8f0] border border-[#2a2d42]">
                  <ChatMarkdown content={streaming} />
                  <span className="inline-block w-[2px] h-3.5 ml-0.5 align-[-1px] bg-[#a5b4fc] animate-pulse" />
                </div>
              ) : (
                // Nothing streamed yet (still connecting, or running tools).
                <div className="px-3.5 py-2 rounded-2xl bg-[#1e2235] border border-[#2a2d42]">
                  <div className="w-4 h-4 rounded-full border-2 border-[#6366f1] border-t-transparent animate-spin" />
                </div>
              )}
              {/* Icon-only stop, as in Claude/ChatGPT: the square reads as
                  "stop" on its own, so the label is left to the tooltip. */}
              <button
                onClick={() => {
                  abortRef.current = true
                }}
                title="Parar"
                aria-label="Parar"
                className="flex items-center justify-center w-7 h-7 rounded-full bg-[#1e2235] border border-[#2a2d42] text-[#8892a4] hover:text-[#e2e8f0] hover:border-[#3a3e58] transition-colors"
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Banners */}
        {createdCount !== null && (
          <div className="px-6 py-2 text-xs text-[#4ade80] bg-[#22c55e]/10 border-t border-[#22c55e]/20 shrink-0">
            {createdCount} task{createdCount === 1 ? '' : 's'} criada{createdCount === 1 ? '' : 's'}{' '}
            em {activeProject?.name}.
          </div>
        )}
        {error && (
          <div className="px-6 py-2 text-xs text-red-400 bg-red-400/10 border-t border-red-400/20 shrink-0">
            {error}
          </div>
        )}

        {/* External code agent output */}
        {agentLog && (
          <div className="border-t border-[#2a2d42] bg-[#0d0f18] shrink-0">
            <div className="flex items-center justify-between px-6 py-1.5">
              <span className="flex items-center gap-2 text-[11px] font-medium text-[#8892a4]">
                {agentRunning && (
                  <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
                )}
                Agente de código {agentRunning ? '(rodando)' : '(encerrado)'}
              </span>
              <div className="flex items-center gap-3">
                {agentRunning && (
                  <button
                    onClick={() => window.electronAPI.ai.codeAgent.stop()}
                    className="text-[11px] text-red-400 hover:text-red-300"
                  >
                    Parar
                  </button>
                )}
                <button
                  onClick={() => setAgentLog('')}
                  className="text-[11px] text-[#8892a4] hover:text-[#e2e8f0]"
                >
                  Limpar
                </button>
              </div>
            </div>
            <pre className="max-h-40 overflow-y-auto px-6 pb-2 text-[11px] leading-relaxed font-mono text-[#a5b4fc] whitespace-pre-wrap break-words">
              {agentLog}
            </pre>
          </div>
        )}

        {/* Composer */}
        <div className="px-6 py-3 border-t border-[#2a2d42] shrink-0">
          {!configReady && (
            <p className="mb-2 text-[11px] text-orange-400">
              Configure a Base URL e o Model antes de enviar.
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Descreva o projeto ou faça uma pergunta…"
              rows={2}
              disabled={!configReady || busy}
              className="flex-1 resize-none px-3 py-2 rounded-lg bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] placeholder:text-[#4a5068] focus:outline-none focus:border-[#6366f1] disabled:opacity-50"
            />
            <div className="flex flex-col gap-2">
              <button
                onClick={handleSend}
                disabled={!configReady || busy || input.trim() === ''}
                className="px-3 py-1.5 rounded-lg bg-[#1e2235] border border-[#2a2d42] text-sm text-[#e2e8f0] font-medium hover:bg-[#2a2d42] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Enviar
              </button>
              <button
                onClick={handleGenerate}
                disabled={!configReady || busy}
                title={
                  !activeProject
                    ? 'Você poderá revisar antes de criar; selecione um projeto para criar as tasks'
                    : undefined
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6366f1]/90 text-sm text-white font-medium hover:bg-[#6366f1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Gerar Tasks
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      {proposed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setProposed(null)}
        >
          <div
            className="w-[560px] max-h-[80vh] flex flex-col rounded-xl bg-[#13151f] border border-[#2a2d42] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2d42]">
              <h2 className="text-sm font-semibold text-[#e2e8f0]">
                Criar tasks ({selected.size}/{proposed.length})
              </h2>
              <button
                onClick={() => setProposed(null)}
                className="text-[#8892a4] hover:text-[#e2e8f0]"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {!activeProject && (
              <p className="px-5 py-2 text-[11px] text-orange-400 bg-orange-400/10 border-b border-orange-400/20">
                Selecione um projeto para poder criar as tasks.
              </p>
            )}

            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {proposed.map((t, i) => {
                const p = PRIORITY_CONFIG[(t.priority ?? 'medium') as Priority]
                return (
                  <label
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-lg bg-[#0d0f18] border border-[#2a2d42] cursor-pointer hover:border-[#3a3e58]"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={() => toggleSelected(i)}
                      className="mt-0.5 accent-[#6366f1]"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-[#e2e8f0]">{t.title}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${p.bg} ${p.color}`}
                        >
                          {p.label}
                        </span>
                        {t.column && (
                          <span className="text-[10px] text-[#8892a4]">→ {t.column}</span>
                        )}
                        {t.sprint && <span className="text-[10px] text-[#a5b4fc]">{t.sprint}</span>}
                      </div>
                      {t.description && (
                        <p className="text-xs text-[#8892a4] mt-1">{t.description}</p>
                      )}
                      {t.tags && t.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {t.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-1.5 py-0.5 rounded text-[10px] bg-[#1e2235] text-[#8892a4]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-[#2a2d42]">
              <button
                onClick={() =>
                  setSelected((prev) =>
                    prev.size === proposed.length ? new Set() : new Set(proposed.map((_, i) => i))
                  )
                }
                className="text-xs text-[#8892a4] hover:text-[#e2e8f0]"
              >
                {selected.size === proposed.length ? 'Desmarcar todas' : 'Selecionar todas'}
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setProposed(null)}
                  className="px-3 py-1.5 rounded-lg text-sm text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmCreate}
                  disabled={!activeProject || selected.size === 0}
                  className="px-4 py-1.5 rounded-lg bg-[#6366f1] text-sm text-white font-medium hover:bg-[#4f52d4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Criar {selected.size > 0 ? selected.size : ''} task
                  {selected.size === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Approval card — write actions the agent wants to run */}
      {pendingApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[520px] max-h-[80vh] flex flex-col rounded-xl bg-[#13151f] border border-[#2a2d42] shadow-2xl">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-[#2a2d42]">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <h2 className="text-sm font-semibold text-[#e2e8f0]">
                Aprovar ações da IA ({pendingApproval.selected.size}/{pendingApproval.writes.length}
                )
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              <p className="text-xs text-[#8892a4] mb-1">
                A IA quer executar as ações abaixo. Marque as que você aprova.
              </p>
              {pendingApproval.writes.map((w) => (
                <label
                  key={w.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-[#0d0f18] border border-[#2a2d42] cursor-pointer hover:border-[#3a3e58]"
                >
                  <input
                    type="checkbox"
                    checked={pendingApproval.selected.has(w.id)}
                    onChange={() => toggleApproval(w.id)}
                    className="mt-0.5 accent-[#6366f1]"
                  />
                  <span className="text-sm text-[#e2e8f0]">{describeToolCall(w.name, w.args)}</span>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-[#2a2d42] gap-2">
              <button
                onClick={() => resolveApproval(new Set())}
                className="px-3 py-1.5 rounded-lg text-sm text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors shrink-0"
              >
                Recusar tudo
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setAuto(true)
                    resolveApproval(new Set(pendingApproval.writes.map((w) => w.id)))
                  }}
                  title="Aprova estas ações e liga o modo automático (não pergunta mais nesta sessão)"
                  className="px-3 py-1.5 rounded-lg text-xs text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
                >
                  Aprovar tudo e continuar
                </button>
                <button
                  onClick={() => resolveApproval(pendingApproval.selected)}
                  disabled={pendingApproval.selected.size === 0}
                  className="px-4 py-1.5 rounded-lg bg-[#6366f1] text-sm text-white font-medium hover:bg-[#4f52d4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Aprovar {pendingApproval.selected.size > 0 ? pendingApproval.selected.size : ''}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Apagar conversa"
        message={`Apagar "${confirmDelete?.title ?? ''}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Apagar"
        onConfirm={confirmDeleteConversation}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  )
}
