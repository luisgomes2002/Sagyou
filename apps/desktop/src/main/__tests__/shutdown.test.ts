// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createShutdown, systemExe } from '../modules/remote/shutdown'

const T0 = 1_800_000_000_000
const SHUTDOWN_EXE = 'D:\\Win\\System32\\shutdown.exe'

interface Setup {
  deps: {
    flush: ReturnType<typeof vi.fn>
    stopRunTimers: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
    restore: ReturnType<typeof vi.fn>
    now: () => number
    env: NodeJS.ProcessEnv
  }
  calls: string[]
  shutdown: ReturnType<typeof createShutdown>
  advance: (ms: number) => void
}

function setup(flushOk: boolean): Setup {
  const calls: string[] = []
  let now = T0
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
    restore: vi.fn(() => {
      calls.push('restore')
    }),
    now: () => now,
    env: { SystemRoot: 'D:\\Win' } as NodeJS.ProcessEnv
  }
  return {
    deps,
    calls,
    shutdown: createShutdown(deps),
    advance: (ms) => {
      now += ms
    }
  }
}

describe('createShutdown', () => {
  it('flush falhando não desliga e devolve a tela', async () => {
    const t = setup(false)
    expect(await t.shutdown.start()).toBe('flush-failed')
    expect(t.deps.exec).not.toHaveBeenCalled()
    expect(t.deps.stopRunTimers).not.toHaveBeenCalled()
    expect(t.deps.restore).toHaveBeenCalledTimes(1)
    expect(t.shutdown.at()).toBeNull()
  })

  it('salva, para os cronômetros e só então agenda o desligamento de 60 s', async () => {
    const t = setup(true)
    expect(await t.shutdown.start()).toBe('ok')
    expect(t.calls).toEqual([
      'flush',
      'timers',
      `${SHUTDOWN_EXE} /s /t 60 /c Sagyou: desligando pelo celular`
    ])
    expect(t.deps.exec).toHaveBeenCalledWith(SHUTDOWN_EXE, [
      '/s',
      '/t',
      '60',
      '/c',
      'Sagyou: desligando pelo celular'
    ])
    expect(t.deps.restore).not.toHaveBeenCalled()
    expect(t.shutdown.at()).toBe(T0 + 60_000)
  })

  it('exec falhando devolve a tela e responde failed', async () => {
    const t = setup(true)
    t.deps.exec.mockRejectedValueOnce(new Error('acesso negado'))
    expect(await t.shutdown.start()).toBe('failed')
    expect(t.deps.restore).toHaveBeenCalledTimes(1)
    expect(t.shutdown.at()).toBeNull()
  })

  it('cronômetros falhando devolve a tela e não desliga', async () => {
    const t = setup(true)
    t.deps.stopRunTimers.mockRejectedValueOnce(new Error('boom'))
    expect(await t.shutdown.start()).toBe('failed')
    expect(t.deps.exec).not.toHaveBeenCalled()
    expect(t.deps.restore).toHaveBeenCalledTimes(1)
  })

  it('segundo pedido com desligamento marcado responde ok sem novo flush', async () => {
    const t = setup(true)
    await t.shutdown.start()
    expect(await t.shutdown.start()).toBe('ok')
    expect(t.deps.flush).toHaveBeenCalledTimes(1)
    expect(t.deps.exec).toHaveBeenCalledTimes(1)
  })

  it('cancelar roda shutdown /a, limpa o horário e devolve a tela', async () => {
    const t = setup(true)
    await t.shutdown.start()
    await t.shutdown.abort()
    expect(t.deps.exec).toHaveBeenLastCalledWith(SHUTDOWN_EXE, ['/a'])
    expect(t.shutdown.at()).toBeNull()
    expect(t.deps.restore).toHaveBeenCalledTimes(1)
  })

  it('cancelar com exec falhando ainda devolve a tela', async () => {
    const t = setup(true)
    await t.shutdown.start()
    t.deps.exec.mockRejectedValueOnce(new Error('boom'))
    await expect(t.shutdown.abort()).rejects.toThrow('boom')
    expect(t.deps.restore).toHaveBeenCalledTimes(1)
  })

  it('o horário some depois que passa', async () => {
    const t = setup(true)
    await t.shutdown.start()
    t.advance(60_000)
    expect(t.shutdown.at()).toBeNull()
  })
})

describe('systemExe', () => {
  it('usa %SystemRoot%\\System32 e cai em C:\\Windows sem a variável', () => {
    expect(systemExe('shutdown.exe', { SystemRoot: 'E:\\WINDOWS' })).toBe(
      'E:\\WINDOWS\\System32\\shutdown.exe'
    )
    expect(systemExe('shutdown.exe', {})).toBe('C:\\Windows\\System32\\shutdown.exe')
  })
})
