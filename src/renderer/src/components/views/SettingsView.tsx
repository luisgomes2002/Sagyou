import { useEffect, useState, type JSX } from 'react'
import { ALL_FEATURE_IDS, type FeatureId } from '../../types'

interface Props {
  featurePreferences?: FeatureId[]
  onSetFeaturePreferences: (features: FeatureId[]) => void
  onToast: (message: string, type?: 'success' | 'error') => void
}

const FEATURE_LABELS: Record<FeatureId, { label: string; description: string }> = {
  kanban: { label: 'Kanban', description: 'Board, próximas, concluídas e projetos.' },
  goals: { label: 'Metas', description: 'Metas e registros de progresso.' },
  habits: { label: 'Hábitos', description: 'Acompanhamento de hábitos.' },
  financial: { label: 'Financeiro', description: 'Finanças, tabelas e perfis.' },
  planning: { label: 'Planejamento', description: 'Agenda e rotinas.' },
  reports: { label: 'Relatórios', description: 'Indicadores de produtividade.' },
  canvas: { label: 'Canvas', description: 'Notas visuais por projeto.' },
  files: { label: 'Arquivos', description: 'Biblioteca e anexos.' },
  graph: { label: 'Grafo', description: 'Relações entre registros.' },
  ai: { label: 'Assistente IA', description: 'Chat, memória e agentes.' }
}

export function SettingsView({
  featurePreferences,
  onSetFeaturePreferences,
  onToast
}: Props): JSX.Element {
  const [userName, setUserName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [loadingName, setLoadingName] = useState(true)
  const enabledFeatures = featurePreferences ?? ALL_FEATURE_IDS

  useEffect(() => {
    window.electronAPI.ai.config.get().then((config) => {
      const name = config.userName ?? ''
      setUserName(name)
      setSavedName(name)
      setLoadingName(false)
    })
  }, [])

  const saveUserName = async (): Promise<void> => {
    const config = await window.electronAPI.ai.config.get()
    const name = userName.trim()
    await window.electronAPI.ai.config.set({ ...config, userName: name || undefined })
    setUserName(name)
    setSavedName(name)
    onToast(name ? 'Nome salvo.' : 'Nome removido.')
  }

  const toggleFeature = (feature: FeatureId): void => {
    const next = enabledFeatures.includes(feature)
      ? enabledFeatures.filter((item) => item !== feature)
      : [...enabledFeatures, feature]
    onSetFeaturePreferences(next)
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-y-auto">
      <div className="w-full max-w-3xl mx-auto px-6 py-7 space-y-7">
        <div>
          <h1 className="text-xl font-semibold text-[#d4d4d4]">Configurações</h1>
          <p className="mt-1 text-sm text-[#999999]">Personalize o Sagyou para a sua rotina.</p>
        </div>

        <section className="rounded-xl border border-[#3b3b3b] bg-[#232323]">
          <SectionTitle title="Perfil" description="Como o assistente deve chamar você." />
          <div className="p-5 flex gap-3 items-end">
            <label className="block flex-1">
              <span className="mb-1.5 block text-xs font-medium text-[#999999]">Nome</span>
              <input
                type="text"
                value={userName}
                maxLength={80}
                onChange={(event) => setUserName(event.target.value)}
                placeholder="Ex.: Luísa"
                disabled={loadingName}
                className="w-full rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] px-3 py-2 text-sm text-[#d4d4d4] outline-none focus:border-[#7c3aed] disabled:opacity-50"
              />
            </label>
            <button
              type="button"
              onClick={() => void saveUserName()}
              disabled={loadingName || userName.trim() === savedName}
              className="rounded-lg bg-[#7c3aed] px-4 py-2 text-sm font-medium text-white hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Salvar
            </button>
          </div>
        </section>

        <PasswordSettings onToast={onToast} />

        <section className="rounded-xl border border-[#3b3b3b] bg-[#232323]">
          <SectionTitle
            title="Barra lateral"
            description="Escolha as áreas que aparecem na navegação. Seus dados não são apagados ao ocultar uma área."
          />
          <div className="divide-y divide-[#3b3b3b]">
            {ALL_FEATURE_IDS.map((feature) => {
              const info = FEATURE_LABELS[feature]
              const checked = enabledFeatures.includes(feature)
              return (
                <label
                  key={feature}
                  className="flex cursor-pointer items-center gap-4 px-5 py-3 hover:bg-[#2a2a2a]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleFeature(feature)}
                    className="h-4 w-4 accent-[#7c3aed]"
                  />
                  <span className="flex-1">
                    <span className="block text-sm text-[#d4d4d4]">{info.label}</span>
                    <span className="block text-xs text-[#999999]">{info.description}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </section>

        <section className="rounded-xl border border-[#3b3b3b] bg-[#232323]">
          <SectionTitle
            title="Criptografia"
            description="Proteção dos dados armazenados neste computador."
          />
          <div className="p-5">
            <p className="rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] px-3 py-2 text-sm text-[#999999]">
              A criptografia em repouso não está ativa. Ela foi adiada para evitar uma migração de
              dados de alto risco.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

function PasswordSettings({ onToast }: { onToast: Props['onToast'] }): JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.electronAPI.security.status().then((status) => setEnabled(status.enabled))
  }, [])

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
      setError(result.error ?? 'Não foi possível atualizar a senha.')
      return
    }
    setCurrent('')
    setNext('')
    setConfirm('')
    setEnabled(action !== 'disable')
    onToast(
      action === 'disable'
        ? 'Senha desativada.'
        : action === 'enable'
          ? 'Senha ativada.'
          : 'Senha alterada.'
    )
  }

  return (
    <section className="rounded-xl border border-[#3b3b3b] bg-[#232323]">
      <SectionTitle title="Senha" description="Bloqueia o acesso ao app ao abri-lo." />
      <div className="space-y-4 p-5">
        {enabled === null ? (
          <p className="text-sm text-[#999999]">Carregando...</p>
        ) : enabled ? (
          <>
            <p className="text-sm text-[#46d478]">Senha ativada.</p>
            <PasswordField label="Senha atual" value={current} onChange={setCurrent} />
            <PasswordField label="Nova senha" value={next} onChange={setNext} />
            <PasswordField label="Confirmar nova senha" value={confirm} onChange={setConfirm} />
            {error && <p className="text-xs text-[#ef6b73]">{error}</p>}
            <div className="flex justify-between gap-3">
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
              A senha é opcional e será solicitada antes de os dados carregarem.
            </p>
            <PasswordField label="Nova senha" value={next} onChange={setNext} />
            <PasswordField label="Confirmar senha" value={confirm} onChange={setConfirm} />
            {error && <p className="text-xs text-[#ef6b73]">{error}</p>}
            <div className="flex justify-end">
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
    </section>
  )
}

function SectionTitle({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <div className="border-b border-[#3b3b3b] px-5 py-4">
      <h2 className="text-base font-semibold text-[#d4d4d4]">{title}</h2>
      <p className="mt-1 text-xs text-[#999999]">{description}</p>
    </div>
  )
}

function PasswordField({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[#999999]">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="new-password"
        className="w-full rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] px-3 py-2 text-sm text-[#d4d4d4] outline-none focus:border-[#7c3aed]"
      />
    </label>
  )
}
