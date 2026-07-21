import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
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
  LOW_STEPS_WARNING,
  resolveMaxSteps,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  type AIConfig,
  type TokenUsage
} from '../ai/agent'
import { describeToolActivity } from '../ai/tools'
import { toScaledDataUrl, imageFilesFrom } from '../utils/images'
import { estimateAutoRun } from '../utils/spend'
import { ChatMarkdown } from './ChatMarkdown'
import { CodeDiff, type CodeAgentDiff } from './CodeDiff'
import { AgentTerminal } from './AgentTerminal'
import { AgentRunPicker, type AgentRunMeta } from './AgentRunPicker'
import { SandboxOnboarding, type JailStatus } from './SandboxOnboarding'
import { ConfirmDialog } from './ConfirmDialog'

// Colouring for the approval card's write diff — same language as CodeDiff so a
// diff reads the same whether reviewed before or after the write.
const DIFF_LINE_CLASS: Record<'add' | 'del' | 'ctx' | 'meta', string> = {
  add: 'bg-emerald-500/10 text-emerald-300',
  del: 'bg-red-500/10 text-red-300',
  ctx: 'text-[#8892a4]',
  meta: 'text-[#4a5068] bg-[#0d0f18]'
}
const DIFF_MARK: Record<'add' | 'del' | 'ctx' | 'meta', string> = { add: '+', del: '-', ctx: ' ', meta: '' }

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
type RunMetricsSummary = Awaited<ReturnType<typeof window.electronAPI.ai.runMetrics.summary>>

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
      {badge && (
        <span
          title={`Passo ${step} de ${maxSteps} desta execução`}
          className="mt-[1px] shrink-0 px-1.5 py-[1px] rounded text-[10px] font-medium tabular-nums bg-[#1e2235] border border-[#2a2d42] text-[#8892a4]"
        >
          {badge}
        </span>
      )}
      {tokens !== undefined && tokens > 0 && (
        <span
          title="tokens desta chamada do modelo (prompt + resposta). Cresce a cada passo porque o histórico é reenviado."
          className="mt-[1px] shrink-0 px-1.5 py-[1px] rounded text-[10px] font-medium tabular-nums bg-[#1e2235] border border-[#2a2d42] text-[#6b7280]"
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
  // Per-run efficiency, aggregated by model (ai-run-metrics.json). Shown in the
  // same panel as spend, so a model's cost and its efficiency sit side by side.
  const [runMetrics, setRunMetrics] = useState<RunMetricsSummary | null>(null)
  const [showSpend, setShowSpend] = useState(false)

  // Confirmation modal state (Gerar Tasks)
  const [proposed, setProposed] = useState<AITaskInput[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // External code-agent output (streamed from the main process)
  const [agentLog, setAgentLog] = useState('')
  const [agentRunning, setAgentRunning] = useState(false)
  /** The real model the running agent is using (native agent), for the panel. */
  const [agentModel, setAgentModel] = useState('')
  /** Live step + running token total of the current run, for the panel counter. */
  const [agentProgress, setAgentProgress] = useState<{
    step: number
    maxSteps: number
    promptTokens: number
    completionTokens: number
  } | null>(null)
  /** A write/command the loop is parked on, awaiting the user's OK. Null = none. */
  const [agentApproval, setAgentApproval] = useState<{
    id: string
    name: string
    args: Record<string, unknown>
    resumo: string
    conteudo?: string
    comando?: string
    diff?: { kind: 'add' | 'del' | 'ctx' | 'meta'; text: string }[]
    diffTruncated?: boolean
    irreversivel?: boolean
  } | null>(null)
  /** ai-jail sandbox status (merged with config). Null until first fetched. */
  const [jailStatus, setJailStatus] = useState<
    Awaited<ReturnType<typeof window.electronAPI.ai.jail.status>> | null
  >(null)
  /** Whether the first-run sandbox onboarding modal is showing. */
  const [showOnboarding, setShowOnboarding] = useState(false)
  /** What the last agent run changed. Null until asked for. */
  const [agentDiff, setAgentDiff] = useState<CodeAgentDiff | null>(null)
  const [showDiff, setShowDiff] = useState(true)
  // The raw log is the *secondary* view now: what the user wants while an agent
  // works is which files changed, not every file it read. The log stays one
  // click away for when a run goes wrong.
  const [showLog, setShowLog] = useState(false)
  /**
   * Archived runs of the open conversation, and which one the panel is showing.
   *
   * `selectedRunId === null` means the live run — the panel's normal state. A
   * selected run replaces both the log and the diff with the snapshot frozen
   * when that agent exited; nothing about it is re-derived, because a diff
   * recomputed today would attribute the user's own later edits to the agent.
   */
  /**
   * Whether the agent panel is expanded.
   *
   * Closing **collapses to a one-line bar rather than hiding the panel**: a hard
   * close would strand the run history, which is only reachable from this
   * header — the user would have no way back short of starting another run.
   */
  const [agentPanelOpen, setAgentPanelOpen] = useState(true)
  const [pastRuns, setPastRuns] = useState<AgentRunMeta[]>([])
  /** The picked run *and* the chat it was picked in — see `selectedRunId`. */
  const [selection, setSelection] = useState<{ convId: string; id: string } | null>(null)
  /** The fetched snapshot. Carries its own id so it can be matched, not assumed. */
  const [snapshot, setSnapshot] = useState<{
    id: string
    log: string
    diff: CodeAgentDiff | null
  } | null>(null)
  /**
   * A recognised environment failure from the last run, with its fix. Shown in
   * the panel itself: this is the case where the agent exits 0 having changed
   * nothing, so the user has no reason to go open the log and look for it.
   */
  const [agentHint, setAgentHint] = useState<{
    title: string
    detail: string
    command?: string
  } | null>(null)
  const [hintCopied, setHintCopied] = useState(false)

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

  /**
   * What the user is agreeing to when they turn automatic mode on.
   *
   * Leads with the step cap, which is the fact that is always true and always
   * knowable. The money line only appears when there is a real sample to draw
   * it from — with no priced calls logged, any figure here would be invented,
   * and this dialog exists precisely to inform a spending decision.
   */
  const autoSteps = resolveMaxSteps(config.maxSteps, true)
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
          taskTemplateId: stored.taskTemplateId,
          // Undefined = the code agent falls back to the chat provider.
          codeAgent: stored.codeAgent,
          // Undefined = sandbox required (safe default); only explicit false is off.
          sandboxEnabled: stored.sandboxEnabled,
          sandboxOnboardingDismissed: stored.sandboxOnboardingDismissed
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

  /**
   * The archived runs of whichever chat is open. Declared above the listeners
   * below, which call it — a `const` used before its line is a TDZ trap waiting
   * for someone to move a call into render.
   */
  const refreshRuns = async (id: string | null): Promise<void> => {
    setPastRuns(id ? await window.electronAPI.ai.codeAgent.runs(id) : [])
  }

  /** Ask main what the last run changed. Cheap and idempotent — it's derived. */
  const loadDiff = async (): Promise<void> => {
    setAgentDiff(await window.electronAPI.ai.codeAgent.diff())
  }

  /** Refresh ai-jail status; opens onboarding when required-but-unavailable. */
  const refreshJail = async (redetect = false): Promise<void> => {
    const s = await window.electronAPI.ai.jail.status(redetect)
    setJailStatus(s)
    if (!s.available && s.enabled && !s.onboardingDismissed) setShowOnboarding(true)
  }

  // Load the sandbox status when the AI view mounts. Onboarding only appears the
  // first time (until installed or dismissed); a machine that already has
  // ai-jail reports available and never sees the dialog.
  useEffect(() => {
    void refreshJail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      if (s.running) setShowLog(true)
      setAgentModel(s.model ?? '')
      // Replace rather than append: this IS the log, tail and all. Appending
      // would double every line for a user who never left.
      if (s.log) setAgentLog(s.log)
      setAgentHint(s.hint)
      // Catch up the live counter for a panel that mounted mid-run.
      setAgentProgress(s.running ? (s.progress ?? null) : null)
      // A run may have finished while this view didn't exist; its diff is still
      // there to be asked for.
      if (s.log && !s.running) void loadDiff()
    })
    const offOutput = window.electronAPI.ai.codeAgent.onOutput((chunk) => {
      setAgentRunning(true)
      // A new run reopens the panel: output arriving into a bar the user
      // collapsed an hour ago is output nobody sees. Closing is about the run
      // they were done with, not the next one.
      setAgentPanelOpen(true)
      setShowLog(true)
      setAgentLog((l) => (l + chunk).slice(-8000)) // cap to keep the panel light
    })
    // The loop is parked on a write/command: raise the card (and reopen the
    // panel, same reason as onOutput). Answered below via codeAgent.approve.
    const offApprove = window.electronAPI.ai.codeAgent.onApproveRequest((req) => {
      setAgentPanelOpen(true)
      setAgentApproval(req)
      // Record the action in the log as soon as the card appears — before the
      // user answers — so the transcript shows what was asked even if it is
      // declined (the [tool] line is only emitted once the action actually runs).
      setAgentLog((l) => (l + `\n[aguardando aprovação] ${req.resumo}\n`).slice(-8000))
    })
    // Live counter: the running step and token total, pushed each step.
    const offProgress = window.electronAPI.ai.codeAgent.onProgress((p) => {
      setAgentRunning(true)
      setAgentProgress(p)
    })
    const offExit = window.electronAPI.ai.codeAgent.onExit((code) => {
      setAgentRunning(false)
      // The final token summary is already in the log; the live counter belongs
      // to the run that just ended, so clear it.
      setAgentProgress(null)
      // A run that ended can't have a pending approval — clear any stale card.
      setAgentApproval(null)
      setAgentLog((l) => l + `\n[agente encerrado — código ${code}]\n`)
      // The moment there is something to review. Derived in main, so asking
      // again later is free and a run that finished while this view was closed
      // is not lost.
      void loadDiff()
      // The exit event carries only a status code, and this failure exits 0 —
      // so the diagnosis is fetched rather than inferred from it.
      void window.electronAPI.ai.codeAgent.status().then((s) => setAgentHint(s.hint))
    })
    // The run has become history. A separate event from 'exit' on purpose: the
    // archive takes a `git diff` to write, and the panel must not wait on that
    // to stop saying "rodando". So exit flips the UI and this fills the picker
    // when the row actually exists — no sleeping on a guessed delay.
    // Read from the store rather than closing over `conversationId`: this effect
    // binds once (deps `[]`) so it isn't torn down on every chat switch, which
    // means the value captured here would be whichever chat was open at mount.
    const offArchived = window.electronAPI.ai.codeAgent.onArchived(() => {
      void refreshRuns(useAiRunStore.getState().conversationId)
    })
    // A recognised environment failure (e.g. the sandbox couldn't start) arrives
    // mid-run, so the card can go up while the agent still churns — the user can
    // stop it early instead of watching every command fail to the step cap.
    const offHint = window.electronAPI.ai.codeAgent.onHint((hint) => {
      setAgentPanelOpen(true)
      setAgentHint(hint)
    })
    return () => {
      cancelled = true
      offOutput()
      offApprove()
      offProgress()
      offExit()
      offArchived()
      offHint()
    }
  }, [])

  useEffect(() => {
    void refreshRuns(conversationId)
  }, [conversationId])

  /**
   * The selected run, **derived** rather than reset by an effect.
   *
   * A selection is stored with the chat it was made in, so switching chats drops
   * it on the next render instead of needing a `setSelectedRunId(null)` on a
   * conversation change — which is a cascading render, and worse, one frame in
   * which another chat's snapshot is on screen under this chat's panel.
   */
  const selectedRunId = selection?.convId === conversationId ? selection.id : null

  // Fetch the snapshot behind the selected row. Only now — the list is metadata
  // precisely so opening the panel doesn't drag every run's log and diff along.
  useEffect(() => {
    if (!selectedRunId) return
    let cancelled = false
    void window.electronAPI.ai.codeAgent.runGet(selectedRunId).then((snap) => {
      if (cancelled) return
      // Gone (pruned, or the file was removed): fall back to the live run rather
      // than showing an empty panel that looks like a run that did nothing.
      if (!snap) {
        setSelection(null)
        void refreshRuns(conversationId)
        return
      }
      setSnapshot({ id: snap.id, log: snap.log, diff: snap.diff })
    })
    return () => {
      cancelled = true
    }
  }, [selectedRunId])

  /**
   * What the panel is actually showing.
   *
   * A selected past run replaces both halves at once — log and diff always
   * describe the same run, or the user reads one against the other and draws a
   * false conclusion. `running` is false for a snapshot no matter what the agent
   * is doing now: the spinner and "Parar" belong to the live run only.
   *
   * The snapshot is matched against the selection by id rather than assumed to
   * belong to it: while a newly picked run is still being fetched, the previous
   * one is still in state, and showing it under the new row's label would
   * misattribute a diff — the one mistake this whole feature exists to avoid.
   */
  const viewingPast = snapshot !== null && snapshot.id === selectedRunId
  const shownLog = viewingPast ? snapshot.log : agentLog
  const shownDiff = viewingPast ? snapshot.diff : agentDiff

  // Keep the changes panel live while the agent writes. The diff is derived in
  // main from a base captured before the spawn, so re-asking is cheap and
  // idempotent — and it's the only view that answers "what is it doing to my
  // code" without making the user read a redrawing spinner. codex leaves the
  // tree dirty, so the base-to-worktree diff shows the work mid-run.
  useEffect(() => {
    if (!agentRunning) return
    const id = setInterval(() => {
      void loadDiff()
      // Reconcile the hint with main every tick: a new run reset main's copy to
      // null, so this clears a stale card left over from the previous run, and
      // it's a backstop for the pushed onHint (which fires the instant a failure
      // is seen). setState in a timer callback, not the effect body — so it
      // doesn't hit react-hooks/set-state-in-effect.
      void window.electronAPI.ai.codeAgent.status().then((s) => setAgentHint(s.hint))
    }, 2000)
    return () => clearInterval(id)
  }, [agentRunning])

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
   * Answer the code-agent's parked write/command. Logs the outcome — a refusal
   * is recorded too, so the transcript shows what was declined — then resolves
   * the loop's promise (via approve) and clears the card. Shared by the card
   * buttons and the Enter/Esc shortcuts so all three stay in step.
   */
  const answerAgentApproval = useCallback(
    (approved: boolean): void => {
      if (!agentApproval) return
      void window.electronAPI.ai.codeAgent.approve(agentApproval.id, approved)
      setAgentLog((l) =>
        (l + `\n[${approved ? 'aprovado' : 'recusado'}] ${agentApproval.resumo}\n`).slice(-8000)
      )
      setAgentApproval(null)
    },
    [agentApproval]
  )

  /**
   * Keyboard: Esc closes the topmost open thing (one layer per press); Enter
   * approves a parked code-agent action.
   *
   * Bound to the document rather than to each overlay so it works wherever the
   * focus happens to be (the composer, a dropdown's search box, nothing at
   * all). The order mirrors what's stacked on screen, so Escape never reaches
   * past a dialog to dismiss something behind it.
   *
   * Two approval cards exist: the chat write card (pendingApproval) is drawn by
   * AiRunHost — the ordering below is why this view keeps answering it while
   * open (the host binds Escape only when the AI view is closed, so exactly one
   * listener acts) — and the code-agent action card (agentApproval), drawn here.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Enter approves the code-agent card — but never while the user is typing
      // (composer, search boxes), where Enter already means something.
      if (e.key === 'Enter' && agentApproval) {
        const el = e.target as HTMLElement | null
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
        e.preventDefault()
        return answerAgentApproval(true)
      }
      if (e.key !== 'Escape') return
      if (confirmDelete) return setConfirmDelete(null)
      // Code-agent action card: Esc refuses. Same reasoning as pendingApproval —
      // the loop awaits this promise, so hiding it unanswered hangs the run.
      if (agentApproval) return answerAgentApproval(false)
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
    agentApproval,
    answerAgentApproval,
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
        value={typeof config[key] === 'string' ? (config[key] as string) : ''}
        placeholder={placeholder}
        onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))}
        className="px-2.5 py-1.5 rounded-md bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] placeholder:text-[#4a5068] focus:outline-none focus:border-[#6366f1]"
      />
    </label>
  )

  /**
   * A field of the nested codeAgent config; blank falls back to the chat config.
   *
   * `options` turns it into a dropdown that still accepts free text (a `datalist`)
   * — used for Model: the code agent may point at a *different* endpoint than the
   * chat, so the chat's loaded model list is a suggestion, not a hard list.
   */
  const codeAgentField = (
    label: string,
    key: 'baseUrl' | 'apiKey' | 'model',
    type = 'text',
    placeholder = 'como o chat',
    options?: string[]
  ): React.JSX.Element => {
    const listId = options ? `codeagent-${key}-list` : undefined
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[#8892a4]">{label}</span>
        <input
          type={type}
          list={listId}
          value={config.codeAgent?.[key] ?? ''}
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value
            setConfig((c) => {
              const next = { ...(c.codeAgent ?? {}), [key]: raw }
              // Drop empty fields so an all-blank block persists as absent (= fallback).
              const cleaned = Object.fromEntries(
                Object.entries(next).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
              )
              return { ...c, codeAgent: Object.keys(cleaned).length ? cleaned : undefined }
            })
          }}
          className="px-2.5 py-1.5 rounded-md bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] placeholder:text-[#4a5068] focus:outline-none focus:border-[#6366f1]"
        />
        {listId && (
          <datalist id={listId}>
            {options?.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        )}
      </label>
    )
  }

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
                      {cost !== null && (
                        <span className="text-[#a5b4fc]">· {formatCost(cost)}</span>
                      )}
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

                      {runMetrics && runMetrics.byModel.length > 0 && (
                        <>
                          <p className="mt-3 mb-1 text-[10px] font-medium text-[#8892a4] uppercase tracking-wide">
                            Eficiência por modelo
                          </p>
                          <p className="mb-1.5 text-[10px] text-[#4a5068] leading-relaxed">
                            Média por execução do agente ({runMetrics.runs}{' '}
                            {runMetrics.runs === 1 ? 'execução' : 'execuções'}). Menos tokens/passo é
                            mais eficiente.
                          </p>
                          {runMetrics.byModel.map((m) => (
                            <div key={m.model} className="mb-1.5">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-[11px] text-[#e2e8f0] truncate">{m.model}</span>
                                <span className="text-[11px] text-[#8892a4] tabular-nums shrink-0">
                                  {m.runs}× · {formatTokens(Math.round(m.avgTotalTokens))}/exec
                                </span>
                              </div>
                              <div className="flex items-baseline justify-between gap-2 text-[10px] text-[#4a5068] tabular-nums">
                                <span>
                                  {m.avgSteps.toFixed(1)} passos ·{' '}
                                  {formatTokens(Math.round(m.avgTokensPerStep))}/passo
                                </span>
                                <span className="shrink-0">
                                  {m.avgRedundantSearches + m.avgRepeatedReads > 0.05 && (
                                    <span
                                      className="text-amber-500/70"
                                      title="buscas redundantes + releituras freadas, por execução"
                                    >
                                      ⚠ {(m.avgRedundantSearches + m.avgRepeatedReads).toFixed(1)}
                                    </span>
                                  )}
                                  {m.cappedRate > 0 && (
                                    <span className="ml-1.5" title="execuções que bateram o limite de passos">
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
              onClick={() => {
                // Turning it OFF needs no ceremony — it only ever adds
                // approvals back. Turning it ON is the spend decision, and the
                // one moment the user can still say no.
                if (autoApprove) return setAuto(false)
                refreshSpend()
                setConfirmAuto(true)
              }}
              title={
                autoApprove
                  ? 'Modo autônomo LIGADO — a IA trabalha sem interrupção. Clique para voltar a pedir aprovação.'
                  : 'Modo autônomo DESLIGADO — cada ação pede sua aprovação. Clique para não perguntar mais.'
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
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-[#8892a4]">
                  Modelo p/ código (opcional)
                </span>
                <select
                  value={config.modelComplex ?? ''}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, modelComplex: e.target.value || undefined }))
                  }
                  className="px-2.5 py-1.5 rounded-md bg-[#0d0f18] border border-[#2a2d42] text-sm text-[#e2e8f0] focus:outline-none focus:border-[#6366f1]"
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
            <p className="mt-2 text-[11px] leading-relaxed text-[#6b7280]">
              Se você escolher um <b>modelo p/ código</b>, pedidos que parecem tarefa de código
              (código, bug, refatorar, arquitetura, investigar…) rodam nele; o resto usa o modelo
              principal. Deixe em “mesmo do principal” para usar um modelo só.
            </p>
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
              <div className="pt-5">
                <p className="text-[11px] text-[#4a5068] leading-relaxed">
                  Quantas rodadas de ferramentas o assistente pode encadear numa resposta — cada
                  rodada é uma chamada paga ao modelo. Em branco usa o padrão: <b>{MAX_STEPS}</b> no
                  modo manual e <b>{AUTO_MAX_STEPS}</b> no automático. Um valor definido vale para os
                  dois modos (máx. {MAX_STEPS_LIMIT}).
                </p>
                {config.maxSteps !== undefined && config.maxSteps < LOW_STEPS_WARNING && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-400/90 leading-relaxed">
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
                Preços do seu provider, para estimar o custo da conversa. O app não tem como saber
                sozinho — ele fala com qualquer endpoint compatível com OpenAI, inclusive modelos
                locais (custo zero). Deixe em branco e o header mostra só os tokens.
              </p>
            </div>

            <div className="mt-3 pt-3 border-t border-[#2a2d42]">
              <span className="text-[11px] font-medium text-[#8892a4]">Agente de Código</span>
              <p className="mt-1 mb-2 text-[11px] leading-relaxed text-[#4a5068]">
                Provider do agente que edita o código (rodar_agente_codigo). Deixe qualquer campo em
                branco para usar o mesmo do chat acima — assim você pode apontar o agente para um
                modelo mais forte sem trocar o do chat.
              </p>
              <div className="grid grid-cols-3 gap-3">
                {codeAgentField('Base URL', 'baseUrl', 'text', config.baseUrl || 'como o chat')}
                {codeAgentField('API Key', 'apiKey', 'password', config.apiKey ? '••••' : 'como o chat')}
                {/* Dropdown (dos modelos carregados) que ainda aceita digitar um
                    modelo de outro endpoint. Carregue os modelos no campo do chat. */}
                {codeAgentField('Model', 'model', 'text', config.model || 'como o chat', models)}
              </div>

              {/* Sandbox toggle. Checked = required (default). Greyed when ai-jail
                  isn't installed, with a way to open onboarding. Unchecking it
                  runs commands unconfined, so it carries a warning. */}
              <div className="mt-3">
                <label
                  className={`flex items-center gap-2 ${
                    jailStatus && !jailStatus.available ? 'opacity-50' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={config.sandboxEnabled !== false}
                    disabled={!!jailStatus && !jailStatus.available}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, sandboxEnabled: e.target.checked ? undefined : false }))
                    }
                    className="accent-[#4f46e5]"
                  />
                  <span className="text-[12px] text-[#e2e8f0]">Sandbox (ai-jail)</span>
                  {jailStatus?.available && jailStatus.version && (
                    <span className="text-[10px] text-[#4a5068]">v{jailStatus.version}</span>
                  )}
                </label>
                {jailStatus && !jailStatus.available && (
                  <p className="mt-1 text-[11px] text-[#8892a4]">
                    {/* When the kernel blocks the namespaces, ai-jail IS installed —
                        saying "não instalado" here would send the user to reinstall
                        instead of running the sysctl the onboarding now shows. */}
                    {/apparmor_restrict_unprivileged_userns/.test(jailStatus.reason ?? '')
                      ? 'Sandbox indisponível.'
                      : 'ai-jail não instalado.'}{' '}
                    <button
                      onClick={() => setShowOnboarding(true)}
                      className="text-[#a5b4fc] hover:underline"
                    >
                      {/apparmor_restrict_unprivileged_userns/.test(jailStatus.reason ?? '')
                        ? 'Como resolver'
                        : 'Instalar ai-jail'}
                    </button>
                    {jailStatus.reason ? ` — ${jailStatus.reason}` : ''}
                  </p>
                )}
                {config.sandboxEnabled === false && (
                  <p className="mt-1 text-[11px] leading-relaxed text-[#f0a868]">
                    ⚠️ Desativar o sandbox permite que o agente acesse qualquer arquivo do sistema.
                    Use por sua conta e risco.
                  </p>
                )}
              </div>
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
                  Só o template padrão. Crie um para adaptar o Gerar Tasks a uma área — Dev, Estudo,
                  Marketing…
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
                <p className="text-[#e2e8f0] font-medium mb-1">Converse com o modelo</p>
                <p className="text-sm text-[#8892a4]">
                  Descreva o projeto e use <b>Gerar Tasks</b> para criar tarefas.
                </p>
              </div>
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === 'status' ? (
                <StatusLine
                  key={i}
                  text={m.content}
                  state={statusState(m, runningHere)}
                  step={m.step}
                  maxSteps={m.maxSteps}
                  tokens={m.tokens}
                />
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

        {/* External code agent output. Shown for a live/just-finished run, and
            also when this chat has runs to reopen — otherwise the history is
            only reachable while output happens to be on screen, which is the
            case where nobody needs it. */}
        {(agentLog || pastRuns.length > 0) && (
          <div className="border-t border-[#2a2d42] bg-[#0d0f18] shrink-0">
            <div className="flex items-center justify-between px-6 py-1.5">
              <span className="flex items-center gap-2 text-[11px] font-medium text-[#8892a4]">
                {agentRunning && (
                  <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
                )}
                Agente de código{' '}
                {viewingPast ? '(run anterior)' : agentRunning ? '(rodando)' : '(encerrado)'}
                {/* The real model in use (task 11), not "próprio do codex". */}
                {agentRunning && agentModel && (
                  <span className="text-[10px] font-normal text-[#6b7280]">· {agentModel}</span>
                )}
                {/* Live counter: step and running token total. */}
                {agentRunning && agentProgress && agentProgress.step > 0 && (
                  <span className="text-[10px] font-normal text-[#6b7280]">
                    · Passo {agentProgress.step}/{agentProgress.maxSteps} ·{' '}
                    {formatTokens(agentProgress.promptTokens + agentProgress.completionTokens)} tokens
                  </span>
                )}
              </span>
              <div className="flex items-center gap-3">
                <AgentRunPicker
                  runs={pastRuns}
                  selectedId={selectedRunId}
                  live={agentLog !== ''}
                  onSelect={(id) => {
                    // Tagged with the chat, so leaving it drops the selection
                    // by derivation instead of by a reset effect.
                    setSelection(id && conversationId ? { convId: conversationId, id } : null)
                    // Picking a run is asking to see it — a selection that
                    // landed behind a collapsed panel would look like a no-op.
                    setAgentPanelOpen(true)
                  }}
                />
                {agentRunning && (
                  <button
                    onClick={() => window.electronAPI.ai.codeAgent.stop()}
                    className="text-[11px] text-red-400 hover:text-red-300"
                  >
                    Parar
                  </button>
                )}
                {/* Clears the live buffer only. Hidden while a snapshot is up:
                    there it would look like it deletes the archived run, and
                    the archive is the thing the user came here to keep. */}
                {!viewingPast && agentPanelOpen && (
                  <button
                    onClick={() => setAgentLog('')}
                    className="text-[11px] text-[#8892a4] hover:text-[#e2e8f0]"
                  >
                    Limpar
                  </button>
                )}
                {/* Collapses the panel; it does not discard anything. The header
                    stays so the run picker — the only way back to the history —
                    is still reachable. */}
                <button
                  onClick={() => setAgentPanelOpen((v) => !v)}
                  title={agentPanelOpen ? 'Fechar o painel do agente' : 'Abrir o painel do agente'}
                  aria-label={
                    agentPanelOpen ? 'Fechar o painel do agente' : 'Abrir o painel do agente'
                  }
                  className="text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
                >
                  {agentPanelOpen ? (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  ) : (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            {/* Per-action approval (native agent): the loop is parked on a write
                or a command, and nothing runs until the user answers. This is
                the ONLY barrier — the native agent has no OS sandbox — so it is
                rendered prominently and blocks by construction (the loop waits
                on the promise resolved by codeAgent.approve). */}
            {agentPanelOpen && agentApproval && (
              <div className="px-6 pb-3 pt-3">
                <div
                  className={`rounded-lg border p-3 ${
                    agentApproval.irreversivel
                      ? 'border-red-500/60 bg-[#1a0f12]'
                      : 'border-[#4f46e5] bg-[#141527]'
                  }`}
                >
                  <p
                    className={`text-[12px] font-semibold ${
                      agentApproval.irreversivel ? 'text-red-300' : 'text-[#a5b4fc]'
                    }`}
                  >
                    O agente quer{' '}
                    {agentApproval.name === 'executar_comando' ? 'executar um comando' : 'escrever um arquivo'}
                    {agentApproval.irreversivel && ' (sobrescreve o conteúdo atual)'}
                  </p>
                  <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-[#e2e8f0]">
                    {agentApproval.resumo}
                  </p>
                  {/* Preview the actual payload so the user reviews before OKing —
                      a coloured diff when overwriting, the file contents for a new
                      file, the full command for a command. Blind approval is the
                      opposite of what a safety gate is for. */}
                  {agentApproval.name === 'executar_comando' && agentApproval.comando && (
                    <>
                      <pre className="mt-2 max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-[#2a2d42] bg-[#0b0c1a] p-2.5 font-mono text-[11px] leading-relaxed text-[#f8fafc]">
                        {agentApproval.comando}
                      </pre>
                      <p className="mt-1 text-[10px] italic text-[#8892a4]">
                        Executa na pasta do projeto, com efeitos reais no seu sistema.
                      </p>
                    </>
                  )}
                  {agentApproval.name === 'escrever_arquivo' &&
                    (agentApproval.diff && agentApproval.diff.length > 0 ? (
                      <>
                        <div className="mt-2 max-h-[320px] overflow-auto rounded-md border border-[#2a2d42] bg-[#0d0f18] py-1">
                          {agentApproval.diff.map((line, i) => (
                            <div
                              key={i}
                              className={`flex px-2.5 font-mono text-[11px] leading-[1.6] ${DIFF_LINE_CLASS[line.kind]}`}
                            >
                              <span className="w-3 shrink-0 select-none opacity-60">{DIFF_MARK[line.kind]}</span>
                              <span className="whitespace-pre-wrap break-all">{line.text || ' '}</span>
                            </div>
                          ))}
                        </div>
                        {agentApproval.diffTruncated && (
                          <p className="mt-1 text-[10px] italic text-[#8892a4]">
                            diff truncado — o arquivo completo será escrito mesmo assim
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <pre className="mt-2 max-h-[280px] overflow-auto whitespace-pre rounded-md border border-[#2a2d42] bg-[#0b0c1a] p-2.5 font-mono text-[11px] leading-relaxed text-[#e2e8f0]">
                          {agentApproval.conteudo || '(arquivo vazio)'}
                        </pre>
                        {(agentApproval.conteudo?.length ?? 0) >= 3000 && (
                          <p className="mt-1 text-[10px] italic text-[#8892a4]">
                            prévia truncada em 3000 caracteres — o arquivo completo será escrito
                          </p>
                        )}
                      </>
                    ))}
                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      onClick={() => answerAgentApproval(true)}
                      className="rounded-md bg-[#4f46e5] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#4338ca]"
                    >
                      Aprovar <span className="ml-1 opacity-60">↵</span>
                    </button>
                    <button
                      onClick={() => answerAgentApproval(false)}
                      className="rounded-md border border-[#2a2d42] px-3 py-1.5 text-[11px] font-medium text-[#8892a4] hover:text-[#e2e8f0]"
                    >
                      Recusar <span className="ml-1 opacity-60">Esc</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
            {/* Above the diff, because it explains why it's empty: a bwrap/
                sandbox failure prints its cause only in the raw log (behind a
                toggle), so without this the user watches commands fail with no
                idea why. Shown mid-run too (pushed via onHint) so they can stop
                early rather than wait out every failing step. */}
            {agentPanelOpen && agentHint && !viewingPast && (
              <div className="px-6 pb-3">
                <div className="rounded-lg border border-[#7c4a2d] bg-[#1a1108] p-3">
                  <div className="flex items-start gap-2">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#f0a868"
                      strokeWidth="2"
                      className="mt-0.5 shrink-0"
                    >
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-[#f0a868]">{agentHint.title}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-[#c9a68a]">
                        {agentHint.detail}
                      </p>
                      {agentHint.command && (
                        <div className="mt-2 flex items-center gap-2">
                          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-[#0d0f18] px-2 py-1.5 font-mono text-[10.5px] text-[#e2e8f0]">
                            {agentHint.command}
                          </code>
                          {/* Copy, not run: this needs sudo and it loosens the
                              user's kernel hardening. Handing it over to run
                              themselves is the only honest option — the app must
                              not make that call for them. */}
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(agentHint.command ?? '')
                              setHintCopied(true)
                              setTimeout(() => setHintCopied(false), 2000)
                            }}
                            className="shrink-0 rounded px-2 py-1.5 text-[10.5px] font-medium text-[#f0a868] transition-colors hover:bg-[#2a1a0d]"
                          >
                            {hintCopied ? 'copiado' : 'copiar'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* The changes come first and stay visible *while* the agent runs —
                they're the answer to "what is it doing", and the raw log isn't:
                a redrawing status line shows one step at a time and keeps no
                history of it. */}
            {agentPanelOpen && shownDiff && (
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
                  {viewingPast && (
                    // Said plainly, because it is the one thing that could
                    // mislead here: this diff is what the agent changed *then*,
                    // not what the folder looks like now.
                    <span className="font-normal text-[10px] text-[#6b7280]">
                      · snapshot de quando a run terminou
                    </span>
                  )}
                </button>
                {showDiff && (
                  <CodeDiff
                    diff={shownDiff}
                    running={!viewingPast && agentRunning}
                    // A snapshot has nothing to refresh — re-deriving it would
                    // show today's tree as the agent's work.
                    onRefresh={viewingPast ? undefined : () => void loadDiff()}
                  />
                )}
              </div>
            )}

            {/* The raw log, behind a toggle: it's the debugging view (why did it
                fail, what did it read), not the one to watch a run through. */}
            {agentPanelOpen && (
              <div className="px-6 pb-3">
                <button
                  onClick={() => setShowLog((v) => !v)}
                  className="flex items-center gap-1.5 mb-1.5 text-[11px] font-medium text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    className={`transition-transform ${showLog ? 'rotate-90' : ''}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  Log completo
                </button>
              </div>
            )}
            {agentPanelOpen && showLog && (
              <AgentTerminal log={shownLog} running={!viewingPast && agentRunning} />
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
                disabled={
                  !configReady || busy || (input.trim() === '' && pendingImages.length === 0)
                }
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
      <ConfirmDialog
        open={confirmAuto}
        title="Ligar o modo automático"
        message={autoWarning}
        confirmLabel="Ligar automático"
        onConfirm={() => {
          setAuto(true)
          setConfirmAuto(false)
        }}
        onCancel={() => setConfirmAuto(false)}
      />
      {showOnboarding && jailStatus && (
        <SandboxOnboarding
          status={jailStatus as JailStatus}
          onDismiss={() => setShowOnboarding(false)}
          onInstalled={() => void refreshJail(true)}
        />
      )}
    </>
  )
}
