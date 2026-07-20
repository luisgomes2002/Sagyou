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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-xl border border-[#2a2d42] bg-[#13151f] shadow-2xl p-6">
        <h3 className="text-base font-semibold text-[#e2e8f0] mb-2">{title}</h3>
        {/* whitespace-pre-line so a message can use blank lines to separate what
            the action does from what it costs. A single-line message is
            unaffected — nothing else here wraps on newlines. */}
        <p className="text-sm text-[#8892a4] mb-6 leading-relaxed whitespace-pre-line">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-[#2a2d42] text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors font-medium"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
