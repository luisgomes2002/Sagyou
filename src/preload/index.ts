import { contextBridge, ipcRenderer } from 'electron'

/** A user-written prompt template for Gerar Tasks. */
interface PromptTemplate {
  id: string
  name: string
  body: string
  createdAt: string
  updatedAt: string
}

/** Totals for a slice of the usage log. `unpricedCalls` are calls with no price. */
interface UsageBucket {
  calls: number
  promptTokens: number
  completionTokens: number
  cost: number
  unpricedCalls: number
}
import { electronAPI } from '@electron-toolkit/preload'
// Node's randomUUID, not the WebCrypto global — the latter is only defined in a
// secure context, which the preload can't count on.
import { randomUUID } from 'crypto'

const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (cb: (isMax: boolean) => void) => {
      const handler = (_: Electron.IpcRendererEvent, isMax: boolean) => cb(isMax)
      ipcRenderer.on('window:maximized-change', handler)
      return () => ipcRenderer.removeListener('window:maximized-change', handler)
    }
  },
  store: {
    load: (): Promise<{ projects: unknown[]; tasks: unknown[] }> =>
      ipcRenderer.invoke('store:load'),
    save: (data: unknown): Promise<void> => ipcRenderer.invoke('store:save', data)
  },
  backup: {
    export: (backup: unknown): Promise<{ success: boolean; cancelled?: boolean }> =>
      ipcRenderer.invoke('backup:export', backup),
    import: (): Promise<{ success: boolean; cancelled?: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('backup:import')
  },
  ai: {
    import: (): Promise<{ success: boolean; cancelled?: boolean; data?: unknown; error?: string }> =>
      ipcRenderer.invoke('ai:import'),
    config: {
      get: (): Promise<{
        baseUrl: string
        apiKey: string
        model: string
        maxSteps?: number
        inputPricePer1M?: number
        outputPricePer1M?: number
        timeoutMs?: number
        lastConversationId?: string
        taskTemplateId?: string
      }> => ipcRenderer.invoke('ai:config:get'),
      set: (config: {
        baseUrl: string
        apiKey: string
        model: string
        maxSteps?: number
        inputPricePer1M?: number
        outputPricePer1M?: number
        timeoutMs?: number
        lastConversationId?: string
        taskTemplateId?: string
      }): Promise<void> => ipcRenderer.invoke('ai:config:set', config)
    },
    // Spend tracking: per-call log kept by the main process (ai-usage-log.json).
    usage: {
      summary: (): Promise<{
        today: UsageBucket
        last30: UsageBucket
        total: UsageBucket
        byModel: { model: string; bucket: UsageBucket }[]
        recent: {
          at: string
          model: string
          promptTokens: number
          completionTokens: number
          cost?: number
        }[]
      }> => ipcRenderer.invoke('ai:usage:summary')
    },
    // Lists the provider's models (GET /models) through the main process.
    models: (request: {
      baseUrl?: string
      apiKey?: string
    }): Promise<{ success: boolean; models?: string[]; error?: string }> =>
      ipcRenderer.invoke('ai:models', request),
    // Proxies an OpenAI-compatible /chat/completions call through the main
    // process (avoids CORS, keeps the API key out of the renderer). Supports
    // tool calling so the renderer can drive an agent loop.
    chat: (request: {
      messages: {
        role: 'system' | 'user' | 'assistant' | 'tool'
        content: string | unknown[]
        tool_calls?: unknown[]
        tool_call_id?: string
      }[]
      tools?: unknown[]
      model?: string
      baseUrl?: string
      apiKey?: string
    }): Promise<{
      success: boolean
      message?: { role: 'assistant'; content: string; tool_calls?: unknown[] }
      error?: string
      /** Provider HTTP status, when the call reached one. Drives retry policy. */
      status?: number
      usage?: { promptTokens: number; completionTokens: number }
    }> => ipcRenderer.invoke('ai:chat', request),
    // Streaming variant of `chat`: onDelta fires for each text chunk as the
    // model produces it; the promise resolves with the complete message. The
    // streamId keeps concurrent calls from crossing wires.
    chatStream: (
      request: {
        messages: {
          role: 'system' | 'user' | 'assistant' | 'tool'
          content: string | unknown[]
          tool_calls?: unknown[]
          tool_call_id?: string
        }[]
        tools?: unknown[]
        model?: string
        baseUrl?: string
        apiKey?: string
      },
      onDelta: (chunk: string) => void,
      /** A tool call the model is composing right now, named before its args land. */
      onTool?: (index: number, name: string) => void
    ): Promise<{
      success: boolean
      message?: { role: 'assistant'; content: string; tool_calls?: unknown[] }
      error?: string
      /** Provider HTTP status, when the call reached one. Drives retry policy. */
      status?: number
      usage?: { promptTokens: number; completionTokens: number }
    }> => {
      const streamId = randomUUID()
      const handler = (
        _: Electron.IpcRendererEvent,
        payload: { streamId: string; delta?: string; tool?: { index: number; name: string } }
      ): void => {
        if (payload.streamId !== streamId) return
        // One channel, two kinds of event, so each field is checked before use:
        // a tool payload carries no `delta`, and passing that straight through
        // would append the string "undefined" to the answer.
        if (payload.delta) onDelta(payload.delta)
        if (payload.tool) onTool?.(payload.tool.index, payload.tool.name)
      }
      ipcRenderer.on('ai:chat:delta', handler)
      return ipcRenderer
        .invoke('ai:chat:stream', { ...request, streamId })
        .finally(() => ipcRenderer.removeListener('ai:chat:delta', handler))
    },
    // External code agent (Aider/Codex) spawned in the project directory.
    // Launch only after user approval — it writes files and runs commands.
    codeAgent: {
      run: (request: {
        path: string
        task: string
        agent?: 'aider' | 'codex'
      }): Promise<{ success: boolean; agent?: string; dir?: string; error?: string }> =>
        ipcRenderer.invoke('ai:code-agent:run', request),
      stop: (): Promise<void> => ipcRenderer.invoke('ai:code-agent:stop'),
      status: (): Promise<{ running: boolean; log: string }> =>
        ipcRenderer.invoke('ai:code-agent:status'),
      // What the last run changed. Derived on demand, so a panel that wasn't
      // mounted when the agent finished can still ask.
      diff: (): Promise<{
        patch: string
        files: { path: string; added: number; removed: number }[]
        truncated: boolean
        omittedNewFiles: string[]
        error?: string
      }> => ipcRenderer.invoke('ai:code-agent:diff'),
      onOutput: (cb: (chunk: string) => void) => {
        const handler = (_: Electron.IpcRendererEvent, chunk: string): void => cb(chunk)
        ipcRenderer.on('ai:code-agent:output', handler)
        return () => ipcRenderer.removeListener('ai:code-agent:output', handler)
      },
      onExit: (cb: (code: number) => void) => {
        const handler = (_: Electron.IpcRendererEvent, code: number): void => cb(code)
        ipcRenderer.on('ai:code-agent:exit', handler)
        return () => ipcRenderer.removeListener('ai:code-agent:exit', handler)
      }
    },
    // Native folder picker for choosing a project's code directory.
    pickDirectory: (): Promise<{ path: string | null }> =>
      ipcRenderer.invoke('ai:pick-directory'),
    // Read-only source access, confined to `root` (a project's code path).
    code: {
      list: (
        root: string,
        sub?: string
      ): Promise<{ files?: string[]; truncated?: boolean; error?: string }> =>
        ipcRenderer.invoke('ai:code:list', root, sub),
      read: (
        root: string,
        rel: string
      ): Promise<{ content?: string; truncated?: boolean; error?: string }> =>
        ipcRenderer.invoke('ai:code:read', root, rel),
      search: (
        root: string,
        term: string
      ): Promise<{
        matches?: { file: string; line: number; text: string }[]
        truncated?: boolean
        error?: string
      }> => ipcRenderer.invoke('ai:code:search', root, term)
    },
    // Fetches a web page's text through the main process (native fetch, capped
    // and vetted there). Resolves with the text or with a reason it didn't.
    web: {
      fetch: (
        url: string
      ): Promise<
        { content: string; url: string; truncated: boolean } | { error: string }
      > => ipcRenderer.invoke('ai:web:fetch', url)
    },
    // Images pasted into the chat: stored as files by the main process, which
    // hands back an id. The transcript keeps ids, never the bytes.
    images: {
      save: (dataUrl: string): Promise<{ id: string } | { error: string }> =>
        ipcRenderer.invoke('ai:images:save', dataUrl),
      get: (id: string): Promise<{ dataUrl: string } | { error: string }> =>
        ipcRenderer.invoke('ai:images:get', id),
      delete: (ids: string[]): Promise<void> => ipcRenderer.invoke('ai:images:delete', ids)
    },
    // User-written prompt templates for Gerar Tasks (ai-templates.json).
    templates: {
      list: (): Promise<PromptTemplate[]> => ipcRenderer.invoke('ai:templates:list'),
      save: (
        input: { id?: string; name: string; body: string }
      ): Promise<{ template: PromptTemplate } | { error: string }> =>
        ipcRenderer.invoke('ai:templates:save', input),
      delete: (id: string): Promise<void> => ipcRenderer.invoke('ai:templates:delete', id)
    },
    // Persisted chat history (ai-conversations.json in userData).
    conversations: {
      list: (): Promise<
        { id: string; title: string; createdAt: string; updatedAt: string }[]
      > => ipcRenderer.invoke('ai:conversations:list'),
      // Filters by title or by anything said in the chat; '' returns everything.
      search: (
        term: string
      ): Promise<
        { id: string; title: string; createdAt: string; updatedAt: string; snippet?: string }[]
      > => ipcRenderer.invoke('ai:conversations:search', term),
      get: (
        id: string
      ): Promise<{
        id: string
        title: string
        createdAt: string
        updatedAt: string
        messages: {
          role: 'user' | 'assistant' | 'status'
          content: string
          imageIds?: string[]
        }[]
        usage?: { promptTokens: number; completionTokens: number }
      } | null> => ipcRenderer.invoke('ai:conversations:get', id),
      // Names a chat by hand; the autosave's derived title stops applying to it.
      rename: (id: string, title: string): Promise<{ title?: string; error?: string }> =>
        ipcRenderer.invoke('ai:conversations:rename', id, title),
      save: (conv: {
        id: string
        title: string
        messages: {
          role: 'user' | 'assistant' | 'status'
          content: string
          imageIds?: string[]
        }[]
        usage?: { promptTokens: number; completionTokens: number }
      }): Promise<void> => ipcRenderer.invoke('ai:conversations:save', conv),
      delete: (id: string): Promise<void> => ipcRenderer.invoke('ai:conversations:delete', id),
      all: (): Promise<
        {
          id: string
          title: string
          createdAt: string
          updatedAt: string
          messages: { role: 'user' | 'assistant' | 'status'; content: string }[]
        }[]
      > => ipcRenderer.invoke('ai:conversations:all'),
      replace: (
        list: {
          id: string
          title: string
          createdAt: string
          updatedAt: string
          messages: { role: 'user' | 'assistant' | 'status'; content: string }[]
        }[]
      ): Promise<void> => ipcRenderer.invoke('ai:conversations:replace', list)
    }
  },
  files: {
    upload: (): Promise<{ id: string; name: string; ext: string; size: number; createdAt: string }[]> =>
      ipcRenderer.invoke('files:upload'),
    delete: (id: string, ext: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('files:delete', id, ext),
    open: (id: string, ext: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('files:open', id, ext),
    openInBrowser: (id: string, ext: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('files:openInBrowser', id, ext),
    download: (id: string, name: string, ext: string): Promise<{ success: boolean; cancelled?: boolean; error?: string }> =>
      ipcRenderer.invoke('files:download', id, name, ext)
  },
  excel: {
    export: (buffer: ArrayBuffer, filename: string): Promise<{ success: boolean; cancelled?: boolean; error?: string }> =>
      ipcRenderer.invoke('excel:export', buffer, filename)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('electronAPI', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.electronAPI = api
}
