import type { JSX } from 'react'
import type { UpdateStatus } from '../../hooks/useUpdateStatus'

const primary =
  'rounded-lg bg-[#6d5bb8] px-3 py-1.5 text-sm text-white hover:bg-[#7b69c6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a080f0]'
const neutral =
  'rounded-lg bg-[#2a2a30] px-3 py-1.5 text-sm text-[#d4d4d4] hover:bg-[#303036] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a080f0]'

/** The update's message and buttons, shared by the banner and Settings. */
export function UpdateActions({
  status,
  onLater
}: {
  status: UpdateStatus
  onLater?: () => void
}): JSX.Element | null {
  const { update } = window.electronAPI
  if (status.state === 'ready') {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-[#d4d4d4]">Atualização pronta</p>
          {status.version && (
            <span className="text-xs text-[#999999]">versão {status.version}</span>
          )}
          <button type="button" className={primary} onClick={() => void update.install()}>
            Reiniciar e instalar
          </button>
          {onLater && (
            <button type="button" className={neutral} onClick={onLater}>
              Depois
            </button>
          )}
        </div>
        {status.installError && (
          <p role="alert" className="text-sm text-[#ec6a6a]">
            Não foi possível salvar antes de instalar; tente de novo
          </p>
        )}
      </div>
    )
  }
  if (status.state === 'manual') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-[#d4d4d4]">Nova versão disponível</p>
        {status.version && <span className="text-xs text-[#999999]">versão {status.version}</span>}
        <button type="button" className={primary} onClick={() => void update.openRelease()}>
          Abrir Release
        </button>
        {onLater && (
          <button type="button" className={neutral} onClick={onLater}>
            Depois
          </button>
        )}
      </div>
    )
  }
  if (status.state === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-[#d9a640]">Não foi possível verificar atualizações</p>
        <button type="button" className={neutral} onClick={() => void update.check()}>
          Tentar novamente
        </button>
      </div>
    )
  }
  if (status.state === 'checking')
    return <p className="text-sm text-[#999999]">Verificando atualizações…</p>
  if (status.state === 'downloading')
    return (
      <p className="text-sm text-[#999999]">
        Baixando versão {status.version ?? ''} — {status.percent ?? 0}%
      </p>
    )
  if (status.state === 'none')
    return <p className="text-sm text-[#999999]">O Sagyou está na versão mais recente.</p>
  return (
    <p className="text-sm text-[#999999]">Atualização automática só funciona no app instalado.</p>
  )
}
