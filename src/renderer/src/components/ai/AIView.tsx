import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { useKanbanStore } from '../../store/kanban'
import { useAiRunStore, type ChatMessage } from '../../store/aiRun'
import type { Project } from '../../types'
import { resolveMaxSteps, type AIConfig } from '../../ai/agent'
import { describeToolActivity } from '../../ai/tools'
import { toScaledDataUrl, imageFilesFrom, documentFilesFrom } from '../../utils/images'
import { formatChatDocumentPrompt } from '../../ai/document-context'
import { fetchModels } from '../../ai/model-catalog'
import { estimateAutoRun } from '../../utils/spend'
import { estimateCost, formatCost, statusState } from '../../utils/aiDisplay'
import { MessageBubble, MemoStatusLine } from './ChatMessageParts'
import { ChatMarkdown } from './ChatMarkdown'
import { SpendPanel } from './SpendPanel'
import { ConversationHistoryMenu } from './ConversationHistoryMenu'
import { AIConfigPanel } from './AIConfigPanel'
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AIView({
  projects,
  prefill,
  onPrefillConsumed,
  searchConversationId
}: {
  projects: Project[]
  /** Composer text handed in from another view (e.g. a board task). */
  prefill?: string | null
  /** Called once `prefill` has been taken, so it can't be applied twice. */
  onPrefillConsumed?: () => void
  searchConversationId?: string
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
  const setMessages = useAiRunStore((s) => s.setMessages)
  const openConversation = useAiRunStore((s) => s.openConversation)
  const dropConversation = useAiRunStore((s) => s.dropConversation)
  const setConversationId = useAiRunStore((s) => s.setConversationId)
  const ensureConversationId = useAiRunStore((s) => s.ensureConversationId)
  const setAuto = useAiRunStore((s) => s.setAutoApprove)
  const setPlan = useAiRunStore((s) => s.setPlanMode)
  const resolveApproval = useAiRunStore((s) => s.resolveApproval)
  const resetRun = useAiRunStore((s) => s.reset)

  const [input, setInput] = useState('')
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null)
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
  const lastUserMessageIndex = messages.findLastIndex((m) => m.role === 'user')

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
  const autoSteps = resolveMaxSteps(config.maxSteps, true)
  const autoEstimate = estimateAutoRun(spend?.total, autoSteps)
  const autoWarning =
    `O assistente vai encadear até ${autoSteps} rodadas sem pedir aprovação, ` +
    'incluindo ações comuns que gravam dados. Exclusões e lançamentos financeiros ainda pedirão aprovação. Cada rodada é uma chamada paga ao modelo ' +
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
    setEditingMessageIndex(null)
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
          userName: stored.userName,
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
        const conversationToOpen = searchConversationId ?? stored.lastConversationId
        if (conversationToOpen) void handleLoadConversation(conversationToOpen)
      })
      .finally(() => {
        if (!cancelled) configLoaded.current = true
      })
    return () => {
      cancelled = true
    }
  }, [searchConversationId])

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
    setEditingMessageIndex(null)
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
    const conv = await window.electronAPI.ai.conversations.get(id)
    // Main checks memory references before deletion. Never delete attachment
    // bytes first: a rejected deletion must leave the conversation intact.
    const deleted = await window.electronAPI.ai.conversations.delete(id)
    if (deleted.error) {
      setError(deleted.error)
      setConfirmDelete(null)
      return
    }
    const imageIds = [...new Set((conv?.messages ?? []).flatMap((m) => m.imageIds ?? []))]
    if (imageIds.length > 0) await window.electronAPI.ai.images.delete(imageIds)
    const docIds = [...new Set((conv?.messages ?? []).flatMap((m) => m.documentIds ?? []))]
    if (docIds.length > 0) await window.electronAPI.ai.documents.delete(docIds)
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

    if (editingMessageIndex !== null) {
      // Keep the original turn and its actions visible. A correction is a new
      // turn, with Auto off, so a previous write cannot silently repeat.
      if (editingMessageIndex !== lastUserMessageIndex) return
      setAuto(conversationId!, false)
      text = `Correção ao meu último pedido (não repita ações já concluídas):\n\n${text}`
      setEditingMessageIndex(null)
    }

    // Keep the user's request separate from quoted document data. The text is
    // still inline, so reading an attachment consumes no extra tool call.
    if (pendingDocuments.length > 0) {
      text = formatChatDocumentPrompt(text, pendingDocuments)
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

  const copyMessage = async (content: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      setError('Não consegui copiar a mensagem')
    }
  }

  const editMessage = (index: number): void => {
    const message = messages[index]
    if (!message || message.role !== 'user' || index !== lastUserMessageIndex || busyHere) return
    setInput(message.content)
    setEditingMessageIndex(index)
    inputRef.current?.focus()
  }

  const rateMessage = (index: number, feedback: 'positive' | 'negative'): void => {
    setMessages((current) =>
      current.map((message, i) =>
        i === index && message.role === 'assistant'
          ? { ...message, feedback: message.feedback === feedback ? undefined : feedback }
          : message
      )
    )
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
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#2a2a2a] text-[11px] text-[#a080f0] max-w-[280px]"
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
            <SpendPanel
              totalTokens={totalTokens}
              reasoningTokens={reasoningTokens}
              cost={cost}
              usage={usage}
              spend={spend}
              runMetrics={runMetrics}
              showSpend={showSpend}
              onToggle={() => {
                refreshSpend()
                setShowSpend((value) => !value)
              }}
              onClose={() => setShowSpend(false)}
            />
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

            <ConversationHistoryMenu
              showHistory={showHistory}
              setShowHistory={setShowHistory}
              historyQuery={historyQuery}
              setQuery={setQuery}
              conversations={conversations}
              conversationId={conversationId}
              runningConvId={runningConvId}
              renaming={renaming}
              setRenaming={setRenaming}
              commitRename={commitRename}
              handleLoadConversation={handleLoadConversation}
              startRename={startRename}
              handleDeleteConversation={handleDeleteConversation}
            />
            <button
              onClick={() => setShowConfig((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showConfig
                  ? 'bg-[#3b3b3b] text-[#a080f0]'
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

        {showConfig && (
          <AIConfigPanel
            config={config}
            setConfig={setConfig}
            models={models}
            loadingModels={loadingModels}
            modelsError={modelsError}
            handleLoadModels={handleLoadModels}
            codeAgentModels={codeAgentModels}
            loadingCodeAgentModels={loadingCodeAgentModels}
            codeAgentModelsError={codeAgentModelsError}
            handleLoadCodeAgentModels={handleLoadCodeAgentModels}
            harnessStatuses={harnessStatuses}
            loadingHarnessStatuses={loadingHarnessStatuses}
            harnessCheckFeedback={harnessCheckFeedback}
            refreshHarnesses={refreshHarnesses}
            skills={skills}
            editingSkill={editingSkill}
            setEditingSkill={setEditingSkill}
            skillError={skillError}
            setSkillError={setSkillError}
            handleImportSkill={handleImportSkill}
            handleDeleteSkill={handleDeleteSkill}
            handleSaveSkill={handleSaveSkill}
            jailStatus={jailStatus}
            setShowOnboarding={setShowOnboarding}
          />
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
                    onCopy={() => void copyMessage(m.content)}
                    onEdit={
                      m.role === 'user' &&
                      messages.length - visibleMessages.length + i === lastUserMessageIndex &&
                      !busyHere &&
                      !(m.imageIds?.length || m.documentIds?.length)
                        ? () => editMessage(messages.length - visibleMessages.length + i)
                        : undefined
                    }
                    onFeedback={
                      m.role === 'assistant'
                        ? (feedback) =>
                            rateMessage(messages.length - visibleMessages.length + i, feedback)
                        : undefined
                    }
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
                    <MemoStatusLine key={i} text={describeToolActivity(name, {})} state="running" />
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
          <div className="px-6 py-2 text-xs text-[#46d478] bg-[#2a2a2a] border-t border-[#3b3b3b] shrink-0">
            {createdCount} task{createdCount === 1 ? '' : 's'} criada{createdCount === 1 ? '' : 's'}{' '}
            em {activeProject?.name}.
          </div>
        )}
        {error && (
          <div className="px-6 py-2 text-xs text-[#e04040] bg-[#2a2a2a] border-t border-[#3b3b3b] shrink-0">
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
            dragOver ? 'border-[#7c3aed] bg-[#2a2a2a]' : 'border-[#3b3b3b]'
          }`}
        >
          {!configReady && (
            <p className="mb-2 text-[11px] text-[#f08a34]">
              Configure a Base URL e o Model antes de enviar.
            </p>
          )}
          {editingMessageIndex !== null && (
            <div className="flex items-center justify-between gap-2 mb-2 text-xs text-[#f0b820]">
              <span>
                O pedido corrigido será uma nova mensagem. O histórico anterior permanece e novas
                ações pedirão aprovação.
              </span>
              <button
                type="button"
                onClick={() => {
                  setEditingMessageIndex(null)
                  setInput('')
                }}
                className="text-[#d4d4d4] hover:underline"
              >
                Cancelar edição
              </button>
            </div>
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
                {editingMessageIndex !== null ? 'Reenviar' : 'Enviar'}
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
                        ? 'bg-[#3b3b3b] text-[#46d478] border border-[#3b3b3b]'
                        : 'bg-[#3b3b3b] text-[#f0b820] border border-[#3b3b3b]'
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
                    <span className="text-[10px] text-[#46d478]">
                      Skill reconhecida — corpo será enviado ao modelo
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#f0b820]">
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
