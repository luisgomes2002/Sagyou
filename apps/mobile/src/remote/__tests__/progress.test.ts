import type { PcStatus, PcServer } from '@sagyou/core/control/messages'
import type { PcState, PcView } from '@sagyou/core/control/state'
import {
  ACTION_LIMIT_MS,
  DONE_VISIBLE_MS,
  doneText,
  isPending,
  observeAction,
  sendingAction,
  waitingAction,
  type ActionInfo,
  type ActionProgress
} from '../progress'

const T0 = 1_800_000_000_000

const view = (state: PcState): PcView => ({ state }) as PcView
const status = (servers: PcServer[]): PcStatus => ({
  v: 1,
  at: T0,
  locked: false,
  servers,
  pendingCards: 0,
  shutdownAt: null,
  suspendedUntil: null,
  updateVersion: null,
  accessCutAt: null
})
const waiting = (info: ActionInfo): ActionProgress => waitingAction(sendingAction(info, T0))

describe('etapas das ações da aba PC', () => {
  it('os limites e o tempo do "Concluído" são os da spec', () => {
    expect(ACTION_LIMIT_MS).toEqual({
      wake: 300_000,
      shutdown: 60_000,
      'server-start': 60_000,
      'server-stop': 60_000
    })
    expect(DONE_VISIBLE_MS).toBe(3000)
  })

  it('os textos de cada etapa e de cada conclusão', () => {
    expect(sendingAction({ kind: 'shutdown' }, T0)).toMatchObject({
      step: 'sending',
      text: 'Enviando pedido…'
    })
    expect(waiting({ kind: 'shutdown' }).text).toBe('Pedido enviado. Aguardando o PC…')
    expect(waiting({ kind: 'wake' }).text).toBe('Ligando o PC… pode levar alguns minutos.')
    expect(doneText({ kind: 'wake' })).toBe('PC ligado.')
    expect(doneText({ kind: 'shutdown' })).toBe('Desligamento iniciado.')
    expect(doneText({ kind: 'server-start', name: 'Sagyou' })).toBe('Servidor Sagyou ligado.')
    expect(doneText({ kind: 'server-stop', name: 'Sagyou' })).toBe('Servidor Sagyou desligado.')
  })

  it('só sending e waiting bloqueiam outra ação', () => {
    const a = waiting({ kind: 'wake' })
    expect(isPending(null)).toBe(false)
    expect(isPending(sendingAction({ kind: 'wake' }, T0))).toBe(true)
    expect(isPending(a)).toBe(true)
    expect(isPending({ ...a, step: 'done' })).toBe(false)
    expect(isPending({ ...a, step: 'failed' })).toBe(false)
  })

  describe('observeAction', () => {
    it('Ligar PC conclui com ready e com rc-down (o PC está de pé)', () => {
      const a = waiting({ kind: 'wake' })
      expect(observeAction(a, view('ready'), null, T0 + 1000)).toMatchObject({
        step: 'done',
        text: 'PC ligado.'
      })
      expect(observeAction(a, view('rc-down'), null, T0 + 1000).step).toBe('done')
      for (const state of ['off', 'booting', 'waiting-sagyou'] as const) {
        expect(observeAction(a, view(state), null, T0 + 1000)).toBe(a)
      }
    })

    it('Desligar PC conclui com shutting-down ou off', () => {
      const a = waiting({ kind: 'shutdown' })
      expect(observeAction(a, view('shutting-down'), null, T0 + 1000).step).toBe('done')
      expect(observeAction(a, view('off'), null, T0 + 1000).step).toBe('done')
      expect(observeAction(a, view('ready'), null, T0 + 1000)).toBe(a)
    })

    it('Ligar servidor conclui com running e Desligar com stopped, só no servidor certo', () => {
      const start = waiting({ kind: 'server-start', projectId: 'p1', name: 'Sagyou' })
      const stop = waiting({ kind: 'server-stop', projectId: 'p1', name: 'Sagyou' })
      const running = status([
        { name: 'Sagyou', up: true, projectId: 'p1', state: 'running' },
        { name: 'Outro', up: false, projectId: 'p2', state: 'stopped' }
      ])
      const stopped = status([
        { name: 'Sagyou', up: false, projectId: 'p1', state: 'stopped' },
        { name: 'Outro', up: true, projectId: 'p2', state: 'running' }
      ])
      expect(observeAction(start, view('ready'), running, T0 + 1000)).toMatchObject({
        step: 'done',
        text: 'Servidor Sagyou ligado.'
      })
      expect(observeAction(start, view('ready'), stopped, T0 + 1000)).toBe(start)
      expect(observeAction(stop, view('ready'), stopped, T0 + 1000)).toMatchObject({
        step: 'done',
        text: 'Servidor Sagyou desligado.'
      })
      expect(observeAction(stop, view('ready'), running, T0 + 1000)).toBe(stop)
      // Starting is not running yet.
      const starting = status([{ name: 'Sagyou', up: false, projectId: 'p1', state: 'starting' }])
      expect(observeAction(start, view('ready'), starting, T0 + 1000)).toBe(start)
    })

    it('o limite: 299 999 ms ainda espera, 300 000 falha (PC); 60 000 falha nos demais', () => {
      const wake = waiting({ kind: 'wake' })
      expect(observeAction(wake, view('off'), null, T0 + 299_999)).toBe(wake)
      expect(observeAction(wake, view('off'), null, T0 + 300_000)).toMatchObject({
        step: 'failed',
        text: 'O PC não respondeu. Tente de novo.'
      })
      for (const kind of ['shutdown', 'server-start', 'server-stop'] as const) {
        const a = waiting({ kind, projectId: 'p1' })
        expect(observeAction(a, view('ready'), status([]), T0 + 59_999)).toBe(a)
        expect(observeAction(a, view('ready'), status([]), T0 + 60_000).step).toBe('failed')
      }
    })

    it('a conclusão vence o tempo esgotado (voltar à aba tarde ainda acha concluído)', () => {
      const a = waiting({ kind: 'wake' })
      expect(observeAction(a, view('ready'), null, T0 + 10 * 60_000).step).toBe('done')
    })

    it('depois de done ou failed nada muda', () => {
      const done = observeAction(waiting({ kind: 'wake' }), view('ready'), null, T0)
      expect(observeAction(done, view('off'), null, T0 + 999_999)).toBe(done)
    })
  })
})
