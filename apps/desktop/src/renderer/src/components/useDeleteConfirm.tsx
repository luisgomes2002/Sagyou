import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

interface UseDeleteConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
}

/**
 * Manages a ConfirmDialog open/close lifecycle for entity deletion.
 * Returns a `prompt(id)` function that opens the dialog and a
 * `confirmDialog` element ready to render.
 */
export function useDeleteConfirm(
  deleteFn: (id: string) => void,
  { title, message, confirmLabel = 'Deletar' }: UseDeleteConfirmOptions
) {
  const [open, setOpen] = useState(false)
  const [targetId, setTargetId] = useState<string | null>(null)

  const prompt = (id: string) => {
    setTargetId(id)
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    setTargetId(null)
  }

  const handleConfirm = () => {
    if (targetId) deleteFn(targetId)
    close()
  }

  const confirmDialog = (
    <ConfirmDialog
      open={open}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      onConfirm={handleConfirm}
      onCancel={close}
    />
  )

  return { prompt, confirmDialog }
}
