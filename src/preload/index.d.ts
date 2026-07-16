import { ElectronAPI } from '@electron-toolkit/preload'

/** Persisted AI provider config (stored in the main process, not the renderer). */
interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
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

interface AIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
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

interface AIChatResponse {
  success: boolean
  message?: AIChatMessage
  error?: string
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
}

interface AIConversationMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

interface AIConversation extends AIConversationMeta {
  messages: AIStoredMessage[]
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
        import: () => Promise<{ success: boolean; cancelled?: boolean; data?: unknown; error?: string }>
      }
      ai: {
        import: () => Promise<{ success: boolean; cancelled?: boolean; data?: unknown; error?: string }>
        config: {
          get: () => Promise<AIConfig>
          set: (config: AIConfig) => Promise<void>
        }
        models: (request: AIModelsRequest) => Promise<AIModelsResponse>
        chat: (request: AIChatRequest) => Promise<AIChatResponse>
        chatStream: (
          request: AIChatRequest,
          onDelta: (chunk: string) => void
        ) => Promise<AIChatResponse>
        codeAgent: {
          run: (request: {
            path: string
            task: string
            agent?: 'aider' | 'codex'
          }) => Promise<{ success: boolean; agent?: string; dir?: string; error?: string }>
          stop: () => Promise<void>
          status: () => Promise<{ running: boolean }>
          onOutput: (cb: (chunk: string) => void) => () => void
          onExit: (cb: (code: number) => void) => () => void
        }
        pickDirectory: () => Promise<{ path: string | null }>
        code: {
          list: (
            root: string,
            sub?: string
          ) => Promise<{ files?: string[]; truncated?: boolean; error?: string }>
          read: (
            root: string,
            rel: string
          ) => Promise<{ content?: string; truncated?: boolean; error?: string }>
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
          get: (id: string) => Promise<AIConversation | null>
          save: (conv: {
            id: string
            title: string
            messages: AIStoredMessage[]
          }) => Promise<void>
          delete: (id: string) => Promise<void>
          all: () => Promise<AIConversation[]>
          replace: (list: AIConversation[]) => Promise<void>
        }
      }
      files: {
        upload: () => Promise<{ id: string; name: string; ext: string; size: number; createdAt: string }[]>
        delete: (id: string, ext: string) => Promise<{ success: boolean }>
        open: (id: string, ext: string) => Promise<{ success: boolean; error?: string }>
        openInBrowser: (id: string, ext: string) => Promise<{ success: boolean; error?: string }>
        download: (id: string, name: string, ext: string) => Promise<{ success: boolean; cancelled?: boolean; error?: string }>
      }
      excel: {
        export: (buffer: ArrayBuffer, filename: string) => Promise<{ success: boolean; cancelled?: boolean; error?: string }>
      }
    }
  }
}
