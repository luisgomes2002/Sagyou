import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { runAgent, resolveMaxSteps } from '../ai/agent'
import { CODE_TOOL_DEFS } from '../ai/tools'
import codePromptMd from '../ai/code-prompt.md?raw'
import { useKanbanStore } from './kanban'
import { setAdd, setDel } from '../utils/immutable'
import type { AIConfig, PendingCall, TokenUsage, ContentPart } from '../ai/agent'

// ---------------------------------------------------------------------------
// The agent run
//
// This lives outside AIView because a run has to outlive it. AIView is rendered
// conditionally by App, so leaving the AI view unmounts it — and while all of
// this was component state, that quietly threw the run away: the loop kept
// going (and kept billing), but its answer landed on an unmounted component and
// was never saved, and a run parked on an approval could never be answered, so
// it held its progress forever. State that a run owns therefore lives here;
// AIView is one view onto it, free to come and go.
//
// What stays in AIView is what the *view* owns: the composer, the history and
// config panels, image attachments.
// ---------------------------------------------------------------------------

/**
 * The visible chat transcript (user prompts + assistant answers). The
 * tool-calling loop and wire types (ApiMessage) live in ../ai/agent.
 *
 * 'status' is a display-only trace of the agent's intermediate work ("Lendo
 * src/App.tsx"). It's kept in the transcript and persisted, but it is NOT a
 * chat turn: `toApiMessages` strips it before anything goes to the model.
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'status'
  content: string
  /**
   * Chat-image ids. The bytes live as files under userData/chat-images and are
   * loaded into `imageData` on demand — inlining base64 here would land it in
   * ai-conversations.json, which is re-read whole on every autosave and on
   * every keystroke of the history search.
   */
  imageIds?: string[]
  /**
   * Status lines only: false while the tool is running, true once it returns.
   * Absent on the model's own remarks — those describe an intent, not work in
   * flight, so they have nothing to wait for.
   */
  done?: boolean
  /**
   * Status lines only: which step of the run produced this line, 1-based, and
   * the cap it ran under — rendered as a "3/40" badge.
   *
   * Both are stored, rather than deriving the denominator at render time, so an
   * old transcript keeps showing the cap *that run* actually had. `maxSteps` is
   * a user setting: reading today's value would silently relabel a finished
   * run's steps against a limit it never ran under. Optional and additive —
   * lines saved before this existed simply have no badge.
   */
  step?: number
  maxSteps?: number
  /** Tokens this step's model call billed, for the trace. Absent = unknown/older line. */
  tokens?: number
}

/**
 * The transcript as the model should see it — status lines are not turns.
 *
 * A turn with images becomes the multimodal array form; everything else stays a
 * plain string, because not every OpenAI-compatible provider accepts the array
 * shape and there is no reason to make them cope with it for text-only chats.
 *
 * An image whose bytes aren't loaded is dropped rather than sent as a broken
 * reference: the model would otherwise be told there is a picture it cannot see.
 */
export function toApiMessages(
  messages: ChatMessage[],
  imageData: Record<string, string>
): { role: 'user' | 'assistant'; content: string | ContentPart[] }[] {
  return messages
    .filter((m) => m.role !== 'status')
    .map((m) => {
      const role = m.role as 'user' | 'assistant'
      const urls = (m.imageIds ?? []).map((id) => imageData[id]).filter(Boolean)
      if (urls.length === 0) return { role, content: m.content }
      return {
        role,
        content: [
          { type: 'text' as const, text: m.content },
          ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } }))
        ]
      }
    })
}

export const EMPTY_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0 }

/** The abort reply runAgent returns — never worth a handoff. */
const HANDOFF_SKIP = 'Execução interrompida.'

/**
 * Leave a per-project handoff breadcrumb after a run, so a later session opens
 * knowing where this one left off — the automatic sibling of salvar_memoria.
 *
 * Deliberately NOT an LLM summary (that would cost a call, against the token
 * budget the whole feature is built around): it's the last question plus a
 * trimmed final answer. One memory per project, upserted each run (main gives it
 * a deterministic id), so it never floods — it's always "the last exchange",
 * and it decays when the project goes quiet. Skipped for an aborted/empty reply.
 * Fully guarded: a handoff failure — or an absent bridge — must never touch the run.
 */
export async function writeHandoff(
  question: string,
  reply: string,
  convId?: string | null
): Promise<void> {
  try {
    const api = window.electronAPI?.ai?.memory
    if (!api?.handoff) return
    const answer = (reply ?? '').trim()
    if (!answer || answer === HANDOFF_SKIP) return
    const { activeProjectId, projects } = useKanbanStore.getState()
    const name = projects.find((p) => p.id === activeProjectId)?.name
    const q = (question ?? '').trim().slice(0, 200)
    // The handoff is a small breadcrumb re-sent in every future prompt, so it's
    // capped. When it IS cut, point at the full conversation by id: the model
    // opens it with ler_conversa instead of blind-searching (and re-answering
    // from scratch, which is what a bare "…" caused). Only when truncated — a
    // whole short answer needs no pointer.
    const truncated = answer.length > 600
    const a = truncated ? `${answer.slice(0, 600)}…` : answer
    const pointer =
      truncated && convId ? ` (conversa completa: id=${convId} — use ler_conversa para ler tudo)` : ''
    await api.handoff({
      projectId: activeProjectId,
      title: name ? `Última sessão — ${name}` : 'Última sessão',
      body: (q ? `Perguntou: "${q}". ` : '') + `Conclusão: ${a}${pointer}`
    })
  } catch {
    /* a breadcrumb is a convenience; its failure must never affect the run */
  }
}

/**
 * The agent loops await these, so they are live continuations rather than UI
 * state: kept out of the store proper because nothing renders them and
 * replacing one must never trigger a render.
 *
 * Keyed by conversation id, not a single slot: several runs can be parked on an
 * approval at once now, each with its own resolver. See `pendingApprovals`.
 */
const approvalResolvers = new Map<string, (ids: Set<string>) => void>()

/** A transcript the user has switched away from. See `parked` below. */
interface Parked {
  messages: ChatMessage[]
  usage: TokenUsage
}

/** A run parked on the approval card, and which conversation it belongs to. */
export interface PendingApproval {
  convId: string
  writes: PendingCall[]
  selected: Set<string>
}

/**
 * Append to the transcript of a specific conversation, wherever it is: on
 * screen (the chat `conversationId` names), or parked because the user switched
 * away from it mid-run.
 *
 * The convId is the run's own — captured in `send`'s closure — not read from a
 * single "current run" field, because several runs can be writing at once and
 * each must reach only its own chat. An empty patch is the honest answer when
 * the run's chat is gone (deleted mid-run): there is nowhere to write.
 */
function writeConv(
  s: AiRunState,
  convId: string,
  fn: (prev: ChatMessage[]) => ChatMessage[]
): Partial<AiRunState> {
  if (convId === s.conversationId) return { messages: fn(s.messages) }
  const p = s.parked[convId]
  if (!p) return {}
  return { parked: { ...s.parked, [convId]: { ...p, messages: fn(p.messages) } } }
}

/** The same routing, for the token count — billed to the chat that asked. */
function addUsageConv(s: AiRunState, convId: string, u: TokenUsage): Partial<AiRunState> {
  const add = (prev: TokenUsage): TokenUsage => ({
    promptTokens: prev.promptTokens + u.promptTokens,
    completionTokens: prev.completionTokens + u.completionTokens
  })
  if (convId === s.conversationId) return { usage: add(s.usage) }
  const p = s.parked[convId]
  if (!p) return {}
  return { parked: { ...s.parked, [convId]: { ...p, usage: add(p.usage) } } }
}

export interface AiRunState {
  /** The transcript on screen — the chat `conversationId` names, and only that one. */
  messages: ChatMessage[]
  /**
   * The conversations with a live run right now, by id. Several at once: N chat
   * agents can work the same project in parallel. `running.has(convId)` is what
   * blocks a *second* run of the same conversation (reentry) while leaving
   * every other conversation free — and `running.size > 0` is the old global
   * "something is working" flag the background indicator keys off.
   */
  running: Set<string>
  /**
   * Text of each run's answer as it types out, keyed by conversation id (empty
   * until the first chunk). Per-conversation so two runs streaming at once don't
   * overwrite one another — the view shows `streaming[conversationId]`.
   */
  streaming: Record<string, string>
  /**
   * Tools each run is composing this very moment, named before their arguments
   * have finished arriving, keyed by conversation id.
   *
   * Transient — not part of the transcript, never reaches disk. The persistent
   * record of a tool is the 'status' line appended when it actually runs; this
   * only fills the silence while the model writes the call.
   */
  streamingTools: Record<string, string[]>
  /** Error banner for the chat on screen. Background failures append a status line instead. */
  error: string | null
  /**
   * Tokens billed across this conversation. Summed over every call, because
   * every call is charged — not the size of the last prompt.
   */
  usage: TokenUsage
  /** Which chat is on screen. */
  conversationId: string | null
  /**
   * Transcripts that are live but not on screen, keyed by conversation id.
   *
   * A chat the user leaves mid-run still has an answer coming, so its
   * transcript can't be dropped and can't be re-read from disk (the file is
   * behind the run). It waits here: the loop keeps appending, the host keeps
   * saving it, and re-opening it takes the live copy back rather than the
   * stale file. Entries are made when leaving a *running* chat.
   */
  parked: Record<string, Parked>
  /**
   * Which project each active run is working on, by conversation id. Set at the
   * start of a run and cleared when it ends. Powers the agents panel (FleetView)
   * — the one place that has to name what every background run is doing.
   */
  runProjects: Record<string, string | null>
  /**
   * Tokens each *live* run has billed so far, by conversation id — the current
   * run's own spend, not the conversation's persisted lifetime total (that's
   * `usage` / `parked[].usage`). Reset when the run starts, cleared when it ends,
   * so the agents panel can show input/output per working agent.
   */
  runUsage: Record<string, TokenUsage>
  /**
   * A light cooperative lease: which run is working each task, by task id →
   * conversation id. When N agents share a project, this is what stops two of
   * them picking up the same task — a work tool consults it and, if the task is
   * already leased by *another active run*, backs off with a synthetic result
   * (the same "brake" pattern the loop already uses) instead of duplicating the
   * work. Runtime-only, no schema; released when the run ends.
   */
  taskLeases: Record<string, string>
  /**
   * Runs parked on the approval card — a queue, not a single slot, because with
   * N agents several can stop for approval at once. Each is labelled with the
   * conversation it belongs to.
   */
  pendingApprovals: PendingApproval[]
  /**
   * Auto-approve mode, by conversation id: a run whose id is in here runs write
   * actions without the card (chaining autonomously). Per-conversation so
   * "Sempre permitir" on one chat never surrenders the approval gate on another;
   * a fresh conversation has a fresh id and starts gated.
   */
  autoApprove: Set<string>
  /**
   * Planning mode, by conversation id: when on, every user message is prefixed
   * with a planning-mode instruction that tells the assistant to analyse,
   * ask scope questions, and plan — but never write or edit code directly.
   * Per-conversation, toggled via Shift+Tab.
   */
  planMode: Set<string>
  /** Conversations the Stop button has asked to abort; each loop reads its own between steps. */
  abortRequested: Set<string>
  /**
   * Bumped after each autosave, so a mounted AIView can refresh its history
   * list. The save itself is the host's job (it outlives the view).
   */
  savedTick: number

  send: (
    config: AIConfig,
    opts: { text: string; imageIds: string[]; imageData: Record<string, string> },
    codeMode?: boolean
  ) => Promise<void>
  /** Ask a run to stop. Defaults to the chat on screen when no id is given. */
  abort: (convId?: string) => void
  /**
   * Claim a task for a run. Returns true if the run may work it (free, or
   * already this run's); false if another *active* run holds it — the caller
   * then backs off. A lease held by a run that has ended is stale and gets
   * taken over.
   */
  acquireLease: (taskId: string, convId: string) => boolean
  requestApproval: (convId: string, writes: PendingCall[]) => Promise<Set<string>>
  resolveApproval: (convId: string, ids: Set<string>) => void
  toggleApproval: (convId: string, id: string) => void
  setAutoApprove: (convId: string, v: boolean) => void
  setPlanMode: (convId: string, v: boolean) => void
  /**
   * Swap in a whole stored conversation, in one update. Deliberately atomic:
   * the transcript, its id and its usage describe one chat, so setting them
   * one at a time would render the app through states that never existed (an
   * old transcript under a new id, this chat's messages with the last one's
   * token count).
   */
  openConversation: (conv: { id: string; messages: ChatMessage[]; usage?: TokenUsage }) => void
  /**
   * Forget a conversation that no longer exists (deleted from the history).
   * Drops any parked transcript and stops a run that was writing to it — its
   * destination is gone, so every further step would be billed for nothing.
   */
  dropConversation: (id: string) => void
  setMessages: (next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void
  /** Mark a conversation as running/idle. */
  setRunning: (convId: string, v: boolean) => void
  setError: (e: string | null) => void
  addUsage: (u: TokenUsage) => void
  setUsage: (u: TokenUsage) => void
  setConversationId: (id: string | null) => void
  /** Mints an id for a chat that doesn't have one yet, returning it either way. */
  ensureConversationId: () => string
  markSaved: () => void
  /** Blank slate — a new conversation. */
  reset: () => void
}

export const useAiRunStore = create<AiRunState>((set, get) => ({
  messages: [],
  running: new Set(),
  streaming: {},
  streamingTools: {},
  error: null,
  usage: EMPTY_USAGE,
  conversationId: null,
  parked: {},
  runProjects: {},
  runUsage: {},
  taskLeases: {},
  pendingApprovals: [],
  autoApprove: new Set(),
  planMode: new Set(),
  abortRequested: new Set(),
  savedTick: 0,

  send: async (config, { text, imageIds, imageData }, codeMode = false) => {
    const convId = get().ensureConversationId()
    if (get().running.has(convId)) return
    const next: ChatMessage[] = [
      ...get().messages,
      { role: 'user', content: text, ...(imageIds.length > 0 && { imageIds }) }
    ]
    const projectId = useKanbanStore.getState().activeProjectId
    set((s) => ({
      messages: next,
      running: setAdd(s.running, convId),
      streaming: { ...s.streaming, [convId]: '' },
      streamingTools: { ...s.streamingTools, [convId]: [] },
      error: null,
      abortRequested: setDel(s.abortRequested, convId),
      runProjects: { ...s.runProjects, [convId]: projectId ?? null },
      runUsage: { ...s.runUsage, [convId]: EMPTY_USAGE }
    }))
    try {
      const reply = await runAgent(
        config,
        toApiMessages(next, imageData),
        (writes) => get().requestApproval(convId, writes),
        {
          projectId,
          convId,
          maxSteps: resolveMaxSteps(config.maxSteps, get().autoApprove.has(convId)),
          shouldAbort: () => get().abortRequested.has(convId),
          onStream: (t) => set((s) => ({ streaming: { ...s.streaming, [convId]: t } })),
          onToolStream: (names) =>
            set((s) => ({ streamingTools: { ...s.streamingTools, [convId]: names } })),
          onUsage: (u) =>
            set((s) => {
              const prev = s.runUsage[convId] ?? EMPTY_USAGE
              return {
                ...addUsageConv(s, convId, u),
                runUsage: {
                  ...s.runUsage,
                  [convId]: {
                    promptTokens: prev.promptTokens + u.promptTokens,
                    completionTokens: prev.completionTokens + u.completionTokens
                  }
                }
              }
            }),
          // In code mode: use only code tools + a code-focused system prompt.
          ...(codeMode ? { tools: CODE_TOOL_DEFS, systemPrompt: codePromptMd.trim() } : {}),
          onStatus: (text, kind, progress) =>
            set((s) =>
              writeConv(s, convId, (prev) => [
                ...prev,
                {
                  role: 'status',
                  content: text,
                  ...(kind === 'tool' && { done: false }),
                  // Absent on lines that aren't a step (retries, the cap warning).
                  ...(progress && {
                    step: progress.step,
                    maxSteps: progress.maxSteps,
                    ...(progress.tokens !== undefined && { tokens: progress.tokens })
                  })
                }
              ])
            ),
          // Tools run one at a time, so this always closes the last status line.
          onToolEnd: () =>
            set((s) =>
              writeConv(s, convId, (prev) => {
                const i = prev.findLastIndex((m) => m.done === false)
                if (i === -1) return prev
                const messages = [...prev]
                messages[i] = { ...messages[i], done: true }
                return messages
              })
            )
        }
      )
      set((s) => writeConv(s, convId, (prev) => [...prev, { role: 'assistant', content: reply }]))
      // Leave a breadcrumb for the next session (best-effort; see writeHandoff).
      // Pass the run's own convId so a truncated handoff can point back to it.
      void writeHandoff(text, reply, convId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao contatar o modelo'
      // The banner belongs to the chat that failed. If the user has moved on,
      // showing it in `error` would pin someone else's failure to whatever is
      // open — so record it in the run's own transcript instead, where it
      // persists and explains itself when they return.
      set((s) =>
        convId === s.conversationId
          ? { error: msg }
          : writeConv(s, convId, (prev) => [
              ...prev,
              { role: 'status', content: `Erro: ${msg}`, done: true }
            ])
      )
    } finally {
      // A tool that threw leaves its line pending; left that way, the next turn
      // would revive it as "running". Routed to the run's own chat.
      set((s) =>
        writeConv(s, convId, (prev) =>
          prev.some((m) => m.done === false)
            ? prev.map((m) => (m.done === false ? { ...m, done: true } : m))
            : prev
        )
      )
      // Tear down this run's transient state, leaving every other run's alone.
      // autoApprove is deliberately NOT cleared: "Sempre permitir" latches the
      // mode on for this conversation, and a follow-up message keeps it.
      set((s) => {
        const streaming = { ...s.streaming }
        delete streaming[convId]
        const streamingTools = { ...s.streamingTools }
        delete streamingTools[convId]
        const runProjects = { ...s.runProjects }
        delete runProjects[convId]
        const runUsage = { ...s.runUsage }
        delete runUsage[convId]
        // Release this run's task leases so another agent can pick them up.
        const taskLeases = Object.fromEntries(
          Object.entries(s.taskLeases).filter(([, c]) => c !== convId)
        )
        return {
          running: setDel(s.running, convId),
          abortRequested: setDel(s.abortRequested, convId),
          streaming,
          streamingTools,
          runProjects,
          runUsage,
          taskLeases
        }
      })
    }
  },

  abort: (convId) =>
    set((s) => {
      const id = convId ?? s.conversationId
      if (!id) return s
      // Resolve any parked approval so the loop can unblock and reach
      // shouldAbort(). Without this, a run stuck on approval never sees the
      // abort flag because it's parked deep inside await onApprove().
      approvalResolvers.get(id)?.(new Set())
      approvalResolvers.delete(id)
      return {
        abortRequested: setAdd(s.abortRequested, id),
        pendingApprovals: s.pendingApprovals.filter((p) => p.convId !== id)
      }
    }),

  acquireLease: (taskId, convId) => {
    const s = get()
    const holder = s.taskLeases[taskId]
    // Free, ours already, or held by a run that has since ended → grant (and
    // take over a stale lease). Held by another *live* run → deny.
    if (holder && holder !== convId && s.running.has(holder)) return false
    set({ taskLeases: { ...s.taskLeases, [taskId]: convId } })
    return true
  },

  // Shows the approval card for this run and resolves when the user decides (the
  // agent loop awaits this). In auto mode it resolves immediately, approving
  // every write. A run replaces its own earlier card rather than stacking two.
  requestApproval: (convId, writes) => {
    if (get().autoApprove.has(convId)) return Promise.resolve(new Set(writes.map((w) => w.id)))
    return new Promise((resolve) => {
      approvalResolvers.set(convId, resolve)
      set((s) => ({
        pendingApprovals: [
          ...s.pendingApprovals.filter((p) => p.convId !== convId),
          { convId, writes, selected: new Set(writes.map((w) => w.id)) }
        ]
      }))
    })
  },

  resolveApproval: (convId, ids) => {
    approvalResolvers.get(convId)?.(ids)
    approvalResolvers.delete(convId)
    set((s) => ({ pendingApprovals: s.pendingApprovals.filter((p) => p.convId !== convId) }))
  },

  toggleApproval: (convId, id) =>
    set((s) => ({
      pendingApprovals: s.pendingApprovals.map((p) => {
        if (p.convId !== convId) return p
        const selected = new Set(p.selected)
        if (selected.has(id)) selected.delete(id)
        else selected.add(id)
        return { ...p, selected }
      })
    })),

  setAutoApprove: (convId, v) =>
    set((s) => ({ autoApprove: v ? setAdd(s.autoApprove, convId) : setDel(s.autoApprove, convId) })),

  setPlanMode: (convId, v) =>
    set((s) => ({ planMode: v ? setAdd(s.planMode, convId) : setDel(s.planMode, convId) })),

  openConversation: (conv) =>
    set((s) => {
      const parked = { ...s.parked }
      // Leaving a chat the loop is still writing to: park its transcript so the
      // run keeps a destination. Re-reading it from disk later would lose
      // everything the run appended after the last save.
      if (s.conversationId && s.running.has(s.conversationId) && s.conversationId !== conv.id) {
        parked[s.conversationId] = { messages: s.messages, usage: s.usage }
      }
      // Coming back to one: the parked copy is ahead of the file, so it wins.
      const live = parked[conv.id]
      delete parked[conv.id]
      return {
        conversationId: conv.id,
        messages: live?.messages ?? conv.messages,
        // Older files predate usage tracking: zero means "unknown", and the
        // header hides the counter rather than claiming this cost nothing.
        usage: live?.usage ?? conv.usage ?? EMPTY_USAGE,
        error: null,
        parked
      }
    }),

  dropConversation: (id) =>
    set((s) => {
      const parked = { ...s.parked }
      delete parked[id]
      // A run writing into a deleted chat has nowhere to land: stop it rather
      // than pay for steps whose output is discarded. The loop reads
      // abortRequested between steps and unwinds on its own.
      const killing = s.running.has(id)
      if (killing) {
        approvalResolvers.get(id)?.(new Set())
        approvalResolvers.delete(id)
      }
      return {
        parked,
        ...(killing && {
          abortRequested: setAdd(s.abortRequested, id),
          pendingApprovals: s.pendingApprovals.filter((p) => p.convId !== id),
          taskLeases: Object.fromEntries(
            Object.entries(s.taskLeases).filter(([, c]) => c !== id)
          )
        })
      }
    }),
  setMessages: (next) =>
    set((s) => ({ messages: typeof next === 'function' ? next(s.messages) : next })),
  setRunning: (convId, v) =>
    set((s) => ({ running: v ? setAdd(s.running, convId) : setDel(s.running, convId) })),
  setError: (e) => set({ error: e }),
  addUsage: (u) =>
    set((s) => ({
      usage: {
        promptTokens: s.usage.promptTokens + u.promptTokens,
        completionTokens: s.usage.completionTokens + u.completionTokens
      }
    })),
  setUsage: (u) => set({ usage: u }),
  setConversationId: (id) => set({ conversationId: id }),
  ensureConversationId: () => {
    const existing = get().conversationId
    if (existing) return existing
    const id = uuidv4()
    set({ conversationId: id })
    return id
  },
  markSaved: () => set((s) => ({ savedTick: s.savedTick + 1 })),

  reset: () => {
    // "Nova" is a request for a blank chat, nothing more. A run in flight in the
    // chat being left is spared: its transcript is parked so the loop keeps a
    // destination, and its running/approval/auto state (all keyed by convId)
    // are left untouched. Cancelling here would kill a run the user never asked
    // to stop.
    set((s) => {
      const parked = { ...s.parked }
      if (s.conversationId && s.running.has(s.conversationId)) {
        parked[s.conversationId] = { messages: s.messages, usage: s.usage }
      }
      return {
        messages: [],
        conversationId: null,
        error: null,
        usage: EMPTY_USAGE,
        parked
      }
    })
  }
}))
