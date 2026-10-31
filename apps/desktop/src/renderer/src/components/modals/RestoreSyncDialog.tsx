import { useState, type JSX } from 'react'
import { ModalBase } from '../ModalBase'

/**
 * Asked after a backup import while sync is on. Closing without an answer
 * pauses: a restore must never spread to the other devices by accident.
 */
export function RestoreSyncDialog({
  open,
  onDone
}: {
  open: boolean
  onDone: () => void
}): JSX.Element | null {
  const [busy, setBusy] = useState(false)
  if (!open) return null

  const answer = async (choice: 'propagate' | 'pause'): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await window.electronAPI.sync.afterRestore(choice)
    } finally {
      setBusy(false)
      onDone()
    }
  }

  return (
    <ModalBase open={open} onClose={() => void answer('pause')}>
      <div className="relative z-10 mx-4 w-full max-w-sm rounded-xl border border-[#2b2b31] bg-[#16161a] p-6">
        <h3 className="mb-2 text-base font-semibold text-[#d4d4d4]">
          Restaurar também nos outros aparelhos?
        </h3>
        <p className="mb-6 text-sm leading-relaxed text-[#999999]">
          Sim envia o backup restaurado para os aparelhos pareados. Não pausa a sincronização até
          você escolher o que vale, em Configurações.
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void answer('pause')}
            className="rounded-lg bg-[#2a2a30] px-4 py-2 text-sm text-[#d4d4d4] hover:bg-[#303036] disabled:opacity-50"
          >
            Não, só neste aparelho
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void answer('propagate')}
            className="rounded-lg bg-[#6d5bb8] px-4 py-2 text-sm font-medium text-white hover:bg-[#7b69c6] disabled:opacity-50"
          >
            Sim, restaurar nos outros
          </button>
        </div>
      </div>
    </ModalBase>
  )
}
