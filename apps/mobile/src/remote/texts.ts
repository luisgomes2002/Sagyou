import type { PcServer, ServerState } from '@sagyou/core/control/messages'

// Phone-only texts of the remote control; the shared ones live in @sagyou/core/control/texts.
export const REMOTE_TEXT = {
  noPc: 'O PC ainda não está no modo controlado. Ative em Configurações → Controle remoto, no PC.',
  revoked: 'Este celular não controla mais o PC. Peça autorização de novo.',
  refused: 'O PC recusou a autorização.',
  factor: 'Código do autenticador inválido.',
  locked: 'Muitas tentativas. Tente de novo em 15 minutos.',
  noEsp32Key: 'Este celular ainda não tem a chave do ESP32. Gere-a no PC.',
  noUpdate: 'Não há atualização pronta para instalar.',
  generic: 'Não foi possível concluir. Tente de novo.',
  // Spec docs/specs/2026-11-07-endurecer-acesso-remoto.md, item 3.
  cutConfirm:
    'Cortar o acesso remoto? O Claude externo para de funcionar, os servidores de Remote Control são encerrados e o Sagyou é bloqueado. O PC continua ligado.',
  cutNoAnswer: 'O PC não respondeu. Forçar o desligamento pelo ESP32?',
  needFactor: 'Digite o código do autenticador.',
  // Item 9: the request from afar waits 1 h for the PC.
  requestExpired: 'O pedido expirou. Ligue o PC e peça de novo.',
  // Spec docs/specs/2026-11-09-selar-senha-remota.md: the password is sealed to the PC's key.
  noPcKey: 'O PC ainda não publicou a chave dele. Atualize o Sagyou no PC e tente de novo.',
  pcKeyChanged: 'A chave do PC mudou. Autorize este celular em casa, comparando o código.',
  outdated: 'Atualize o Sagyou no celular.',
  // Spec docs/specs/2026-11-09-servidores-remote-control.md: the PC's answer to Ligar/Desligar.
  serverNotConfirmed: 'Confirme este projeto uma vez no PC.',
  serverCut: 'O acesso está cortado. Restaure antes de ligar um servidor.',
  serverUnknown: 'Este servidor não existe mais no PC.',
  serverFailed: 'O servidor não subiu. Veja o terminal no PC.'
} as const

/** A Remote Control server's state on the PC tab; "Confirme no PC", since the phone has no Fleet. */
export const SERVER_STATE_TEXT: Record<ServerState, string> = {
  running: 'Rodando',
  stopped: 'Parado',
  starting: 'Iniciando…',
  'needs-confirm': 'Confirme no PC',
  external: 'Rodando (fora do Sagyou)'
}

/** A server from a PC built before the Sagyou managed them: only whether it is up. */
export function serverStateText(server: PcServer): string {
  if (server.state) return SERVER_STATE_TEXT[server.state]
  return server.up ? SERVER_STATE_TEXT.running : SERVER_STATE_TEXT.stopped
}

/** "Acesso cortado em 14:32." in the phone's local time. */
export function accessCutText(at: number): string {
  const d = new Date(at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `Acesso cortado em ${hh}:${mm}.`
}

/** "Compare este código com o do PC: 482 913". */
export function compareText(code: string): string {
  return `Compare este código com o do PC: ${code.slice(0, 3)} ${code.slice(3)}`
}

/** Time left on an approval card, "4:59". */
export function cardCountdown(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
