import { ModalBase } from './ModalBase'
import { CancelButton } from './CancelButton'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  onConfirm,
  onCancel
}: Props) {
  if (!open) return null

  return (
    <ModalBase open={open} onClose={onCancel}>
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-xl border border-[#3b3b3b] bg-[#232323] shadow-2xl p-6">
        <h3 className="text-base font-semibold text-[#d4d4d4] mb-2">{title}</h3>
        {/* whitespace-pre-line so a message can use blank lines to separate what
            the action does from what it costs. A single-line message is
            unaffected — nothing else here wraps on newlines. */}
        <p className="text-sm text-[#999999] mb-6 leading-relaxed whitespace-pre-line">{message}</p>
        <div className="flex justify-end gap-3">
          <CancelButton onClick={onCancel}>Cancelar</CancelButton>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-[#e04040]/20 text-[#e04040] border border-[#e04040]/30 hover:bg-[#e04040]/30 transition-colors font-medium"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalBase>
  )
}
