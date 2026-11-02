import type { JSX } from 'react'
import { useUpdateStatus } from '../../hooks/useUpdateStatus'
import { UpdateActions } from '../layout/UpdateActions'

export function UpdateSettings(): JSX.Element {
  const status = useUpdateStatus()
  return (
    <section className="space-y-3 rounded-xl border border-[#2b2b31] bg-[#16161a] p-5">
      <div>
        <h3 className="text-sm font-semibold text-[#d4d4d4]">Atualizações</h3>
        <p className="mt-1 text-xs text-[#999999]">
          O Sagyou procura uma versão nova no GitHub sempre que abre.
        </p>
      </div>
      <div role="status" aria-live="polite">
        {status && <UpdateActions status={status} />}
      </div>
    </section>
  )
}
