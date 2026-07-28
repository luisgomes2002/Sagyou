import { useEffect, useState } from 'react'

export interface ToastMessage {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

interface Props {
  toasts: ToastMessage[]
  onRemove: (id: string) => void
}

export function ToastContainer({ toasts, onRemove }: Props) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onRemove }: { toast: ToastMessage; onRemove: (id: string) => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onRemove(toast.id), 200)
    }, 3000)
    return () => clearTimeout(timer)
  }, [toast.id, onRemove])

  const colors = {
    success: 'border-[#46d478]/30 bg-[#46d478]/15 text-[#46d478]',
    error: 'border-[#e04040]/30 bg-[#e04040]/15 text-[#e04040]',
    info: 'border-[#7c3aed]/30 bg-[#7c3aed]/15 text-[#a080f0]'
  }

  return (
    <div
      className={`pointer-events-auto px-4 py-2.5 rounded-lg border text-sm font-medium shadow-xl transition-all duration-200 ${colors[toast.type]} ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
    >
      {toast.message}
    </div>
  )
}
