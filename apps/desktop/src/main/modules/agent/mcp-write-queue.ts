export interface McpWriteRequest {
  runId: string
  name: string
  args: Record<string, unknown>
  /** Absent means the approval card is shown, as for every write before it existed. */
  approval?: boolean
  resumo?: string
}

export interface McpWriteOutcome<T> {
  approved: boolean
  value?: T
  /** The prepare step refused the write; `value` carries its refusal. */
  refused?: boolean
  /** The run stopped being live before the write could execute. */
  ended?: boolean
}

export type McpWritePrepare<T> = () => Promise<{ resumo: string } | { refuse: T }>

interface QueuedWrite<T> extends McpWriteRequest {
  execute: () => Promise<T>
  prepare?: McpWritePrepare<T>
  resolve: (outcome: McpWriteOutcome<T>) => void
  reject: (error: Error) => void
  cancelled: boolean
}

/**
 * Serializes MCP mutations by run. A second request is deliberately not sent
 * to the approval UI until the first one has either completed or been denied.
 */
export class McpWriteQueue {
  private readonly queues = new Map<string, QueuedWrite<unknown>[]>()
  private readonly active = new Map<string, QueuedWrite<unknown>>()

  constructor(
    private readonly approve: (request: McpWriteRequest) => Promise<boolean>,
    private readonly isRunLive: (runId: string) => boolean = () => true,
    /** Sees each write that was approved and executed, with its final card resumo. */
    private readonly onApplied?: (request: McpWriteRequest, value: unknown) => void
  ) {}

  /**
   * `prepare` runs inside the queue, after the previous write of the run has
   * executed, so it validates against the state that write produced.
   */
  enqueue<T>(
    request: McpWriteRequest,
    execute: () => Promise<T>,
    prepare?: McpWritePrepare<T>
  ): Promise<McpWriteOutcome<T>> {
    return new Promise((resolve, reject) => {
      const queued: QueuedWrite<T> = {
        ...request,
        execute,
        prepare,
        resolve,
        reject,
        cancelled: false
      }
      const queue = this.queues.get(request.runId) ?? []
      queue.push(queued as QueuedWrite<unknown>)
      this.queues.set(request.runId, queue)
      void this.drain(request.runId)
    })
  }

  /** Rejects both the visible request and requests that have not reached the UI. */
  rejectRun(runId: string, reason = 'A execução MCP foi encerrada.'): void {
    const error = new Error(reason)
    const active = this.active.get(runId)
    if (active) {
      active.cancelled = true
      this.active.delete(runId)
      active.reject(error)
    }
    const queued = this.queues.get(runId) ?? []
    this.queues.delete(runId)
    for (const write of queued) {
      write.cancelled = true
      write.reject(error)
    }
  }

  private observe(write: QueuedWrite<unknown>, value: unknown): void {
    try {
      this.onApplied?.(
        { runId: write.runId, name: write.name, args: write.args, resumo: write.resumo },
        value
      )
    } catch {
      /* An observer (the session handoff) must never fail a write that already applied. */
    }
  }

  private async drain(runId: string): Promise<void> {
    if (this.active.has(runId)) return
    const queue = this.queues.get(runId)
    const write = queue?.shift()
    if (!write) {
      this.queues.delete(runId)
      return
    }
    this.active.set(runId, write)
    try {
      if (!this.isRunLive(runId)) {
        write.resolve({ approved: false, ended: true })
        return
      }
      if (write.prepare) {
        const prepared = await write.prepare()
        if (write.cancelled) return
        if ('refuse' in prepared) {
          write.resolve({ approved: false, refused: true, value: prepared.refuse })
          return
        }
        write.resumo = prepared.resumo
      }
      const approved =
        write.approval === false
          ? true
          : await this.approve({
              runId: write.runId,
              name: write.name,
              args: write.args,
              resumo: write.resumo
            })
      if (write.cancelled) return
      if (!approved) write.resolve({ approved: false })
      else if (!this.isRunLive(runId)) write.resolve({ approved: false, ended: true })
      else {
        const value = await write.execute()
        this.observe(write, value)
        write.resolve({ approved: true, value })
      }
    } catch (error) {
      if (!write.cancelled)
        write.reject(error instanceof Error ? error : new Error('A escrita MCP falhou.'))
    } finally {
      if (this.active.get(runId) === write) this.active.delete(runId)
      if (!write.cancelled) void this.drain(runId)
    }
  }
}

interface PendingRendererAction<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

/**
 * Main never writes renderer-owned Zustand data: this bridge waits for the
 * renderer action (including its persistence flush) before resolving a write.
 */
export class RendererMcpActionBridge<TPayload, TResult> {
  private readonly pending = new Map<string, PendingRendererAction<TResult>>()

  constructor(
    private readonly send: (request: { requestId: string; payload: TPayload }) => void,
    private readonly timeoutMs = 15_000
  ) {}

  request(payload: TPayload): Promise<TResult> {
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('O renderer não respondeu à ação MCP a tempo.'))
      }, this.timeoutMs)
      this.pending.set(requestId, { resolve, reject, timeout })
      try {
        this.send({ requestId, payload })
      } catch (error) {
        this.reject(requestId, error instanceof Error ? error : new Error('Renderer indisponível.'))
      }
    })
  }

  resolve(requestId: string, value: TResult): void {
    const pending = this.take(requestId)
    pending?.resolve(value)
  }

  reject(requestId: string, error: Error): void {
    const pending = this.take(requestId)
    pending?.reject(error)
  }

  close(reason = 'O renderer foi encerrado antes de concluir a ação MCP.'): void {
    for (const [requestId] of this.pending) this.reject(requestId, new Error(reason))
  }

  private take(requestId: string): PendingRendererAction<TResult> | undefined {
    const pending = this.pending.get(requestId)
    if (!pending) return undefined
    this.pending.delete(requestId)
    clearTimeout(pending.timeout)
    return pending
  }
}
import { randomUUID } from 'crypto'
