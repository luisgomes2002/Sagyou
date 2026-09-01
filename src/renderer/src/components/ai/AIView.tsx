import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo } from 'react'
import { useKanbanStore } from '../../store/kanban'
import { useAiRunStore, type ChatMessage } from '../../store/aiRun'
import type { Project } from '../../types'
import {
  LOW_STEPS_WARNING,
  MAX_STEPS_LIMIT,
  resolveMaxSteps,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  type AIConfig,
  type TokenUsage
} from '../../ai/agent'
import { describeToolActivity } from '../../ai/tools'
import { toScaledDataUrl, imageFilesFrom, documentFilesFrom } from '../../utils/images'
import { estimateAutoRun, cacheHitRate } from '../../utils/spend'
import { ChatMarkdown } from './ChatMarkdown'
import { ConfirmDialog } from '../ConfirmDialog'
import { SandboxOnboarding, type JailStatus } from '../modals/SandboxOnboarding'
import { ModeToggleButton } from './ModeToggleButton'

// Config is persisted via ai:config in the main process (see effects below);
// AIConfig and the tool-calling loop live in ../ai/agent.
const DEFAULT_CONFIG: AIConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini'
}

type HarnessStatus = Awaited<ReturnType<typeof window.electronAPI.ai.harnesses.status>>[number]

/** Map model name → provider base URL, so selecting a model auto-fills the URL. */
const MODEL_PROVIDER: Record<string, string> = {
  deepseek: 'https://api.deepseek.com',
  gpt: 'https://api.openai.com',
  o1: 'https://api.openai.com',
  o3: 'https://api.openai.com',
  claude: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  llama: 'https://api.llama-api.com',
  mistral: 'https://api.mistral.ai',
  codestral: 'https://api.mistral.ai',
  qwen: 'https://api.qwen.ai'
}

function providerForModel(model: string): string | null {
  const key = Object.keys(MODEL_PROVIDER).find((k) => model.startsWith(k))
  return key ? MODEL_PROVIDER[key] : null
}

/** Known models across common providers, shown alongside API results. */
const KNOWN_MODELS = [
  // DeepSeek
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  // OpenAI
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'o1',
  'o1-mini',
  'o3-mini',
  // Anthropic
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
  'claude-opus-4-20250514',
  'claude-3-opus-latest',
  'claude-3-haiku-20240307',
  // Google
  'gemini-2.5-pro-exp-03-25',
  'gemini-2.0-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  // Meta
  'llama-3.3-70b-instruct',
  'llama-3.1-8b-instruct',
  // Mistral
  'mistral-large-latest',
  'mistral-small-latest',
  'codestral-latest',
  // Local / open
  'qwen2.5-coder-32b-instruct',
  'qwen2.5-72b-instruct'
]

/**
 * List the models the provider exposes (GET /models), merged with KNOWN_MODELS
 * so the dropdown always shows common options even when the API omits them.
 */
async function fetchModels(cfg: AIConfig): Promise<string[]> {
  try {
    const res = await window.electronAPI.ai.models({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey })
    if (res.success && Array.isArray(res.models)) {
      return [...new Set([...KNOWN_MODELS, ...res.models])]
    }
  } catch {
    /* fall through to known models only */
  }
  return KNOWN_MODELS
}

/** Extract the first balanced JSON object from arbitrary model text. */

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
  const outputTokens = usage.completionTokens + (usage.reasoningTokens ?? 0)
  return (usage.promptTokens / 1e6) * inP + (outputTokens / 1e6) * outP
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
type RunMetricsSummary = Awaited<ReturnType<typeof window.electronAPI.ai.runMetrics.summary>>

/** Taken off the preload API rather than restated — main owns the shape. */
type SkillItem = Awaited<ReturnType<typeof window.electronAPI.ai.skills.list>>[number]

/**
 * Tallest the composer may grow, in px (~8 lines). Past this it scrolls
 * internally: the transcript is the point of the screen, and an unbounded box
 * would let one pasted log push the whole conversation out of view.
 */
const COMPOSER_MAX_PX = 200

type StatusState = 'remark' | 'running' | 'done'

/**
 * A thin memo wrapper around StatusLine so a growing transcript only re-renders
 * the lines that actually changed. The text identity is the cheapest stable key.
 */
const MemoStatusLine = memo(StatusLine)

/**
 * A chat bubble (user or assistant). Memoized so the visible window re-renders
 * only the messages that content-wise changed, not every message on every
 * streaming chunk.
 */
const MessageBubble = memo(function MessageBubble({
  m,
  index,
  imageData
}: {
  m: ChatMessage
  index: number
  imageData: Record<string, string>
}) {
  return (
    <div key={index} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`px-3.5 py-2 rounded-2xl text-sm break-words ${
          m.role === 'user'
            ? 'max-w-[75%] whitespace-pre-wrap bg-[#7c3aed] text-white rounded-br-sm'
            : 'max-w-[88%] bg-[#2a2a2a] text-[#d4d4d4] border border-[#3b3b3b] rounded-bl-sm'
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
})

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
function StatusLine({
  text,
  state,
  step,
  maxSteps,
  tokens
}: {
  text: string
  state: StatusState
  step?: number
  maxSteps?: number
  tokens?: number
}): React.JSX.Element {
  // Both or neither: a "3/" with no denominator says nothing about how much
  // budget is left, which is the only reason the badge exists.
  const badge = step !== undefined && maxSteps !== undefined ? `${step}/${maxSteps}` : null
  return (
    <div
      className={`flex items-start gap-2 px-1 ${
        state === 'running' ? 'text-[#a080f0]' : 'text-[#999999]'
      }`}
    >
      {state === 'running' ? (
        <span className="mt-[3px] w-2.5 h-2.5 shrink-0 rounded-full border-[1.5px] border-[#a080f0] border-t-transparent animate-spin" />
      ) : state === 'done' ? (
        <svg
          className="mt-[2px] shrink-0 text-[#46d478]"
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
        <span className="mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 bg-[#555555]" />
      )}
      {badge && (
        <span
          title={`Passo ${step} de ${maxSteps} desta execução`}
          className="mt-[1px] shrink-0 px-1.5 py-[1px] rounded text-[10px] font-medium tabular-nums bg-[#2a2a2a] border border-[#3b3b3b] text-[#999999]"
        >
          {badge}
        </span>
      )}
      {tokens !== undefined && tokens > 0 && (
        <span
          title="tokens desta chamada do modelo (prompt + resposta). Cresce a cada passo porque o histórico é reenviado."
          className="mt-[1px] shrink-0 px-1.5 py-[1px] rounded text-[10px] font-medium tabular-nums bg-[#2a2a2a] border border-[#3b3b3b] text-[#999999]"
        >
          {formatTokens(tokens)} tokens
        </span>
      )}
      <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">{text}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AIView({
  projects,
  prefill,
  onPrefillConsumed
}: {
  projects: Project[]
  /** Composer text handed in from another view (e.g. a board task). */
  prefill?: string | null
  /** Called once `prefill` has been taken, so it can't be applied twice. */
  onPrefillConsumed?: () => void
}) {
  const activeProjectId = useKanbanStore((s) => s.activeProjectId)

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
  // The code agent may point at its own endpoint, so it loads its own model list
  // (falling back to the chat's when its provider fields are blank).
  const [codeAgentModels, setCodeAgentModels] = useState<string[]>([])
  const [loadingCodeAgentModels, setLoadingCodeAgentModels] = useState(false)
  const [codeAgentModelsError, setCodeAgentModelsError] = useState<string | null>(null)
  // The run itself lives in its own store, above the view switch: this
  // component is unmounted the moment the user looks at anything else, and a
  // run must not die with it. See store/aiRun.ts.
  const messages = useAiRunStore((s) => s.messages)
  const running = useAiRunStore((s) => s.running)
  const busy = running.size > 0
  const streamingAll = useAiRunStore((s) => s.streaming)
  const streamingToolsAll = useAiRunStore((s) => s.streamingTools)
  const conversationId = useAiRunStore((s) => s.conversationId)
  const busyHere = running.has(conversationId ?? '')
  const streaming = conversationId ? (streamingAll[conversationId] ?? '') : ''
  const streamingTools = conversationId ? (streamingToolsAll[conversationId] ?? []) : []
  const error = useAiRunStore((s) => s.error)
  const usage = useAiRunStore((s) => s.usage)
  const runningConvId = useAiRunStore((s) => {
    if (s.running.size === 0) return null
    return [...s.running][0]
  })
  const pendingApproval = useAiRunStore((s) => s.pendingApprovals)
  const autoApprove = useAiRunStore((s) => s.autoApprove)
  const planMode = useAiRunStore((s) => s.planMode)
  const savedTick = useAiRunStore((s) => s.savedTick)
  const setError = useAiRunStore((s) => s.setError)
  const openConversation = useAiRunStore((s) => s.openConversation)
  const dropConversation = useAiRunStore((s) => s.dropConversation)
  const setConversationId = useAiRunStore((s) => s.setConversationId)
  const ensureConversationId = useAiRunStore((s) => s.ensureConversationId)
  const setAuto = useAiRunStore((s) => s.setAutoApprove)
  const setPlan = useAiRunStore((s) => s.setPlanMode)
  const resolveApproval = useAiRunStore((s) => s.resolveApproval)
  const resetRun = useAiRunStore((s) => s.reset)

  const [input, setInput] = useState('')
  // Skill autocomplete: when input starts with /, show matching skills.
  const [skillMenuOpen, setSkillMenuOpen] = useState(false)
  // Spend across every call ever made, from the main process's log. Separate
  // from `usage`, which is only this conversation.
  const [spend, setSpend] = useState<UsageSummary | null>(null)
  // Per-run efficiency, aggregated by model (ai-run-metrics.json). Shown in the
  // same panel as spend, so a model's cost and its efficiency sit side by side.
  const [runMetrics, setRunMetrics] = useState<RunMetricsSummary | null>(null)
  const [showSpend, setShowSpend] = useState(false)

  // ai-jail sandbox status (merged with config). Null until first fetched.
  const [jailStatus, setJailStatus] = useState<Awaited<
    ReturnType<typeof window.electronAPI.ai.jail.status>
  > | null>(null)
  const [harnessStatuses, setHarnessStatuses] = useState<HarnessStatus[]>([])
  const [loadingHarnessStatuses, setLoadingHarnessStatuses] = useState(false)
  const [harnessCheckFeedback, setHarnessCheckFeedback] = useState<string | null>(null)
  /** Whether the first-run sandbox onboarding modal is showing. */
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Persisted conversation history
  const [conversations, setConversations] = useState<
    { id: string; title: string; updatedAt: string; snippet?: string }[]
  >([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  // User-written Skills (.md files). Use /skill-name in the chat.
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [editingSkill, setEditingSkill] = useState<{
    id?: string
    name: string
    body: string
  } | null>(null)
  const [skillError, setSkillError] = useState<string | null>(null)
  // Images attached to the message being written, and the bytes for every
  // image on screen (id -> dataUrl), loaded from disk on demand.
  const [pendingImages, setPendingImages] = useState<{ id: string; dataUrl: string }[]>([])
  const [imageData, setImageData] = useState<Record<string, string>>({})
  // Documents attached to the message being composed (PDF, DOCX, etc.).
  // The bytes have been parsed on the main process; only the text is kept here.
  const [pendingDocuments, setPendingDocuments] = useState<
    { id: string; name: string; ext: string; text: string; truncated: boolean }[]
  >([])
  const [dragOver, setDragOver] = useState(false)
  // Mirrors historyQuery for the callers that fire from a stale closure — the
  /** Formerly held a proposed task prompt from the old template system — kept so references compile. */
  const [proposed, setProposed] = useState<string | null>(null)
  /** Count of tasks created by the last agent action. */
  const [createdCount] = useState<number | null>(null)
  // debounced autosave refreshes the list and must not undo the filter.
  const historyQueryRef = useRef('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null)
  /** The "you are about to authorise N paid calls" gate — see the Auto button. */
  const [confirmAuto, setConfirmAuto] = useState(false)
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
   * `busy` is global (N runs at once), so on its own it would spin a
   * thinking bubble and offer a "Parar" button at the foot of whatever chat the
   * user opened — for work happening in another one. The transcript's live
   * furniture keys off this instead; the composer keys off `busyHere`,
   * so the current chat is only blocked when *its own* run is in flight.
   */
  const runningHere = busy && runningConvId === conversationId
  const toolRunning = runningHere && messages.some((m) => m.done === false)

  const MESSAGE_PAGE = 80
  const [visibleCount, setVisibleCount] = useState(MESSAGE_PAGE)
  const hasMore = messages.length > visibleCount
  const hiddenCount = messages.length - visibleCount

  const visibleMessages = useMemo(
    () => messages.slice(Math.max(0, messages.length - visibleCount)),
    [messages, visibleCount]
  )

  // Preserve scroll position when expanding: new messages arrive above, so
  // the old content shifts down. Compensate scrollTop to keep the user's view.
  const expandScrollRef = useRef(0)
  const showMore = useCallback(() => {
    if (scrollRef.current) {
      expandScrollRef.current = scrollRef.current.scrollHeight
    }
    setVisibleCount((n) => {
      if (n >= messages.length) return n
      return Math.min(n + MESSAGE_PAGE, messages.length)
    })
  }, [messages.length])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !expandScrollRef.current) return
    const delta = el.scrollHeight - expandScrollRef.current
    if (delta > 0) el.scrollTop += delta
    expandScrollRef.current = 0
  }, [visibleCount])

  const totalTokens = usage.promptTokens + usage.completionTokens + (usage.reasoningTokens ?? 0)
  const reasoningTokens = usage.reasoningTokens
  const cost = estimateCost(usage, config)

  /**
   * What the user is agreeing to when they turn automatic mode on.
   *
   * Leads with the step cap, which is the fact that is always true and always
   * knowable. The money line only appears when there is a real sample to draw
   * it from — with no priced calls logged, any figure here would be invented,
   * and this dialog exists precisely to inform a spending decision.
   */
  const autoSteps = config.maxSteps === undefined ? 20 : resolveMaxSteps(config.maxSteps, true)
  const autoEstimate = estimateAutoRun(spend?.total, autoSteps)
  const autoWarning =
    `O assistente vai encadear até ${autoSteps} rodadas sem pedir aprovação, ` +
    'incluindo ações que gravam dados. Cada rodada é uma chamada paga ao modelo ' +
    'e reenvia todo o histórico da conversa.' +
    (autoEstimate
      ? `\n\nPelas suas ${autoEstimate.sample} chamadas já cobradas, a média é ` +
        `${formatCost(autoEstimate.perCall)} por chamada — cerca de ` +
        `${formatCost(autoEstimate.total)} numa execução cheia. Conte com mais: ` +
        'as últimas rodadas custam acima da média, porque carregam todo o ' +
        'histórico acumulado até ali.'
      : '')

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
          // Undefined = no separate model = one model for everything (routeModel).
          modelComplex: stored.modelComplex,
          // Left undefined on purpose when unset — that's what selects the
          // per-mode default in resolveMaxSteps.
          maxSteps: stored.maxSteps,
          // Likewise undefined = no price configured = no cost quoted.
          inputPricePer1M: stored.inputPricePer1M,
          outputPricePer1M: stored.outputPricePer1M,
          timeoutMs: stored.timeoutMs,
          lastConversationId: stored.lastConversationId,
          // Undefined = the code agent falls back to the chat provider.
          codeAgent: stored.codeAgent,
          // Older configs predate the harness picker and keep using the native runtime.
          codeHarness: stored.codeHarness ?? 'sagyou',
          // Undefined = sandbox required (safe default); only explicit false is off.
          sandboxEnabled: stored.sandboxEnabled,
          sandboxOnboardingDismissed: stored.sandboxOnboardingDismissed,
          reasoningEffort: stored.reasoningEffort
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

  /** Refresh ai-jail status; opens onboarding when required-but-unavailable. */
  const refreshJail = useCallback(async (redetect = false): Promise<void> => {
    const s = await window.electronAPI.ai.jail.status(redetect)
    setJailStatus(s)
    if (!s.available && s.enabled && !s.onboardingDismissed) setShowOnboarding(true)
  }, [])

  // Load the sandbox status when the AI view mounts. Onboarding only appears the
  // first time ai-jail reports unavailable and the user never sees the dialog.
  useEffect(() => {
    void refreshJail()
  }, [refreshJail])

  const refreshHarnesses = useCallback(async (refresh = false): Promise<void> => {
    setLoadingHarnessStatuses(true)
    setHarnessCheckFeedback(null)
    try {
      setHarnessStatuses(await window.electronAPI.ai.harnesses.status(refresh))
      setHarnessCheckFeedback('Verificado agora')
    } catch {
      // A missing/pre-release preload bridge reads as unavailable, never as installed.
      setHarnessStatuses([])
      setHarnessCheckFeedback('Falha ao verificar')
    } finally {
      setLoadingHarnessStatuses(false)
    }
  }, [])

  useEffect(() => {
    if (showConfig) void refreshHarnesses()
  }, [showConfig, refreshHarnesses])

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
    // Best-effort: an older preload without the bridge just leaves it null.
    window.electronAPI.ai.runMetrics?.summary().then(setRunMetrics)
  }

  const refreshSkills = (): void => {
    window.electronAPI.ai.skills.list().then(setSkills)
  }

  // Load the conversation list on mount.
  useEffect(() => {
    refreshConversations()
    refreshSpend()
    refreshSkills()
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
    const state = useAiRunStore.getState()
    if (state.running.size === 0) {
      const convId = state.conversationId
      if (convId) setAuto(convId, false)
    }
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
    if (pendingDocuments.length > 0) {
      void window.electronAPI.ai.documents.delete(pendingDocuments.map((d) => d.id))
      setPendingDocuments([])
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
    const imageIds = [...new Set((conv?.messages ?? []).flatMap((m) => m.imageIds ?? []))]
    if (imageIds.length > 0) await window.electronAPI.ai.images.delete(imageIds)
    const docIds = [...new Set((conv?.messages ?? []).flatMap((m) => m.documentIds ?? []))]
    if (docIds.length > 0) await window.electronAPI.ai.documents.delete(docIds)
    await window.electronAPI.ai.conversations.delete(id)
    // Let the run store forget it too: it may be parked, or be the very chat
    // the loop is writing into, and the file is gone either way.
    dropConversation(id)
    if (id === conversationId) handleNewConversation()
    setConfirmDelete(null)
    refreshConversations()
  }

  /**
   * Take a composer text handed over from another view (a board task).
   *
   * The handoff has to survive a view switch, and AIView is unmounted whenever
   * another view is active — so the text is parked in App and read here on
   * arrival. Consumed on use (like `jumpToEnd`) rather than latched: leaving the
   * AI view and coming back must not retype a task the user already sent or
   * deliberately cleared.
   *
   * ⚠️ **It starts a new conversation**, and that is a cost decision as much as
   * a relevance one. Verified in the real app: the handoff used to land in
   * whatever chat was last open — a task briefing dropped into an 8.1k-token
   * conversation about something else entirely. Every step of a run resends the
   * whole history, so that unrelated context would be paid for again on each of
   * up to AUTO_MAX_STEPS steps, and the model would read a code task through a
   * financial conversation. `handleNewConversation` is the same path the "Nova"
   * button takes, so a run in flight is parked and spared rather than killed.
   *
   * Only when the open chat has something in it: a blank chat is already new,
   * and resetting one would drop the id of a conversation the user just opened.
   *
   * ⚠️ The composer text is appended, never replaced, when the box isn't empty —
   * a half-written message is the user's, and overwriting it loses work nothing
   * can recover.
   */
  useEffect(() => {
    if (!prefill) return
    if (messages.length > 0) handleNewConversation()
    setInput((cur) => (cur.trim() ? `${cur.replace(/\s+$/, '')}\n\n${prefill}` : prefill))
    onPrefillConsumed?.()
    // The cursor belongs after the context, where the instruction gets written.
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
    // handleNewConversation is stable enough for this: it is recreated each
    // render but only ever called on a fresh `prefill`, which is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, onPrefillConsumed])

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

  /**
   * Take pasted or dropped documents (PDF, DOCX, CSV, etc.): send the raw
   * bytes to the main process, which saves the file and parses it. The parsed
   * text stays in memory — it'll be prepended to the message on send.
   */
  const attachDocuments = async (files: File[]): Promise<void> => {
    for (const file of files) {
      try {
        const ext = file.name.split('.').pop()?.toLowerCase()
        if (!ext) {
          setError('Extensão de arquivo não reconhecida')
          continue
        }
        const arrayBuffer = await file.arrayBuffer()
        const data = Array.from(new Uint8Array(arrayBuffer))
        const res = await window.electronAPI.ai.documents.save(file.name, '.' + ext, data)
        if ('error' in res) {
          setError(res.error)
          continue
        }
        setPendingDocuments((p) => [
          ...p,
          { id: res.id, name: res.name, ext: res.ext, text: res.text, truncated: res.truncated }
        ])
      } catch {
        setError('Não consegui ler esse arquivo')
      }
    }
  }

  const removePendingDocument = (id: string): void => {
    setPendingDocuments((p) => p.filter((d) => d.id !== id))
    void window.electronAPI.ai.documents.delete([id])
  }

  const handleSaveSkill = async (): Promise<void> => {
    if (!editingSkill) return
    const res = await window.electronAPI.ai.skills.save(editingSkill)
    if ('error' in res) {
      setSkillError(res.error)
      return
    }
    setSkillError(null)
    setEditingSkill(null)
    refreshSkills()
  }

  const handleDeleteSkill = async (name: string): Promise<void> => {
    await window.electronAPI.ai.skills.delete(name)
    refreshSkills()
    if (editingSkill?.name === name) setEditingSkill(null)
  }

  const handleImportSkill = async (): Promise<void> => {
    try {
      const res = await window.electronAPI.ai.skills.import()
      if ('skill' in res) {
        refreshSkills()
      } else {
        setSkillError(res.error)
      }
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : 'Falha ao importar skill')
    }
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

  // Load the code agent's own model list. Its provider fields fall back to the
  // chat's when blank (same rule as resolveCodeAgentConfig in main), so an empty
  // Base URL/API Key here still lists the chat endpoint's models.
  const handleLoadCodeAgentModels = async (): Promise<void> => {
    const baseUrl = config.codeAgent?.baseUrl?.trim() || config.baseUrl
    const apiKey = config.codeAgent?.apiKey?.trim() || config.apiKey
    if (loadingCodeAgentModels || baseUrl.trim() === '') return
    setLoadingCodeAgentModels(true)
    setCodeAgentModelsError(null)
    try {
      setCodeAgentModels(await fetchModels({ ...config, baseUrl, apiKey }))
    } catch (e) {
      setCodeAgentModelsError(e instanceof Error ? e.message : 'Falha ao carregar modelos')
    } finally {
      setLoadingCodeAgentModels(false)
    }
  }

  // Auto-load the model list the first time the config panel is opened
  useEffect(() => {
    if (showConfig && models.length === 0 && config.baseUrl.trim() !== '') handleLoadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showConfig])

  // Skills matching the current /-prefixed input, for autocomplete.
  const matchedSkills = useMemo(() => {
    if (!input.startsWith('/')) return []
    const query = input.slice(1).trim().toLowerCase()
    if (!query) return skills
    return skills.filter((s) => s.name.toLowerCase().includes(query))
  }, [input, skills])

  /**
   * Hands the message to the store and returns — the run outlives this view, so
   * nothing here waits on it. What the composer owns (the text, the pending
   * attachments) is cleared up front; the transcript, the spend and the
   * approval belong to the run.
   */
  const handleSend = (): void => {
    let text = input.trim()
    if ((!text && pendingImages.length === 0 && pendingDocuments.length === 0) || busyHere) return

    // Prepend parsed document text to the message body so the model reads it
    // inline — no tool call consumed.
    if (pendingDocuments.length > 0) {
      const docBlocks = pendingDocuments.map((d) => {
        const truncated = d.truncated ? ' (texto truncado)' : ''
        return `[Documento: ${d.name}${truncated}]\n${d.text}`
      })
      text = docBlocks.join('\n\n---\n\n') + (text ? '\n\n---\n\n' + text : '')
    }

    // /skill-name: replace with skill body
    if (text.startsWith('/')) {
      const parts = text.slice(1).trim().split(/\s+/)
      const skillName = parts[0]
      const rest = parts.slice(1).join(' ')
      const skill = skills.find((s) => s.name === skillName)
      if (skill) {
        text = skill.body + (rest ? '\n\n' + rest : '')
      }
      // If skill not found, send as-is (model might handle it)
    }

    // When planning mode is on, prepend a planning-mode instruction that tells
    // the assistant to analyse, ask scope questions, and plan — but never write
    // or edit code directly.
    if (planMode.has(conversationId!)) {
      text =
        '[Modo: PLANEJAMENTO] Você está no modo de planejamento. Analise, faça perguntas de escopo e planeje a implementação — NÃO escreva nem edite código agora.\n\n' +
        text
    }

    setInput('')
    setSkillMenuOpen(false)
    const imageIds = pendingImages.map((p) => p.id)
    const documentIds = pendingDocuments.map((d) => d.id)
    setPendingImages([])
    setPendingDocuments([])
    void useAiRunStore.getState().send(config, { text, imageIds, imageData, documentIds })
  }

  /**
   * Keyboard: Esc closes the topmost open thing (one layer per press).
   *
   * Bound to the document rather than to each overlay so it works wherever the
   * focus happens to be (the composer, a dropdown's search box, nothing at
   * all). The order mirrors what's stacked on screen, so Escape never reaches
   * past a dialog to dismiss something behind it.
   *
   * Chat write cards (pendingApproval) are drawn by AiRunHost — the ordering
   * below is why this view keeps answering them while open (the host binds
   * Escape only when the AI view is closed, so exactly one listener acts).
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Ctrl+Tab toggles auto-approve on/off for the current conversation.
      if (e.key === 'Tab' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const convId = ensureConversationId()
        setAuto(convId, !autoApprove.has(convId))
        return
      }
      // Shift+Tab toggles planning mode on/off for the current conversation.
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        if (conversationId) {
          setPlan(conversationId, !planMode.has(conversationId))
        }
        return
      }
      if (e.key !== 'Escape') return
      if (confirmDelete) return setConfirmDelete(null)
      if (pendingApproval.length > 0) {
        // NOT just a close: the agent loop is awaiting this promise, so hiding
        // the card without answering leaves the run hanging forever. Escape is
        // a cancel, and the safe reading of cancel is "approve nothing".
        for (const pa of pendingApproval) {
          resolveApproval(pa.convId, new Set())
        }
        return
      }
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
    conversationId,
    pendingApproval,
    proposed,
    showSpend,
    renaming,
    showHistory,
    showConfig,
    resolveApproval,
    ensureConversationId,
    setAuto,
    setPlan,
    autoApprove,
    planMode
  ])

  /** A USD-per-1M-tokens input. Blank means unset, which hides the cost. */
  const priceField = (
    label: string,
    key: 'inputPricePer1M' | 'outputPricePer1M'
  ): React.JSX.Element => (
    <label className="flex flex-col gap-1 shrink-0 w-44">
      <span className="text-[11px] font-medium text-[#999999]">{label}</span>
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
        className="px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]"
      />
    </label>
  )

  const field = (label: string, key: keyof AIConfig, type = 'text', placeholder = '') => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-[#999999]">{label}</span>
      <input
        type={type}
        value={typeof config[key] === 'string' ? (config[key] as string) : ''}
        placeholder={placeholder}
        onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))}
        className="px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]"
      />
    </label>
  )

  /**
   * A field of the nested codeAgent config; blank falls back to the chat config.
   *
   * `options` turns it into a strict dropdown (no free typing) — used for Model, so
   * the user picks from the chat's loaded model list. The empty choice keeps the
   * "same as chat" fallback, and a stored value not in the list is preserved as its
   * own option (e.g. a model from a different endpoint set earlier).
   */
  const codeAgentField = (
    label: string,
    key: 'baseUrl' | 'apiKey' | 'model',
    type = 'text',
    placeholder = 'como o chat',
    options?: string[],
    loader?: { onLoad: () => void; loading: boolean }
  ): React.JSX.Element => {
    const current = config.codeAgent?.[key] ?? ''
    const setField = (raw: string): void =>
      setConfig((c) => {
        const next = { ...(c.codeAgent ?? {}), [key]: raw }
        // Drop empty fields so an all-blank block persists as absent (= fallback).
        const cleaned = Object.fromEntries(
          Object.entries(next).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
        )
        return { ...c, codeAgent: Object.keys(cleaned).length ? cleaned : undefined }
      })
    const inputClass =
      'px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]'
    const selectEl = options ? (
      <select
        value={current}
        onChange={(e) => setField(e.target.value)}
        className={`min-w-0 ${loader ? 'flex-1' : ''} ${inputClass}`}
      >
        <option value="">{placeholder}</option>
        {current && !options.includes(current) && <option value={current}>{current}</option>}
        {options.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    ) : (
      <input
        type={type}
        value={current}
        placeholder={placeholder}
        onChange={(e) => setField(e.target.value)}
        className={inputClass}
      />
    )
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[#999999]">{label}</span>
        {loader ? (
          <div className="flex gap-1.5">
            {selectEl}
            <button
              onClick={loader.onLoad}
              disabled={loader.loading}
              title="Carregar modelos do endpoint do agente"
              className="shrink-0 px-2 py-1.5 rounded-md bg-[#2a2a2a] border border-[#3b3b3b] text-[#999999] hover:text-[#d4d4d4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loader.loading ? (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-[#7c3aed] border-t-transparent animate-spin" />
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
        ) : (
          selectEl
        )}
      </label>
    )
  }

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#3b3b3b] shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-[#d4d4d4]">Assistente IA</h1>
            <span className="text-xs text-[#999999]">
              {activeProject ? activeProject.name : 'Nenhum projeto selecionado'}
            </span>
            {activeCodePaths.length > 0 && (
              <span
                title={`A IA lê o código em:\n${activeCodePaths.map((c) => c.path).join('\n')}`}
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#7c3aed]/10 text-[11px] text-[#a080f0] max-w-[280px]"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="shrink-0"
                >
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
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
                        (reasoningTokens
                          ? `Raciocínio: ${reasoningTokens.toLocaleString('pt-BR')} tokens\n`
                          : '') +
                        'Soma de todas as chamadas desta conversa. Clique para ver os gastos.'
                      : 'Ver o histórico de chamadas e gastos'
                  }
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] tabular-nums transition-colors ${
                    showSpend
                      ? 'bg-[#7c3aed]/20 text-[#a080f0]'
                      : 'bg-[#2a2a2a] text-[#999999] hover:text-[#d4d4d4]'
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
                      {reasoningTokens ? (
                        <span className="text-[#a080f0]">
                          {' '}
                          +{formatTokens(reasoningTokens)} rac.
                        </span>
                      ) : null}
                      {cost !== null && (
                        <span className="text-[#a080f0]">· {formatCost(cost)}</span>
                      )}
                    </>
                  ) : (
                    'Gastos'
                  )}
                </button>

                {showSpend && spend && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowSpend(false)} />
                    <div className="absolute right-0 top-full mt-1 z-40 w-80 max-h-[26rem] overflow-y-auto rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] shadow-2xl p-3">
                      <p className="text-[11px] font-semibold text-[#d4d4d4] mb-2">
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
                          <div key={label}>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-[11px] text-[#999999]">{label}</span>
                              <span className="text-[11px] text-[#d4d4d4] tabular-nums">
                                {b.calls} {b.calls === 1 ? 'chamada' : 'chamadas'} ·{' '}
                                {formatTokens(b.promptTokens + b.completionTokens)} ·{' '}
                                {b.unpricedCalls === b.calls ? (
                                  <span className="text-[#666666]">sem preço</span>
                                ) : (
                                  <span className="text-[#a080f0]">{formatCost(b.cost)}</span>
                                )}
                              </span>
                            </div>
                            {cacheHitRate(b) !== null && (
                              <div>
                                <div className="w-full h-1 bg-[#3b3b3b] rounded-full mt-0.5">
                                  <div
                                    className="h-full bg-[#46d478] rounded-full"
                                    style={{ width: `${Math.round(cacheHitRate(b)! * 100)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-[#46d478]">
                                  {Math.round(cacheHitRate(b)! * 100)}% cache
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {spend.total.unpricedCalls > 0 && (
                        <p className="mt-2 text-[10px] text-[#666666] leading-relaxed">
                          {spend.total.unpricedCalls} chamada
                          {spend.total.unpricedCalls === 1 ? '' : 's'} sem preço configurado na
                          época — não {spend.total.unpricedCalls === 1 ? 'entra' : 'entram'} no
                          total.
                        </p>
                      )}

                      {spend.byModel.length > 0 && (
                        <>
                          <p className="mt-3 mb-1 text-[10px] font-medium text-[#999999] uppercase tracking-wide">
                            Por modelo
                          </p>
                          {spend.byModel.map(({ model, bucket }) => (
                            <div key={model}>
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-[11px] text-[#d4d4d4] truncate">{model}</span>
                                <span className="text-[11px] text-[#999999] tabular-nums shrink-0">
                                  {bucket.calls}× ·{' '}
                                  {bucket.unpricedCalls === bucket.calls
                                    ? '—'
                                    : formatCost(bucket.cost)}
                                </span>
                              </div>
                              {cacheHitRate(bucket) !== null && (
                                <div>
                                  <div className="w-full h-1 bg-[#3b3b3b] rounded-full mt-0.5">
                                    <div
                                      className="h-full bg-[#46d478] rounded-full"
                                      style={{
                                        width: `${Math.round(cacheHitRate(bucket)! * 100)}%`
                                      }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-[#46d478]">
                                    {Math.round(cacheHitRate(bucket)! * 100)}% cache
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}
                        </>
                      )}

                      {runMetrics && runMetrics.byModel.length > 0 && (
                        <>
                          <p className="mt-3 mb-1 text-[10px] font-medium text-[#999999] uppercase tracking-wide">
                            Eficiência por modelo
                          </p>
                          <p className="mb-1.5 text-[10px] text-[#666666] leading-relaxed">
                            Média por execução do agente ({runMetrics.runs}{' '}
                            {runMetrics.runs === 1 ? 'execução' : 'execuções'}). Menos tokens/passo
                            é mais eficiente.
                          </p>
                          {runMetrics.byModel.map((m) => (
                            <div key={m.model} className="mb-1.5">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-[11px] text-[#d4d4d4] truncate">
                                  {m.model}
                                </span>
                                <span className="text-[11px] text-[#999999] tabular-nums shrink-0">
                                  {m.runs}× · {formatTokens(Math.round(m.avgTotalTokens))}/exec
                                </span>
                              </div>
                              <div className="flex items-baseline justify-between gap-2 text-[10px] text-[#666666] tabular-nums">
                                <span>
                                  {m.avgSteps.toFixed(1)} passos ·{' '}
                                  {formatTokens(Math.round(m.avgTokensPerStep))}/passo
                                </span>
                                <span className="shrink-0">
                                  {m.avgRedundantSearches + m.avgRepeatedReads > 0.05 && (
                                    <span
                                      className="text-[#f0b820]/70"
                                      title="buscas redundantes + releituras freadas, por execução"
                                    >
                                      {(m.avgRedundantSearches + m.avgRepeatedReads).toFixed(1)}
                                    </span>
                                  )}
                                  {m.cappedRate > 0 && (
                                    <span
                                      className="ml-1.5"
                                      title="execuções que bateram o limite de passos"
                                    >
                                      cap {Math.round(m.cappedRate * 100)}%
                                    </span>
                                  )}
                                </span>
                              </div>
                            </div>
                          ))}
                        </>
                      )}

                      {spend.recent.length > 0 && (
                        <>
                          <p className="mt-3 mb-1 text-[10px] font-medium text-[#999999] uppercase tracking-wide">
                            Últimas chamadas
                          </p>
                          <div className="space-y-0.5">
                            {spend.recent.map((e, i) => (
                              <div
                                key={`${e.at}-${i}`}
                                className="flex items-baseline justify-between gap-2"
                              >
                                <span className="text-[10px] text-[#666666] tabular-nums shrink-0">
                                  {new Date(e.at).toLocaleString('pt-BR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </span>
                                <span className="text-[10px] text-[#999999] tabular-nums">
                                  {formatTokens(e.promptTokens)}→{formatTokens(e.completionTokens)}
                                  {typeof e.cost === 'number' && (
                                    <span className="text-[#a080f0]"> {formatCost(e.cost)}</span>
                                  )}
                                  {typeof e.cachedPromptTokens === 'number' && (
                                    <span className="text-[#46d478]"> cache</span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      {spend.total.calls === 0 && (
                        <p className="text-[11px] text-[#666666] italic">
                          Nenhuma chamada registrada ainda.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            <ModeToggleButton
              active={planMode.has(conversationId!)}
              label="Plano"
              activeLabel="Plano: ON"
              onClick={() => {
                if (!conversationId) return
                setPlan(conversationId, !planMode.has(conversationId))
              }}
              title={
                planMode.has(conversationId!)
                  ? 'Modo planejamento LIGADO — a IA analisa e planeja, sem escrever código. Shift+Tab para desligar.'
                  : 'Modo planejamento DESLIGADO — a IA pode escrever e editar código. Shift+Tab para ligar.'
              }
              icon={
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                  <rect x="9" y="3" width="6" height="4" rx="1" />
                  <path d="M9 14h6" />
                  <path d="M9 18h3" />
                </svg>
              }
            />

            <ModeToggleButton
              active={autoApprove.has(conversationId!)}
              label="Auto"
              activeLabel="Auto: ON"
              onClick={() => {
                // Turning it OFF needs no ceremony — it only ever adds
                // approvals back. Turning it ON is the spend decision, and the
                // one moment the user can still say no.
                if (conversationId && autoApprove.has(conversationId))
                  return setAuto(conversationId, false)
                refreshSpend()
                setConfirmAuto(true)
              }}
              title={
                autoApprove.has(conversationId!)
                  ? 'Modo autônomo LIGADO — a IA trabalha sem interrupção. Clique para voltar a pedir aprovação.'
                  : 'Modo autônomo DESLIGADO — cada ação pede sua aprovação. Clique para não perguntar mais.'
              }
            />

            <button
              onClick={handleNewConversation}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
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
                    ? 'bg-[#7c3aed]/20 text-[#a080f0]'
                    : 'text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a]'
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
                  <div className="absolute right-0 top-full mt-1 z-40 w-80 max-h-96 overflow-y-auto rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] shadow-2xl py-1">
                    <div className="sticky top-0 bg-[#1b1b1b] px-2 pt-1 pb-2 border-b border-[#3b3b3b]">
                      <input
                        autoFocus
                        value={historyQuery}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar por título ou conteúdo…"
                        className="w-full px-2.5 py-1.5 rounded-md bg-[#232323] border border-[#3b3b3b] text-xs text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]"
                      />
                    </div>
                    {conversations.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-[#666666] italic text-center">
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
                            c.id === conversationId ? 'bg-[#7c3aed]/10' : 'hover:bg-[#2a2a2a]'
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
                                className="w-full px-1.5 py-0.5 rounded bg-[#1b1b1b] border border-[#7c3aed] text-xs text-[#d4d4d4] focus:outline-none"
                              />
                            ) : (
                              <p className="text-xs text-[#d4d4d4] truncate">{c.title}</p>
                            )}
                            {c.snippet && (
                              // Matched on the body, not the title: show the
                              // line, or the result looks arbitrary.
                              <p className="text-[10px] text-[#999999] truncate italic">
                                {c.snippet}
                              </p>
                            )}
                            <p className="text-[10px] text-[#666666]">
                              {new Date(c.updatedAt).toLocaleString('pt-BR')}
                            </p>
                          </div>
                          {c.id === runningConvId && (
                            // This chat is the one the agent is working in —
                            // worth saying, since it's about to change on its
                            // own and it isn't necessarily the one on screen.
                            <span
                              title="A IA está trabalhando nesta conversa"
                              className="w-3 h-3 shrink-0 rounded-full border-[1.5px] border-[#a080f0] border-t-transparent animate-spin"
                            />
                          )}
                          <button
                            onClick={(e) => startRename(c.id, c.title, e)}
                            title="Renomear conversa"
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-[#999999] hover:text-[#d4d4d4] shrink-0"
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
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-[#999999] hover:text-[#e04040] shrink-0"
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
                  ? 'bg-[#7c3aed]/20 text-[#a080f0]'
                  : 'text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a]'
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
          <div className="max-h-[70vh] overflow-y-auto overscroll-contain px-6 py-4 border-b border-[#3b3b3b] bg-[#232323] shrink-0">
            <span className="text-[11px] font-medium text-[#999999]">Chat</span>
            <p className="mt-1 mb-2 text-[11px] leading-relaxed text-[#666666]">
              Provider e modelo que o assistente usa para <b>conversar com você</b> no chat — ler
              seus dados, analisar e responder. É o modelo principal do app.
            </p>
            <div className="grid grid-cols-3 gap-3">
              {field('Base URL', 'baseUrl', 'text', 'https://api.openai.com/v1')}
              {field('API Key', 'apiKey', 'password', 'sk-...')}
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[#999999]">Model</span>
                <div className="flex gap-1.5">
                  <select
                    value={config.model}
                    onChange={(e) => {
                      const model = e.target.value
                      setConfig((c) => {
                        // Auto-fill base URL when the model maps to a known provider
                        // and the current URL is empty or matches a different provider.
                        const url = providerForModel(model)
                        const currentUrl = c.baseUrl.trim()
                        const shouldFill =
                          url &&
                          (!currentUrl ||
                            Object.values(MODEL_PROVIDER).includes(currentUrl) ||
                            currentUrl.includes('localhost'))
                        return { ...c, model, ...(shouldFill ? { baseUrl: url } : {}) }
                      })
                    }}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed]"
                  >
                    {models.length === 0 && (
                      <option value={config.model || ''}>
                        {config.model || 'Carregue os modelos…'}
                      </option>
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
                    className="shrink-0 px-2 py-1.5 rounded-md bg-[#2a2a2a] border border-[#3b3b3b] text-[#999999] hover:text-[#d4d4d4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {loadingModels ? (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-[#7c3aed] border-t-transparent animate-spin" />
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
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[#999999]">
                  Modelo do chat para conversar sobre código (opcional)
                </span>
                <select
                  value={config.modelComplex ?? ''}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, modelComplex: e.target.value || undefined }))
                  }
                  className="px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed]"
                >
                  <option value="">Mesmo do principal</option>
                  {/* The loaded list, plus whatever is stored (may not be listed yet). */}
                  {config.modelComplex && !models.includes(config.modelComplex) && (
                    <option value={config.modelComplex}>{config.modelComplex}</option>
                  )}
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[#999999]">
              O <b>modelo principal</b> (acima) responde tudo no chat. Aqui você pode definir um{' '}
              <b>segundo modelo, mais forte, só para mensagens de código</b>: quando você escreve
              algo como "tem um bug aqui", "refatora essa função" ou "otimiza isso", a resposta usa
              este modelo; perguntas comuns ("quantas tasks fiz essa semana?") continuam no
              principal — assim você só paga o modelo caro quando o assunto é código. Vale para o
              chat <b>conversar e analisar</b>; quem de fato <b>edita os arquivos</b> é o Agente de
              Código (mais abaixo). Deixe em "mesmo do principal" para usar um único modelo em tudo.
            </p>
            <label className="flex flex-col gap-1 mt-3">
              <span className="text-[11px] font-medium text-[#999999]">
                Esforço de raciocínio (DeepSeek)
              </span>
              <select
                value={config.reasoningEffort ?? ''}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    reasoningEffort: (e.target.value || undefined) as
                      | 'low'
                      | 'medium'
                      | 'high'
                      | undefined
                  }))
                }
                className="px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed]"
              >
                <option value="">Padrão do provedor</option>
                <option value="low">Baixo</option>
                <option value="medium">Médio</option>
                <option value="high">Alto</option>
              </select>
            </label>
            <div className="mt-3 flex items-start gap-3">
              <label className="flex flex-col gap-1 shrink-0 w-40">
                <span className="text-[11px] font-medium text-[#999999]">Passos máximos</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_STEPS_LIMIT}
                  value={config.maxSteps ?? ''}
                  placeholder="Padrão adaptativo (2–20)"
                  onChange={(e) => {
                    const raw = e.target.value.trim()
                    // Empty means "unset" — that's what selects the per-mode default.
                    setConfig((c) => ({
                      ...c,
                      maxSteps: raw === '' ? undefined : Number(raw)
                    }))
                  }}
                  className="px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]"
                />
              </label>
              <div className="pt-5">
                <p className="text-[11px] text-[#666666] leading-relaxed">
                  Quantas rodadas de ferramentas o assistente pode encadear numa resposta — cada
                  rodada é uma chamada paga ao modelo. Em branco escolhe o orçamento pela tarefa:{' '}
                  <b>2</b> para leitura pontual, <b>4</b> para ajuste simples, <b>8</b> para
                  implementação normal e <b>15</b> para tarefa complexa (até <b>20</b> no
                  automático). Um valor definido vale para os dois modos (máx. {MAX_STEPS_LIMIT}).
                </p>
                {config.maxSteps !== undefined && config.maxSteps < LOW_STEPS_WARNING && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[#f0b820]/90 leading-relaxed">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="shrink-0 mt-0.5"
                    >
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span>
                      Com apenas {config.maxSteps} passo{config.maxSteps === 1 ? '' : 's'}, tarefas
                      maiores podem não ser concluídas — ler e pesquisar o código já consome vários
                      passos antes de qualquer alteração. O assistente para no limite e responde com
                      o que tiver feito até ali.
                    </span>
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-start gap-3">
              <label className="flex flex-col gap-1 shrink-0 w-40">
                <span className="text-[11px] font-medium text-[#999999]">Timeout (segundos)</span>
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
                  className="px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]"
                />
              </label>
              <p className="text-[11px] text-[#666666] pt-5 leading-relaxed">
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
              <p className="text-[11px] text-[#666666] pt-5 leading-relaxed">
                Preços do seu provider, para estimar o custo da conversa. O app não tem como saber
                sozinho — ele fala com qualquer endpoint compatível com OpenAI, inclusive modelos
                locais (custo zero). Deixe em branco e o header mostra só os tokens.
              </p>
            </div>

            <div className="mt-3 flex items-start gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.usePromptCaching !== false}
                  onChange={(e) => setConfig((c) => ({ ...c, usePromptCaching: e.target.checked }))}
                  className="accent-[#7c3aed]"
                />
                <span className="text-[11px] font-medium text-[#999999]">
                  Cache de prefixo ativo
                </span>
              </label>
              <p className="text-[11px] text-[#666666] pt-0 leading-relaxed">
                Quando ligado (padrão), mantém o histórico estável para maximizar o cache do
                provedor (DeepSeek ~50x mais barato, Claude, Gemini). Desligue se o provedor não
                tiver cache — resultados de leitura repetidos serão podados para economizar tokens.
              </p>
            </div>

            <div className="mt-3 pt-3 border-t border-[#3b3b3b]">
              <span className="text-[11px] font-medium text-[#999999]">Agente de Código</span>
              <p className="mt-1 mb-2 text-[11px] leading-relaxed text-[#666666]">
                Modelo que <b>escreve as alterações nos seus arquivos</b> quando o assistente decide
                mexer no código — diferente do chat acima, que só conversa e analisa. Tem provider
                próprio: deixe <b>Base URL</b> e <b>API Key</b> em branco para reaproveitar os do
                chat e preencha só o <b>Model</b> para apontar o agente a um modelo mais forte (ou a
                um modelo local, custo zero). Como editar código é a parte pesada, costuma valer um
                modelo melhor aqui do que no chat.
              </p>
              <div className="mb-3 rounded-lg border border-[#3b3b3b] bg-[#202020] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-medium text-[#d4d4d4]">Harness de execução</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-[#777777]">
                      Define qual runtime executa tarefas que alteram código. A escolha é salva por
                      dispositivo.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {config.codeHarness === 'sagyou' && (
                      <span className="rounded-full border border-[#d7a347]/35 bg-[#d7a347]/10 px-2 py-0.5 text-[10px] font-medium text-[#e8bc70]">
                        EM TESTE
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void refreshHarnesses(true)}
                      disabled={loadingHarnessStatuses}
                      className="text-[10px] text-[#a080f0] hover:text-[#d4d4d4] disabled:cursor-wait disabled:opacity-50"
                    >
                      {loadingHarnessStatuses
                        ? 'Verificando…'
                        : (harnessCheckFeedback ?? 'Verificar novamente')}
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      ['sagyou', 'Sagyou'],
                      ['codex', 'Codex'],
                      ['opencode', 'OpenCode'],
                      ['claude-code', 'Claude Code']
                    ] as const
                  ).map(([value, label]) => {
                    const selected = (config.codeHarness ?? 'sagyou') === value
                    const status =
                      value === 'sagyou'
                        ? null
                        : harnessStatuses.find((harness) => harness.id === value)
                    const detail =
                      value === 'sagyou'
                        ? 'Nativo · em teste'
                        : loadingHarnessStatuses
                          ? 'Verificando…'
                          : status?.installed
                            ? status.version
                              ? 'Instalado · ' + status.version
                              : 'Instalado'
                            : 'Não encontrado'
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setConfig((c) => ({ ...c, codeHarness: value }))}
                        className={
                          'rounded-md border px-2.5 py-2 text-left transition-colors ' +
                          (selected
                            ? 'border-[#a080f0] bg-[#7c3aed]/15 text-[#e3dcff]'
                            : 'border-[#3b3b3b] bg-[#181818] text-[#b0b0b0] hover:border-[#666666]')
                        }
                        aria-pressed={selected}
                      >
                        <span className="block text-[11px] font-medium">{label}</span>
                        <span className="mt-0.5 block text-[10px] text-[#777777]">{detail}</span>
                      </button>
                    )
                  })}
                </div>
                {config.codeHarness && config.codeHarness !== 'sagyou' ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-[#d7a347]">
                    {config.codeHarness === 'claude-code'
                      ? 'Claude Code'
                      : config.codeHarness === 'opencode'
                        ? 'OpenCode'
                        : 'Codex'}{' '}
                    {loadingHarnessStatuses
                      ? 'está sendo verificado nesta máquina.'
                      : harnessStatuses.find((harness) => harness.id === config.codeHarness)
                            ?.installed
                        ? 'vai executar em um worktree isolado e pedirá sua aprovação antes de aplicar o diff ao projeto. As credenciais e o modelo são configurados no próprio CLI.'
                        : 'não foi encontrado nesta máquina. Instale o CLI correspondente e use Verificar novamente.'}
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] leading-relaxed text-[#e8bc70]">
                    O harness Sagyou está em teste. Use aprovações manuais e confira o diff antes de
                    aceitar alterações.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {codeAgentField('Base URL', 'baseUrl', 'text', config.baseUrl || 'como o chat')}
                {codeAgentField(
                  'API Key',
                  'apiKey',
                  'password',
                  config.apiKey ? '••••' : 'como o chat'
                )}
                {/* Dropdown estrito. Usa a lista própria do agente quando carregada
                    (botão ⟳), senão a do chat. O botão busca no endpoint do agente. */}
                {codeAgentField(
                  'Model',
                  'model',
                  'text',
                  config.model || 'como o chat',
                  codeAgentModels.length ? codeAgentModels : models,
                  { onLoad: handleLoadCodeAgentModels, loading: loadingCodeAgentModels }
                )}
              </div>
              {codeAgentModelsError && (
                <p className="mt-1.5 text-[11px] text-[#e04040]">
                  Modelos do agente: {codeAgentModelsError}
                </p>
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-[#3b3b3b]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-[#999999]">Skills</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setSkillError(null)
                      setEditingSkill({ name: '', body: '' })
                    }}
                    className="text-[11px] text-[#a080f0] hover:text-[#d4d4d4]"
                  >
                    + Nova skill
                  </button>
                  <button
                    onClick={handleImportSkill}
                    className="text-[11px] text-[#a080f0] hover:text-[#d4d4d4]"
                  >
                    Importar .md
                  </button>
                </div>
              </div>

              {skills.length === 0 && !editingSkill && (
                <p className="text-[11px] text-[#666666] italic">
                  Nenhuma skill ainda. Crie uma para usar com / no chat.
                </p>
              )}

              <div className="space-y-1">
                {skills.map((s) => (
                  <div key={s.name} className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate text-[11px] text-[#d4d4d4]">
                      {s.name}
                    </span>
                    <button
                      onClick={() => {
                        setSkillError(null)
                        setEditingSkill({ name: s.name, body: s.body })
                      }}
                      className="text-[11px] text-[#999999] hover:text-[#d4d4d4]"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteSkill(s.name)}
                      className="text-[11px] text-[#999999] hover:text-[#e04040]"
                    >
                      Apagar
                    </button>
                  </div>
                ))}
              </div>

              {editingSkill && (
                <div className="mt-2 space-y-2">
                  <input
                    value={editingSkill.name}
                    onChange={(e) =>
                      setEditingSkill((s) => (s ? { ...s, name: e.target.value } : s))
                    }
                    placeholder="Nome da skill (ex: criar-projeto)"
                    className="w-full px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]"
                  />
                  <textarea
                    aria-label="Conteúdo da skill"
                    value={editingSkill.body}
                    onChange={(e) =>
                      setEditingSkill((s) => (s ? { ...s, body: e.target.value } : s))
                    }
                    rows={8}
                    spellCheck={false}
                    className="w-full resize-y px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-[11px] font-mono text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed]"
                  />
                  <p className="text-[10px] text-[#666666] leading-relaxed">
                    O conteúdo da skill é enviado como contexto no chat. Use markdown.
                  </p>
                  {skillError && <p className="text-[11px] text-[#e04040]">{skillError}</p>}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveSkill}
                      className="px-3 py-1 rounded-md bg-[#7c3aed] text-xs text-white font-medium hover:bg-[#6d28d9]"
                    >
                      Salvar
                    </button>
                    <button
                      onClick={() => {
                        setEditingSkill(null)
                        setSkillError(null)
                      }}
                      className="px-3 py-1 rounded-md text-xs text-[#999999] hover:text-[#d4d4d4]"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Sandbox toggle — the ONLY barrier between the native agent and the
                rest of the disk. Checked = required (default). Greyed when ai-jail
                isn't installed, with a way to open onboarding. Unchecking it
                runs shell commands unconfined. */}
            <div className="mt-4 pt-4 border-t border-[#3b3b3b]">
              <label
                className={`flex items-center gap-2 cursor-pointer select-none ${
                  jailStatus && !jailStatus.available ? 'opacity-50' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={config.sandboxEnabled !== false}
                  disabled={!!jailStatus && !jailStatus.available}
                  onChange={(e) => {
                    setConfig((c) => ({
                      ...c,
                      sandboxEnabled: e.target.checked ? undefined : false
                    }))
                  }}
                  className="w-3.5 h-3.5 accent-[#7c3aed]"
                />
                <span className="text-[12px] text-[#d4d4d4]">Sandbox (ai-jail)</span>
                {jailStatus?.available && jailStatus.version && (
                  <span className="text-[10px] text-[#666666]">v{jailStatus.version}</span>
                )}
              </label>
              {jailStatus && !jailStatus.available && (
                <div className="mt-1.5 text-[11px] text-[#999999]">
                  {/* When the kernel blocks the namespaces, ai-jail IS installed —
                      bail the user out without telling them to install it again. */}
                  {/apparmor_restrict_unprivileged_userns/.test(jailStatus.reason ?? '')
                    ? 'Sandbox indisponível.'
                    : 'ai-jail não instalado.'}{' '}
                  <button
                    onClick={() => setShowOnboarding(true)}
                    className="text-[#a080f0] hover:underline"
                  >
                    {/apparmor_restrict_unprivileged_userns/.test(jailStatus.reason ?? '')
                      ? 'Ver detalhes'
                      : 'Instalar ai-jail'}
                  </button>
                  {jailStatus.reason ? ` — ${jailStatus.reason}` : ''}
                </div>
              )}
              {config.sandboxEnabled === false && (
                <p className="mt-1.5 text-[11px] text-[#f0c210]">
                  Desativar o sandbox permite que o agente acesse qualquer arquivo do sistema.
                </p>
              )}
            </div>

            {modelsError ? (
              <p className="mt-2 text-[11px] text-[#e04040]">Modelos: {modelsError}</p>
            ) : (
              <p className="mt-2 text-[11px] text-[#666666]">
                Endpoint compatível com OpenAI (<code>/chat/completions</code>). Os modelos vêm de{' '}
                <code>/models</code> — clique em atualizar para listar. A chave é salva localmente
                neste dispositivo.
              </p>
            )}
          </div>
        )}

        {/* First-run sandbox onboarding modal */}
        {showOnboarding && jailStatus && (
          <SandboxOnboarding
            status={jailStatus as JailStatus}
            onDismiss={() => setShowOnboarding(false)}
            onInstalled={() => void refreshJail(true)}
          />
        )}

        {/* Chat */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div>
                <p className="text-[#d4d4d4] font-medium mb-1">Converse com o modelo</p>
                <p className="text-sm text-[#999999]">
                  Converse com o modelo ou use <b>/skill-name</b> no chat.
                </p>
              </div>
            </div>
          ) : (
            <>
              {hasMore && (
                <div className="flex justify-center sticky top-0 z-10 py-1">
                  <button
                    onClick={showMore}
                    className="px-4 py-1.5 rounded-full bg-[#2a2a2a] border border-[#3b3b3b] text-xs text-[#999999] hover:text-[#d4d4d4] hover:border-[#555555] transition-colors shadow-lg"
                  >
                    Mostrar {hiddenCount > MESSAGE_PAGE ? `${MESSAGE_PAGE}+` : hiddenCount} mensage
                    {hiddenCount === 1 ? 'm' : 'ns'} anterior{hiddenCount === 1 ? '' : 'es'}
                  </button>
                </div>
              )}
              {visibleMessages.map((m, i) =>
                m.role === 'status' ? (
                  <MemoStatusLine
                    key={messages.length - visibleMessages.length + i}
                    text={m.content}
                    state={statusState(m, runningHere)}
                    step={m.step}
                    maxSteps={m.maxSteps}
                    tokens={m.tokens}
                  />
                ) : (
                  <MessageBubble
                    key={messages.length - visibleMessages.length + i}
                    m={m}
                    index={messages.length - visibleMessages.length + i}
                    imageData={imageData}
                  />
                )
              )}
            </>
          )}
          {runningHere && (
            <div className="flex flex-col items-start gap-1.5">
              {streaming ? (
                // The answer typing itself out — same bubble as a finished
                // message, with a caret trailing the text.
                <div className="max-w-[88%] px-3.5 py-2 rounded-2xl rounded-bl-sm text-sm break-words bg-[#2a2a2a] text-[#d4d4d4] border border-[#3b3b3b]">
                  <ChatMarkdown content={streaming} />
                  <span className="inline-block w-[2px] h-3.5 ml-0.5 align-[-1px] bg-[#a080f0] animate-pulse" />
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
                  <div className="px-3.5 py-2 rounded-2xl bg-[#2a2a2a] border border-[#3b3b3b]">
                    <div className="w-4 h-4 rounded-full border-2 border-[#7c3aed] border-t-transparent animate-spin" />
                  </div>
                )
              )}
              {/* Icon-only stop, as in Claude/ChatGPT: the square reads as
                  "stop" on its own, so the label is left to the tooltip. */}
              <button
                onClick={() => useAiRunStore.getState().abort()}
                title="Parar"
                aria-label="Parar"
                className="flex items-center justify-center w-7 h-7 rounded-full bg-[#2a2a2a] border border-[#3b3b3b] text-[#999999] hover:text-[#d4d4d4] hover:border-[#555555] transition-colors"
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
          <div className="px-6 py-2 text-xs text-[#46d478] bg-[#20b858]/10 border-t border-[#20b858]/20 shrink-0">
            {createdCount} task{createdCount === 1 ? '' : 's'} criada{createdCount === 1 ? '' : 's'}{' '}
            em {activeProject?.name}.
          </div>
        )}
        {error && (
          <div className="px-6 py-2 text-xs text-[#e04040] bg-[#e04040]/10 border-t border-[#e04040]/20 shrink-0">
            {error}
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
            const images = imageFilesFrom(e.dataTransfer)
            const docs = documentFilesFrom(e.dataTransfer)
            if (images.length === 0 && docs.length === 0) return
            e.preventDefault()
            setDragOver(false)
            if (images.length > 0) void attachImages(images)
            if (docs.length > 0) void attachDocuments(docs)
          }}
          className={`px-6 py-3 border-t shrink-0 transition-colors ${
            dragOver ? 'border-[#7c3aed] bg-[#7c3aed]/5' : 'border-[#3b3b3b]'
          }`}
        >
          {!configReady && (
            <p className="mb-2 text-[11px] text-[#f08a34]">
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
                    className="h-16 w-16 object-cover rounded-md border border-[#3b3b3b]"
                  />
                  <button
                    onClick={() => removePendingImage(img.id)}
                    title="Remover"
                    aria-label="Remover imagem"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-[#2a2a2a] border border-[#3b3b3b] text-[#999999] opacity-0 group-hover:opacity-100 hover:text-[#e04040] transition-opacity"
                  >
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {pendingDocuments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {pendingDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="relative group flex items-center gap-2 px-2 py-1 rounded-md border border-[#3b3b3b] bg-[#1b1b1b] text-xs"
                >
                  <span className="text-[#7c3aed] font-medium">
                    {doc.ext.replace('.', '').toUpperCase()}
                  </span>
                  <span className="text-[#999999] max-w-[160px] truncate">{doc.name}</span>
                  {doc.truncated && (
                    <span className="text-[#f08a34]" title="O texto do documento foi truncado">
                      (cortado)
                    </span>
                  )}
                  <button
                    onClick={() => removePendingDocument(doc.id)}
                    title="Remover"
                    aria-label="Remover documento"
                    className="ml-1 w-5 h-5 flex items-center justify-center rounded-full bg-[#2a2a2a] border border-[#3b3b3b] text-[#999999] opacity-0 group-hover:opacity-100 hover:text-[#e04040] transition-opacity"
                  >
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
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
              className="flex items-center gap-2 mb-2 px-1 text-xs text-[#999999] hover:text-[#d4d4d4] transition-colors"
            >
              <span className="w-3 h-3 shrink-0 rounded-full border-[1.5px] border-[#a080f0] border-t-transparent animate-spin" />
              A IA está trabalhando em outra conversa — abrir
            </button>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              onPaste={(e) => {
                const images = imageFilesFrom(e.clipboardData)
                const docs = documentFilesFrom(e.clipboardData)
                if (images.length > 0 || docs.length > 0) {
                  e.preventDefault()
                  if (images.length > 0) void attachImages(images)
                  if (docs.length > 0) void attachDocuments(docs)
                  return
                }
                // otherwise let ordinary text paste through
              }}
              value={input}
              onChange={(e) => {
                const v = e.target.value
                setInput(v)
                // Skill autocomplete: open when user types /, filter as they type.
                if (v.startsWith('/')) {
                  setSkillMenuOpen(true)
                } else {
                  setSkillMenuOpen(false)
                }
              }}
              onKeyDown={(e) => {
                // Tab in skill menu: select the first match and close.
                if (e.key === 'Tab' && skillMenuOpen && matchedSkills.length > 0) {
                  e.preventDefault()
                  const skill = matchedSkills[0]
                  setInput(`/${skill.name} `)
                  setSkillMenuOpen(false)
                  return
                }
                // Escape closes the skill menu without clearing input.
                if (e.key === 'Escape' && skillMenuOpen) {
                  e.preventDefault()
                  setSkillMenuOpen(false)
                  return
                }
                // Enter sends; Shift+Enter is a newline. Ctrl/Cmd+Enter sends
                // too — neither sets shiftKey, so they fall out of the same
                // condition, which is why this reads as one rule rather than
                // three. Tested, because that is easy to break by "tidying".
                if (e.key === 'Enter' && !e.shiftKey && !skillMenuOpen) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Descreva o projeto ou faça uma pergunta…"
              rows={2}
              disabled={!configReady || busyHere}
              // maxHeight repeats the JS cap so the box stays bounded even if a
              // measurement is off; min-h holds the original two-line resting
              // size, which the inline height would otherwise undercut.
              style={{ maxHeight: COMPOSER_MAX_PX }}
              className="flex-1 resize-none overflow-y-auto min-h-[58px] px-3 py-2 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed] disabled:opacity-50"
            />
            <div className="flex flex-col gap-2">
              <button
                onClick={handleSend}
                disabled={
                  !configReady ||
                  busyHere ||
                  (input.trim() === '' &&
                    pendingImages.length === 0 &&
                    pendingDocuments.length === 0)
                }
                className="px-3 py-1.5 rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] text-sm text-[#d4d4d4] font-medium hover:bg-[#3b3b3b] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Enviar
              </button>
            </div>
          </div>

          {/* Skill visual chip: shown when input starts with /skill-name */}
          {input.startsWith('/') &&
            (() => {
              const parts = input.slice(1).trim().split(/\s+/)
              const name = parts[0]
              const skill = skills.find((s) => s.name === name)
              return (
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${
                      skill
                        ? 'bg-[#46d478]/15 text-[#46d478] border border-[#46d478]/30'
                        : 'bg-[#f0b820]/15 text-[#f0b820] border border-[#f0b820]/30'
                    }`}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    {skill ? `/${skill.name}` : `/${name}`}
                  </span>
                  {skill ? (
                    <span className="text-[10px] text-[#46d478]/70">
                      Skill reconhecida — corpo será enviado ao modelo
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#f0b820]/70">
                      Skill não encontrada — texto enviado como está
                    </span>
                  )}
                </div>
              )
            })()}

          {/* Skill autocomplete dropdown */}
          {skillMenuOpen && matchedSkills.length > 0 && (
            <div className="mt-1 rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] shadow-lg overflow-hidden max-h-48 overflow-y-auto">
              {matchedSkills.map((skill) => (
                <button
                  key={skill.name}
                  onClick={() => {
                    setInput(`/${skill.name} `)
                    setSkillMenuOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-[#d4d4d4] hover:bg-[#3b3b3b] transition-colors"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="shrink-0 text-[#999999]"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="font-medium">/{skill.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation modals */}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Apagar conversa"
        message={`Apagar "${confirmDelete?.title ?? ''}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Apagar"
        onConfirm={confirmDeleteConversation}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmDialog
        open={confirmAuto}
        title="Ligar o modo automático"
        message={autoWarning}
        confirmLabel="Ligar automático"
        onConfirm={() => {
          // A blank transcript normally receives its id with the first
          // message. Auto approval is keyed by that id, so the explicit user
          // confirmation must mint it before enabling the mode.
          setAuto(ensureConversationId(), true)
          setConfirmAuto(false)
        }}
        onCancel={() => setConfirmAuto(false)}
      />
    </>
  )
}
