import { useEffect, useState, type JSX } from 'react'
import { ModalBase } from '../ModalBase'
import { CancelButton } from '../CancelButton'

interface Props {
  open: boolean
  onClose: () => void
  onToast: (message: string, type?: 'success' | 'error') => void
}

export function SecuritySettingsModal({ open, onClose, onToast }: Props): JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    window.electronAPI.security.status().then((status) => {
      setCurrent('')
      setNext('')
      setConfirm('')
      setError('')
      setEnabled(status.enabled)
    })
  }, [open])

  const save = async (action: 'enable' | 'change' | 'disable'): Promise<void> => {
    if (action !== 'disable' && next !== confirm) {
      setError('A confirmação não coincide com a nova senha.')
      return
    }
    setSaving(true)
    setError('')
    const result =
      action === 'enable'
        ? await window.electronAPI.security.enable(next)
        : action === 'change'
          ? await window.electronAPI.security.change(current, next)
          : await window.electronAPI.security.disable(current)
    setSaving(false)
    if (!result.success) {
      setError(result.error ?? 'Não foi possível atualizar a proteção.')
      return
    }
    if (action === 'disable') {
      setEnabled(false)
      setCurrent('')
      setNext('')
      setConfirm('')
      onToast('Senha desativada.')
    } else {
      setEnabled(true)
      setCurrent('')
      setNext('')
      setConfirm('')
      onToast(action === 'enable' ? 'Senha ativada.' : 'Senha alterada.')
    }
  }

  return (
    <ModalBase open={open} onClose={onClose}>
      <div className="relative z-10 mx-4 w-full max-w-md rounded-xl border border-[#2b2b31] bg-[#16161a] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#2b2b31] p-5">
          <div>
            <h2 className="text-base font-semibold text-[#d4d4d4]">Segurança</h2>
            <p className="mt-1 text-xs text-[#999999]">Proteja o acesso ao Sagyou com uma senha.</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[#999999] hover:bg-[#222227] hover:text-[#d4d4d4]"
          >
            ×
          </button>
        </div>
        <div className="space-y-4 p-5">
          {enabled === null ? (
            <p className="text-sm text-[#999999]">Carregando...</p>
          ) : enabled ? (
            <>
              <p className="rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#46d478]">
                Senha ativada. Ela será solicitada ao abrir o app.
              </p>
              <Field label="Senha atual" value={current} onChange={setCurrent} />
              <Field label="Nova senha" value={next} onChange={setNext} />
              <Field label="Confirmar nova senha" value={confirm} onChange={setConfirm} />
              {error && <p className="text-xs text-[#ef6b73]">{error}</p>}
              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void save('disable')}
                  disabled={!current || saving}
                  className="text-sm text-[#ef6b73] hover:text-[#ff8890] disabled:opacity-50"
                >
                  Desativar senha
                </button>
                <button
                  type="button"
                  onClick={() => void save('change')}
                  disabled={!current || !next || !confirm || saving}
                  className="rounded-lg bg-[#7c3aed] px-4 py-2 text-sm font-medium text-white hover:bg-[#6d28d9] disabled:opacity-50"
                >
                  Alterar senha
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-[#999999]">
                A senha é opcional. Ao ativá-la, o app pedirá o desbloqueio antes de carregar seus
                dados.
              </p>
              <Field label="Nova senha" value={next} onChange={setNext} autoFocus />
              <Field label="Confirmar senha" value={confirm} onChange={setConfirm} />
              {error && <p className="text-xs text-[#ef6b73]">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <CancelButton onClick={onClose}>Cancelar</CancelButton>
                <button
                  type="button"
                  onClick={() => void save('enable')}
                  disabled={!next || !confirm || saving}
                  className="rounded-lg bg-[#7c3aed] px-4 py-2 text-sm font-medium text-white hover:bg-[#6d28d9] disabled:opacity-50"
                >
                  Ativar senha
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalBase>
  )
}

function Field({
  label,
  value,
  onChange,
  autoFocus = false
}: {
  label: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[#999999]">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoFocus={autoFocus}
        autoComplete="new-password"
        className="w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#d4d4d4] outline-none focus:border-[#7c3aed]"
      />
    </label>
  )
}
