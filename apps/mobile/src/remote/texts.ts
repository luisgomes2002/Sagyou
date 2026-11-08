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
  requestExpired: 'O pedido expirou. Ligue o PC e peça de novo.'
} as const

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
