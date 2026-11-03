/** Exact pt-BR texts of the remote control, shared by the desktop and the phone. */
import type { PcState } from './state'

export const PC_STATE_TEXT: Record<PcState, string> = {
  ready: 'Pronto',
  'rc-down': 'Remote Control fora do ar',
  'waiting-sagyou': 'Ligado, aguardando o Sagyou',
  booting: 'Ligando',
  'shutting-down': 'Desligando',
  off: 'Desligado'
}

export const CONTROL_TEXT = {
  ready: 'PC pronto.',
  esp32Offline: 'ESP32 sem contato',
  esp32NoAnswer: 'O ESP32 não respondeu.',
  esp32Refused: 'O ESP32 recusou o comando.',
  esp32Clock: 'O ESP32 recusou o comando: relógio do celular errado.',
  refused: 'O PC recusou o pedido.',
  cardGone: 'Este cartão já foi respondido ou expirou.',
  flushFailed: 'Não foi possível salvar o Sagyou; o PC não foi desligado.',
  notDeployed: 'Atualize o Worker para usar o controle remoto.',
  waitingPc: 'Aguardando o PC concluir a autorização',
  previousRevoked:
    'Celulares anteriores perderam o controle do PC. Revogue também o aparelho perdido na sincronização, apagando os dados dele.',
  biometricsChanged: 'A biometria do celular mudou. Autorize este celular de novo.',
  wrongPassword: 'Senha do Sagyou incorreta.',
  secondFactorAgain:
    'Use um código novo do autenticador ou outro código reserva (o anterior já foi usado para entrar).',
  offline: 'Sem conexão com o servidor.',
  syncInactive: 'O controle remoto está parado: a sincronização não está ativa.',
  forceConfirm:
    'O Sagyou não está respondendo. Forçar o desligamento pelo ESP32? O que não foi salvo no Sagyou pode se perder.'
} as const

const pad = (n: number): string => n.toString().padStart(2, '0')

export function rcDownText(names: string[]): string {
  return `PC ligado, Remote Control fora do ar: ${names.join(', ')}.`
}

/** "Desligando em 0:58". */
export function shuttingDownText(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000))
  return `Desligando em ${Math.floor(s / 60)}:${pad(s % 60)}`
}

/** Local HH:MM. */
export function clockText(at: number): string {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function suspendedText(until: number): string {
  return `Desbloqueio remoto suspenso até ${clockText(until)}.`
}
