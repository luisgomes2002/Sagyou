import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useKanbanStore } from '../store/kanban'
import { useAiRunStore, toApiMessages, type ChatMessage } from '../store/aiRun'
import { PRIORITY_CONFIG, AI_TASK_PROMPT_TEMPLATE } from '../types'
import type { AITaskInput, Priority, Project } from '../types'
import {
  callModel,
  contentText,
  MAX_STEPS,
  AUTO_MAX_STEPS,
  MAX_STEPS_LIMIT,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  type AIConfig,
  type TokenUsage
} from '../ai/agent'
import { describeToolActivity } from '../ai/tools'
import { toScaledDataUrl, imageFilesFrom } from '../utils/images'
import { ChatMarkdown } from './ChatMarkdown'
import { CodeDiff, type CodeAgentDiff } from './CodeDiff'
import { AgentTerminal } from './AgentTerminal'
import { ConfirmDialog } from './ConfirmDialog'

// Config is persisted via ai:config in the main process (see effects below);
// AIConfig and the tool-calling loop live in ../ai/agent.
const DEFAULT_CONFIG: AIConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini'
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
 * Tokens as a compact label: 980 → "980", 4210 → "4.2k".
 */
function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/**
 * What the conversation cost, in USD, or null when we can't honestly say.
 *
 * Both prices must be set: quoting a cost with only one of them configured
 * would silently price half the tokens at zero. Plain float arithmetic is fine
 * here — this is a display estimate, not a stored monetary record (those are
 * decimal strings; see the financial module).
 */
function estimateCost(usage: TokenUsage, cfg: AIConfig): number | null {
  const { inputPricePer1M: inP, outputPricePer1M: outP } = cfg
  if (typeof inP !== 'number' || typeof outP !== 'number') return null
  if (!Number.isFinite(inP) || !Number.isFinite(outP)) return null
  return (usage.promptTokens / 1e6) * inP + (usage.completionTokens / 1e6) * outP
}

/** Small costs need more decimals than large ones to say anything at all. */
function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

/**
 * The spend summary, taken straight off the preload API rather than restated —
 * the shape lives in the main process, and a second copy here would drift.
 */
type UsageSummary = Awaited<ReturnType<typeof window.electronAPI.ai.usage.summary>>

/** Taken off the preload API rather than restated — main owns the shape. */
type PromptTemplate = Awaited<ReturnType<typeof window.electronAPI.ai.templates.list>>[number]

/**
 * Tallest the composer may grow, in px (~8 lines). Past this it scrolls
 * internally: the transcript is the point of the screen, and an unbounded box
 * would let one pasted log push the whole conversation out of view.
 */
const COMPOSER_MAX_PX = 200

type StatusState = 'remark' | 'running' | 'done'

/**
 * How a status line should read right now. A tool left at done:false by an
 * interrupted run (abort, crash, a reloaded conversation) would otherwise spin
 * forever, so nothing is "running" once the agent stops working.
 */
function statusState(m: ChatMessage, busy: boolean): StatusState {
  if (m.done === undefined) return 'remark'
  return m.done === false && busy ? 'running' : 'done'
}

/**
 * A step of the agent's work, rendered as quiet inline text instead of a chat
 * bubble — it's a trace of what happened, not something that was said. A tool
 * spins while it runs and settles into a check, so a slow call reads as
 * progress rather than a frozen chat.
 */
function StatusLine({ text, state }: { text: string; state: StatusState }): React.JSX.Element {
  return (
    <div
      className={`flex items-start gap-2 px-1 ${
        state === 'running' ? 'text-[#a5b4fc]' : 'text-[#8892a4]'
      }`}
    >
      {state === 'running' ? (
        <span className="mt-[3px] w-2.5 h-2.5 shrink-0 rounded-full border-[1.5px] border-[#a5b4fc] border-t-transparent animate-spin" />
      ) : state === 'done' ? (
        <svg
          className="mt-[2px] shrink-0 text-[#4ade80]"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <span className="mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 bg-[#3a3e58]" />
      )}
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
  // Surfaced in the header so the code tools' reach is visible without opening
  // the project modal.
  const activeCodePaths = (activeProject?.codePaths ?? []).filter((c) =>
    (activeProject?.activeCodePathIds ?? []).includes(c.id)
  )

  const [config, setConfig] = useState<AIConfig>(DEFAULT_CONFIG)
  const [showConfig, setShowConfig] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  // The run itself lives in its own store, above the view switch: this
  // component is unmounted the moment the user looks at anything else, and a
  // run must not die with it. See store/aiRun.ts.
  const messages = useAiRunStore((s) => s.messages)
  const busy = useAiRunStore((s) => s.busy)
  const streaming = useAiRunStore((s) => s.streaming)
  const streamingTools = useAiRunStore((s) => s.streamingTools)
  const error = useAiRunStore((s) => s.error)
  const usage = useAiRunStore((s) => s.usage)
  const conversationId = useAiRunStore((s) => s.conversationId)
  const runningConvId = useAiRunStore((s) => s.runningConvId)
  const pendingApproval = useAiRunStore((s) => s.pendingApproval)
  const autoApprove = useAiRunStore((s) => s.autoApprove)
  const savedTick = useAiRunStore((s) => s.savedTick)
  const setMessages = useAiRunStore((s) => s.setMessages)
  const setBusy = useAiRunStore((s) => s.setBusy)
  const setError = useAiRunStore((s) => s.setError)
  const openConversation = useAiRunStore((s) => s.openConversation)
  const dropConversation = useAiRunStore((s) => s.dropConversation)
  const addUsage = useAiRunStore((s) => s.addUsage)
  const setConversationId = useAiRunStore((s) => s.setConversationId)
  const setAuto = useAiRunStore((s) => s.setAutoApprove)
  const resolveApproval = useAiRunStore((s) => s.resolveApproval)
  const resetRun = useAiRunStore((s) => s.reset)

  const [input, setInput] = useState('')
  // Spend across every call ever made, from the main process's log. Separate
  // from `usage`, which is only this conversation.
  const [spend, setSpend] = useState<UsageSummary | null>(null)
  const [showSpend, setShowSpend] = useState(false)

  // Confirmation modal state (Gerar Tasks)
  const [proposed, setProposed] = useState<AITaskInput[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // External code-agent output (streamed from the main process)
  const [agentLog, setAgentLog] = useState('')
  const [agentRunning, setAgentRunning] = useState(false)
  /** What the last agent run changed. Null until asked for. */
  const [agentDiff, setAgentDiff] = useState<CodeAgentDiff | null>(null)
  const [showDiff, setShowDiff] = useState(true)

  // Persisted conversation history
  const [conversations, setConversations] = useState<
    { id: string; title: string; updatedAt: string; snippet?: string }[]
  >([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  // User-written Gerar Tasks templates. The built-in default is not in here —
  // it stays in code as the fallback, so an empty or broken list still works.
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [editingTemplate, setEditingTemplate] = useState<{
    id?: string
    name: string
    body: string
  } | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)
  // Images attached to the message being written, and the bytes for every
  // image on screen (id -> dataUrl), loaded from disk on demand.
  const [pendingImages, setPendingImages] = useState<{ id: string; dataUrl: string }[]>([])
  const [imageData, setImageData] = useState<Record<string, string>>({})
  const [dragOver, setDragOver] = useState(false)
  // Mirrors historyQuery for the callers that fire from a stale closure — the
  // debounced autosave refreshes the list and must not undo the filter.
  const historyQueryRef = useRef('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null)
  /** The chat being renamed in the history list, and the name so far. */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Set when a whole transcript is swapped in (restored on entry, or picked
  // from the history) — that render must land at the end, not follow the usual
  // "only if already at the bottom" rule.
  const jumpToEnd = useRef(false)
  // Guards the persist effect so we don't overwrite the stored config with the
  // defaults before the initial async load has completed.
  const configLoaded = useRef(false)
  const configReady = config.baseUrl.trim() !== '' && config.model.trim() !== ''
  /**
   * A run is going *and it belongs to the chat on screen*.
   *
   * `busy` is global (one run at a time), so on its own it would spin a
   * thinking bubble and offer a "Parar" button at the foot of whatever chat the
   * user opened — for work happening in another one. The transcript's live
   * furniture keys off this instead; the composer still keys off `busy`,
   * because the one run is what stops a second from starting.
   */
  const runningHere = busy && runningConvId === conversationId
  const toolRunning = runningHere && messages.some((m) => m.done === false)
  // The template in force. Falls back to the built-in whenever the selection
  // can't be honoured — no template picked, or the picked one was deleted (in
  // this window or another) — so Gerar Tasks never breaks over a dangling id.
  const activeTemplate = templates.find((t) => t.id === config.taskTemplateId) ?? null
  const activeTemplateBody = activeTemplate?.body ?? AI_TASK_PROMPT_TEMPLATE
  const totalTokens = usage.promptTokens + usage.completionTokens
  const cost = estimateCost(usage, config)

  /** Persist which conversation is open, so entering the view reopens it. */
  const rememberConversation = (id: string | null): void =>
    setConfig((c) =>
      c.lastConversationId === (id ?? undefined) ? c : { ...c, lastConversationId: id ?? undefined }
    )

  /**
   * Pull in the bytes for a reopened conversation's images. They are files on
   * disk, so the transcript arrives with ids and no pictures until this runs.
   */
  const loadImagesFor = async (msgs: ChatMessage[]): Promise<void> => {
    const ids = [...new Set(msgs.flatMap((m) => m.imageIds ?? []))]
    const loaded = await Promise.all(
      ids.map(async (id) => [id, await window.electronAPI.ai.images.get(id)] as const)
    )
    const next: Record<string, string> = {}
    for (const [id, res] of loaded) if ('dataUrl' in res) next[id] = res.dataUrl
    // A missing file just means no picture — the text of the turn still stands.
    setImageData((d) => ({ ...d, ...next }))
  }

  const handleLoadConversation = async (id: string): Promise<void> => {
    const conv = await window.electronAPI.ai.conversations.get(id)
    if (conv) {
      openConversation(conv)
      setProposed(null)
      // A whole transcript just arrived: show its end, where the user left off.
      jumpToEnd.current = true
      void loadImagesFor(conv.messages)
    } else {
      // It's gone (deleted elsewhere, or the file was edited). Forget it rather
      // than trying to reopen it again on every entry.
      //
      // Explicit, and not redundant with the effect below: nothing *changes*
      // here — the open chat was already none — so there is no transition for
      // the effect to react to, and the dead id would stay in the config and be
      // retried on every entry.
      setConversationId(null)
      rememberConversation(null)
    }
    setShowHistory(false)
  }

  // Load the persisted config from the main process once on mount, then reopen
  // whatever chat was last in front of the user.
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
          model: stored.model || DEFAULT_CONFIG.model,
          // Left undefined on purpose when unset — that's what selects the
          // per-mode default in resolveMaxSteps.
          maxSteps: stored.maxSteps,
          // Likewise undefined = no price configured = no cost quoted.
          inputPricePer1M: stored.inputPricePer1M,
          outputPricePer1M: stored.outputPricePer1M,
          timeoutMs: stored.timeoutMs,
          lastConversationId: stored.lastConversationId,
          taskTemplateId: stored.taskTemplateId
        })
        // Entering the view puts the user back where they were, at the end of
        // the chat they were reading — not in a blank one.
        if (stored.lastConversationId) void handleLoadConversation(stored.lastConversationId)
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
  //
  // Opening a conversation is the exception: a freshly loaded transcript sits
  // at scrollTop 0, which is nowhere near the bottom, so the "follow" rule
  // above would leave the user staring at the oldest message. jumpToEnd forces
  // that one case.
  //
  // Layout effect, not a passive one: this runs after the transcript is in the
  // DOM but before the browser paints, so a restored chat appears at the end
  // instead of flashing its first message and then jumping.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (jumpToEnd.current) {
      jumpToEnd.current = false
      el.scrollTo({ top: el.scrollHeight })
      return
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (atBottom) el.scrollTo({ top: el.scrollHeight })
  }, [messages, busy, streaming])

  // Grow the composer to fit what's being typed, so a long prompt is visible
  // instead of scrolling inside a two-line slot. Runs on every input change,
  // which also shrinks it back after a send clears the box.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    // Measure from scratch: scrollHeight can't report less than the element's
    // current height, so without this reset the box would only ever grow.
    el.style.height = 'auto'
    // scrollHeight covers content + padding but not borders, and the box is
    // border-box — so height must add them back or the text sits 2px short and
    // the textarea scrolls a hair even when it fits.
    const borders = el.offsetHeight - el.clientHeight
    el.style.height = `${Math.min(el.scrollHeight + borders, COMPOSER_MAX_PX)}px`
  }, [input])

  /** Ask main what the last run changed. Cheap and idempotent — it's derived. */
  const loadDiff = async (): Promise<void> => {
    setAgentDiff(await window.electronAPI.ai.codeAgent.diff())
  }

  // Stream the external code agent's output into the panel.
  //
  // The panel is only alive while this view is: the agent is a child process
  // that outlives it by design (a code review runs for minutes, and the user is
  // meant to carry on working). So on mount, catch up from the buffer main kept
  // — everything below this only hears what arrives from now on, and the run may
  // have started, printed, and finished while this view didn't exist.
  useEffect(() => {
    let cancelled = false
    window.electronAPI.ai.codeAgent.status().then((s) => {
      if (cancelled) return
      setAgentRunning(s.running)
      // Replace rather than append: this IS the log, tail and all. Appending
      // would double every line for a user who never left.
      if (s.log) setAgentLog(s.log)
      // A run may have finished while this view didn't exist; its diff is still
      // there to be asked for.
      if (s.log && !s.running) void loadDiff()
    })
    const offOutput = window.electronAPI.ai.codeAgent.onOutput((chunk) => {
      setAgentRunning(true)
      setAgentLog((l) => (l + chunk).slice(-8000)) // cap to keep the panel light
    })
    const offExit = window.electronAPI.ai.codeAgent.onExit((code) => {
      setAgentRunning(false)
      setAgentLog((l) => l + `\n[agente encerrado — código ${code}]\n`)
      // The moment there is something to review. Derived in main, so asking
      // again later is free and a run that finished while this view was closed
      // is not lost.
      void loadDiff()
    })
    return () => {
      cancelled = true
      offOutput()
      offExit()
    }
  }, [])

  /**
   * Reload the history list. Always goes through search so an autosave landing
   * mid-search can't quietly replace the filtered list with the full one.
   */
  const refreshConversations = (query = historyQueryRef.current): void => {
    window.electronAPI.ai.conversations.search(query).then(setConversations)
  }

  const setQuery = (q: string): void => {
    historyQueryRef.current = q
    setHistoryQuery(q)
    refreshConversations(q)
  }

  const refreshSpend = (): void => {
    window.electronAPI.ai.usage.summary().then(setSpend)
  }

  const refreshTemplates = (): void => {
    window.electronAPI.ai.templates.list().then(setTemplates)
  }

  // Load the conversation list on mount.
  useEffect(() => {
    refreshConversations()
    refreshSpend()
    refreshTemplates()
  }, [])

  // The autosave itself belongs to AiRunHost, which outlives this view — an
  // answer that lands while the user is on the Board still has to be written.
  // Its saves refresh the list here, so an open history doesn't go stale.
  useEffect(() => {
    if (savedTick > 0) refreshConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTick])

  /**
   * Whichever chat is open is the one to reopen next time. Driven off the id
   * rather than called from each place that changes it (history pick, "Nova",
   * the first message of a new chat) — that was three call sites to remember,
   * and the one that got forgotten was a chat that never reopened.
   */
  useEffect(() => {
    rememberConversation(conversationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // The spend log is written by the main process as calls happen, so it's only
  // worth re-reading once the run has stopped making them.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) refreshSpend()
    wasBusy.current = busy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy])

  /**
   * Automatic mode is tied to the run it was turned on for. It lives in the
   * store now (a background run has to keep chaining actions without the card),
   * so entering the view is where it gets cleared — otherwise "Aprovar tudo e
   * continuar" on one run would silently hand the next one the same licence.
   * Only when nothing is in flight: clearing it mid-run would park the very run
   * it was turned on for on a card the user already answered.
   */
  useEffect(() => {
    if (!useAiRunStore.getState().busy) setAuto(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleNewConversation = (): void => {
    // Clears the transcript, the id, the usage and any card the loop is parked
    // on; the effect above then remembers the blank chat for next entry.
    resetRun()
    setProposed(null)
    setShowHistory(false)
    // Attachments never sent belong to no conversation — bin the files rather
    // than leave them on disk with nothing pointing at them.
    if (pendingImages.length > 0) {
      void window.electronAPI.ai.images.delete(pendingImages.map((p) => p.id))
      setPendingImages([])
    }
  }

  const handleDeleteConversation = (id: string, title: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    setShowHistory(false)
    setConfirmDelete({ id, title })
  }

  const startRename = (id: string, title: string, e: React.MouseEvent): void => {
    // The row itself opens the chat; renaming it shouldn't.
    e.stopPropagation()
    setRenaming({ id, value: title })
  }

  /**
   * Save the new name, or drop the edit if it's blank or unchanged.
   *
   * Renaming goes straight to the file, not through the run store: it reaches
   * any chat in the history, and the open one is the only transcript the
   * renderer holds. The list is then re-read, so the name shown is the one that
   * was actually stored (trimmed and clipped) rather than what was typed.
   */
  const commitRename = async (): Promise<void> => {
    if (!renaming) return
    const { id, value } = renaming
    const name = value.trim()
    setRenaming(null)
    // Blank is a cancel, not a request to be nameless — the chat keeps its title.
    if (!name) return
    const res = await window.electronAPI.ai.conversations.rename(id, name)
    if (res.error) setError(res.error)
    refreshConversations()
  }

  const confirmDeleteConversation = async (): Promise<void> => {
    if (!confirmDelete) return
    const { id } = confirmDelete
    // Take the image files with it: nothing else references them, so leaving
    // them behind orphans them on disk forever.
    const conv = await window.electronAPI.ai.conversations.get(id)
    const ids = [...new Set((conv?.messages ?? []).flatMap((m) => m.imageIds ?? []))]
    if (ids.length > 0) await window.electronAPI.ai.images.delete(ids)
    await window.electronAPI.ai.conversations.delete(id)
    // Let the run store forget it too: it may be parked, or be the very chat
    // the loop is writing into, and the file is gone either way.
    dropConversation(id)
    if (id === conversationId) handleNewConversation()
    setConfirmDelete(null)
    refreshConversations()
  }

  /**
   * Take pasted or dropped images: downscale, hand the bytes to the main
   * process, and keep only the id — the transcript never carries base64.
   */
  const attachImages = async (files: File[]): Promise<void> => {
    for (const file of files) {
      try {
        const dataUrl = await toScaledDataUrl(file)
        const res = await window.electronAPI.ai.images.save(dataUrl)
        if ('error' in res) {
          setError(res.error)
          continue
        }
        setImageData((d) => ({ ...d, [res.id]: dataUrl }))
        setPendingImages((p) => [...p, { id: res.id, dataUrl }])
      } catch {
        setError('Não consegui ler essa imagem')
      }
    }
  }

  const removePendingImage = (id: string): void => {
    setPendingImages((p) => p.filter((img) => img.id !== id))
    // The file is orphaned the moment it leaves the draft — it was never sent.
    void window.electronAPI.ai.images.delete([id])
  }

  const handleSaveTemplate = async (): Promise<void> => {
    if (!editingTemplate) return
    const res = await window.electronAPI.ai.templates.save(editingTemplate)
    if ('error' in res) {
      setTemplateError(res.error)
      return
    }
    setTemplateError(null)
    setEditingTemplate(null)
    refreshTemplates()
    // A template is written to be used: pick it straight away.
    setConfig((c) => ({ ...c, taskTemplateId: res.template.id }))
  }

  const handleDeleteTemplate = async (id: string): Promise<void> => {
    await window.electronAPI.ai.templates.delete(id)
    refreshTemplates()
    if (editingTemplate?.id === id) setEditingTemplate(null)
    // Don't leave the composer pointing at something that no longer exists.
    if (config.taskTemplateId === id) setConfig((c) => ({ ...c, taskTemplateId: undefined }))
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

  /**
   * Hands the message to the store and returns — the run outlives this view, so
   * nothing here waits on it. What the composer owns (the text, the pending
   * attachments) is cleared up front; the transcript, the spend and the
   * approval belong to the run.
   */
  const handleSend = (): void => {
    const text = input.trim()
    // An image alone is a fair question ("what is this?"), so a message with
    // attachments may carry no text.
    if ((!text && pendingImages.length === 0) || busy) return
    setInput('')
    const imageIds = pendingImages.map((p) => p.id)
    setPendingImages([])
    void useAiRunStore.getState().send(config, { text, imageIds, imageData })
  }

  /**
   * Escape closes the topmost thing that's open — one layer per press.
   *
   * Bound to the document rather than to each overlay so it works wherever the
   * focus happens to be (the composer, a dropdown's search box, nothing at
   * all). The order mirrors what's stacked on screen, so Escape never reaches
   * past a dialog to dismiss something behind it.
   *
   * The approval card is drawn by AiRunHost, not here — but the ordering below
   * is the reason this view keeps answering it while it's open: the host binds
   * Escape only when the AI view is closed, so exactly one listener acts.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (confirmDelete) return setConfirmDelete(null)
      if (pendingApproval) {
        // NOT just a close: the agent loop is awaiting this promise, so hiding
        // the card without answering leaves the run hanging forever. Escape is
        // a cancel, and the safe reading of cancel is "approve nothing".
        return resolveApproval(new Set())
      }
      if (proposed) return setProposed(null)
      if (showSpend) return setShowSpend(false)
      // Abandons the edit, keeping the old name. Ahead of showHistory: the box
      // is drawn inside that dropdown, so closing the dropdown first would take
      // the rename down with it and read as one press doing two things.
      if (renaming) return setRenaming(null)
      if (showHistory) return setShowHistory(false)
      if (showConfig) return setShowConfig(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [
    confirmDelete,
    pendingApproval,
    proposed,
    showSpend,
    renaming,
    showHistory,
    showConfig,
    resolveApproval
  ])

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
      ...toApiMessages(messages, imageData),
      {
        role: 'user' as const,
        content:
          activeTemplateBody +
          '\n\nDescrição do projeto:\n' +
          (description || '(use a conversa acima como descrição)')
      }
    ]
    setMessages([...messages, marker])
    setBusy(true)
    try {
      const { message, usage } = await callModel(config, sent)
      if (usage) addUsage(usage)
      const reply = contentText(message.content)
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

  /** A USD-per-1M-tokens input. Blank means unset, which hides the cost. */
  const priceField = (
    label: string,
    key: 'inputPricePer1M' | 'outputPricePer1M'
  ): React.JSX.Element => (
    <label className="flex flex-col gap-1 shrink-0 w-44">
      <span className="text-[11px] font-medium text-[#8892a4]">{label}</span>
      <input
        type="number"
        min={0}
        step="0.01"
        value={config[key] ?? ''}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value.trim()
          setConfig((c) => ({ ...c, [key]: raw === '' ? undefined : Number(raw) }))
        }}
        className="px-2.5 py-1.5 rounded-md bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] placeholder:text-[#4a5068] focus:outline-none focus:border-[#6366f1]"
      />
    </label>
  )

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
            {activeCodePaths.length > 0 && (
              <span
                title={`A IA lê o código em:\n${activeCodePaths.map((c) => c.path).join('\n')}`}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#6366f1]/10 text-[11px] text-[#a5b4fc] max-w-[280px]"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                  <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                </svg>
                <span className="truncate">
                  {activeCodePaths.length === 1
                    ? (activeCodePaths[0].label ?? activeCodePaths[0].path)
                    : `${activeCodePaths.length} pastas`}
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(totalTokens > 0 || (spend?.total.calls ?? 0) > 0) && (
              <div className="relative">
                <button
                  onClick={() => {
                    refreshSpend()
                    setShowSpend((v) => !v)
                  }}
                  title={
                    totalTokens > 0
                      ? `Entrada: ${usage.promptTokens.toLocaleString('pt-BR')} tokens\n` +
                        `Saída: ${usage.completionTokens.toLocaleString('pt-BR')} tokens\n` +
                        'Soma de todas as chamadas desta conversa. Clique para ver os gastos.'
                      : 'Ver o histórico de chamadas e gastos'
                  }
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] tabular-nums transition-colors ${
                    showSpend
                      ? 'bg-[#6366f1]/20 text-[#a5b4fc]'
                      : 'bg-[#1e2235] text-[#8892a4] hover:text-[#e2e8f0]'
                  }`}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="shrink-0"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v10M9.5 9.5h5M9.5 14.5h5" />
                  </svg>
                  {totalTokens > 0 ? (
                    <>
                      {formatTokens(totalTokens)} tokens
                      {cost !== null && <span className="text-[#a5b4fc]">· {formatCost(cost)}</span>}
                    </>
                  ) : (
                    'Gastos'
                  )}
                </button>

                {showSpend && spend && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowSpend(false)} />
                    <div className="absolute right-0 top-full mt-1 z-40 w-80 max-h-[26rem] overflow-y-auto rounded-lg border border-[#2a2d42] bg-[#0d0f18] shadow-2xl p-3">
                      <p className="text-[11px] font-semibold text-[#e2e8f0] mb-2">
                        Gastos com o modelo
                      </p>

                      <div className="space-y-1">
                        {(
                          [
                            ['Hoje', spend.today],
                            ['30 dias', spend.last30],
                            ['Total', spend.total]
                          ] as const
                        ).map(([label, b]) => (
                          <div key={label} className="flex items-baseline justify-between gap-2">
                            <span className="text-[11px] text-[#8892a4]">{label}</span>
                            <span className="text-[11px] text-[#e2e8f0] tabular-nums">
                              {b.calls} {b.calls === 1 ? 'chamada' : 'chamadas'} ·{' '}
                              {formatTokens(b.promptTokens + b.completionTokens)} ·{' '}
                              {b.unpricedCalls === b.calls ? (
                                <span className="text-[#4a5068]">sem preço</span>
                              ) : (
                                <span className="text-[#a5b4fc]">{formatCost(b.cost)}</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>

                      {spend.total.unpricedCalls > 0 && (
                        <p className="mt-2 text-[10px] text-[#4a5068] leading-relaxed">
                          {spend.total.unpricedCalls} chamada
                          {spend.total.unpricedCalls === 1 ? '' : 's'} sem preço configurado na
                          época — não {spend.total.unpricedCalls === 1 ? 'entra' : 'entram'} no
                          total.
                        </p>
                      )}

                      {spend.byModel.length > 0 && (
                        <>
                          <p className="mt-3 mb-1 text-[10px] font-medium text-[#8892a4] uppercase tracking-wide">
                            Por modelo
                          </p>
                          {spend.byModel.map(({ model, bucket }) => (
                            <div key={model} className="flex items-baseline justify-between gap-2">
                              <span className="text-[11px] text-[#e2e8f0] truncate">{model}</span>
                              <span className="text-[11px] text-[#8892a4] tabular-nums shrink-0">
                                {bucket.calls}× ·{' '}
                                {bucket.unpricedCalls === bucket.calls
                                  ? '—'
                                  : formatCost(bucket.cost)}
                              </span>
                            </div>
                          ))}
                        </>
                      )}

                      {spend.recent.length > 0 && (
                        <>
                          <p className="mt-3 mb-1 text-[10px] font-medium text-[#8892a4] uppercase tracking-wide">
                            Últimas chamadas
                          </p>
                          <div className="space-y-0.5">
                            {spend.recent.map((e, i) => (
                              <div
                                key={`${e.at}-${i}`}
                                className="flex items-baseline justify-between gap-2"
                              >
                                <span className="text-[10px] text-[#4a5068] tabular-nums shrink-0">
                                  {new Date(e.at).toLocaleString('pt-BR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </span>
                                <span className="text-[10px] text-[#8892a4] tabular-nums">
                                  {formatTokens(e.promptTokens)}→{formatTokens(e.completionTokens)}
                                  {typeof e.cost === 'number' && (
                                    <span className="text-[#a5b4fc]"> {formatCost(e.cost)}</span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      {spend.total.calls === 0 && (
                        <p className="text-[11px] text-[#4a5068] italic">
                          Nenhuma chamada registrada ainda.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

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
                onClick={() => {
                  // Reopening always starts unfiltered — a stale query would
                  // look like the history had lost conversations.
                  if (!showHistory) setQuery('')
                  setShowHistory((v) => !v)
                }}
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
                  <div className="absolute right-0 top-full mt-1 z-40 w-80 max-h-96 overflow-y-auto rounded-lg border border-[#2a2d42] bg-[#0d0f18] shadow-2xl py-1">
                    <div className="sticky top-0 bg-[#0d0f18] px-2 pt-1 pb-2 border-b border-[#2a2d42]">
                      <input
                        autoFocus
                        value={historyQuery}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar por título ou conteúdo…"
                        className="w-full px-2.5 py-1.5 rounded-md bg-[#13151f] border border-[#2a2d42] text-xs text-[#e2e8f0] placeholder:text-[#4a5068] focus:outline-none focus:border-[#6366f1]"
                      />
                    </div>
                    {conversations.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-[#4a5068] italic text-center">
                        {historyQuery.trim()
                          ? `Nada encontrado para "${historyQuery.trim()}"`
                          : 'Nenhuma conversa salva'}
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
                            {renaming?.id === c.id ? (
                              <input
                                autoFocus
                                value={renaming.value}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setRenaming({ id: c.id, value: e.target.value })}
                                // Clicking away is a commit, like a rename in a
                                // file manager. Escape is handled by the view's
                                // ordering above, which clears `renaming` first
                                // — so by the time blur fires there is nothing
                                // to commit and the old name stands.
                                onBlur={() => void commitRename()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void commitRename()
                                }}
                                className="w-full px-1.5 py-0.5 rounded bg-[#0d0f18] border border-[#6366f1] text-xs text-[#e2e8f0] focus:outline-none"
                              />
                            ) : (
                              <p className="text-xs text-[#e2e8f0] truncate">{c.title}</p>
                            )}
                            {c.snippet && (
                              // Matched on the body, not the title: show the
                              // line, or the result looks arbitrary.
                              <p className="text-[10px] text-[#8892a4] truncate italic">
                                {c.snippet}
                              </p>
                            )}
                            <p className="text-[10px] text-[#4a5068]">
                              {new Date(c.updatedAt).toLocaleString('pt-BR')}
                            </p>
                          </div>
                          {c.id === runningConvId && (
                            // This chat is the one the agent is working in —
                            // worth saying, since it's about to change on its
                            // own and it isn't necessarily the one on screen.
                            <span
                              title="A IA está trabalhando nesta conversa"
                              className="w-3 h-3 shrink-0 rounded-full border-[1.5px] border-[#a5b4fc] border-t-transparent animate-spin"
                            />
                          )}
                          <button
                            onClick={(e) => startRename(c.id, c.title, e)}
                            title="Renomear conversa"
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] shrink-0"
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
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
            <div className="mt-3 flex items-start gap-3">
              <label className="flex flex-col gap-1 shrink-0 w-40">
                <span className="text-[11px] font-medium text-[#8892a4]">Passos máximos</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_STEPS_LIMIT}
                  value={config.maxSteps ?? ''}
                  placeholder={`Padrão (${MAX_STEPS}/${AUTO_MAX_STEPS})`}
                  onChange={(e) => {
                    const raw = e.target.value.trim()
                    // Empty means "unset" — that's what selects the per-mode default.
                    setConfig((c) => ({
                      ...c,
                      maxSteps: raw === '' ? undefined : Number(raw)
                    }))
                  }}
                  className="px-2.5 py-1.5 rounded-md bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] placeholder:text-[#4a5068] focus:outline-none focus:border-[#6366f1]"
                />
              </label>
              <p className="text-[11px] text-[#4a5068] pt-5 leading-relaxed">
                Quantas rodadas de ferramentas o assistente pode encadear numa resposta — cada
                rodada é uma chamada paga ao modelo. Em branco usa o padrão: <b>{MAX_STEPS}</b> no
                modo manual e <b>{AUTO_MAX_STEPS}</b> no automático. Um valor definido vale para os
                dois modos (máx. {MAX_STEPS_LIMIT}).
              </p>
            </div>

            <div className="mt-3 flex items-start gap-3">
              <label className="flex flex-col gap-1 shrink-0 w-40">
                <span className="text-[11px] font-medium text-[#8892a4]">Timeout (segundos)</span>
                <input
                  type="number"
                  min={MIN_TIMEOUT_MS / 1000}
                  max={MAX_TIMEOUT_MS / 1000}
                  value={config.timeoutMs === undefined ? '' : config.timeoutMs / 1000}
                  placeholder={`Padrão (${DEFAULT_TIMEOUT_MS / 1000}s)`}
                  onChange={(e) => {
                    const raw = e.target.value.trim()
                    // Stored in ms (the SDK's unit); shown in seconds, which is
                    // how anyone actually thinks about a timeout.
                    setConfig((c) => ({
                      ...c,
                      timeoutMs: raw === '' ? undefined : Math.round(Number(raw) * 1000)
                    }))
                  }}
                  className="px-2.5 py-1.5 rounded-md bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] placeholder:text-[#4a5068] focus:outline-none focus:border-[#6366f1]"
                />
              </label>
              <p className="text-[11px] text-[#4a5068] pt-5 leading-relaxed">
                Quanto esperar o modelo <b>começar</b> a responder antes de desistir. Não corta
                respostas longas — vale só até a primeira resposta chegar. Em branco usa{' '}
                {DEFAULT_TIMEOUT_MS / 1000}s (mín. {MIN_TIMEOUT_MS / 1000}s, máx.{' '}
                {MAX_TIMEOUT_MS / 1000}s). Um timeout é tratado como falha temporária e entra no
                retry.
              </p>
            </div>

            <div className="mt-3 flex items-start gap-3">
              {priceField('Preço entrada (US$ / 1M tokens)', 'inputPricePer1M')}
              {priceField('Preço saída (US$ / 1M tokens)', 'outputPricePer1M')}
              <p className="text-[11px] text-[#4a5068] pt-5 leading-relaxed">
                Preços do seu provider, para estimar o custo da conversa. O app não tem como
                saber sozinho — ele fala com qualquer endpoint compatível com OpenAI, inclusive
                modelos locais (custo zero). Deixe em branco e o header mostra só os tokens.
              </p>
            </div>

            <div className="mt-3 pt-3 border-t border-[#2a2d42]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-[#8892a4]">
                  Templates do Gerar Tasks
                </span>
                <button
                  onClick={() => {
                    setTemplateError(null)
                    // Start from the built-in: a blank box invites a prompt that
                    // doesn't ask for the JSON the importer needs.
                    setEditingTemplate({ name: '', body: AI_TASK_PROMPT_TEMPLATE })
                  }}
                  className="text-[11px] text-[#a5b4fc] hover:text-[#e2e8f0]"
                >
                  + Novo template
                </button>
              </div>

              {templates.length === 0 && !editingTemplate && (
                <p className="text-[11px] text-[#4a5068] italic">
                  Só o template padrão. Crie um para adaptar o Gerar Tasks a uma área — Dev,
                  Estudo, Marketing…
                </p>
              )}

              <div className="space-y-1">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate text-[11px] text-[#e2e8f0]">
                      {t.name}
                      {config.taskTemplateId === t.id && (
                        <span className="ml-1.5 text-[10px] text-[#a5b4fc]">(em uso)</span>
                      )}
                    </span>
                    <button
                      onClick={() => {
                        setTemplateError(null)
                        setEditingTemplate({ id: t.id, name: t.name, body: t.body })
                      }}
                      className="text-[11px] text-[#8892a4] hover:text-[#e2e8f0]"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(t.id)}
                      className="text-[11px] text-[#8892a4] hover:text-red-400"
                    >
                      Apagar
                    </button>
                  </div>
                ))}
              </div>

              {editingTemplate && (
                <div className="mt-2 space-y-2">
                  <input
                    value={editingTemplate.name}
                    onChange={(e) =>
                      setEditingTemplate((t) => (t ? { ...t, name: e.target.value } : t))
                    }
                    placeholder="Nome do template (ex: Dev)"
                    className="w-full px-2.5 py-1.5 rounded-md bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] placeholder:text-[#4a5068] focus:outline-none focus:border-[#6366f1]"
                  />
                  <textarea
                    aria-label="Conteúdo do template"
                    value={editingTemplate.body}
                    onChange={(e) =>
                      setEditingTemplate((t) => (t ? { ...t, body: e.target.value } : t))
                    }
                    rows={8}
                    spellCheck={false}
                    className="w-full resize-y px-2.5 py-1.5 rounded-md bg-[#0d0f18] border border-[#2a2d42] text-[11px] font-mono text-[#e2e8f0] focus:outline-none focus:border-[#6366f1]"
                  />
                  <p className="text-[10px] text-[#4a5068] leading-relaxed">
                    A descrição do projeto é acrescentada no fim. O template precisa pedir o JSON
                    com a lista <code>tasks</code> — é o que o importador entende.
                  </p>
                  {templateError && <p className="text-[11px] text-red-400">{templateError}</p>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveTemplate}
                      className="px-3 py-1 rounded-md bg-[#6366f1] text-xs text-white font-medium hover:bg-[#4f52d4]"
                    >
                      Salvar
                    </button>
                    <button
                      onClick={() => {
                        setEditingTemplate(null)
                        setTemplateError(null)
                      }}
                      className="px-3 py-1 rounded-md text-xs text-[#8892a4] hover:text-[#e2e8f0]"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
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
                <p className="text-[#e2e8f0] font-medium mb-1">Converse com o modelo alterado</p>
                <p className="text-sm text-[#8892a4]">
                  Descreva o projeto e use <b>Gerar Tasks</b> para criar tarefas.
                </p>
              </div>
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === 'status' ? (
                <StatusLine key={i} text={m.content} state={statusState(m, runningHere)} />
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
                    {(m.imageIds ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {(m.imageIds ?? []).map((id) =>
                          imageData[id] ? (
                            <img
                              key={id}
                              src={imageData[id]}
                              alt="Imagem enviada"
                              className="max-h-40 rounded-md border border-white/10"
                            />
                          ) : (
                            // The file is gone; the turn's text still stands.
                            <span key={id} className="text-[10px] italic opacity-60">
                              [imagem indisponível]
                            </span>
                          )
                        )}
                      </div>
                    )}
                    {m.role === 'user' ? m.content : <ChatMarkdown content={m.content} />}
                  </div>
                </div>
              )
            )
          )}
          {runningHere && (
            <div className="flex flex-col items-start gap-1.5">
              {streaming ? (
                // The answer typing itself out — same bubble as a finished
                // message, with a caret trailing the text.
                <div className="max-w-[88%] px-3.5 py-2 rounded-2xl rounded-bl-sm text-sm break-words bg-[#1e2235] text-[#e2e8f0] border border-[#2a2d42]">
                  <ChatMarkdown content={streaming} />
                  <span className="inline-block w-[2px] h-3.5 ml-0.5 align-[-1px] bg-[#a5b4fc] animate-pulse" />
                </div>
              ) : streamingTools.length > 0 ? (
                // No text, but the model has told us what it's writing: a tool
                // call, still composing its arguments. Naming it beats the bare
                // spinner below — that spinner is all there was to see for as
                // long as the arguments took to arrive, which for a big
                // criar_tasks is seconds.
                //
                // Shown like the real status lines it's about to become, but it
                // is not one: these are replaced by the persistent lines the
                // moment the message completes.
                <div className="flex flex-col gap-1">
                  {streamingTools.map((name, i) => (
                    <StatusLine key={i} text={describeToolActivity(name, {})} state="running" />
                  ))}
                </div>
              ) : (
                // Nothing streamed yet — still connecting. While a tool runs its
                // own status line is already spinning, so this would be a second
                // spinner for the same wait.
                !toolRunning && (
                  <div className="px-3.5 py-2 rounded-2xl bg-[#1e2235] border border-[#2a2d42]">
                    <div className="w-4 h-4 rounded-full border-2 border-[#6366f1] border-t-transparent animate-spin" />
                  </div>
                )
              )}
              {/* Icon-only stop, as in Claude/ChatGPT: the square reads as
                  "stop" on its own, so the label is left to the tooltip. */}
              <button
                onClick={() => useAiRunStore.getState().abort()}
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
            <AgentTerminal log={agentLog} running={agentRunning} />

            {/* The changes themselves, so they can be reviewed here rather than
                in an editor. Only once the agent has stopped writing them. */}
            {!agentRunning && agentDiff && (
              <div className="px-6 pb-3">
                <button
                  onClick={() => setShowDiff((v) => !v)}
                  className="flex items-center gap-1.5 mb-1.5 text-[11px] font-medium text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    className={`transition-transform ${showDiff ? 'rotate-90' : ''}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  Mudanças
                </button>
                {showDiff && <CodeDiff diff={agentDiff} onRefresh={() => void loadDiff()} />}
              </div>
            )}
          </div>
        )}

        {/* Composer */}
        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            const files = imageFilesFrom(e.dataTransfer)
            if (files.length === 0) return
            e.preventDefault()
            setDragOver(false)
            void attachImages(files)
          }}
          className={`px-6 py-3 border-t shrink-0 transition-colors ${
            dragOver ? 'border-[#6366f1] bg-[#6366f1]/5' : 'border-[#2a2d42]'
          }`}
        >
          {!configReady && (
            <p className="mb-2 text-[11px] text-orange-400">
              Configure a Base URL e o Model antes de enviar.
            </p>
          )}
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {pendingImages.map((img) => (
                <div key={img.id} className="relative group">
                  <img
                    src={img.dataUrl}
                    alt="Anexo"
                    className="h-16 w-16 object-cover rounded-md border border-[#2a2d42]"
                  />
                  <button
                    onClick={() => removePendingImage(img.id)}
                    title="Remover"
                    aria-label="Remover imagem"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-[#1e2235] border border-[#2a2d42] text-[#8892a4] opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {busy && !runningHere && (
            // The composer is disabled because a run is going — in a chat the
            // user can't see. Without this the send button is simply dead, with
            // the explanation one dropdown away. Only reachable now that
            // switching chats mid-run is safe.
            <button
              onClick={() => void handleLoadConversation(runningConvId!)}
              className="flex items-center gap-2 mb-2 px-1 text-xs text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
            >
              <span className="w-3 h-3 shrink-0 rounded-full border-[1.5px] border-[#a5b4fc] border-t-transparent animate-spin" />
              A IA está trabalhando em outra conversa — abrir
            </button>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              onPaste={(e) => {
                const files = imageFilesFrom(e.clipboardData)
                if (files.length === 0) return // let ordinary text paste through
                e.preventDefault()
                void attachImages(files)
              }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter is a newline. Ctrl/Cmd+Enter sends
                // too — neither sets shiftKey, so they fall out of the same
                // condition, which is why this reads as one rule rather than
                // three. Tested, because that is easy to break by "tidying".
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Descreva o projeto ou faça uma pergunta…"
              rows={2}
              disabled={!configReady || busy}
              // maxHeight repeats the JS cap so the box stays bounded even if a
              // measurement is off; min-h holds the original two-line resting
              // size, which the inline height would otherwise undercut.
              style={{ maxHeight: COMPOSER_MAX_PX }}
              className="flex-1 resize-none overflow-y-auto min-h-[58px] px-3 py-2 rounded-lg bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] placeholder:text-[#4a5068] focus:outline-none focus:border-[#6366f1] disabled:opacity-50"
            />
            <div className="flex flex-col gap-2">
              <button
                onClick={handleSend}
                disabled={!configReady || busy || (input.trim() === '' && pendingImages.length === 0)}
                className="px-3 py-1.5 rounded-lg bg-[#1e2235] border border-[#2a2d42] text-sm text-[#e2e8f0] font-medium hover:bg-[#2a2d42] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Enviar
              </button>
              <select
                value={config.taskTemplateId ?? ''}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, taskTemplateId: e.target.value || undefined }))
                }
                title="Template usado pelo Gerar Tasks"
                className="px-2 py-1 rounded-lg bg-[#0d0f18] border border-[#2a2d42] text-[11px] text-[#8892a4] focus:outline-none focus:border-[#6366f1] max-w-[9rem]"
              >
                {/* The built-in is always offered and can't be deleted — it is
                    the floor Gerar Tasks falls back to. */}
                <option value="">Padrão</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
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
