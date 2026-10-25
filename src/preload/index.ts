import { contextBridge, ipcRenderer } from 'electron'
// Type-only: erased at build, so no main-process code is pulled into the preload.
import type { AiMemory, MemoryInput, MemorySummary, MemoryConflict } from '../main/modules/ai/memory'
import type { McpActionRequest, McpActionResult } from '../main/modules/agent/mcp-write-types'
import type {
  GlobalSearchHit,
  GlobalSearchLookup,
  GlobalSearchOptions,
  GlobalSearchResponse
} from '../main/modules/search/global-search-query'

/** A user-written Skill (.md file in userData/skills/). */
interface Skill {
  name: string
  body: string
  updatedAt: string
}

/** A finished code-agent run, as listed in the run picker. */
interface AgentRunMeta {
  id: string
  /** Legacy: only on runs archived before chats were removed. */
  convId: string | null
  sessionId: string | null
  projectId: string | null
  /** codex is the only agent. Kept on the row so the picker can state it. */
  agent: 'codex'
  dir: string
  task: string
  startedAt: number
  endedAt: number
  exitCode: number
  delivery?: 'applied' | 'merge_failed'
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
  sessionId?: string | null
  projectId?: string | null
  financialProfileId?: string
  codeRoot?: string
  agent: string
  harness?: 'codex' | 'claude-code' | 'opencode'
  worktreeDir?: string | null
  localInstructions?: string[]
  localSkills?: string[]
  /** Live external executors always run in the PTY; archived snapshots may not. */
  interactive: boolean
  terminalCols?: number
  terminalRows?: number
  allowedWritePaths?: string[]
  readOnlyRoots?: { id: string; nome: string; path: string }[]
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
  approvals?: CodeApprovalRequest[]
  questions?: CodeQuestionRequest[]
}

interface CodeQuestionRequest {
  runId: string
  id: string
  question: string
}

interface CodeApprovalRequest {
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
}

/** Agent settings that cross IPC. No API key exists in this shape, in either direction. */
interface PublicAIConfig {
  userName?: string
  codeHarness?: 'codex' | 'claude-code' | 'opencode'
  reasoningEffort?: 'low' | 'medium' | 'high'
  [key: string]: unknown
}
import { electronAPI } from '@electron-toolkit/preload'

/**
 * Public IPC bridge. `SagyouElectronAPI` below is derived from this value, so
 * the renderer declaration cannot silently drift away from exposed methods.
 */
export const api = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (cb: (isMax: boolean) => void) => {
      const handler = (_: Electron.IpcRendererEvent, isMax: boolean): void => cb(isMax)
      ipcRenderer.on('window:maximized-change', handler)
      return (): void => {
        ipcRenderer.removeListener('window:maximized-change', handler)
      }
    }
  },
  lifecycle: {
    onFlushBeforeClose: (cb: () => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('app:flush-before-close', handler)
      return (): void => {
        ipcRenderer.removeListener('app:flush-before-close', handler)
      }
    },
    flushBeforeCloseComplete: (): Promise<void> =>
      ipcRenderer.invoke('app:flush-before-close:complete')
  },
  security: {
    status: (): Promise<{ enabled: boolean; corrupt: boolean; userName?: string }> =>
      ipcRenderer.invoke('security:status'),
    unlock: (password: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('security:unlock', password),
    enable: (password: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('security:enable', password),
    change: (current: string, next: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('security:change', current, next),
    disable: (current: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('security:disable', current),
    recover: (confirmed: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('security:recover', confirmed)
  },
  // One-time notice that the retired chat's data was removed (pulled when the Fleet opens).
  legacyChat: {
    notice: (): Promise<{ snapshotDir: string } | null> => ipcRenderer.invoke('legacy-chat:notice'),
    dismiss: (): Promise<void> => ipcRenderer.invoke('legacy-chat:dismiss')
  },
  store: {
    load: (): Promise<{ projects: unknown[]; tasks: unknown[] }> =>
      ipcRenderer.invoke('store:load'),
    save: (data: unknown): Promise<void> => ipcRenderer.invoke('store:save', data),
    rebuildSearchIndex: (): Promise<void> => ipcRenderer.invoke('store:rebuild-search-index'),
    onReload: (cb: () => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('store:reload', handler)
      return (): void => {
        ipcRenderer.removeListener('store:reload', handler)
      }
    },
    onMcpCreateTask: (
      cb: (request: {
        requestId: string
        task: { projectId: string; columnId: string; title: string; description?: string }
      }) => void
    ) => {
      const handler = (_: Electron.IpcRendererEvent, request: Parameters<typeof cb>[0]): void =>
        cb(request)
      ipcRenderer.on('store:mcp:create-task', handler)
      return (): void => {
        ipcRenderer.removeListener('store:mcp:create-task', handler)
      }
    },
    respondMcpCreateTask: (requestId: string, result: { id?: string; error?: string }): void => {
      ipcRenderer.send('store:mcp:create-task:response', { requestId, ...result })
    },
    onMcpAction: (
      cb: (message: { requestId: string; request: McpActionRequest }) => void
    ) => {
      const handler = (_: Electron.IpcRendererEvent, message: Parameters<typeof cb>[0]): void =>
        cb(message)
      ipcRenderer.on('store:mcp:action', handler)
      return (): void => {
        ipcRenderer.removeListener('store:mcp:action', handler)
      }
    },
    respondMcpAction: (requestId: string, result: McpActionResult): void => {
      ipcRenderer.send('store:mcp:action:response', { requestId, result })
    }
  },
  search: {
    global: (options: GlobalSearchOptions): Promise<GlobalSearchResponse> =>
      ipcRenderer.invoke('search:global', options),
    get: (options: GlobalSearchLookup): Promise<GlobalSearchHit | null> =>
      ipcRenderer.invoke('search:global:get', options)
  },
  backup: {
    export: (backup: unknown): Promise<{ success: boolean; cancelled?: boolean }> =>
      ipcRenderer.invoke('backup:export', backup),
    cancelExport: (): void => ipcRenderer.send('backup:export:cancel'),
    onExportProgress: (
      cb: (progress: { completed: number; total: number; done?: boolean }) => void
    ) => {
      const handler = (_: Electron.IpcRendererEvent, progress: Parameters<typeof cb>[0]): void =>
        cb(progress)
      ipcRenderer.on('backup:export-progress', handler)
      return (): void => {
        ipcRenderer.removeListener('backup:export-progress', handler)
      }
    },
    autoSave: (backup: unknown, force = false): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('backup:auto-save', backup, force),
    commitBlobs: (): Promise<{ success: boolean }> => ipcRenderer.invoke('backup:commit-blobs'),
    openFolder: (): Promise<string> => ipcRenderer.invoke('backup:open-folder'),
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
      get: (): Promise<PublicAIConfig> => ipcRenderer.invoke('ai:config:get'),
      set: (config: PublicAIConfig): Promise<void> => ipcRenderer.invoke('ai:config:set', config)
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
      search: (opts: {
        projectId?: string | null
        term?: string
        type?: string
        includeArchived?: boolean
        limit?: number
      }): Promise<{ memory: AiMemory; snippet: string }[]> =>
        ipcRenderer.invoke('ai:memory:search', opts),
      delete: (id: string): Promise<void> => ipcRenderer.invoke('ai:memory:delete', id),
      // Wholesale replace, for backup import.
      replace: (list: AiMemory[]): Promise<void> => ipcRenderer.invoke('ai:memory:replace', list),
      touch: (ids: string[]): Promise<void> => ipcRenderer.invoke('ai:memory:touch', ids),
      prune: (): Promise<{ archived: number }> => ipcRenderer.invoke('ai:memory:prune'),
      summary: (): Promise<MemorySummary> => ipcRenderer.invoke('ai:memory:summary'),
      conflicts: (): Promise<MemoryConflict[]> => ipcRenderer.invoke('ai:memory:conflicts'),
      // The run-start briefing text for a project (its memories + globals).
      // `archived` = how many cold pages the lazy decay pass just retired.
      briefing: (
        projectId?: string | null
      ): Promise<{ text: string; count: number; archived: number }> =>
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
    // Native code agent (the loop in ./code-agent). N concurrent runs can be
    // active in different directories.
    codeAgent: {
      run: (request: {
        path: string
        task: string
        /** Open the CLI on its own screen, with no initial request or briefing. */
        blank?: boolean
        files?: string[]
        allowedWritePaths?: string[]
        readOnlyRoots?: { id: string; nome: string; path: string }[]
        decisoes?: string[]
        sessionId?: string
        projectId?: string | null
        financialProfileId?: string
        coordinated?: boolean
        autoApprove?: boolean
      }): Promise<{
        success: boolean
        agent?: string
        dir?: string
        runId?: string
        error?: string
      }> => ipcRenderer.invoke('ai:code-agent:run', request),
      stop: (runId?: string): Promise<void> => ipcRenderer.invoke('ai:code-agent:stop', runId),
      terminalInput: (
        runId: string,
        input: string
      ): Promise<{ success: boolean; error?: string }> =>
        ipcRenderer.invoke('ai:code-agent:terminal-input', runId, input),
      terminalResize: (
        runId: string,
        cols: number,
        rows: number
      ): Promise<{ success: boolean; error?: string }> =>
        ipcRenderer.invoke('ai:code-agent:terminal-resize', runId, cols, rows),
      terminalReconnect: (
        runId: string
      ): Promise<{ success: boolean; error?: string; log?: string; cols?: number; rows?: number }> =>
        ipcRenderer.invoke('ai:code-agent:terminal-reconnect', runId),
      // Answer an approval card the loop is parked on (native agent).
      approve: (id: string, approved: boolean): Promise<void> =>
        ipcRenderer.invoke('ai:code-agent:approve-response', id, approved),
      answerQuestion: (id: string, answer: string): Promise<void> =>
        ipcRenderer.invoke('ai:code-agent:question-response', id, answer),
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
      // Past runs of a session. The index only — a row's log and diff are
      // fetched by runGet when the user actually opens it.
      runs: (sessionId?: string): Promise<AgentRunMeta[]> =>
        ipcRenderer.invoke('ai:code-agent:runs', sessionId),
      runGet: (id: string): Promise<AgentRunSnapshot | null> =>
        ipcRenderer.invoke('ai:code-agent:run-get', id),
      runRenew: (id: string): Promise<void> => ipcRenderer.invoke('ai:code-agent:run-renew', id),
      // Output carries runId to distinguish concurrent runs.
      onOutput: (cb: (payload: { runId: string; chunk: string }) => void) => {
        const handler = (
          _: Electron.IpcRendererEvent,
          payload: { runId: string; chunk: string }
        ): void => cb(payload)
        ipcRenderer.on('ai:code-agent:output', handler)
        return (): void => {
          ipcRenderer.removeListener('ai:code-agent:output', handler)
        }
      },
      // Fires immediately when a run starts — before any output, so the UI can
      // light indicators without waiting for the first chunk.
      onStarted: (cb: (payload: { runId: string; dir: string }) => void) => {
        const handler = (
          _: Electron.IpcRendererEvent,
          payload: { runId: string; dir: string }
        ): void => cb(payload)
        ipcRenderer.on('ai:code-agent:started', handler)
        return (): void => {
          ipcRenderer.removeListener('ai:code-agent:started', handler)
        }
      },
      // Fires once a finished run has been written to the archive — later than
      // onExit, which doesn't wait for the diff that snapshot needs.
      onArchived: (cb: (payload: { runId: string; id: string; sessionId: string | null }) => void) => {
        const handler = (
          _: Electron.IpcRendererEvent,
          payload: { runId: string; id: string; sessionId: string | null }
        ): void => cb(payload)
        ipcRenderer.on('ai:code-agent:archived', handler)
        return (): void => {
          ipcRenderer.removeListener('ai:code-agent:archived', handler)
        }
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
        return (): void => {
          ipcRenderer.removeListener('ai:code-agent:progress', handler)
        }
      },
      onExit: (cb: (payload: { runId: string; code: number }) => void) => {
        const handler = (
          _: Electron.IpcRendererEvent,
          payload: { runId: string; code: number }
        ): void => cb(payload)
        ipcRenderer.on('ai:code-agent:exit', handler)
        return (): void => {
          ipcRenderer.removeListener('ai:code-agent:exit', handler)
        }
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
        return (): void => {
          ipcRenderer.removeListener('ai:code-agent:approve-request', handler)
        }
      },
      // A recognised environment failure hit mid-run (e.g. the sandbox couldn't
      // start) — pushed so the panel's hint card can appear without waiting for
      // the run to exit. `status().hint` carries the same value for a late mount.
      // A question pauses the native loop; automatic mode never answers it.
      onQuestion: (cb: (req: CodeQuestionRequest) => void) => {
        const handler = (_: Electron.IpcRendererEvent, req: CodeQuestionRequest): void => cb(req)
        ipcRenderer.on('ai:code-agent:question', handler)
        return (): void => {
          ipcRenderer.removeListener('ai:code-agent:question', handler)
        }
      },
      onHint: (
        cb: (hint: { runId: string; title: string; detail: string; command?: string }) => void
      ) => {
        const handler = (_: Electron.IpcRendererEvent, hint: Parameters<typeof cb>[0]): void =>
          cb(hint)
        ipcRenderer.on('ai:code-agent:hint', handler)
        return (): void => {
          ipcRenderer.removeListener('ai:code-agent:hint', handler)
        }
      },
      // Fires when auto-approval is toggled for a run, so the UI can reflect it.
      onAutoChanged: (
        cb: (payload: {
          runId: string
          autoApprove: boolean
          resolvedApprovalIds?: string[]
        }) => void
      ) => {
        const handler = (_: Electron.IpcRendererEvent, payload: Parameters<typeof cb>[0]): void =>
          cb(payload)
        ipcRenderer.on('ai:code-agent:auto-changed', handler)
        return (): void => {
          ipcRenderer.removeListener('ai:code-agent:auto-changed', handler)
        }
      }
    },
    harnesses: {
      // Detects local CLIs only; it never starts a code task.
      status: (
        refresh?: boolean
      ): Promise<
        Array<{
          id: 'codex' | 'claude-code' | 'opencode'
          label: string
          command: string
          installed: boolean
          path: string | null
          version: string | null
          authentication: 'authenticated' | 'unauthenticated' | 'unknown'
          models: string[]
          capabilities: {
            interactiveTerminal: 'available' | 'unavailable' | 'unknown'
            createSession: 'available' | 'unavailable' | 'unknown'
            resumeSession: 'available' | 'unavailable' | 'unknown'
            modelSelection: 'available' | 'unavailable' | 'unknown'
            modelStatus: 'available' | 'unavailable' | 'unknown'
            permissionPrompts: 'available' | 'unavailable' | 'unknown'
            cancellation: 'available' | 'unavailable' | 'unknown'
            mcp: 'available' | 'unavailable' | 'unknown'
            localInstructionDiscovery: 'available' | 'unavailable' | 'unknown'
          }
        }>
      > => ipcRenderer.invoke('ai:harnesses:status', refresh)
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
    // Read a project file (uploaded via FilesView) and return its parsed text.
    projectFile: {
      read: (
        fileId: string
      ): Promise<{ text: string; truncated: boolean; size?: number } | { error: string }> =>
        ipcRenderer.invoke('ai:project-file:read', fileId)
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

export type SagyouElectronAPI = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('electronAPI', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore: Electron only injects this global when context isolation is off.
  window.electron = electronAPI
  // @ts-ignore: Electron only injects this global when context isolation is off.
  window.electronAPI = api
}
