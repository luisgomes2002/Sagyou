import { useState, type JSX } from 'react'
import { useUpdateStatus } from '../../hooks/useUpdateStatus'
import { UpdateActions } from './UpdateActions'

/** A thin strip above the view, only when an update needs the user. Never a modal. */
export function UpdateBanner(): JSX.Element | null {
  const status = useUpdateStatus()
  // "Depois" hides this exact state; any change in main shows the strip again.
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (!status || (status.state !== 'ready' && status.state !== 'manual')) return null
  const key = JSON.stringify(status)
  if (dismissed === key) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-[#2b2b31] bg-[#16161a] px-5 py-2"
    >
      <UpdateActions status={status} onLater={() => setDismissed(key)} />
    </div>
  )
}
