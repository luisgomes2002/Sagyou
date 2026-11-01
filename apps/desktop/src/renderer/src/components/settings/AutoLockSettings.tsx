import { useEffect, useState, type JSX } from 'react'
import { SettingToggle } from './WindowSettings'

type PrefsView = Awaited<ReturnType<typeof window.electronAPI.desktop.getPrefs>>
type Minutes = PrefsView['idleLockMinutes']

const OPTIONS: { value: Minutes; label: string }[] = [
  { value: 0, label: 'Nunca' },
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' }
]

/** Automatic lock options; they only exist with a password, which the parent knows. */
export function AutoLockSettings({ passwordEnabled }: { passwordEnabled: boolean }): JSX.Element {
  const [prefs, setPrefs] = useState<PrefsView | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    window.electronAPI.desktop
      .getPrefs()
      .then(setPrefs)
      .catch(() => setError(true))
  }, [])

  const save = async (
    patch: Parameters<typeof window.electronAPI.desktop.setPrefs>[0]
  ): Promise<void> => {
    setError(false)
    try {
      setPrefs(await window.electronAPI.desktop.setPrefs(patch))
    } catch {
      setError(true)
    }
  }

  if (prefs === null)
    return error ? (
      <p role="alert" className="border-t border-[#2b2b31] pt-4 text-xs text-[#ef6b73]">
        Não foi possível carregar o bloqueio automático.
      </p>
    ) : (
      <></>
    )
  const disabled = !passwordEnabled

  return (
    <div className="space-y-3 border-t border-[#2b2b31] pt-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-[#999999]">
          Bloquear automaticamente após
        </span>
        <select
          value={prefs.idleLockMinutes}
          disabled={disabled}
          onChange={(event) =>
            void save({ idleLockMinutes: Number(event.target.value) as Minutes })
          }
          className="w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#d4d4d4] focus:outline-none focus-visible:border-[#6d5bb8] focus-visible:ring-1 focus-visible:ring-[#6d5bb8] disabled:opacity-50"
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="rounded-lg border border-[#2b2b31] bg-[#101014]">
        <SettingToggle
          label="Bloquear quando o Windows bloquear a tela"
          description="Também ao suspender o computador."
          checked={prefs.lockOnSystemLock}
          disabled={disabled}
          onChange={(lockOnSystemLock) => void save({ lockOnSystemLock })}
        />
      </div>
      {disabled && (
        <p className="text-xs text-[#999999]">Ative uma senha para usar o bloqueio automático.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-[#ef6b73]">
          Não foi possível salvar.
        </p>
      )}
    </div>
  )
}
