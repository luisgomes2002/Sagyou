// Remote Control servers the Sagyou manages (spec
// docs/specs/2026-11-09-servidores-remote-control.md): the exact texts the PC
// shows and the id of a server's terminal, shared by Configurações and the Fleet.

export type RcServerList = Awaited<ReturnType<Window['electronAPI']['rcServers']['list']>>
export type RcServerView = RcServerList['servers'][number]
export type RcServerState = RcServerView['state']

export const SERVER_STATE_TEXT: Record<RcServerState, string> = {
  running: 'Rodando',
  stopped: 'Parado',
  starting: 'Iniciando…',
  'needs-confirm': 'Confirme no Fleet',
  external: 'Rodando (fora do Sagyou)'
}

export const SERVER_FIRST_RUN_HINT =
  'Responda às perguntas do Claude no Fleet. Depois disso, o celular também liga este servidor.'
export const SERVER_FOOTER = 'Só aparecem projetos com uma pasta de código.'
export const SERVER_CUT_TEXT = 'O acesso está cortado. Restaure antes de ligar um servidor.'
export const SERVER_START_FAILED = 'O servidor não subiu.'
export const SERVER_STOP_FAILED = 'Não deu para desligar o servidor, tente de novo.'

/** States in which the Sagyou owns a terminal for the server (a Fleet tab). */
export const SERVER_LIVE_STATES: readonly RcServerState[] = ['running', 'starting', 'needs-confirm']

/** Same id main gives the server's terminal (`serverTerminalId`), and the Fleet tab key. */
export function serverSessionKey(projectId: string): string {
  return `server:${projectId}`
}

export function isServerTerminalId(id: string): boolean {
  return id.startsWith('server:')
}
