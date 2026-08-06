// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { CodeRunCoordinator } from '../code-run-coordinator'

describe('CodeRunCoordinator', () => {
  it('keeps a directory occupied until every concurrent run finishes', () => {
    const coordinator = new CodeRunCoordinator()
    coordinator.register('/project', 'run-1', true)
    coordinator.register('/project', 'run-2', false)
    coordinator.register('/project', 'run-3', false)

    coordinator.unregister('/project', 'run-2')
    expect(coordinator.hasActive('/project')).toBe(true)
    coordinator.unregister('/project', 'run-1')
    expect(coordinator.hasActive('/project')).toBe(true)
    coordinator.unregister('/project', 'run-3')
    expect(coordinator.hasActive('/project')).toBe(false)
  })

  it('holds isolated delivery until the direct run finishes', async () => {
    const coordinator = new CodeRunCoordinator()
    coordinator.register('/project', 'direct', true)
    coordinator.register('/project', 'isolated', false)
    let released = false
    const waiting = coordinator.waitForDirectRun('/project', 'isolated').then(() => {
      released = true
    })

    await new Promise((done) => setTimeout(done, 0))
    expect(released).toBe(false)
    coordinator.unregister('/project', 'direct')
    await waiting
    expect(released).toBe(true)
  })

  it('serializes patch deliveries for the same original directory', async () => {
    const coordinator = new CodeRunCoordinator()
    const events: string[] = []
    let releaseFirst = (): void => {}
    const firstGate = new Promise<void>((done) => {
      releaseFirst = done
    })

    const first = coordinator.deliver('/project', async () => {
      events.push('first:start')
      await firstGate
      events.push('first:end')
    })
    const second = coordinator.deliver('/project', async () => {
      events.push('second:start')
      events.push('second:end')
    })

    await new Promise((done) => setTimeout(done, 0))
    expect(events).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('does not make isolated runs wait for each other as if one were direct', async () => {
    const coordinator = new CodeRunCoordinator()
    coordinator.register('/project', 'run-1', false)
    coordinator.register('/project', 'run-2', false)

    expect(coordinator.hasDirectRun('/project', 'run-2')).toBe(false)
    await expect(coordinator.waitForDirectRun('/project', 'run-2')).resolves.toBe(false)
  })
})
