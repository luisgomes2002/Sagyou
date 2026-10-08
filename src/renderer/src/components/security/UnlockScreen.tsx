import { useEffect, useRef, useState, type JSX } from 'react'

interface Props {
  userName?: string
  onUnlocked: () => void
}

export function UnlockScreen({ userName, onUnlocked }: Props): JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setShowPassword(true), reduceMotion ? 0 : 2_550)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (showPassword) passwordRef.current?.focus()
  }, [showPassword])

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
    <div className="unlock-screen flex h-screen flex-col overflow-hidden bg-[#050507]">
      <div className="unlock-glow unlock-glow-left" />
      <div className="unlock-glow unlock-glow-right" />
      <div className="unlock-noise" />
      <div className="relative h-10 shrink-0" />
      <main className="relative flex flex-1 flex-col items-center justify-center px-6 pb-10">
        <section className="unlock-greeting mb-10 text-center">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.3em] text-white/45">
            Sagyou
          </p>
          <h1 className="text-5xl font-semibold tracking-[-0.045em] text-white sm:text-6xl">
            {userName ? `Bem-vindo, ${userName}` : 'Bem-vindo'}
          </h1>
          <p className="mt-3 text-base text-white/60">Seu espaço para organizar o que importa.</p>
        </section>
        <form
          onSubmit={submit}
          className={`unlock-password-panel w-full max-w-sm rounded-2xl border border-white/15 bg-white/[0.08] p-6 shadow-2xl backdrop-blur-2xl ${
            showPassword ? 'unlock-password-panel-visible' : ''
          }`}
        >
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10">
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
              <h2 className="text-base font-semibold text-white">Desbloqueie o Sagyou</h2>
              <p className="mt-0.5 text-xs text-white/55">Informe sua senha para continuar.</p>
            </div>
          </div>
          <label
            htmlFor="unlock-password"
            className="mb-1.5 block text-xs font-medium text-white/60"
          >
            Senha
          </label>
          <input
            id="unlock-password"
            ref={passwordRef}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-violet-300/80 focus:ring-2 focus:ring-violet-300/20"
          />
          {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
          <button
            type="submit"
            disabled={!password || submitting}
            className="mt-5 w-full rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#111111] transition-all hover:scale-[1.01] hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Desbloqueando...' : 'Desbloquear'}
          </button>
        </form>
      </main>
    </div>
  )
}
