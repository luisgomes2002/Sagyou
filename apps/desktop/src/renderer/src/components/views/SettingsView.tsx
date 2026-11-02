import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { ALL_FEATURE_IDS, type FeatureId, type UiPreferences } from '../../types'
import type { SettingsSectionId } from '../../navigation'
import { SyncSettings } from '../settings/SyncSettings'
import { UpdateSettings } from '../settings/UpdateSettings'
import { WindowSettings } from '../settings/WindowSettings'
import { AutoLockSettings } from '../settings/AutoLockSettings'
import { SectionedPage } from '../layout/SectionedPage'
import { SECTION_ICONS } from '../layout/sectionIcons'

interface Props {
  featurePreferences?: FeatureId[]
  onSetFeaturePreferences: (features: FeatureId[]) => void
  uiPreferences: UiPreferences
  onSetUiPreferences: (preferences: UiPreferences) => void
  onToast: (message: string, type?: 'success' | 'error') => void
  initialSection?: SettingsSectionId
  onOpenGuide: (articleId?: string) => void
}

export const SETTINGS_SECTIONS: {
  id: SettingsSectionId
  label: string
  description: string
  icon: JSX.Element
}[] = [
  {
    id: 'geral',
    label: 'Geral',
    description: 'Como o Sagyou deve chamar você.',
    icon: SECTION_ICONS.user
  },
  {
    id: 'aparencia',
    label: 'Aparência',
    description: 'Tema, tamanho do texto e acessibilidade.',
    icon: SECTION_ICONS.palette
  },
  {
    id: 'barra-lateral',
    label: 'Barra lateral',
    description:
      'Escolha as áreas que aparecem na navegação. Seus dados não são apagados ao ocultar uma área.',
    icon: SECTION_ICONS.sidebar
  },
  {
    id: 'seguranca',
    label: 'Segurança',
    description: 'Senha do app e bloqueio automático.',
    icon: SECTION_ICONS.lock
  },
  {
    id: 'sincronizacao',
    label: 'Sincronização',
    description: 'Mantenha seus PCs e o celular com os mesmos dados.',
    icon: SECTION_ICONS.sync
  },
  {
    id: 'sistema',
    label: 'Sistema',
    description: 'Janela, bandeja e atualizações do app.',
    icon: SECTION_ICONS.system
  },
  {
    id: 'sobre',
    label: 'Sobre',
    description: 'Versão e ajuda.',
    icon: SECTION_ICONS.info
  }
]

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
  ai: { label: 'Sessões de código', description: 'Agentes de código no terminal e memória.' }
}

const primaryButton =
  'rounded-lg bg-[#6d5bb8] px-4 py-2 text-sm font-medium text-white hover:bg-[#7b69c6] disabled:cursor-not-allowed disabled:opacity-50'
const fieldClass =
  'w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#d4d4d4] outline-none focus:border-[#6d5bb8] disabled:opacity-50'

export function SettingsView({
  featurePreferences,
  onSetFeaturePreferences,
  uiPreferences,
  onSetUiPreferences,
  onToast,
  initialSection = 'geral',
  onOpenGuide
}: Props): JSX.Element {
  const [section, setSection] = useState<SettingsSectionId>(initialSection)
  const current = SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0]

  return (
    <SectionedPage
      title="Configurações"
      items={SETTINGS_SECTIONS}
      activeId={current.id}
      onSelect={setSection}
      heading={current.label}
      description={current.description}
    >
      <div className="space-y-5">
        {current.id === 'geral' && <GeneralSection onToast={onToast} />}
        {current.id === 'aparencia' && (
          <AppearanceSection
            uiPreferences={uiPreferences}
            onSetUiPreferences={onSetUiPreferences}
          />
        )}
        {current.id === 'barra-lateral' && (
          <SidebarSection
            enabledFeatures={featurePreferences ?? ALL_FEATURE_IDS}
            onSetFeaturePreferences={onSetFeaturePreferences}
          />
        )}
        {current.id === 'seguranca' && <PasswordSettings onToast={onToast} />}
        {current.id === 'sincronizacao' && (
          <>
            <button
              type="button"
              onClick={() => onOpenGuide('sync-o-que-e')}
              className="text-sm text-[#a080f0] hover:underline"
            >
              Como funciona a sincronização
            </button>
            <SyncSettings onToast={onToast} />
          </>
        )}
        {current.id === 'sistema' && (
          <>
            <WindowSettings />
            <UpdateSettings />
          </>
        )}
        {current.id === 'sobre' && <AboutSection onOpenGuide={onOpenGuide} />}
      </div>
    </SectionedPage>
  )
}

function Card({ children }: { children: ReactNode }): JSX.Element {
  return <section className="rounded-xl border border-[#2b2b31] bg-[#16161a]">{children}</section>
}

function GeneralSection({ onToast }: { onToast: Props['onToast'] }): JSX.Element {
  const [userName, setUserName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [loadingName, setLoadingName] = useState(true)

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

  return (
    <Card>
      <div className="flex items-end gap-3 p-5">
        <label className="block flex-1">
          <span className="mb-1.5 block text-xs font-medium text-[#999999]">Nome</span>
          <input
            type="text"
            value={userName}
            maxLength={80}
            onChange={(event) => setUserName(event.target.value)}
            placeholder="Ex.: Luísa"
            disabled={loadingName}
            className={fieldClass}
          />
        </label>
        <button
          type="button"
          onClick={() => void saveUserName()}
          disabled={loadingName || userName.trim() === savedName}
          className={primaryButton}
        >
          Salvar
        </button>
      </div>
    </Card>
  )
}

function AppearanceSection({
  uiPreferences,
  onSetUiPreferences
}: {
  uiPreferences: UiPreferences
  onSetUiPreferences: (preferences: UiPreferences) => void
}): JSX.Element {
  const update = <Key extends keyof UiPreferences>(key: Key, value: UiPreferences[Key]): void => {
    onSetUiPreferences({ ...uiPreferences, [key]: value })
  }

  return (
    <Card>
      <div className="space-y-5 p-5">
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-[#d4d4d4]">Tema</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tema do aplicativo">
            <PreferenceButton
              active={uiPreferences.theme === 'dark'}
              onClick={() => update('theme', 'dark')}
            >
              Escuro
            </PreferenceButton>
            <PreferenceButton
              active={uiPreferences.theme === 'light'}
              onClick={() => update('theme', 'light')}
            >
              Claro
            </PreferenceButton>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-[#d4d4d4]">Tamanho do texto</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tamanho do texto">
            <PreferenceButton
              active={uiPreferences.fontSize === 'small'}
              onClick={() => update('fontSize', 'small')}
            >
              Menor
            </PreferenceButton>
            <PreferenceButton
              active={uiPreferences.fontSize === 'default'}
              onClick={() => update('fontSize', 'default')}
            >
              Padrão
            </PreferenceButton>
            <PreferenceButton
              active={uiPreferences.fontSize === 'large'}
              onClick={() => update('fontSize', 'large')}
            >
              Maior
            </PreferenceButton>
          </div>
        </fieldset>

        <div className="divide-y divide-[#2b2b31] rounded-lg border border-[#2b2b31] bg-[#101014]">
          <TogglePreference
            label="Reduzir movimentos"
            description="Desativa animações e transições que não são essenciais."
            checked={uiPreferences.reduceMotion}
            onChange={(checked) => update('reduceMotion', checked)}
          />
          <TogglePreference
            label="Alto contraste"
            description="Aumenta a diferença entre texto, fundos e bordas."
            checked={uiPreferences.highContrast}
            onChange={(checked) => update('highContrast', checked)}
          />
        </div>
      </div>
    </Card>
  )
}

function SidebarSection({
  enabledFeatures,
  onSetFeaturePreferences
}: {
  enabledFeatures: FeatureId[]
  onSetFeaturePreferences: (features: FeatureId[]) => void
}): JSX.Element {
  const toggle = (feature: FeatureId): void => {
    onSetFeaturePreferences(
      enabledFeatures.includes(feature)
        ? enabledFeatures.filter((item) => item !== feature)
        : [...enabledFeatures, feature]
    )
  }

  return (
    <Card>
      <div className="divide-y divide-[#2b2b31]">
        {ALL_FEATURE_IDS.map((feature) => {
          const info = FEATURE_LABELS[feature]
          return (
            <TogglePreference
              key={feature}
              label={info.label}
              description={info.description}
              checked={enabledFeatures.includes(feature)}
              onChange={() => toggle(feature)}
            />
          )
        })}
      </div>
    </Card>
  )
}

function AboutSection({ onOpenGuide }: { onOpenGuide: Props['onOpenGuide'] }): JSX.Element {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm font-medium text-[#d4d4d4]">Sagyou</p>
          <p className="text-sm text-[#999999]">Versão {__APP_VERSION__}</p>
        </div>
        <button
          type="button"
          onClick={() => onOpenGuide(undefined)}
          className="rounded-lg bg-[#2a2a30] px-4 py-2 text-sm text-[#d4d4d4] hover:bg-[#303036]"
        >
          Abrir o Como funciona
        </button>
      </div>
    </Card>
  )
}

function PreferenceButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-[#6d5bb8] bg-[#6d5bb8] text-white'
          : 'border-[#2b2b31] bg-[#16161a] text-[#d4d4d4] hover:bg-[#222227]'
      }`}
    >
      {children}
    </button>
  )
}

function TogglePreference({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-4 px-4 py-3 hover:bg-[#222227]">
      <span className="flex-1">
        <span className="block text-sm text-[#d4d4d4]">{label}</span>
        <span className="block text-xs text-[#999999]">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[#6d5bb8]"
      />
    </label>
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
    <Card>
      <div className="border-b border-[#2b2b31] px-5 py-4">
        <h3 className="text-sm font-semibold text-[#d4d4d4]">Senha</h3>
        <p className="mt-1 text-xs text-[#999999]">Bloqueia o acesso ao app ao abri-lo.</p>
      </div>
      <div className="space-y-4 p-5">
        {enabled === null ? (
          <p className="text-sm text-[#999999]">Carregando...</p>
        ) : enabled ? (
          <>
            <p className="text-sm text-[#46d478]">Senha ativada.</p>
            <PasswordField label="Senha atual" value={current} onChange={setCurrent} />
            <PasswordField label="Nova senha" value={next} onChange={setNext} />
            <PasswordField label="Confirmar nova senha" value={confirm} onChange={setConfirm} />
            {error && <p className="text-xs text-[#ec6a6a]">{error}</p>}
            <div className="flex justify-between gap-3">
              <button
                type="button"
                onClick={() => void save('disable')}
                disabled={!current || saving}
                className="text-sm text-[#ec6a6a] hover:text-[#e04040] disabled:opacity-50"
              >
                Desativar senha
              </button>
              <button
                type="button"
                onClick={() => void save('change')}
                disabled={!current || !next || !confirm || saving}
                className={primaryButton}
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
            {error && <p className="text-xs text-[#ec6a6a]">{error}</p>}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void save('enable')}
                disabled={!next || !confirm || saving}
                className={primaryButton}
              >
                Ativar senha
              </button>
            </div>
          </>
        )}
        {enabled !== null && <AutoLockSettings passwordEnabled={enabled} />}
      </div>
    </Card>
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
        className={fieldClass}
      />
    </label>
  )
}
