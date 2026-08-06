interface DirectRunGate {
  runId: string
  promise: Promise<void>
  resolve: () => void
}

/** Run-scoped coordination for agents sharing one original project directory. */
export class CodeRunCoordinator {
  private readonly activeByDir = new Map<string, Set<string>>()
  private readonly directRuns = new Map<string, DirectRunGate>()
  private readonly deliveryQueues = new Map<string, Promise<void>>()

  hasActive(dir: string): boolean {
    return (this.activeByDir.get(dir)?.size ?? 0) > 0
  }

  hasDirectRun(dir: string, exceptRunId: string): boolean {
    const direct = this.directRuns.get(dir)
    return !!direct && direct.runId !== exceptRunId
  }

  register(dir: string, runId: string, direct: boolean): void {
    const ids = this.activeByDir.get(dir) ?? new Set<string>()
    ids.add(runId)
    this.activeByDir.set(dir, ids)
    if (!direct) return

    let resolveGate = (): void => {}
    const promise = new Promise<void>((done) => {
      resolveGate = done
    })
    this.directRuns.set(dir, { runId, promise, resolve: resolveGate })
  }

  unregister(dir: string, runId: string): void {
    const direct = this.directRuns.get(dir)
    if (direct?.runId === runId) {
      direct.resolve()
      this.directRuns.delete(dir)
    }
    const ids = this.activeByDir.get(dir)
    if (!ids) return
    ids.delete(runId)
    if (ids.size === 0) this.activeByDir.delete(dir)
  }

  async waitForDirectRun(dir: string, exceptRunId: string): Promise<boolean> {
    const direct = this.directRuns.get(dir)
    if (!direct || direct.runId === exceptRunId) return false
    await direct.promise
    return true
  }

  async deliver<T>(dir: string, action: () => Promise<T>): Promise<T> {
    const previous = this.deliveryQueues.get(dir) ?? Promise.resolve()
    let release = (): void => {}
    const gate = new Promise<void>((done) => {
      release = done
    })
    const tail = previous.catch(() => {}).then(() => gate)
    this.deliveryQueues.set(dir, tail)
    await previous.catch(() => {})
    try {
      return await action()
    } finally {
      release()
      if (this.deliveryQueues.get(dir) === tail) this.deliveryQueues.delete(dir)
    }
  }
}
