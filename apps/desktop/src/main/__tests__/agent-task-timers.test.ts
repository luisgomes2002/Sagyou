// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createRunTaskTimers } from '../modules/agent/agent-task-timers'
import type { McpActionResult, McpScope } from '../modules/agent/mcp-write-types'

const scope: McpScope = { projectId: 'p1', financialProfileId: 'personal' }
const started = (id: string, startedAt: number): McpActionResult => ({ ok: true, id, startedAt })
const ok = (id: string): McpActionResult => ({ ok: true, id })

describe('run task timers', () => {
  it('stops at the end of the run only the timers it created, with their start instant', async () => {
    const stop = vi.fn(async () => ({ ok: true }))
    const timers = createRunTaskTimers(stop)
    timers.record('run-1', scope, 'start_task_timer', started('a', 100))
    timers.record('run-1', scope, 'start_task_timer', started('b', 200))
    timers.record('run-2', scope, 'start_task_timer', started('c', 300))

    await timers.stopAll('run-1')

    expect(stop.mock.calls).toEqual([
      ['a', 100, scope],
      ['b', 200, scope]
    ])
    stop.mockClear()
    await timers.stopAll('run-1')
    expect(stop).not.toHaveBeenCalled()
    await timers.stopAll('run-2')
    expect(stop.mock.calls).toEqual([['c', 300, scope]])
  })

  it('does not own a timer that was already running (started by the user)', async () => {
    const stop = vi.fn(async () => ({ ok: true }))
    const timers = createRunTaskTimers(stop)
    timers.record('run', scope, 'start_task_timer', { ok: true, id: 'a', jaRodando: true })
    expect(timers.hasRunning()).toBe(false)
    await timers.stopAll('run')
    expect(stop).not.toHaveBeenCalled()
  })

  it('forgets a task once the agent stopped, completed or deleted it', async () => {
    const stop = vi.fn(async () => ({ ok: true }))
    const timers = createRunTaskTimers(stop)
    for (const [i, id] of ['a', 'b', 'c', 'd'].entries())
      timers.record('run', scope, 'start_task_timer', started(id, i))
    timers.record('run', scope, 'stop_task_timer', ok('a'))
    timers.record('run', scope, 'complete_task', ok('b'))
    timers.record('run', scope, 'delete_task', ok('c'))
    await timers.stopAll('run')
    expect(stop.mock.calls).toEqual([['d', 3, scope]])
  })

  it('ignores refused writes and other tools', async () => {
    const stop = vi.fn(async () => ({ ok: true }))
    const timers = createRunTaskTimers(stop)
    timers.record('run', scope, 'start_task_timer', { ok: false, error: 'x' })
    timers.record('run', scope, 'update_task', ok('x'))
    timers.record('run', scope, 'start_task_timer', started('a', 1))
    timers.record('run', scope, 'complete_task', { ok: false, error: 'x' })
    await timers.stopAll('run')
    expect(stop.mock.calls).toEqual([['a', 1, scope]])
  })

  it('stops right away a timer whose start lands after the run ended', async () => {
    const stop = vi.fn(async () => ({ ok: true }))
    const timers = createRunTaskTimers(stop)
    await timers.stopAll('run')
    timers.record('run', scope, 'start_task_timer', started('late', 9))
    await vi.waitFor(() => expect(stop).toHaveBeenCalledWith('late', 9, scope))
    expect(timers.hasRunning()).toBe(false)
  })

  it('stops every run at once (app quit) and reports whether any is left', async () => {
    const stop = vi.fn(async () => ({ ok: true }))
    const timers = createRunTaskTimers(stop)
    expect(timers.hasRunning()).toBe(false)
    timers.record('run-1', scope, 'start_task_timer', started('a', 1))
    timers.record('run-2', scope, 'start_task_timer', started('b', 2))
    expect(timers.hasRunning()).toBe(true)
    await timers.stopEverything()
    expect(stop).toHaveBeenCalledTimes(2)
    expect(timers.hasRunning()).toBe(false)
  })

  it('reports each stop and never throws when one fails', async () => {
    const stop = vi.fn(async (taskId: string) => {
      if (taskId === 'a') throw new Error('renderer gone')
      return { ok: true }
    })
    const onStopped = vi.fn()
    const timers = createRunTaskTimers(stop, onStopped)
    timers.record('run', scope, 'start_task_timer', started('a', 1))
    timers.record('run', scope, 'start_task_timer', started('b', 2))
    await expect(timers.stopAll('run')).resolves.toBeUndefined()
    expect(onStopped.mock.calls).toEqual([
      [{ runId: 'run', taskId: 'a', outcome: 'error' }],
      [{ runId: 'run', taskId: 'b', outcome: 'ok' }]
    ])
  })
})
