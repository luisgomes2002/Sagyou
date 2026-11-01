import { useEffect, useState, type JSX } from 'react'

type PrefsView = Awaited<ReturnType<typeof window.electronAPI.desktop.getPrefs>>

/** "Janela e inicialização": close-to-tray and the Windows login item. */
export function WindowSettings(): JSX.Element {
  const [prefs, setPrefs] = useState<PrefsView | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    window.electronAPI.desktop
      .getPrefs()
      .then(setPrefs)
      .catch(() => setError(true))
  }, [])

  // The switch only moves once main stored the value, so a failed save leaves it as it was.
  const apply = async (request: () => Promise<PrefsView>): Promise<void> => {
    setError(false)
    try {
      setPrefs(await request())
    } catch {
      setError(true)
    }
  }

  return (
    <section className="rounded-xl border border-[#2b2b31] bg-[#16161a]">
      <div className="border-b border-[#2b2b31] px-5 py-4">
        <h2 className="text-base font-semibold text-[#d4d4d4]">Janela e inicialização</h2>
        <p className="mt-1 text-xs text-[#999999]">
          Como o Sagyou se comporta ao fechar a janela e ao ligar o computador.
        </p>
      </div>
      <div className="space-y-3 p-5">
        {prefs === null ? (
          <p className="text-sm text-[#999999]">
            {error ? 'Não foi possível carregar.' : 'Carregando...'}
          </p>
        ) : (
          <div className="divide-y divide-[#2b2b31] rounded-lg border border-[#2b2b31] bg-[#101014]">
            <SettingToggle
              label="Fechar a janela mantém o Sagyou na bandeja"
              description="Use Sair no ícone da bandeja para encerrar."
              checked={prefs.closeToTray}
              onChange={(closeToTray) =>
                void apply(() => window.electronAPI.desktop.setPrefs({ closeToTray }))
              }
            />
            {prefs.platform === 'win32' && (
              <SettingToggle
                label="Iniciar com o Windows (na bandeja)"
                description="O Sagyou abre escondido na bandeja ao entrar no Windows."
                checked={prefs.openAtLogin}
                onChange={(on) => void apply(() => window.electronAPI.desktop.setOpenAtLogin(on))}
              />
            )}
          </div>
        )}
        {error && prefs !== null && (
          <p role="alert" className="text-xs text-[#ef6b73]">
            Não foi possível salvar.
          </p>
        )}
      </div>
    </section>
  )
}

export function SettingToggle({
  label,
  description,
  checked,
  disabled = false,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <label
      className={`flex items-center gap-4 px-4 py-3 ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-[#222227]'
      }`}
    >
      <span className="flex-1">
        <span className="block text-sm text-[#d4d4d4]">{label}</span>
        <span className="block text-xs text-[#999999]">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[#7c3aed]"
      />
    </label>
  )
}
