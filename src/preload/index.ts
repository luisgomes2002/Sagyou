import { contextBridge, ipcRenderer } from 'electron'
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
      get: (): Promise<{ baseUrl: string; apiKey: string; model: string }> =>
        ipcRenderer.invoke('ai:config:get'),
      set: (config: { baseUrl: string; apiKey: string; model: string }): Promise<void> =>
        ipcRenderer.invoke('ai:config:set', config)
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
        content: string
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
    }> => ipcRenderer.invoke('ai:chat', request),
    // Streaming variant of `chat`: onDelta fires for each text chunk as the
    // model produces it; the promise resolves with the complete message. The
    // streamId keeps concurrent calls from crossing wires.
    chatStream: (
      request: {
        messages: {
          role: 'system' | 'user' | 'assistant' | 'tool'
          content: string
          tool_calls?: unknown[]
          tool_call_id?: string
        }[]
        tools?: unknown[]
        model?: string
        baseUrl?: string
        apiKey?: string
      },
      onDelta: (chunk: string) => void
    ): Promise<{
      success: boolean
      message?: { role: 'assistant'; content: string; tool_calls?: unknown[] }
      error?: string
    }> => {
      const streamId = randomUUID()
      const handler = (
        _: Electron.IpcRendererEvent,
        payload: { streamId: string; delta: string }
      ): void => {
        if (payload.streamId === streamId) onDelta(payload.delta)
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
      status: (): Promise<{ running: boolean }> => ipcRenderer.invoke('ai:code-agent:status'),
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
    // Persisted chat history (ai-conversations.json in userData).
    conversations: {
      list: (): Promise<
        { id: string; title: string; createdAt: string; updatedAt: string }[]
      > => ipcRenderer.invoke('ai:conversations:list'),
      get: (
        id: string
      ): Promise<{
        id: string
        title: string
        createdAt: string
        updatedAt: string
        messages: { role: 'user' | 'assistant' | 'status'; content: string }[]
      } | null> => ipcRenderer.invoke('ai:conversations:get', id),
      save: (conv: {
        id: string
        title: string
        messages: { role: 'user' | 'assistant' | 'status'; content: string }[]
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
