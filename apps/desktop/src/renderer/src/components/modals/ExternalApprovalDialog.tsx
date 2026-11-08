import { useCallback, useEffect, useState, type JSX } from 'react'
import { ModalBase } from '../ModalBase'

export const EXTERNAL_APPROVAL_TITLE = 'Aprovar ação do acesso externo'

interface ExternalCard {
  id: string
  name: string
  resumo: string
  expiresAt?: string
}

/** "4:59" until `expiresAt`, never negative. */
function timeLeft(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * A risky write of the external MCP token waits here, over any screen (spec
 * docs/specs/2026-11-07-endurecer-acesso-remoto.md, item 1). The same card goes
 * to the authorized phone; the first answer wins, and whatever closes it (an
 * answer elsewhere, the deadline, a lock) drops it here. One card at a time.
 */
export function ExternalApprovalDialog(): JSX.Element | null {
  const [queue, setQueue] = useState<ExternalCard[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const api = window.electronAPI?.mcpExternal
    if (!api?.onApproveRequest || !api.onApprovalClosed) return
    const offRequest = api.onApproveRequest((card) => {
      setNow(Date.now())
      setQueue((prev) => (prev.some((c) => c.id === card.id) ? prev : [...prev, card]))
    })
    const offClosed = api.onApprovalClosed((id) =>
      setQueue((prev) => prev.filter((c) => c.id !== id))
    )
    return () => {
      offRequest()
      offClosed()
    }
  }, [])

  const current = queue[0]
  const counting = Boolean(current?.expiresAt)
  useEffect(() => {
    if (!counting) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [counting])

  const currentId = current?.id
  // Stable per card: ModalBase refocuses whenever onClose changes, and the
  // countdown re-renders every second.
  const respond = useCallback(
    (approved: boolean): void => {
      if (!currentId) return
      setQueue((prev) => prev.filter((c) => c.id !== currentId))
      void window.electronAPI.mcpExternal.answer(currentId, approved)
    },
    [currentId]
  )
  // Escape or a click outside refuses: a risky write never runs by accident.
  const refuse = useCallback(() => respond(false), [respond])

  if (!current) return null

  return (
    <ModalBase open onClose={refuse}>
      <div className="relative z-10 mx-4 w-full max-w-md rounded-xl border border-[#2b2b31] bg-[#16161a] p-6 shadow-2xl">
        <h3 className="mb-2 text-base font-semibold text-[#d4d4d4]">{EXTERNAL_APPROVAL_TITLE}</h3>
        <p className="mb-2 whitespace-pre-line text-sm leading-relaxed text-[#d4d4d4]">
          {`O Claude externo quer: ${current.resumo}`}
        </p>
        {current.expiresAt && (
          <p aria-live="polite" className="mb-6 text-xs text-[#999999]">
            {`Expira em ${timeLeft(current.expiresAt, now)}`}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={refuse}
            className="rounded-lg bg-[#2a2a30] px-4 py-2 text-sm text-[#d4d4d4] hover:bg-[#303036] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6d5bb8]"
          >
            Recusar
          </button>
          <button
            type="button"
            onClick={() => respond(true)}
            className="rounded-lg bg-[#6d5bb8] px-4 py-2 text-sm font-medium text-white hover:bg-[#7b69c6] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6d5bb8]"
          >
            Aprovar
          </button>
        </div>
      </div>
    </ModalBase>
  )
}
