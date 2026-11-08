export type TrayMenuItem =
  | { id: 'open'; label: 'Abrir Sagyou' }
  // Shown disabled: a notice, not an action (spec 2026-11-07, item 3).
  | { id: 'cut'; label: 'Acesso cortado pelo celular' }
  | { id: 'lock'; label: 'Bloquear agora' }
  | { id: 'sep' }
  | { id: 'quit'; label: 'Sair' }

/** "Bloquear agora" only when there is a password and the app is unlocked. */
export function buildTrayMenu(opts: { canLock: boolean; accessCut?: boolean }): TrayMenuItem[] {
  return [
    { id: 'open', label: 'Abrir Sagyou' },
    ...(opts.accessCut ? [{ id: 'cut', label: 'Acesso cortado pelo celular' } as const] : []),
    ...(opts.canLock ? [{ id: 'lock', label: 'Bloquear agora' } as const] : []),
    { id: 'sep' },
    { id: 'quit', label: 'Sair' }
  ]
}
