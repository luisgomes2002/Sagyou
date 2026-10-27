// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createRunTaskTimers } from '../modules/agent/agent-task-timers'
import type { McpScope } from '../modules/agent/mcp-write-types'

const scope: McpScope = { projectId: 'p1', financialProfileId: 'personal' }
const ok = (id: string): { ok: true; id: string } => ({ ok: true, id })

describe('run task timers', () => {
  it('stops at the end of the run only the timers it started', async () => {
    const stop = vi.fn(async () => {})
    const timers = createRunTaskTimers(stop)
    timers.record('run-1', scope, 'start_task_timer', ok('a'))
    timers.record('run-1', scope, 'start_task_timer', ok('b'))
    timers.record('run-1', scope, 'start_task_timer', ok('a'))
    timers.record('run-2', scope, 'start_task_timer', ok('c'))

    await timers.stopAll('run-1')

    expect(stop.mock.calls).toEqual([
      ['a', scope],
      ['b', scope]
    ])
    stop.mockClear()
    await timers.stopAll('run-1')
    expect(stop).not.toHaveBeenCalled()
    await timers.stopAll('run-2')
    expect(stop.mock.calls).toEqual([['c', scope]])
  })

  it('forgets a task once the agent stopped, completed or deleted it', async () => {
    const stop = vi.fn(async () => {})
    const timers = createRunTaskTimers(stop)
    for (const id of ['a', 'b', 'c', 'd']) timers.record('run', scope, 'start_task_timer', ok(id))
    timers.record('run', scope, 'stop_task_timer', ok('a'))
    timers.record('run', scope, 'complete_task', ok('b'))
    timers.record('run', scope, 'delete_task', ok('c'))
    await timers.stopAll('run')
    expect(stop.mock.calls).toEqual([['d', scope]])
  })

  it('ignores refused writes and other tools', async () => {
    const stop = vi.fn(async () => {})
    const timers = createRunTaskTimers(stop)
    timers.record('run', scope, 'start_task_timer', {
      ok: false,
      error: 'A tarefa já está concluída.'
    })
    timers.record('run', scope, 'update_task', ok('x'))
    timers.record('run', scope, 'start_task_timer', ok('a'))
    timers.record('run', scope, 'complete_task', { ok: false, error: 'x' })
    await timers.stopAll('run')
    expect(stop.mock.calls).toEqual([['a', scope]])
  })

  it('keeps stopping the others when one stop fails, and never throws', async () => {
    const stop = vi.fn(async (taskId: string) => {
      if (taskId === 'a') throw new Error('renderer gone')
    })
    const timers = createRunTaskTimers(stop)
    timers.record('run', scope, 'start_task_timer', ok('a'))
    timers.record('run', scope, 'start_task_timer', ok('b'))
    await expect(timers.stopAll('run')).resolves.toBeUndefined()
    expect(stop).toHaveBeenCalledTimes(2)
  })
})
