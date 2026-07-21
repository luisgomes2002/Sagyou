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
   * Optional heavier model for code/analysis work. When set, a run whose
   * triggering message looks like a code task (see routeModel) uses this model,
   * and everything else stays on the cheaper `model`. Absent = one model for
   * everything, unchanged from before.
   */
  modelComplex?: string
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
  /**
   * A separate provider for the native code agent. Any field left empty falls
   * back to the chat config above, so a user sets only what differs. Absent =
   * the code agent uses the chat provider.
   */
  codeAgent?: { baseUrl?: string; apiKey?: string; model?: string }
  /** Whether the ai-jail sandbox is required for the agent's shell commands (absent = on). */
  sandboxEnabled?: boolean
  /** Whether the sandbox onboarding has been answered (so it doesn't reappear). */
  sandboxOnboardingDismissed?: boolean
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
export const MAX_STEPS = 40

/**
 * Default cap in automatic mode, where the agent chains actions on its own.
 *
 * ⚠️ **100 is a deliberate choice, not an accident** — the pair has been moved
 * twice on request (15/40 originally, briefly 15/15 as a cost measure, now
 * 40/100). Keep the cost shape in mind before touching it: every step is a paid
 * call that resends the whole accumulated history, so the *last* steps of a long
 * run are far more expensive than the first, and the total grows worse than
 * linearly in this number. That is why turning automatic mode on quotes an
 * estimate first (`estimateAutoRun`, priced off the user's own logged calls).
 */
export const AUTO_MAX_STEPS = 100

/**
 * Nothing may raise the cap past this — every step is a paid model call.
 *
 * Must stay >= AUTO_MAX_STEPS: resolveMaxSteps clamps to this, so a limit below
 * the automatic default would silently cap automatic runs at the limit and make
 * the documented default a lie.
 */
export const MAX_STEPS_LIMIT = 100

/**
 * Below this, a hand-set step cap is likely to cut a real task short, so the
 * settings panel warns rather than silently accepting it.
 *
 * Calibrated on what an implementation run actually spends before it does any
 * work: orienting in a codebase costs several steps on its own (list the tree,
 * search, then read — and a file over CODE_READ_PAGE takes more than one read
 * to page through). A cap in the single digits is therefore often exhausted
 * during the *reading*, and the run ends having understood the task without
 * having started it. It's a warning and not a floor: a low cap is legitimate
 * for a cheap question, and the user may well mean it.
 */
export const LOW_STEPS_WARNING = 10

/**
 * Words that mark a message as a code / deep-analysis task, worth routing to the
 * heavier `modelComplex`. Matched against accent-stripped, lowercased text, so
 * only ASCII stems belong here (see routeModel). Kept deliberately close to the
 * user's own list — over-matching would send cheap questions to the pricey model
 * and quietly raise the bill this whole feature exists to lower.
 */
export const COMPLEX_TASK_PATTERN =
  /\b(codigo|bug|refator|arquitetura|investig|implement|depura|debug|stacktrace|stack trace|excecao|traceback|algoritmo)\w*/

/** Lowercase and strip accents, so "código"/"refatorar" match ASCII stems. */
function normalizeForRoute(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

/**
 * Which model a run should use, given the message that triggered it.
 *
 * With no `modelComplex` configured this is always `cfg.model` — the previous
 * single-model behaviour, unchanged. When one is set, a message that reads like
 * a code or analysis task (COMPLEX_TASK_PATTERN) goes to it and everything else
 * stays on the cheaper `model`. Routing is per-run, decided once from the last
 * user turn, so a follow-up question is re-classified on its own words.
 */
export function routeModel(userText: string, cfg: AIConfig): string {
  const complex = cfg.modelComplex?.trim()
  if (!complex) return cfg.model
  return COMPLEX_TASK_PATTERN.test(normalizeForRoute(userText)) ? complex : cfg.model
}

/** The text of the last user turn in a conversation — what routeModel weighs. */
function lastUserText(conversation: ApiMessage[]): string {
  for (let i = conversation.length - 1; i >= 0; i--) {
    if (conversation[i].role === 'user') return contentText(conversation[i].content)
  }
  return ''
}

/** Which step of the run a status line belongs to, for a "3/40" badge. */
export interface StepProgress {
  /** 1-based, so the first step reads "1/40" and not "0/40". */
  step: number
  /** This run's resolved cap — not the constant, which the user can override. */
  maxSteps: number
  /**
   * Tokens this step's model call billed (prompt + completion), so the trace can
   * show what each step cost. Absent when the provider reported no usage — the
   * step still ran, its cost is just unknown. Known only after the call returns,
   * so it's filled in before the step's status lines are emitted.
   */
  tokens?: number
}

/**
 * How many times the model may make the *same read call* (identical tool name
 * and arguments) in one run before the loop stops actually running it. On the
 * Nth try the tool is skipped and a nudge is fed back instead — a soft brake on
 * a model that has started looping, complementary to maxSteps (which caps how
 * many steps run; this cuts a stuck run short before it burns them all).
 */
export const READ_REPEAT_LIMIT = 3

/**
 * How many times the model may read the *same file* blindly — ler_arquivo on a
 * path with no targeting argument (simbolo / linha_inicio / linha_fim / inicio)
 * — before the loop stops running it. Tighter than READ_REPEAT_LIMIT because a
 * second blind read of a whole file is almost always the model re-fetching what
 * it already has; the nudge points it at the surgical args instead. Scoped and
 * paged reads of the same file are never counted here — those are legitimate.
 */
export const BLIND_FILE_READ_LIMIT = 2

/** How many recent buscar_no_codigo terms a run remembers for fuzzy-dup detection. */
export const SEARCH_HISTORY_MAX = 5

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
  /**
   * The active project, used to fetch the memory briefing injected at run start
   * (this project's memories + the globals). Absent = globals only. Best-effort:
   * a missing memory bridge (older preload, tests) just means no briefing.
   */
  projectId?: string | null
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
   *
   * `progress` carries which step the line belongs to, for a "3/40" badge. It
   * is **absent on lines that are not a step of the run** — a retry notice
   * (the same step being attempted again) and the cap warning after the loop.
   * Numbering those would overstate how much budget was spent. Several tool
   * lines in one step deliberately share a number: they ran in the same round.
   */
  onStatus?: (text: string, kind?: 'remark' | 'tool', progress?: StepProgress) => void
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

/** Increment a counter keyed by `key` and return the new tally. */
function bumpCount(counts: Map<string, number>, key: string): number {
  const n = (counts.get(key) ?? 0) + 1
  counts.set(key, n)
  return n
}

/**
 * Signature for a "blind" whole-file read — ler_arquivo on a path with no
 * targeting argument. Returns null for any other tool, or for a scoped/paged
 * read (simbolo, a line range, or an offset), which are legitimate and must
 * never be braked. Includes pastaId so the same relative path under two roots
 * isn't conflated.
 */
function blindFileReadSignature(name: string, args: Record<string, unknown>): string | null {
  if (name !== 'ler_arquivo') return null
  const caminho = typeof args.caminho === 'string' ? args.caminho.trim() : ''
  if (!caminho) return null
  const targeted =
    (typeof args.simbolo === 'string' && args.simbolo.trim() !== '') ||
    typeof args.linha_inicio === 'number' ||
    typeof args.linha_fim === 'number' ||
    typeof args.inicio === 'number'
  if (targeted) return null
  const pasta = typeof args.pastaId === 'string' ? args.pastaId : ''
  return `ler_arquivo:${pasta}:${caminho}`
}

/** A search term, normalised for fuzzy comparison. */
function normalizeSearchTerm(t: unknown): string {
  return typeof t === 'string' ? t.trim().toLowerCase() : ''
}

/**
 * Register a buscar_no_codigo term against the run's recent history and, if a
 * prior term already covers it (one is a substring of the other), return a
 * warning to hand back alongside the results. The search still runs — this only
 * nudges the model to reuse what it already fetched instead of re-searching a
 * variation. Exact repeats are left to the READ_REPEAT brake.
 */
function fuzzySearchWarning(history: string[], args: Record<string, unknown>): string | null {
  const term = normalizeSearchTerm(args.termo)
  if (!term) return null
  let warning: string | null = null
  for (const prev of history) {
    if (prev === term) continue
    if (prev.includes(term) || term.includes(prev)) {
      warning =
        `Você já buscou por "${prev}" nesta execução — os resultados anteriores ` +
        `provavelmente já cobrem "${term}". Prefira reusá-los a repetir a busca.`
      break
    }
  }
  history.push(term)
  while (history.length > SEARCH_HISTORY_MAX) history.shift()
  return warning
}

/** Merge an `aviso` field into a tool-result JSON string, best-effort. */
function withAviso(result: string, aviso: string): string {
  try {
    const parsed = JSON.parse(result)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify({ ...parsed, aviso })
    }
  } catch {
    // Not a JSON object — leave the result untouched.
  }
  return result
}

/** One model call's billed tokens plus the tools its step went on to run. */
export interface StepCost {
  step: number
  prompt: number
  completion: number
  tools: string[]
}

/** A run's cost, rolled up from its per-call records. */
export interface RunCostSummary {
  /** Model calls that actually billed (a call the provider left unpriced is dropped). */
  calls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** USD estimate, or null when either price is unset (mirrors the app's rule). */
  costUsd: number | null
  /** The costliest calls first (up to 3), for spotting where the tokens went. */
  top: StepCost[]
}

/**
 * Roll a run's per-call records into a summary, or null when the provider
 * reported no usage at all (there is nothing to show).
 *
 * ⚠️ A call's figure is the whole accumulated prompt, not one tool's share:
 * tokens are billed per call, and this cannot attribute them to a single tool.
 * `top[i].tools` names what that step went on to run, so a costly step is
 * recognisable even though the cost isn't the tool's alone.
 */
export function summarizeRunCost(cfg: AIConfig, records: StepCost[]): RunCostSummary | null {
  const priced = records.filter((r) => r.prompt > 0 || r.completion > 0)
  if (priced.length === 0) return null
  const promptTokens = priced.reduce((s, r) => s + r.prompt, 0)
  const completionTokens = priced.reduce((s, r) => s + r.completion, 0)
  const costUsd =
    typeof cfg.inputPricePer1M === 'number' && typeof cfg.outputPricePer1M === 'number'
      ? (promptTokens / 1e6) * cfg.inputPricePer1M + (completionTokens / 1e6) * cfg.outputPricePer1M
      : null
  const top = [...priced]
    .sort((a, b) => b.prompt + b.completion - (a.prompt + a.completion))
    .slice(0, 3)
  return {
    calls: priced.length,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd,
    top
  }
}

/**
 * Log a run's cost breakdown to the console — a diagnostic to spot waste in
 * production. The model is what chooses to filter and scope, and this shows
 * whether it did. Silent when there was nothing billed.
 */
function logRunCost(cfg: AIConfig, records: StepCost[]): void {
  const s = summarizeRunCost(cfg, records)
  if (!s) return
  const lines = s.top.map((r) => {
    const what = r.tools.length ? r.tools.join(', ') : '(resposta final)'
    return `    passo ${r.step}: ${r.prompt + r.completion} tokens (prompt ${r.prompt} + saída ${r.completion}) — ${what}`
  })
  console.info(
    `[agente] custo da execução: ${s.calls} chamada(s), ${s.totalTokens} tokens ` +
      `(prompt ${s.promptTokens} + saída ${s.completionTokens})` +
      (s.costUsd != null ? `, ~$${s.costUsd.toFixed(4)}` : '') +
      '\n  ⚠️ estimativa: tokens são por chamada (histórico acumulado), não por ferramenta.' +
      '\n  chamadas mais caras:\n' +
      lines.join('\n')
  )
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
  // Pick the model once, from the message that started the run: a code task goes
  // to `modelComplex` (when configured), the rest stays on the cheaper `model`.
  // Every call this run makes uses `rcfg`, so the whole loop runs on one model.
  const rcfg: AIConfig = { ...cfg, model: routeModel(lastUserText(conversation), cfg) }
  // Prepend the memory briefing (this project's memories + globals) to the system
  // prompt. Best-effort and guarded: a briefing failure — or an absent bridge in
  // tests/older preload — leaves the prompt exactly as it was. Reading the
  // briefing is decay-neutral (see formatMemoriesForPrompt); only buscar_memoria
  // touches memories.
  let systemContent = SYSTEM_PROMPT
  try {
    const brief = await window.electronAPI?.ai?.memory?.briefing?.(opts.projectId ?? null)
    if (brief?.text) systemContent = `${SYSTEM_PROMPT}\n\n${brief.text}`
    // The briefing call also runs the lazy decay pass. Surface it only when it
    // actually retired something — rare, so it's a signal, not noise.
    if (brief?.archived) {
      opts.onStatus?.(
        `${brief.archived} memória(s) arquivada(s) por inatividade.`,
        'remark'
      )
    }
  } catch {
    /* memory is best-effort; a briefing failure never blocks the run */
  }
  const msgs: ApiMessage[] = [{ role: 'system', content: systemContent }, ...conversation]
  const { onStream, onStatus, onToolEnd } = opts
  // Run-scoped brake state. Each counter/list lives for one run only, so a
  // brake never carries over into the next answer.
  //  - readRepeats: how often each exact read call (tool + args) was made.
  //  - blindFileReads: how often each file was read *whole* (ler_arquivo, no scope).
  //  - searchTerms: recent buscar_no_codigo terms, for fuzzy-dup warnings.
  const readRepeats = new Map<string, number>()
  const blindFileReads = new Map<string, number>()
  const searchTerms: string[] = []

  // A read call's brake, or null to let it run. Computed once per read (its
  // counters increment as a side effect), never for a write. Two brakes:
  // the exact-repeat one (same tool + args, READ_REPEAT_LIMIT) and the blind
  // whole-file one (same file re-read without a scope, BLIND_FILE_READ_LIMIT).
  const readBrake = (name: string, args: Record<string, unknown>): string | null => {
    if (bumpReadRepeat(readRepeats, name, args) >= READ_REPEAT_LIMIT) {
      // The model is looping on the same read. Hand back a nudge to conclude
      // with what it has instead of burning steps re-fetching the same answer.
      return JSON.stringify({
        error: `Você já fez esta chamada ${READ_REPEAT_LIMIT}x com os mesmos argumentos e obteve o mesmo resultado. Não repita — responda com o que já tem.`
      })
    }
    const blindSig = blindFileReadSignature(name, args)
    if (blindSig && bumpCount(blindFileReads, blindSig) >= BLIND_FILE_READ_LIMIT) {
      const caminho = typeof args.caminho === 'string' ? args.caminho : 'esse arquivo'
      return JSON.stringify({
        error: `Você já leu "${caminho}" inteiro nesta execução. Se precisa de um trecho específico, use "simbolo", "linha_inicio"/"linha_fim" ou "inicio" — não releia o arquivo todo.`
      })
    }
    return null
  }

  // Per-run cost accounting for the end-of-run log. onUsage still reaches the
  // caller; this wrapper also records each call so logRunCost can break it down.
  const costRecords: StepCost[] = []
  // The wrapper fills in the record for the call in flight — the one just pushed
  // before the call, so it is always the last. Reporting through a fresh record
  // per call sidesteps the flow-narrowing a mutable local would trip on. Retries
  // don't double-count: callModelResilient reports usage once, on success only.
  const runOpts: RunAgentOptions = {
    ...opts,
    onUsage: (u) => {
      const rec = costRecords[costRecords.length - 1]
      if (rec) {
        rec.prompt = u.promptTokens
        rec.completion = u.completionTokens
      }
      opts.onUsage?.(u)
    }
  }

  // Per-run efficiency counters, sent to the main process at the end (Task 8).
  // steps counts completed model rounds; the two waste signals count how often
  // the run's own brakes/warnings fired.
  let stepsRun = 0
  let redundantSearches = 0
  let repeatedReads = 0
  let hitStepCap = false

  try {
    for (let step = 0; step < maxSteps; step++) {
      // 1-based for display: the badge on the first step should read "1/40".
      const progress: StepProgress = { step: step + 1, maxSteps }
      if (opts.shouldAbort?.()) return 'Execução interrompida.'
      // Open this step's cost record *before* the call, so onUsage (firing
      // during it) fills this one; its tools are appended as they run below.
      const cost: StepCost = { step: step + 1, prompt: 0, completion: 0, tools: [] }
      costRecords.push(cost)
      // Prune a copy, not `msgs` itself: the run keeps its full history, and only
      // what goes over the wire is trimmed.
      const assistant = await callModelResilient(rcfg, pruneSupersededResults(msgs), TOOL_DEFS, runOpts)
      msgs.push(assistant)
      // Count a step only once its model call came back — a thrown call is not a
      // completed round, and shouldn't inflate the efficiency average.
      stepsRun++
      // The call is done, so its cost is known: attach it to this step's badge.
      // Only when billed — a 0 would read as "free" rather than "unknown".
      if (cost.prompt + cost.completion > 0) progress.tokens = cost.prompt + cost.completion
      const calls = assistant.tool_calls
      if (!calls || calls.length === 0) return contentText(assistant.content)

      // This step calls tools, so its text is only a remark on the way to the
      // real answer ("deixa eu ver as tasks…"). Keep it as a status line — the
      // streamed copy is about to be cleared for the next step.
      const remark = contentText(assistant.content).trim()
      if (remark) {
        onStatus?.(remark, 'remark', progress)
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
        const name = call.function.name
        const isWrite = isWriteTool(name)
        // Read brakes increment run-scoped counters, so compute once per read
        // (whether or not it fires) and never for a write.
        const brake = !parseError && !isWrite ? readBrake(name, args) : null
        let result: string
        if (parseError) {
          result = JSON.stringify({ error: parseError })
        } else if (isWrite && !approved.has(call.id)) {
          result = JSON.stringify({ error: 'Ação recusada pelo usuário' })
        } else if (brake) {
          result = brake
          repeatedReads++
        } else {
          cost.tools.push(name)
          onStatus?.(describeToolActivity(name, args), 'tool', progress)
          try {
            result = await runTool(name, args)
          } finally {
            onToolEnd?.()
          }
          // A fuzzy-duplicate search still runs, but carries a nudge to reuse
          // the earlier results instead of re-searching a variation.
          if (name === 'buscar_no_codigo') {
            const warn = fuzzySearchWarning(searchTerms, args)
            if (warn) {
              result = withAviso(result, warn)
              redundantSearches++
            }
          }
        }
        msgs.push({ role: 'tool', tool_call_id: call.id, content: result })
      }
    }

    // Safety cap reached — force a final text answer with tools disabled.
    //
    // ⚠️ Say so *before* that answer lands. The forced reply reads exactly like a
    // normal one: the model summarises what it has and gives no sign it was cut
    // off mid-task. Without this line the two outcomes are indistinguishable in
    // the transcript, so a run that stopped halfway through implementing
    // something is read as a finished job — the user acts on a partial result
    // believing it is the whole one. A run that *concluded* never reaches here
    // (it returns from inside the loop), so this cannot fire on a healthy run.
    hitStepCap = true
    onStatus?.(
      `Limite de ${maxSteps} passos atingido — a tarefa pode estar incompleta. ` +
        'O assistente vai resumir só o que deu tempo de fazer. Para ir mais longe, ' +
        `aumente "Passos máximos" nas configurações (máx. ${MAX_STEPS_LIMIT}).`,
      'remark'
    )
    costRecords.push({ step: maxSteps + 1, prompt: 0, completion: 0, tools: [] })
    const final = await callModelResilient(rcfg, pruneSupersededResults(msgs), undefined, runOpts)
    return (
      contentText(final.content) ||
      `Parei ao atingir o limite de ${maxSteps} passos, sem conseguir concluir. ` +
        'Tente dividir o pedido em partes menores ou aumentar "Passos máximos" nas configurações.'
    )
  } finally {
    logRunCost(rcfg, costRecords)
    // Best-effort per-run metric for the efficiency log (main persists it).
    // Guarded and fire-and-forget: a bookkeeping failure — or an absent bridge
    // in tests — must never touch the run. Only recorded once a round completed.
    if (stepsRun > 0) {
      const s = summarizeRunCost(rcfg, costRecords)
      void window.electronAPI?.ai?.runMetrics
        ?.append?.({
          model: rcfg.model,
          steps: stepsRun,
          calls: s?.calls ?? 0,
          promptTokens: s?.promptTokens ?? 0,
          completionTokens: s?.completionTokens ?? 0,
          totalTokens: s?.totalTokens ?? 0,
          redundantSearches,
          repeatedReads,
          hitStepCap
        })
        ?.catch(() => {})
    }
  }
}
