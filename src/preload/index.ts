import { contextBridge, ipcRenderer } from 'electron'
// Type-only: erased at build, so no main-process code is pulled into the preload.
import type { RunMetricInput, RunMetricsSummary } from '../main/run-metrics'
import type { AiMemory, MemoryInput, MemorySummary, MemoryConflict } from '../main/memory'

/** A user-written Skill (.md file in userData/skills/). */
interface Skill {
  name: string
  body: string
  updatedAt: string
}

/** A finished code-agent run, as listed in the run picker. */
interface AgentRunMeta {
  id: string
  convId: string | null
  /** codex is the only agent. Kept on the row so the picker can state it. */
  agent: 'codex'
  dir: string
  task: string
  startedAt: number
  endedAt: number
  exitCode: number
  fileCount: number
}

/** An archived run, log and diff frozen at the moment the agent exited. */
interface AgentRunSnapshot extends AgentRunMeta {
  log: string
  diff: {
    patch: string
    files: { path: string; added: number; removed: number }[]
    truncated: boolean
    omittedNewFiles: string[]
    error?: string
  } | null
}

/** A live (in-flight) code-agent run, as returned by status(). */
interface CodeRunSummary {
  id: string
  dir: string
  task: string
  convId: string | null
  agent: string
  startedAt: number
  log: string
  model?: string
  hint: { title: string; detail: string; command?: string } | null
  progress?: {
    step: number
    maxSteps: number
    promptTokens: number
    completionTokens: number
  }
  autoApprove?: boolean
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
    import: (): Promise<{
      success: boolean
      cancelled?: boolean
      data?: unknown
      error?: string
    }> => ipcRenderer.invoke('backup:import')
  },
  ai: {
    import: (): Promise<{
      success: boolean
      cancelled?: boolean
      data?: unknown
      error?: string
    }> => ipcRenderer.invoke('ai:import'),
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
    // Per-run efficiency metrics, aggregated by the main process for comparing
    // models over time (ai-run-metrics.json). append is best-effort bookkeeping.
    runMetrics: {
      append: (input: RunMetricInput): Promise<void> =>
        ipcRenderer.invoke('ai:run-metrics:append', input),
      summary: (): Promise<RunMetricsSummary> => ipcRenderer.invoke('ai:run-metrics:summary')
    },
    // Durable memory: facts the assistant carries across chats (kanban.db,
    // outside persistAll). save scrubs secrets; prune archives cold pages.
    memory: {
      list: (opts?: {
        projectId?: string | null
        includeArchived?: boolean
      }): Promise<AiMemory[]> => ipcRenderer.invoke('ai:memory:list', opts),
      save: (
        input: MemoryInput & { id?: string }
      ): Promise<{ memory: AiMemory; redacted: boolean } | { error: string }> =>
        ipcRenderer.invoke('ai:memory:save', input),
      delete: (id: string): Promise<void> => ipcRenderer.invoke('ai:memory:delete', id),
      // Wholesale replace, for backup import.
      replace: (list: AiMemory[]): Promise<void> => ipcRenderer.invoke('ai:memory:replace', list),
      touch: (ids: string[]): Promise<void> => ipcRenderer.invoke('ai:memory:touch', ids),
      prune: (): Promise<{ archived: number }> => ipcRenderer.invoke('ai:memory:prune'),
      summary: (): Promise<MemorySummary> => ipcRenderer.invoke('ai:memory:summary'),
      conflicts: (): Promise<MemoryConflict[]> => ipcRenderer.invoke('ai:memory:conflicts'),
      // The run-start briefing text for a project (its memories + globals).
      // `archived` = how many cold pages the lazy decay pass just retired.
      briefing: (projectId?: string | null): Promise<{ text: string; archived: number }> =>
        ipcRenderer.invoke('ai:memory:briefing', projectId),
      // Upsert the per-project handoff breadcrumb (one per project, replaced each run).
      handoff: (input: {
        projectId?: string | null
        title: string
        body: string
      }): Promise<{ ok: true } | { error: string }> =>
        ipcRenderer.invoke('ai:memory:handoff', input)
    },
    // Entity lineage: the event log for one entity (audit trail).
    lineage: {
      list: (
        entityType: string,
        entityId: string
      ): Promise<
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
      > => ipcRenderer.invoke('ai:lineage:list', entityType, entityId)
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
    // Native code agent (the loop in ./code-agent). N concurrent runs can be
    // active in different directories.
    codeAgent: {
      run: (request: {
        path: string
        task: string
        files?: string[]
        decisoes?: string[]
        convId?: string
        projectId?: string | null
        autoApprove?: boolean
      }): Promise<{
        success: boolean
        agent?: string
        dir?: string
        runId?: string
        error?: string
      }> => ipcRenderer.invoke('ai:code-agent:run', request),
      stop: (runId?: string): Promise<void> => ipcRenderer.invoke('ai:code-agent:stop', runId),
      // Answer an approval card the loop is parked on (native agent).
      approve: (id: string, approved: boolean): Promise<void> =>
        ipcRenderer.invoke('ai:code-agent:approve-response', id, approved),
      setAuto: (runId: string, enabled: boolean): Promise<void> =>
        ipcRenderer.invoke('ai:code-agent:set-auto', runId, enabled),
      status: (): Promise<{
        running: boolean
        log: string
        model?: string
        hint: { title: string; detail: string; command?: string } | null
        progress?: {
          step: number
          maxSteps: number
          promptTokens: number
          completionTokens: number
        }
        /** All live runs, for multi-agent support. `runs.length > 0` replaces `running`. */
        runs: CodeRunSummary[]
      }> => ipcRenderer.invoke('ai:code-agent:status'),
      // What a run changed. Accepts optional runId to target a specific run;
      // without it uses the first active run's base.
      diff: (
        runId?: string
      ): Promise<{
        patch: string
        files: { path: string; added: number; removed: number }[]
        truncated: boolean
        omittedNewFiles: string[]
        error?: string
      }> => ipcRenderer.invoke('ai:code-agent:diff', runId),
      // Past runs of a conversation. The index only — a row's log and diff are
      // fetched by runGet when the user actually opens it.
      runs: (convId?: string): Promise<AgentRunMeta[]> =>
        ipcRenderer.invoke('ai:code-agent:runs', convId),
      runGet: (id: string): Promise<AgentRunSnapshot | null> =>
        ipcRenderer.invoke('ai:code-agent:run-get', id),
      runRenew: (id: string): Promise<void> =>
        ipcRenderer.invoke('ai:code-agent:run-renew', id),
      // Output carries runId to distinguish concurrent runs.
      onOutput: (cb: (payload: { runId: string; chunk: string }) => void) => {
        const handler = (
          _: Electron.IpcRendererEvent,
          payload: { runId: string; chunk: string }
        ): void => cb(payload)
        ipcRenderer.on('ai:code-agent:output', handler)
        return () => ipcRenderer.removeListener('ai:code-agent:output', handler)
      },
      // Fires immediately when a run starts — before any output, so the UI can
      // light indicators without waiting for the first chunk.
      onStarted: (cb: (payload: { runId: string; dir: string }) => void) => {
        const handler = (
          _: Electron.IpcRendererEvent,
          payload: { runId: string; dir: string }
        ): void => cb(payload)
        ipcRenderer.on('ai:code-agent:started', handler)
        return () => ipcRenderer.removeListener('ai:code-agent:started', handler)
      },
      // Fires once a finished run has been written to the archive — later than
      // onExit, which doesn't wait for the diff that snapshot needs.
      onArchived: (cb: (payload: { runId: string; id: string; convId: string | null }) => void) => {
        const handler = (
          _: Electron.IpcRendererEvent,
          payload: { runId: string; id: string; convId: string | null }
        ): void => cb(payload)
        ipcRenderer.on('ai:code-agent:archived', handler)
        return () => ipcRenderer.removeListener('ai:code-agent:archived', handler)
      },
      // Live progress during a run: the step and the running token total, for
      // the panel's "Passo X/Y · Zk tokens" counter.
      onProgress: (
        cb: (p: {
          runId: string
          step: number
          maxSteps: number
          promptTokens: number
          completionTokens: number
        }) => void
      ) => {
        const handler = (_: Electron.IpcRendererEvent, p: Parameters<typeof cb>[0]): void => cb(p)
        ipcRenderer.on('ai:code-agent:progress', handler)
        return () => ipcRenderer.removeListener('ai:code-agent:progress', handler)
      },
      onExit: (cb: (payload: { runId: string; code: number }) => void) => {
        const handler = (
          _: Electron.IpcRendererEvent,
          payload: { runId: string; code: number }
        ): void => cb(payload)
        ipcRenderer.on('ai:code-agent:exit', handler)
        return () => ipcRenderer.removeListener('ai:code-agent:exit', handler)
      },
      // Structured tool events (native agent): a tool call being run, then its
      // result summary — so the panel can show the run's steps live (task 6/11).
      onToolEvent: (
        cb: (ev: {
          runId: string
          phase: 'call' | 'result'
          name: string
          args?: Record<string, unknown>
          summary?: string
        }) => void
      ) => {
        const handler = (_: Electron.IpcRendererEvent, ev: Parameters<typeof cb>[0]): void => cb(ev)
        ipcRenderer.on('ai:code-agent:tool', handler)
        return () => ipcRenderer.removeListener('ai:code-agent:tool', handler)
      },
      // The loop is parked on a write/command and needs the user's OK (task 9).
      onApproveRequest: (
        cb: (req: {
          runId: string
          id: string
          name: string
          args: Record<string, unknown>
          resumo: string
          conteudo?: string
          comando?: string
          diff?: { kind: 'add' | 'del' | 'ctx' | 'meta'; text: string }[]
          diffTruncated?: boolean
          irreversivel?: boolean
        }) => void
      ) => {
        const handler = (_: Electron.IpcRendererEvent, req: Parameters<typeof cb>[0]): void =>
          cb(req)
        ipcRenderer.on('ai:code-agent:approve-request', handler)
        return () => ipcRenderer.removeListener('ai:code-agent:approve-request', handler)
      },
      // A recognised environment failure hit mid-run (e.g. the sandbox couldn't
      // start) — pushed so the panel's hint card can appear without waiting for
      // the run to exit. `status().hint` carries the same value for a late mount.
      onHint: (
        cb: (hint: { runId: string; title: string; detail: string; command?: string }) => void
      ) => {
        const handler = (_: Electron.IpcRendererEvent, hint: Parameters<typeof cb>[0]): void =>
          cb(hint)
        ipcRenderer.on('ai:code-agent:hint', handler)
        return () => ipcRenderer.removeListener('ai:code-agent:hint', handler)
      },
      // Fires when auto-approval is toggled for a run, so the UI can reflect it.
      onAutoChanged: (cb: (payload: { runId: string; autoApprove: boolean }) => void) => {
        const handler = (_: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]): void =>
          cb(payload)
        ipcRenderer.on('ai:code-agent:auto-changed', handler)
        return () => ipcRenderer.removeListener('ai:code-agent:auto-changed', handler)
      }
    },
    // The ai-jail sandbox for the code agent (see main/ai-jail.ts).
    jail: {
      // Current status merged with config. `refresh` re-runs detection.
      status: (
        refresh?: boolean
      ): Promise<{
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
      }> => ipcRenderer.invoke('ai:jail:status', refresh),
      install: (): Promise<{ success: boolean; version?: string; path?: string; error?: string }> =>
        ipcRenderer.invoke('ai:jail:install'),
      dismissOnboarding: (): Promise<void> => ipcRenderer.invoke('ai:jail:dismiss-onboarding'),
      onProgress: (cb: (p: { phase: string; fraction: number | null }) => void) => {
        const handler = (_: Electron.IpcRendererEvent, p: Parameters<typeof cb>[0]): void => cb(p)
        ipcRenderer.on('ai:jail:progress', handler)
        return () => ipcRenderer.removeListener('ai:jail:progress', handler)
      }
    },
    // Native folder picker for choosing a project's code directory.
    pickDirectory: (): Promise<{ path: string | null }> => ipcRenderer.invoke('ai:pick-directory'),
    // Read-only source access, confined to `root` (a project's code path).
    code: {
      list: (
        root: string,
        sub?: string,
        offset?: number,
        limit?: number
      ): Promise<{
        files?: string[]
        truncated?: boolean
        offset?: number
        total?: number
        nextOffset?: number
        error?: string
      }> => ipcRenderer.invoke('ai:code:list', root, sub, offset, limit),
      read: (
        root: string,
        rel: string,
        offset?: number,
        maxChars?: number,
        scope?: { symbol?: string; lineStart?: number; lineEnd?: number }
      ): Promise<{
        content?: string
        truncated?: boolean
        offset?: number
        total?: number
        nextOffset?: number
        // Set in scoped reads (a symbol or a line range): the 1-based bounds of
        // the returned slice, and the symbol name when one was requested.
        simbolo?: string
        linhaInicio?: number
        linhaFim?: number
        // A map of the file's declarations — present on a big file's first page,
        // or when a requested symbol wasn't found, so the model can jump to one.
        simbolos?: { nome: string; linha: number; tipo: string }[]
        error?: string
      }> => ipcRenderer.invoke('ai:code:read', root, rel, offset, maxChars, scope),
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
        url: string,
        render?: boolean
      ): Promise<{ content: string; url: string; truncated: boolean } | { error: string }> =>
        ipcRenderer.invoke('ai:web:fetch', url, render)
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
    // User-written Skills (.md files in userData/skills/).
    skills: {
      list: (): Promise<Skill[]> => ipcRenderer.invoke('ai:skills:list'),
      save: (input: {
        name: string
        body: string
        oldName?: string
      }): Promise<{ skill: Skill } | { error: string }> =>
        ipcRenderer.invoke('ai:skills:save', input),
      delete: (name: string): Promise<void> => ipcRenderer.invoke('ai:skills:delete', name),
      import: (): Promise<{ skill: Skill } | { error: string }> =>
        ipcRenderer.invoke('ai:skills:import')
    },
    // Persisted chat history (ai-conversations.json in userData).
    conversations: {
      list: (): Promise<{ id: string; title: string; createdAt: string; updatedAt: string }[]> =>
        ipcRenderer.invoke('ai:conversations:list'),
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
    upload: (): Promise<
      { id: string; name: string; ext: string; size: number; createdAt: string }[]
    > => ipcRenderer.invoke('files:upload'),
    delete: (id: string, ext: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('files:delete', id, ext),
    open: (id: string, ext: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('files:open', id, ext),
    openInBrowser: (id: string, ext: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('files:openInBrowser', id, ext),
    download: (
      id: string,
      name: string,
      ext: string
    ): Promise<{ success: boolean; cancelled?: boolean; error?: string }> =>
      ipcRenderer.invoke('files:download', id, name, ext)
  },
  // Task images: the renderer downscales and hands over a dataUrl; main stores
  // the bytes as files under task-images/ and returns id+ext. The DB keeps only
  // metadata, and the bytes are read back on demand for display.
  taskImages: {
    save: (
      dataUrl: string
    ): Promise<{ id: string; ext: string; size: number } | { error: string }> =>
      ipcRenderer.invoke('task:images:save', dataUrl),
    get: (id: string, ext: string): Promise<{ dataUrl: string } | { error: string }> =>
      ipcRenderer.invoke('task:images:get', id, ext),
    delete: (items: { id: string; ext: string }[]): Promise<void> =>
      ipcRenderer.invoke('task:images:delete', items)
  },
  excel: {
    export: (
      buffer: ArrayBuffer,
      filename: string
    ): Promise<{ success: boolean; cancelled?: boolean; error?: string }> =>
      ipcRenderer.invoke('excel:export', buffer, filename)
  },
  financial: {
    fetchExchangeRate: (
      pair: string
    ): Promise<{
      rate: string
      date: string
      source: 'awesomeapi' | 'frankfurter' | 'cache' | 'identity'
      error?: string
    }> => ipcRenderer.invoke('financial:exchange-rate:fetch', pair)
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
