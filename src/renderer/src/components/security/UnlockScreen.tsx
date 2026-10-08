import { useState, type JSX } from 'react'

interface Props {
  onUnlocked: () => void
}

export function UnlockScreen({ onUnlocked }: Props): JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    const result = await window.electronAPI.security.unlock(password)
    setSubmitting(false)
    if (result.success) onUnlocked()
    else setError(result.error ?? 'Não foi possível desbloquear o Sagyou.')
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#1b1b1b]">
      <div className="h-10 shrink-0" />
      <main className="flex flex-1 items-center justify-center p-6">
        <form
          onSubmit={submit}
          className="w-full max-w-sm rounded-xl border border-[#3b3b3b] bg-[#232323] p-7 shadow-2xl"
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#7c3aed]">
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
                <rect x="5" y="10" width="14" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold text-[#d4d4d4]">Sagyou bloqueado</h1>
              <p className="mt-0.5 text-xs text-[#999999]">Informe sua senha para continuar.</p>
            </div>
          </div>
          <label className="mb-1.5 block text-xs font-medium text-[#999999]">Senha</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            autoComplete="current-password"
            className="w-full rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] px-3 py-2 text-sm text-[#d4d4d4] outline-none transition-colors focus:border-[#7c3aed]"
          />
          {error && <p className="mt-2 text-xs text-[#ef6b73]">{error}</p>}
          <button
            type="submit"
            disabled={!password || submitting}
            className="mt-5 w-full rounded-lg bg-[#7c3aed] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Desbloqueando...' : 'Desbloquear'}
          </button>
        </form>
      </main>
    </div>
  )
}
