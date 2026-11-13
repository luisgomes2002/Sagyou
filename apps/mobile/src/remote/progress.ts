/**
 * The steps of "Ligar / Desligar o PC" and "Ligar / Desligar servidor" on the PC tab (spec
 * docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md): sending the request, waiting for the
 * PC and the end, which is observed in the PC's state, never guessed.
 */
import type { PcStatus } from '@sagyou/core/control/messages'
import type { PcView } from '@sagyou/core/control/state'
import { REMOTE_TEXT } from './texts'

export type ActionKind = 'wake' | 'shutdown' | 'server-start' | 'server-stop'
export type ActionStep = 'sending' | 'waiting' | 'done' | 'failed'

export interface ActionProgress {
  kind: ActionKind
  /** The server's project, for the two server actions. */
  projectId?: string
  /** The server's name, for the texts. */
  name?: string
  step: ActionStep
  startedAt: number
  text: string
}

/** How long each action waits for the PC before saying it did not answer. */
export const ACTION_LIMIT_MS: Record<ActionKind, number> = {
  wake: 300_000,
  shutdown: 60_000,
  'server-start': 60_000,
  'server-stop': 60_000
}

/** "Concluído" stays this long on screen. */
export const DONE_VISIBLE_MS = 3_000

export interface ActionInfo {
  kind: ActionKind
  projectId?: string
  name?: string
}

export function doneText(info: ActionInfo): string {
  switch (info.kind) {
    case 'wake':
      return 'PC ligado.'
    case 'shutdown':
      return 'Desligamento iniciado.'
    case 'server-start':
      return `Servidor ${info.name ?? ''} ligado.`.replace('  ', ' ')
    case 'server-stop':
      return `Servidor ${info.name ?? ''} desligado.`.replace('  ', ' ')
  }
}

export const sendingAction = (info: ActionInfo, now: number): ActionProgress => ({
  ...info,
  step: 'sending',
  startedAt: now,
  text: REMOTE_TEXT.sending
})

export const waitingAction = (a: ActionProgress): ActionProgress => ({
  ...a,
  step: 'waiting',
  text: a.kind === 'wake' ? REMOTE_TEXT.wakeWaiting : REMOTE_TEXT.waiting
})

/** An action that still blocks the others. */
export const isPending = (a: ActionProgress | null): boolean =>
  a !== null && (a.step === 'sending' || a.step === 'waiting')

function reached(a: ActionProgress, view: PcView | null, status: PcStatus | null): boolean {
  if (a.kind === 'wake') return view?.state === 'ready' || view?.state === 'rc-down'
  if (a.kind === 'shutdown') return view?.state === 'shutting-down' || view?.state === 'off'
  const server = status?.servers.find((s) => s.projectId === a.projectId)
  return a.kind === 'server-start' ? server?.state === 'running' : server?.state === 'stopped'
}

/**
 * Where a waiting action stands after the PC's state was read: done when its end is seen (this
 * wins over the time limit, so coming back to the tab late still finds it done), failed when the
 * limit passed, the same object when nothing changed.
 */
export function observeAction(
  a: ActionProgress,
  view: PcView | null,
  status: PcStatus | null,
  now: number
): ActionProgress {
  if (a.step !== 'waiting') return a
  if (reached(a, view, status)) return { ...a, step: 'done', text: doneText(a) }
  if (now - a.startedAt >= ACTION_LIMIT_MS[a.kind]) {
    return { ...a, step: 'failed', text: REMOTE_TEXT.noAnswer }
  }
  return a
}
