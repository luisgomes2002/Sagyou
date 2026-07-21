import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { runAgent, resolveMaxSteps } from '../ai/agent'
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
// config panels, the Gerar Tasks review, image attachments.
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

/**
 * Apply `fn` to the transcript of the chat the loop is running for, wherever it
 * is: on screen, or parked because the user switched away.
 *
 * This is the whole point of `runningConvId`. Every append the loop makes goes
 * through here, so none of them can land in a chat that merely happens to be
 * open. Returning `s` unchanged is the honest answer when the run's chat is
 * gone (deleted mid-run) — there is nowhere to write, and inventing a
 * destination is what the bug did.
 */
function routeRun(
  s: AiRunState,
  fn: (prev: ChatMessage[]) => ChatMessage[]
): Partial<AiRunState> | AiRunState {
  const id = s.runningConvId
  if (!id) return s
  if (id === s.conversationId) return { messages: fn(s.messages) }
  const p = s.parked[id]
  if (!p) return s
  return { parked: { ...s.parked, [id]: { ...p, messages: fn(p.messages) } } }
}

/** The same routing, for the token count — billed to the chat that asked. */
function routeUsage(s: AiRunState, u: TokenUsage): Partial<AiRunState> | AiRunState {
  const add = (prev: TokenUsage): TokenUsage => ({
    promptTokens: prev.promptTokens + u.promptTokens,
    completionTokens: prev.completionTokens + u.completionTokens
  })
  const id = s.runningConvId
  // No run: a direct addUsage (Gerar Tasks) bills the chat on screen.
  if (!id) return { usage: add(s.usage) }
  if (id === s.conversationId) return { usage: add(s.usage) }
  const p = s.parked[id]
  if (!p) return s
  return { parked: { ...s.parked, [id]: { ...p, usage: add(p.usage) } } }
}

/**
 * The agent loop awaits this, so it is a live continuation rather than UI
 * state: kept out of the store proper because nothing renders it and replacing
 * it must never trigger a render. One run at a time, so one slot is enough.
 */
let approvalResolver: ((ids: Set<string>) => void) | null = null

/** A transcript the user has switched away from. See `parked` below. */
interface Parked {
  messages: ChatMessage[]
  usage: TokenUsage
}

export interface AiRunState {
  /** The transcript on screen — the chat `conversationId` names, and only that one. */
  messages: ChatMessage[]
  busy: boolean
  /** Text of the answer being typed out right now (empty until the first chunk). */
  streaming: string
  /**
   * Tools the model is composing this very moment, named before their arguments
   * have finished arriving.
   *
   * Transient — it is not part of the transcript and never reaches disk. The
   * persistent record of a tool is the 'status' line appended when it actually
   * runs; this only fills the silence while the model writes the call, which is
   * otherwise a spinner with nothing to say.
   */
  streamingTools: string[]
  error: string | null
  /**
   * Tokens billed across this conversation. Summed over every call, because
   * every call is charged — not the size of the last prompt.
   */
  usage: TokenUsage
  /** Which chat is on screen. */
  conversationId: string | null
  /**
   * Which chat the running loop belongs to — the one that asked, which is not
   * necessarily the one being looked at.
   *
   * A run used to write to "the current transcript", so switching chats
   * mid-run swapped the target out from under it and the answer landed in
   * whichever chat the user had moved to (and was saved there). The run is
   * bound to its own conversation instead: `writeRun` routes every append to
   * this id, on screen or not. Null when nothing is running.
   */
  runningConvId: string | null
  /**
   * Transcripts that are live but not on screen, keyed by conversation id.
   *
   * A chat the user leaves mid-run still has an answer coming, so its
   * transcript can't be dropped and can't be re-read from disk (the file is
   * behind the run). It waits here: `writeRun` keeps appending, the host keeps
   * saving it, and re-opening it takes the live copy back rather than the
   * stale file. Entries are only made when leaving a *running* chat, so this
   * holds one at most today and empties as chats are re-opened.
   */
  parked: Record<string, Parked>
  pendingApproval: { writes: PendingCall[]; selected: Set<string> } | null
  /**
   * Auto-approve mode: when on, write actions run without the card (the agent
   * chains actions autonomously). Off by default. It is deliberately tied to
   * the run it was turned on for — AIView clears it on entry when nothing is
   * in flight, so it can't quietly outlive that run and surrender the approval
   * gate on the next one.
   */
  autoApprove: boolean
  /** Set by the Stop button; the loop reads it between steps. */
  abortRequested: boolean
  /**
   * Bumped after each autosave, so a mounted AIView can refresh its history
   * list. The save itself is the host's job (it outlives the view).
   */
  savedTick: number

  send: (
    config: AIConfig,
    opts: { text: string; imageIds: string[]; imageData: Record<string, string> }
  ) => Promise<void>
  abort: () => void
  requestApproval: (writes: PendingCall[]) => Promise<Set<string>>
  resolveApproval: (ids: Set<string>) => void
  toggleApproval: (id: string) => void
  setAutoApprove: (v: boolean) => void
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
  setBusy: (v: boolean) => void
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
  busy: false,
  streaming: '',
  streamingTools: [],
  error: null,
  usage: EMPTY_USAGE,
  conversationId: null,
  runningConvId: null,
  parked: {},
  pendingApproval: null,
  autoApprove: false,
  abortRequested: false,
  savedTick: 0,

  send: async (config, { text, imageIds, imageData }) => {
    if (get().busy) return
    const next: ChatMessage[] = [
      ...get().messages,
      { role: 'user', content: text, ...(imageIds.length > 0 && { imageIds }) }
    ]
    set({
      messages: next,
      busy: true,
      streaming: '',
      streamingTools: [],
      error: null,
      abortRequested: false
    })
    // Mint the id up front rather than leaving it to the autosave: the run has
    // to know which conversation it belongs to from the start, or a run whose
    // view is closed before the first save has nowhere to land.
    const convId = get().ensureConversationId()
    // Bind the run to the chat that asked. Everything below writes through
    // `writeRun`/`addUsage`, which target this id — never "whatever is open".
    set({ runningConvId: convId })
    try {
      const reply = await runAgent(config, toApiMessages(next, imageData), get().requestApproval, {
        maxSteps: resolveMaxSteps(config.maxSteps, get().autoApprove),
        shouldAbort: () => get().abortRequested,
        onStream: (t) => set({ streaming: t }),
        onToolStream: (names) => set({ streamingTools: names }),
        onUsage: (u) => get().addUsage(u),
        // Status lines land in the transcript as they happen, so append to the
        // latest state rather than to the `next` snapshot taken above.
        onStatus: (text, kind, progress) =>
          set((s) =>
            routeRun(s, (prev) => [
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
            routeRun(s, (prev) => {
              const i = prev.findLastIndex((m) => m.done === false)
              if (i === -1) return prev
              const messages = [...prev]
              messages[i] = { ...messages[i], done: true }
              return messages
            })
          )
      })
      set((s) => routeRun(s, (prev) => [...prev, { role: 'assistant', content: reply }]))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao contatar o modelo'
      // The banner belongs to the chat that failed. If the user has moved on,
      // showing it here would pin someone else's failure to whatever is open,
      // and it would be gone by the time they went back to look — so record it
      // in the run's own transcript instead, where it persists and explains
      // itself when they return.
      set((s) =>
        s.runningConvId === s.conversationId
          ? { error: msg }
          : routeRun(s, (prev) => [...prev, { role: 'status', content: `Erro: ${msg}`, done: true }])
      )
    } finally {
      // A tool that threw leaves its line pending; left that way, the next turn
      // would revive it as "running" once busy flips back on. Routed like every
      // other write — the failed run's chat may not be the one on screen.
      set((s) =>
        routeRun(s, (prev) =>
          prev.some((m) => m.done === false)
            ? prev.map((m) => (m.done === false ? { ...m, done: true } : m))
            : prev
        )
      )
      // Unbind last: everything above still had to reach the run's chat.
      set({ streaming: '', streamingTools: [], busy: false, runningConvId: null })
    }
  },

  abort: () => set({ abortRequested: true }),

  // Shows the approval card and resolves when the user decides (the agent loop
  // awaits this). In auto mode it resolves immediately, approving every write.
  requestApproval: (writes) => {
    if (get().autoApprove) return Promise.resolve(new Set(writes.map((w) => w.id)))
    return new Promise((resolve) => {
      approvalResolver = resolve
      set({ pendingApproval: { writes, selected: new Set(writes.map((w) => w.id)) } })
    })
  },

  resolveApproval: (ids) => {
    approvalResolver?.(ids)
    approvalResolver = null
    set({ pendingApproval: null })
  },

  toggleApproval: (id) =>
    set((s) => {
      if (!s.pendingApproval) return s
      const selected = new Set(s.pendingApproval.selected)
      if (selected.has(id)) selected.delete(id)
      else selected.add(id)
      return { pendingApproval: { ...s.pendingApproval, selected } }
    }),

  setAutoApprove: (v) => set({ autoApprove: v }),
  openConversation: (conv) =>
    set((s) => {
      const parked = { ...s.parked }
      // Leaving a chat the loop is still writing to: park its transcript so the
      // run keeps a destination. Re-reading it from disk later would lose
      // everything the run appended after the last save.
      if (s.conversationId && s.conversationId === s.runningConvId && s.conversationId !== conv.id) {
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
      const killing = s.runningConvId === id
      if (killing) {
        approvalResolver?.(new Set())
        approvalResolver = null
      }
      return {
        parked,
        ...(killing && { abortRequested: true, pendingApproval: null })
      }
    }),
  setMessages: (next) =>
    set((s) => ({ messages: typeof next === 'function' ? next(s.messages) : next })),
  setBusy: (v) => set({ busy: v }),
  setError: (e) => set({ error: e }),
  addUsage: (u) => set((s) => routeUsage(s, u)),
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
    const busy = get().busy
    // A run in flight is left alone. This used to cancel whatever the loop was
    // waiting on, because a card raised by a chat you had navigated away from
    // was unanswerable — but the card is the host's now and shows wherever the
    // user is, and the run keeps its own transcript, so "Nova" is a request for
    // a blank chat and nothing more. Cancelling here would kill a run the user
    // never asked to stop. Same for autoApprove: clearing it mid-run would park
    // the very run it was turned on for.
    if (!busy) {
      approvalResolver?.(new Set())
      approvalResolver = null
    }
    set((s) => {
      const parked = { ...s.parked }
      if (s.conversationId && s.conversationId === s.runningConvId) {
        parked[s.conversationId] = { messages: s.messages, usage: s.usage }
      }
      return {
        messages: [],
        conversationId: null,
        error: null,
        usage: EMPTY_USAGE,
        streaming: '',
        streamingTools: [],
        parked,
        ...(busy ? {} : { pendingApproval: null, autoApprove: false })
      }
    })
  }
}))
