export type TrayMenuItem =
  | { id: 'open'; label: 'Abrir Sagyou' }
  | { id: 'lock'; label: 'Bloquear agora' }
  | { id: 'sep' }
  | { id: 'quit'; label: 'Sair' }

/** "Bloquear agora" only when there is a password and the app is unlocked. */
export function buildTrayMenu(opts: { canLock: boolean }): TrayMenuItem[] {
  return [
    { id: 'open', label: 'Abrir Sagyou' },
    ...(opts.canLock ? [{ id: 'lock', label: 'Bloquear agora' } as const] : []),
    { id: 'sep' },
    { id: 'quit', label: 'Sair' }
  ]
}
