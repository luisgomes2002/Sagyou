/**
 * The push notifications of the remote control (spec
 * docs/specs/2026-11-13-mobile-aprovacoes-notificacoes.md): one list of codes,
 * the Android channel (category) each belongs to, the fixed text the Worker
 * sends and where a tap leads. The Worker has its own small copy (it does not
 * depend on the core); a test in sync-server keeps both equal.
 */
export const NOTIFY_CODES = [
  'ready',
  'shutdown-failed',
  'server-ready',
  'server-failed',
  'pc-silent',
  'approval',
  'session-done',
  'suspended',
  'access-cut',
  'device-paired',
  'device-revoked'
] as const

export type NotifyCode = (typeof NOTIFY_CODES)[number]

/** The Android notification channel; the phone lets the user mute each one. */
export type NotifyCategory = 'pc' | 'sessions' | 'security'

export const NOTIFY_CATEGORY: Record<NotifyCode, NotifyCategory> = {
  ready: 'pc',
  'shutdown-failed': 'pc',
  'server-ready': 'pc',
  'server-failed': 'pc',
  'pc-silent': 'pc',
  approval: 'sessions',
  'session-done': 'sessions',
  suspended: 'security',
  'access-cut': 'security',
  'device-paired': 'security',
  'device-revoked': 'security'
}

export const NOTIFY_CATEGORY_LABEL: Record<NotifyCategory, string> = {
  pc: 'PC e servidores',
  sessions: 'Sessões de código',
  security: 'Segurança'
}

/** Generic on purpose: nothing the PC writes reaches a notification. */
export const NOTIFICATION_TEXT: Record<NotifyCode, string> = {
  ready: 'PC pronto.',
  'shutdown-failed': 'O PC não foi desligado.',
  'server-ready': 'Servidor de Remote Control ligado.',
  'server-failed': 'O servidor de Remote Control não subiu ou caiu.',
  'pc-silent': 'O PC parou de responder.',
  approval: 'Aprovação pendente no Sagyou.',
  'session-done': 'Uma sessão de código terminou.',
  suspended: 'Controle remoto suspenso por tentativas recusadas.',
  'access-cut': 'Acesso remoto cortado.',
  'device-paired': 'Um aparelho foi pareado ao seu sync.',
  'device-revoked': 'Um aparelho do seu sync foi revogado.'
}

/** What the history shows for a push that carried no (known) code. */
export const NOTIFICATION_FALLBACK = 'Notificação do Sagyou'

export function isNotifyCode(value: unknown): value is NotifyCode {
  return typeof value === 'string' && (NOTIFY_CODES as readonly string[]).includes(value)
}

/** A tap on an approval leads to the Notificações screen; everything else to the PC tab. */
export function notifyTarget(code: NotifyCode | null): 'pc' | 'notifications' {
  return code === 'approval' ? 'notifications' : 'pc'
}
