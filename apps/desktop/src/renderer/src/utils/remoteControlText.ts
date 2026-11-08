// Texts of Configurações → Controle remoto (spec docs/specs/2026-11-03-controle-remoto-app.md).

export const ENABLE_LABEL = 'Controlar este PC pelo celular'
export const ENABLE_DESCRIPTION =
  'Ligar, desligar, desbloquear e aprovar cartões do Fleet pelo celular autorizado. Pede o código do autenticador.'
export const ESP32_ONCE_TEXT = 'Cole os dois no secrets.h do ESP32. Eles não aparecem de novo.'
export const ESP32_SUGGESTION =
  'Se o celular revogado ficou com outra pessoa, gere uma nova chave do ESP32.'

const pad = (n: number): string => n.toString().padStart(2, '0')

function clock(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "Acesso cortado pelo celular em 07/11 às 14:32." (spec 2026-11-07, item 3). */
export function accessCutPcText(at: number): string {
  const d = new Date(at)
  return `Acesso cortado pelo celular em ${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${clock(at)}.`
}

export const RESTORE_ACCESS_LABEL = 'Restaurar acesso'

export function suspendedText(until: number): string {
  return `Controle remoto suspenso até ${clock(until)} por pedidos recusados.`
}

/** "Pixel 8 quer controlar este PC — código 482 913". */
export function requestText(p: { name: string; code: string }): string {
  return `${p.name} quer controlar este PC — código ${p.code.slice(0, 3)} ${p.code.slice(3)}`
}

export function revokeMessage(name: string): string {
  return `Revogar ${name}? Ele deixa de controlar este PC na hora.`
}
