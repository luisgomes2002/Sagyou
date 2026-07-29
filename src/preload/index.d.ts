import { ElectronAPI } from '@electron-toolkit/preload'
import type { RunMetricInput, RunMetricsSummary } from '../main/run-metrics'
import type { AiMemory, MemoryInput, MemorySummary, MemoryConflict } from '../main/memory'

/** Persisted AI provider config (stored in the main process, not the renderer). */
interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** Optional heavier model for code/analysis tasks; absent = one model for all. */
  modelComplex?: string
  /** Separate provider for the native code agent; empty fields fall back to the chat config. */
  codeAgent?: { baseUrl?: string; apiKey?: string; model?: string }
  /** Whether the ai-jail sandbox is required for the agent's shell commands (absent = on). */
  sandboxEnabled?: boolean
  /** Whether the sandbox onboarding has been answered (so it doesn't reappear). */
  sandboxOnboardingDismissed?: boolean
  /** Optional cap on the agent's tool rounds; absent means the per-mode default. */
  maxSteps?: number
  /** USD per 1M tokens for the configured provider. Absent = cost not shown. */
  inputPricePer1M?: number
  outputPricePer1M?: number
  /** Wait for the model to start responding, in ms. Absent = the main default. */
  timeoutMs?: number
  /** Conversation to reopen when the AI view is entered. */
  lastConversationId?: string
  /**
   * DeepSeek reasoning_effort parameter. Controls how much reasoning the model
   * does before answering. One of 'low', 'medium', 'high'. Only sent when set.
   */
  reasoningEffort?: 'low' | 'medium' | 'high'

}

/** A tool call requested by the model, in the OpenAI/DeepSeek wire format. */
interface AIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** A tool the model is allowed to call, in the OpenAI/DeepSeek wire format. */
interface AIToolDefinition {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

/** One part of a multimodal message (vision turns). */
type AIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

interface AIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  /** An array of parts on a vision turn; a plain string otherwise. */
  content: string | AIContentPart[]
  /** Present on assistant turns that request tool calls. */
  tool_calls?: AIToolCall[]
  /** Present on tool-result messages (role: 'tool'). */
  tool_call_id?: string
}

interface AIChatRequest {
  messages: AIChatMessage[]
  /** Tools exposed to the model this turn (enables the agent loop). */
  tools?: AIToolDefinition[]
  /** Overrides the stored config model for this call. */
  model?: string
  /** Provider credentials; when omitted the main process uses the stored config. */
  baseUrl?: string
  apiKey?: string
}

/** Tokens billed by a model call, as the provider reported them. */
interface TokenUsage {
  promptTokens: number
  completionTokens: number
  /** See TokenUsage.cachedPromptTokens — absent = the provider reported none. */
  cachedPromptTokens?: number
  /** Tokens the model spent on internal reasoning (DeepSeek). Billed but invisible. */
  reasoningTokens?: number
}

/** Totals for a slice of the usage log. */
interface UsageBucket {
  calls: number
  promptTokens: number
  completionTokens: number
  /** USD summed over the priced calls only — see unpricedCalls. */
  cost: number
  /** Calls with no price attached; their spend is unknown, not zero. */
  unpricedCalls: number
  /** Sum of cachedPromptTokens over calls whose provider reported a cache figure. */
  cachedPromptTokens: number
  /** Of promptTokens, the portion belonging to calls that reported a cache figure. */
  cacheReportedPromptTokens: number
  /** Sum of reasoningTokens over every call. */
  reasoningTokens?: number
}

/** One logged model call. */
interface UsageLogEntry {
  at: string
  model: string
  promptTokens: number
  completionTokens: number
  /** USD at the prices configured when the call ran. Absent = unknown. */
  cost?: number
  /** See TokenUsage.cachedPromptTokens. Absent = the provider reported none. */
  cachedPromptTokens?: number
  /** See TokenUsage.reasoningTokens. Absent = the provider reported none. */
  reasoningTokens?: number
}

interface UsageSummary {
  today: UsageBucket
  last30: UsageBucket
  total: UsageBucket
  byModel: { model: string; bucket: UsageBucket }[]
  recent: UsageLogEntry[]
}

/** A page fetched for the assistant, or why it wasn't. */
type WebFetchResult = { content: string; url: string; truncated: boolean } | { error: string }

/** A user-written Skill (.md file in userData/skills/). */
interface Skill {
  name: string
  body: string
  updatedAt: string
}

interface AIChatResponse {
  success: boolean
  message?: AIChatMessage
  error?: string
  /**
   * Provider HTTP status when the call got a response. Absent means it never
   * reached one (DNS, refused connection). The agent uses it to decide whether
   * a failure is worth retrying.
   */
  status?: number
  /** Absent when the provider reported no usage (many local servers don't). */
  usage?: TokenUsage
}

interface AIModelsRequest {
  /** Provider credentials; when omitted the main process uses the stored config. */
  baseUrl?: string
  apiKey?: string
}

interface AIModelsResponse {
  success: boolean
  models?: string[]
  error?: string
}

interface AIStoredMessage {
  /** 'status' is a display-only trace of the agent's work, never a chat turn. */
  role: 'user' | 'assistant' | 'status'
  content: string
  /** Chat-image ids; the bytes live as files under chat-images/. */
  imageIds?: string[]
  /** Chat-document ids; the bytes live as files under chat-files/. */
  documentIds?: string[]
}

/**
 * A recognised environment failure that left the agent reporting success while
 * changing nothing, paired with the fix. Surfaced in the panel rather than only
 * in the log, which sits behind a toggle.
 */
interface AgentHint {
  title: string
  detail: string
  /** A shell command that fixes it, for the user to run themselves. */
  command?: string
}

/** Live progress of a code-agent run: the step and the running token total. */
interface AgentProgress {
  step: number
  maxSteps: number
  promptTokens: number
  completionTokens: number
}

interface CodeAgentDiff {
  /** Unified diff. Empty means the agent changed nothing. */
  patch: string
  files: { path: string; added: number; removed: number }[]
  truncated: boolean
  /** New files there wasn't room to show in `patch`. */
  omittedNewFiles: string[]
  /** Set when no diff could be produced (not a repo, base gone, git failed). */
  error?: string
}

/** A live (in-flight) code-agent run summary, as returned by status(). */
interface CodeRunSummary {
  id: string
  dir: string
  task: string
  convId: string | null
  agent: string
  startedAt: number
  log: string
  model?: string
  hint: AgentHint | null
  progress?: AgentProgress
  autoApprove?: boolean
}

/** A finished code-agent run, as listed in the run picker. */
interface AgentRunMeta {
  id: string
  /** The chat that started it. Null for a run with no chat behind it. */
  convId: string | null
  /** codex is the only agent. Kept on the row so the picker can state it. */
  agent: 'codex'
  dir: string
  task: string
  startedAt: number
  endedAt: number
  exitCode: number
  fileCount: number
  /** Tokens billed across the run. Absent on old rows / no-usage providers. */
  tokens?: { promptTokens: number; completionTokens: number }
}

/** An archived run: metadata plus the output frozen when the agent exited. */
interface AgentRunSnapshot extends AgentRunMeta {
  log: string
  /** Null when the run had no diff to take (not a git repo). */
  diff: CodeAgentDiff | null
}

interface AIConversationMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

interface AIConversation extends AIConversationMeta {
  messages: AIStoredMessage[]
  /** Tokens billed across the conversation's life. Absent on pre-existing files. */
  usage?: TokenUsage
  /** The user named this chat; the autosave must not derive over it. */
  titleCustom?: boolean
}

declare global {
  interface Window {
    electron: ElectronAPI
    electronAPI: {
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
        isMaximized: () => Promise<boolean>
        onMaximizedChange: (cb: (isMax: boolean) => void) => () => void
      }
      store: {
        load: () => Promise<{ projects: unknown[]; tasks: unknown[] }>
        save: (data: unknown) => Promise<void>
      }
      backup: {
        export: (backup: unknown) => Promise<{ success: boolean; cancelled?: boolean }>
        import: () => Promise<{
          success: boolean
          cancelled?: boolean
          data?: unknown
          error?: string
        }>
      }
      ai: {
        import: () => Promise<{
          success: boolean
          cancelled?: boolean
          data?: unknown
          error?: string
        }>
        config: {
          get: () => Promise<AIConfig>
          set: (config: AIConfig) => Promise<void>
        }
        usage: { summary: () => Promise<UsageSummary> }
        runMetrics: {
          append: (input: RunMetricInput) => Promise<void>
          summary: () => Promise<RunMetricsSummary>
        }
        memory: {
          list: (opts?: {
            projectId?: string | null
            includeArchived?: boolean
          }) => Promise<AiMemory[]>
          save: (
            input: MemoryInput & { id?: string }
          ) => Promise<{ memory: AiMemory; redacted: boolean } | { error: string }>
          delete: (id: string) => Promise<void>
          replace: (list: AiMemory[]) => Promise<void>
          touch: (ids: string[]) => Promise<void>
          prune: () => Promise<{ archived: number }>
          summary: () => Promise<MemorySummary>
          conflicts: () => Promise<MemoryConflict[]>
          briefing: (projectId?: string | null) => Promise<{ text: string; count: number; archived: number }>
          handoff: (input: {
            projectId?: string | null
            title: string
            body: string
          }) => Promise<{ ok: true } | { error: string }>
        }
        /** Entity event log: the audit trail for one domain entity. */
        lineage: {
          list: (
            entityType: string,
            entityId: string
          ) => Promise<
            {
              id: string
              entityType: string
              entityId: string
              action: string
              summary: string
              source: string
              toolName?: string
              convId?: string
              timestamp: string
            }[]
          >
        }
        web: { fetch: (url: string, render?: boolean) => Promise<WebFetchResult> }
        images: {
          save: (dataUrl: string) => Promise<{ id: string } | { error: string }>
          get: (id: string) => Promise<{ dataUrl: string } | { error: string }>
          delete: (ids: string[]) => Promise<void>
        }
        /** Documents attached to the chat: saved, parsed, and sent inline. */
        documents: {
          save: (
            name: string,
            ext: string,
            data: number[]
          ) => Promise<
            | { id: string; name: string; ext: string; size: number; text: string; truncated: boolean }
            | { error: string }
          >
          delete: (ids: string[]) => Promise<void>
        }
        /** Read and parse a project file (uploaded via FilesView). */
        projectFile: {
          read: (
            fileId: string
          ) => Promise<{ text: string; truncated: boolean; size?: number } | { error: string }>
        }
        skills: {
          list: () => Promise<Skill[]>
          save: (input: { name: string; body: string; oldName?: string }) => Promise<{ skill: Skill } | { error: string }>
          delete: (name: string) => Promise<void>
          import: () => Promise<{ skill: Skill } | { error: string }>
        }
        models: (request: AIModelsRequest) => Promise<AIModelsResponse>
        chat: (request: AIChatRequest) => Promise<AIChatResponse>
        chatStream: (
          request: AIChatRequest,
          onDelta: (chunk: string) => void,
          /** A tool call being composed: named as soon as it's known, before its args land. */
          onTool?: (index: number, name: string) => void
        ) => Promise<AIChatResponse>
        codeAgent: {
          run: (request: {
            path: string
            task: string
            files?: string[]
            /** Scope decisions already agreed with the user, honoured without re-deciding. */
            decisoes?: string[]
            /** The chat that asked, so the run can be reopened from it later. */
            convId?: string
            /** The project whose memory to brief the agent with. */
            projectId?: string | null
            autoApprove?: boolean
          }) => Promise<{ success: boolean; agent?: string; dir?: string; runId?: string; error?: string }>
          /** Stop one run by id, or all when omitted. */
          stop: (runId?: string) => Promise<void>
          /** Answer an approval card the native agent's loop is parked on. */
          approve: (id: string, approved: boolean) => Promise<void>
          setAuto: (runId: string, enabled: boolean) => Promise<void>
          /**
           * `running` is true while any run is active.
           * `runs` lists every live run for multi-agent support.
           * Old singleton fields (`log`, `model`, `hint`, `progress`) are
           * kept for backward compat but carry no data — use `runs` instead.
           */
          status: () => Promise<{
            running: boolean
            log: string
            model?: string
            hint: AgentHint | null
            /** Live step + running token total, so a late-mounting panel catches up. */
            progress?: AgentProgress
            /** All live runs. `runs.length > 0` is the canonical "any agent running?" check. */
            runs: CodeRunSummary[]
          }>
          /** What a run changed. Pass `runId` for a specific run; omit for the first active. */
          diff: (runId?: string) => Promise<CodeAgentDiff>
          /** Past runs of one conversation, newest first. Metadata only. */
          runs: (convId?: string) => Promise<AgentRunMeta[]>
          /**
           * One archived run. Its diff is a snapshot taken when the agent
           * exited — never re-derived, or the user's later edits would be shown
           * as the agent's work.
           */
          runGet: (id: string) => Promise<AgentRunSnapshot | null>
          runRenew: (id: string) => Promise<void>
          /** Live output stream. Payload carries runId to distinguish concurrent runs. */
          onOutput: (cb: (payload: { runId: string; chunk: string }) => void) => () => void
          /** Fires immediately when a run starts — before any output. */
          onStarted: (cb: (payload: { runId: string; dir: string }) => void) => () => void
          onExit: (cb: (payload: { runId: string; code: number }) => void) => () => void
          /** A finished run has been archived and can now be listed. */
          onArchived: (cb: (payload: { runId: string; id: string; convId: string | null }) => void) => () => void
          /** Live progress during a run (step + running token total). */
          onProgress: (cb: (p: { runId: string } & AgentProgress) => void) => () => void
          /** A tool call being run, then its result summary (native agent). */
          onToolEvent: (
            cb: (ev: {
              runId: string
              phase: 'call' | 'result'
              name: string
              args?: Record<string, unknown>
              summary?: string
            }) => void
          ) => () => void
          /** The loop needs approval for a write/command before it runs. */
          onApproveRequest: (
            cb: (req: {
              runId: string
              id: string
              name: string
              args: Record<string, unknown>
              resumo: string
              /** File contents to be written (capped), for the card's preview. */
              conteudo?: string
              /** Full shell command to be run, for the card's preview. */
              comando?: string
              /** old→new line diff for a write (over an existing file), for colouring. */
              diff?: { kind: 'add' | 'del' | 'ctx' | 'meta'; text: string }[]
              /** The diff was longer than the cap and cut. */
              diffTruncated?: boolean
              /** Overwrite/command — the card warns (old bytes lost / arbitrary effect). */
              irreversivel?: boolean
            }) => void
          ) => () => void
          /** A recognised environment failure hit mid-run (sandbox couldn't start, …). */
          onHint: (cb: (hint: { runId: string } & AgentHint) => void) => () => void
          onAutoChanged: (cb: (payload: { runId: string; autoApprove: boolean }) => void) => () => void
        }
        jail: {
          status: (refresh?: boolean) => Promise<{
            available: boolean
            version: string | null
            path: string | null
            platform: string
            installable: boolean
            bubblewrap?: boolean
            wsl2?: boolean
            viaWsl?: boolean
            reason?: string
            enabled: boolean
            onboardingDismissed: boolean
            wslCommand: string
            wslAiJailCommands: string
          }>
          install: () => Promise<{ success: boolean; version?: string; path?: string; error?: string }>
          dismissOnboarding: () => Promise<void>
          onProgress: (cb: (p: { phase: string; fraction: number | null }) => void) => () => void
        }
        pickDirectory: () => Promise<{ path: string | null }>
        code: {
          list: (
            root: string,
            sub?: string,
            offset?: number,
            limit?: number
          ) => Promise<{
            files?: string[]
            truncated?: boolean
            offset?: number
            total?: number
            nextOffset?: number
            error?: string
          }>
          read: (
            root: string,
            rel: string,
            offset?: number,
            maxChars?: number,
            scope?: { symbol?: string; lineStart?: number; lineEnd?: number }
          ) => Promise<{
            content?: string
            truncated?: boolean
            offset?: number
            total?: number
            nextOffset?: number
            simbolo?: string
            linhaInicio?: number
            linhaFim?: number
            simbolos?: { nome: string; linha: number; tipo: string }[]
            error?: string
          }>
          search: (
            root: string,
            term: string
          ) => Promise<{
            matches?: { file: string; line: number; text: string }[]
            truncated?: boolean
            error?: string
          }>
        }
        conversations: {
          list: () => Promise<AIConversationMeta[]>
          search: (term: string) => Promise<(AIConversationMeta & { snippet?: string })[]>
          get: (id: string) => Promise<AIConversation | null>
          save: (conv: {
            id: string
            title: string
            messages: AIStoredMessage[]
            usage?: TokenUsage
          }) => Promise<void>
          rename: (id: string, title: string) => Promise<{ title?: string; error?: string }>
          delete: (id: string) => Promise<void>
          all: () => Promise<AIConversation[]>
          replace: (list: AIConversation[]) => Promise<void>
        }
      }
      files: {
        upload: () => Promise<
          { id: string; name: string; ext: string; size: number; createdAt: string }[]
        >
        delete: (id: string, ext: string) => Promise<{ success: boolean }>
        open: (id: string, ext: string) => Promise<{ success: boolean; error?: string }>
        openInBrowser: (id: string, ext: string) => Promise<{ success: boolean; error?: string }>
        download: (
          id: string,
          name: string,
          ext: string
        ) => Promise<{ success: boolean; cancelled?: boolean; error?: string }>
      }
      taskImages: {
        save: (
          dataUrl: string
        ) => Promise<{ id: string; ext: string; size: number } | { error: string }>
        get: (id: string, ext: string) => Promise<{ dataUrl: string } | { error: string }>
        delete: (items: { id: string; ext: string }[]) => Promise<void>
      }
      excel: {
        export: (
          buffer: ArrayBuffer,
          filename: string
        ) => Promise<{ success: boolean; cancelled?: boolean; error?: string }>
      }
      financial: {
        fetchExchangeRate: (
          pair: string
        ) => Promise<{
          rate: string
          date: string
          source: 'awesomeapi' | 'frankfurter' | 'cache' | 'identity'
          error?: string
        }>
      }
    }
  }
}
