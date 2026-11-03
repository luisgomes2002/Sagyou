// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createShutdown } from '../modules/remote/shutdown'

const T0 = 1_800_000_000_000

interface Setup {
  deps: {
    flush: ReturnType<typeof vi.fn>
    stopRunTimers: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
    now: () => number
  }
  calls: string[]
  shutdown: ReturnType<typeof createShutdown>
}

function setup(flushOk: boolean): Setup {
  const calls: string[] = []
  const deps = {
    flush: vi.fn(async () => {
      calls.push('flush')
      return flushOk
    }),
    stopRunTimers: vi.fn(async () => {
      calls.push('timers')
    }),
    exec: vi.fn(async (cmd: string, args: string[]) => {
      calls.push(`${cmd} ${args.join(' ')}`)
    }),
    now: () => T0
  }
  return { deps, calls, shutdown: createShutdown(deps) }
}

describe('createShutdown', () => {
  it('flush falhando não desliga', async () => {
    const t = setup(false)
    expect(await t.shutdown.start()).toBe('flush-failed')
    expect(t.deps.exec).not.toHaveBeenCalled()
    expect(t.deps.stopRunTimers).not.toHaveBeenCalled()
    expect(t.shutdown.at()).toBeNull()
  })

  it('salva, para os cronômetros e só então agenda o desligamento de 60 s', async () => {
    const t = setup(true)
    expect(await t.shutdown.start()).toBe('ok')
    expect(t.calls).toEqual([
      'flush',
      'timers',
      'shutdown /s /t 60 /c Sagyou: desligando pelo celular'
    ])
    expect(t.deps.exec).toHaveBeenCalledWith('shutdown', [
      '/s',
      '/t',
      '60',
      '/c',
      'Sagyou: desligando pelo celular'
    ])
    expect(t.shutdown.at()).toBe(T0 + 60_000)
  })

  it('cancelar roda shutdown /a e limpa o horário', async () => {
    const t = setup(true)
    await t.shutdown.start()
    await t.shutdown.abort()
    expect(t.deps.exec).toHaveBeenLastCalledWith('shutdown', ['/a'])
    expect(t.shutdown.at()).toBeNull()
  })
})
