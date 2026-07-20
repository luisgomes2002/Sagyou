import { TOOL_DEFS, runTool, isWriteTool, describeToolActivity, type ToolDef } from './tools'
import systemPromptMd from './system-prompt.md?raw'

// ---------------------------------------------------------------------------
// Agent — the tool-calling loop, proxied through the main process (ai:chat).
// Keeps the API key out of the renderer and avoids CORS on hosted providers.
// ---------------------------------------------------------------------------

/** AI provider config (base URL, key, model). */
export interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
  /**
   * User-set cap on tool rounds per answer. Undefined (the default) keeps the
   * per-mode defaults below — see resolveMaxSteps.
   */
  maxSteps?: number
  /**
   * USD per 1M tokens for this provider. No default is possible — the same app
   * talks to OpenAI and to a free local model — so absent means "don't quote a
   * cost" rather than "assume zero".
   */
  inputPricePer1M?: number
  outputPricePer1M?: number
  /**
   * How long to wait for the model to start responding, in ms. Applied in the
   * main process, which owns the HTTP call; absent means its default.
   */
  timeoutMs?: number
  /** The conversation to reopen when the AI view is entered. */
  lastConversationId?: string
  /** Template picked for Gerar Tasks. Absent = the built-in default. */
  taskTemplateId?: string
}

/** Tokens billed by a model call, as the provider reported them. */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/**
 * One part of a multimodal message. Vision models take an array of these in
 * place of a plain string — text alongside images.
 */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** A message on the wire — carries tool plumbing (tool_calls / tool_call_id). */
export interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  /**
   * A plain string for ordinary turns; an array of parts when the turn carries
   * images. Wire-only — the transcript and ai-conversations.json keep text and
   * image ids separately, so this shape never reaches disk.
   */
  content: string | ContentPart[]
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

/**
 * A message's text, whatever shape it arrived in.
 *
 * Models answer with a plain string — the array form is what *we* send for a
 * turn with images. This flattens either, so an unexpected multimodal reply
 * reads as its text instead of "[object Object]".
 */
export function contentText(content: string | ContentPart[] | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

/** A pending write action awaiting the user's approval. */
export interface PendingCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/** Asks the user which write actions to approve; resolves with the approved ids. */
export type ApprovalRequest = (writes: PendingCall[]) => Promise<Set<string>>

/**
 * The assistant's system prompt, kept in system-prompt.md so it can be edited
 * and reviewed as prose rather than as a string concatenation.
 *
 * Vite inlines the file at build time (`?raw`), so there's no file read at
 * runtime and it still works from a packaged asar. Editing the .md hot-reloads
 * in dev.
 *
 * Everything in that file is sent to the model verbatim — it is prompt text,
 * not documentation. Don't put comments or front-matter in it.
 */
export const SYSTEM_PROMPT = systemPromptMd.trim()

// Timeout bounds, for the config UI's placeholder and limits.
//
// The main process ENFORCES these (openai-client.ts owns the HTTP call and
// clamps whatever it is handed) — these copies exist because the renderer can't
// import from main without dragging the OpenAI SDK into its bundle. Same
// convention as main/store.ts mirroring the renderer's types. Keep in step.
export const DEFAULT_TIMEOUT_MS = 60_000
export const MIN_TIMEOUT_MS = 5_000
export const MAX_TIMEOUT_MS = 600_000

/** Error from a model call, carrying the provider's HTTP status when there was one. */
export class ModelError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ModelError'
  }
}

/** Extra attempts a failed model call gets before the run gives up. */
export const MAX_RETRIES = 3

/** First backoff step; each retry doubles it. */
export const RETRY_BASE_MS = 500

/**
 * Whether a failed model call is worth trying again.
 *
 * Retrying a permanent failure is worse than not retrying: a wrong API key
 * would take three backoffs to report "401" instead of saying so at once. So
 * only transient conditions requalify — rate limits, timeouts, and the
 * provider's own 5xx.
 *
 * No status means the call never got a response (DNS, refused connection,
 * dropped socket). That's the classic transient case, so it retries.
 */
export function isRetryable(status: number | undefined): boolean {
  if (status === undefined) return true
  if (status === 408 || status === 429) return true
  return status >= 500 && status < 600
}

/** Exponential backoff with jitter, so parallel clients don't retry in lockstep. */
export function backoffDelay(attempt: number): number {
  return RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * RETRY_BASE_MS)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Default safety cap on loop iterations, so a misbehaving model can't spin forever.
 *
 * Manual mode, so every write still stops for approval — the cost of a long run
 * here is bounded by a human saying yes to each step, not by this number alone.
 */
export const MAX_STEPS = 15

/**
 * Default cap in automatic mode, where the agent chains actions on its own.
 *
 * ⚠️ **40 is a deliberate choice, not an accident** — it was briefly lowered to
 * 15 as a cost measure and raised back on request. Keep the cost shape in mind
 * before touching it: every step is a paid call that resends the whole
 * accumulated history, so the *last* steps of a long run are far more expensive
 * than the first, and the total grows worse than linearly in this number.
 * That is why turning automatic mode on quotes an estimate first
 * (`estimateAutoRun`, priced off the user's own logged calls).
 */
export const AUTO_MAX_STEPS = 40

/** Nothing may raise the cap past this — every step is a paid model call. */
export const MAX_STEPS_LIMIT = 50

/**
 * How many times the model may make the *same read call* (identical tool name
 * and arguments) in one run before the loop stops actually running it. On the
 * Nth try the tool is skipped and a nudge is fed back instead — a soft brake on
 * a model that has started looping, complementary to maxSteps (which caps how
 * many steps run; this cuts a stuck run short before it burns them all).
 */
export const READ_REPEAT_LIMIT = 3

/**
 * How many tool rounds a run gets.
 *
 * The step cap and the approval mode are separate concerns that used to be
 * welded together: the only way to get more than MAX_STEPS was automatic mode,
 * which also gives up per-action approval. A configured value therefore wins in
 * BOTH modes — someone who asks for 15 steps while still approving each write
 * should get exactly that.
 *
 * Anything absent or nonsensical (0, negative, NaN, a hand-edited string in
 * ai-config.json) falls back to the mode's default rather than erroring.
 */
export function resolveMaxSteps(configured: unknown, autoApprove: boolean): number {
  const fallback = autoApprove ? AUTO_MAX_STEPS : MAX_STEPS
  if (typeof configured !== 'number' || !Number.isFinite(configured)) return fallback
  const n = Math.floor(configured)
  if (n < 1) return fallback
  return Math.min(n, MAX_STEPS_LIMIT)
}

export interface RunAgentOptions {
  /** Max loop iterations before forcing a final answer (default MAX_STEPS). */
  maxSteps?: number
  /** Checked between iterations; if it returns true, the loop stops early. */
  shouldAbort?: () => boolean
  /**
   * Called as the model types, with the accumulated text of the assistant
   * message currently being generated. Resets to '' at the start of each step,
   * so a step that only calls tools doesn't leave its text on screen.
   */
  onStream?: (text: string) => void
  /**
   * Called once per intermediate step with what the agent is doing: the model's
   * own remark on the way to a tool call ("vou verificar as tasks…"), then one
   * line per tool. Lets the caller keep a trace of the work in the transcript;
   * without it these steps are invisible and the text is discarded.
   *
   * `kind` says which of the two it is, so a caller can render a tool line as
   * running until the matching onToolEnd arrives.
   */
  onStatus?: (text: string, kind?: 'remark' | 'tool') => void
  /**
   * Called with the tools the model is composing *right now*, as their names
   * arrive — before the message is finished and before any of them runs.
   *
   * This is the gap it fills: a step that calls a tool with no preamble streams
   * no text at all, so `onStream` never fires and the only thing on screen is an
   * anonymous spinner for as long as the arguments take to arrive — seconds, for
   * a `criar_tasks` carrying twenty of them. The name is known from the first
   * delta; only the arguments are slow.
   *
   * Transient and **not** a transcript line: `onStatus(_, 'tool')` still fires
   * per tool at execution time, and that is what gets kept. This fires with `[]`
   * when the message completes (handing over to those) and at the start of every
   * retry attempt.
   */
  onToolStream?: (names: string[]) => void
  /**
   * Called when the tool announced by the preceding onStatus(_, 'tool') has
   * finished, whether it succeeded or reported an error. Tools run one at a
   * time, so this always closes the most recent 'tool' status.
   */
  onToolEnd?: () => void
  /**
   * Reports the tokens each model call billed. One answer can take several
   * calls (one per tool round), and every one is charged, so this fires per
   * call and the caller adds them up. Silent when the provider reports nothing.
   */
  onUsage?: (usage: TokenUsage) => void
}

/**
 * One round-trip to the model, returning the full assistant message. Pass
 * onDelta to stream the text out chunk by chunk as it's generated; the resolved
 * message is the same either way.
 */
export async function callModel(
  cfg: AIConfig,
  messages: ApiMessage[],
  tools?: ToolDef[],
  onDelta?: (chunk: string) => void,
  onTool?: (index: number, name: string) => void
): Promise<{ message: ApiMessage; usage?: TokenUsage }> {
  const request = {
    messages,
    tools,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model
  }
  const res = onDelta
    ? await window.electronAPI.ai.chatStream(request, onDelta, onTool)
    : await window.electronAPI.ai.chat(request)
  if (!res.success || !res.message) {
    throw new ModelError(res.error || 'Falha ao contatar o modelo', res.status)
  }
  // usage is absent whenever the provider didn't report any — many local
  // servers don't. That's "unknown", not zero.
  return { message: res.message as ApiMessage, usage: res.usage }
}

/**
 * callModel, but riding out a transient provider failure instead of throwing it
 * at the user.
 *
 * A run holds everything it has done so far in `msgs` — tool results and all —
 * and none of that survives the exception. Losing five steps of work to one 503
 * on the sixth is the whole reason this exists.
 *
 * Only the model call is retried. Tools are never re-run: a retry that replayed
 * `criar_tasks` would duplicate the user's data.
 */
async function callModelResilient(
  cfg: AIConfig,
  msgs: ApiMessage[],
  tools: ToolDef[] | undefined,
  opts: RunAgentOptions
): Promise<ApiMessage> {
  const { onStream, onStatus, onToolStream, shouldAbort, onUsage } = opts
  for (let attempt = 0; ; attempt++) {
    // Reset per attempt: a half-streamed answer from the failed try must not be
    // left on screen, nor prepended to what the retry types out. The same goes
    // for the tools it had begun to announce — the retry composes its own, and
    // a dead attempt's would otherwise sit there being wrong.
    let buffer = ''
    const pending: string[] = []
    onStream?.('')
    onToolStream?.([])
    try {
      const { message, usage } = await callModel(
        cfg,
        msgs,
        tools,
        onStream &&
          ((chunk) => {
            buffer += chunk
            onStream(buffer)
          }),
        onToolStream &&
          ((index, name) => {
            // Keyed by index, so a name arriving in pieces corrects itself
            // rather than appearing twice.
            pending[index] = name
            onToolStream([...pending].filter(Boolean))
          })
      )
      // The message is complete: the real per-tool status lines take over from
      // here, and leaving this on would show the same work twice.
      onToolStream?.([])
      // Only a call that came back is billed; a failed attempt isn't reported.
      if (usage) onUsage?.(usage)
      return message
    } catch (e) {
      const status = e instanceof ModelError ? e.status : undefined
      // Don't keep retrying something the user has already stopped.
      if (attempt >= MAX_RETRIES || !isRetryable(status) || shouldAbort?.()) throw e
      const wait = backoffDelay(attempt)
      const reason = e instanceof Error ? e.message : 'falha'
      onStatus?.(
        `Falha ao contatar o modelo (${reason}). Tentando de novo em ${(wait / 1000).toFixed(1)}s — ${attempt + 1}/${MAX_RETRIES}.`,
        'remark'
      )
      await sleep(wait)
      onStream?.('')
    }
  }
}

/** Stand-in left where a superseded tool result used to be. */
const ELIDED = JSON.stringify({
  elided: 'Resultado substituído por uma chamada idêntica mais recente nesta mesma execução.'
})

/**
 * Below this, a result isn't worth the words it would take to explain its
 * absence — and eliding it saves nothing worth measuring.
 */
const ELIDE_MIN_CHARS = 400

/**
 * Blank out tool results that a later, identical call has already replaced.
 *
 * `msgs` grows all run and **every step resends all of it**, so a big result
 * (`ler_tasks` on a 155-task board is ~8.5k tokens) is paid for again on each
 * later step. When the model asks the same tool the same question twice, the
 * older answer is dead weight: the newer one is the current truth, and where
 * they differ the older is simply stale.
 *
 * Deliberately narrow, because the alternative is worse than the bill:
 * - **Same tool AND same arguments only.** Any looser and this would drop a
 *   result the model still needs, which makes it re-fetch (another paid call)
 *   or, worse, answer without it.
 * - **The message stays, only its content goes.** The API requires a `tool`
 *   message for every `tool_call` id; removing it outright is a 400.
 * - **Read tools only.** A write's result reports what happened — two identical
 *   `criar_tasks` calls are two different events, not a repeated question.
 * - **The last result for any given call is always kept**, however duplicated.
 *
 * This does not touch the case of a single large result resent across many
 * steps — nothing can, safely: the model may still need it. That one is fixed
 * at the source, by `ler_tasks` returning a filtered slice instead of a board.
 */
export function pruneSupersededResults(msgs: ApiMessage[]): ApiMessage[] {
  // tool_call_id -> what was asked, so a result can be compared to a later one.
  const asked = new Map<string, string>()
  for (const m of msgs) {
    for (const c of m.tool_calls ?? []) {
      if (isWriteTool(c.function.name)) continue
      asked.set(c.id, `${c.function.name}:${c.function.arguments ?? ''}`)
    }
  }

  // Walking backwards, the first result seen for a question is the newest.
  const seen = new Set<string>()
  const out = [...msgs]
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]
    if (m.role !== 'tool' || !m.tool_call_id) continue
    const question = asked.get(m.tool_call_id)
    if (!question) continue
    if (!seen.has(question)) {
      seen.add(question)
      continue // the newest answer to this question — keep it
    }
    if (typeof m.content === 'string' && m.content.length >= ELIDE_MIN_CHARS) {
      out[i] = { ...m, content: ELIDED }
    }
  }
  return out
}

/**
 * Count this read call by its signature (tool name + arguments) and return the
 * running tally for the run. Reads only: a repeated write is a distinct event,
 * not a loop — the same line pruneSupersededResults draws. Arguments are
 * canonicalised through JSON.stringify so "same call" ignores key spacing.
 */
function bumpReadRepeat(
  counts: Map<string, number>,
  name: string,
  args: Record<string, unknown>
): number {
  const sig = `${name}:${JSON.stringify(args)}`
  const n = (counts.get(sig) ?? 0) + 1
  counts.set(sig, n)
  return n
}

/**
 * The tool-calling loop: call the model with tools; while it returns
 * tool_calls, run each against the store and feed the results back; stop when
 * it answers with plain text (or after MAX_STEPS as a safety cap).
 *
 * Read tools run automatically; write tools pause the loop for user approval
 * (onApprove) and only run if approved — denied ones report back to the model.
 */
export async function runAgent(
  cfg: AIConfig,
  conversation: ApiMessage[],
  onApprove: ApprovalRequest,
  opts: RunAgentOptions = {}
): Promise<string> {
  // Clamped, not trusted: this number now comes from a setting the user can
  // hand-edit in ai-config.json, and each step is a paid model call.
  const maxSteps = resolveMaxSteps(opts.maxSteps ?? MAX_STEPS, false)
  const msgs: ApiMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...conversation]
  const { onStream, onStatus, onToolEnd } = opts
  // Tracks how often each read call (tool + args) has been made this run, so the
  // brake below can stop one the model keeps repeating instead of re-running it.
  const readRepeats = new Map<string, number>()

  for (let step = 0; step < maxSteps; step++) {
    if (opts.shouldAbort?.()) return 'Execução interrompida.'
    // Prune a copy, not `msgs` itself: the run keeps its full history, and only
    // what goes over the wire is trimmed.
    const assistant = await callModelResilient(cfg, pruneSupersededResults(msgs), TOOL_DEFS, opts)
    msgs.push(assistant)
    const calls = assistant.tool_calls
    if (!calls || calls.length === 0) return contentText(assistant.content)

    // This step calls tools, so its text is only a remark on the way to the
    // real answer ("deixa eu ver as tasks…"). Keep it as a status line — the
    // streamed copy is about to be cleared for the next step.
    const remark = contentText(assistant.content).trim()
    if (remark) {
      onStatus?.(remark, 'remark')
      // Hand off from the typing bubble to the status line now, not at the top
      // of the next step — the tools in between can take a while, and the text
      // would sit on screen twice.
      onStream?.('')
    }

    // Parse args once; a tool result must be returned for every tool_call.
    const parsed = calls.map((call) => {
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
        return { call, args: args as Record<string, unknown>, parseError: null as string | null }
      } catch {
        return { call, args: {} as Record<string, unknown>, parseError: 'Argumentos inválidos (JSON)' }
      }
    })

    // Gate write tools behind approval; reads run without asking.
    const writes = parsed
      .filter((p) => !p.parseError && isWriteTool(p.call.function.name))
      .map((p) => ({ id: p.call.id, name: p.call.function.name, args: p.args }))
    const approved = writes.length > 0 ? await onApprove(writes) : new Set<string>()

    for (const { call, args, parseError } of parsed) {
      let result: string
      if (parseError) {
        result = JSON.stringify({ error: parseError })
      } else if (isWriteTool(call.function.name) && !approved.has(call.id)) {
        result = JSON.stringify({ error: 'Ação recusada pelo usuário' })
      } else if (
        !isWriteTool(call.function.name) &&
        bumpReadRepeat(readRepeats, call.function.name, args) >= READ_REPEAT_LIMIT
      ) {
        // Soft brake: the model is looping on the same read (same tool + args).
        // Don't run it again — hand back a nudge to conclude with what it has.
        // Complements maxSteps: it ends a stuck run early instead of letting it
        // burn every remaining step re-fetching an answer it already holds. The
        // nudge goes back as an ordinary tool result, so no work is discarded.
        result = JSON.stringify({
          error: `Você já fez esta chamada ${READ_REPEAT_LIMIT}x com os mesmos argumentos e obteve o mesmo resultado. Não repita — responda com o que já tem.`
        })
      } else {
        onStatus?.(describeToolActivity(call.function.name, args), 'tool')
        try {
          result = await runTool(call.function.name, args)
        } finally {
          onToolEnd?.()
        }
      }
      msgs.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  // Safety cap reached — force a final text answer with tools disabled.
  const final = await callModelResilient(cfg, pruneSupersededResults(msgs), undefined, opts)
  return contentText(final.content) || 'Parei após várias etapas. Pode reformular o pedido?'
}
