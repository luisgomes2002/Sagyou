import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { AIConfig, AIProviderProfile } from '../../ai/agent'

type Session = Awaited<ReturnType<typeof window.electronAPI.ai.chatgpt.session>>
type Account = Awaited<ReturnType<typeof window.electronAPI.ai.chatgpt.profiles>>[number]

interface SkillItem {
  name: string
  body: string
  updatedAt: string
}
type SkillDraft = { id?: string; name: string; body: string } | null

type ProfilePreset = Pick<AIProviderProfile, 'name' | 'baseUrl' | 'provider'> & {
  description: string
}

function modelCheckError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : 'Falha ao verificar a conexão'
  if (/\b(401|403)\b/.test(message))
    return 'A chave foi recusada. Confira a chave e as permissões da conta.'
  if (/\b(404)\b/.test(message)) return 'A URL não respondeu como uma API de modelos. Confira a Base URL.'
  if (/network|fetch|timed? ?out|ECONN|ENOTFOUND/i.test(message))
    return 'Não foi possível alcançar a API. Confira a URL, a conexão e tente novamente.'
  return message
}

const API_PRESETS: ProfilePreset[] = [
  {
    name: 'OpenAI / Codex',
    baseUrl: 'https://api.openai.com/v1',
    provider: 'openai',
    description: 'Use uma chave da API OpenAI para modelos GPT e Codex.'
  },
  {
    name: 'Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    provider: 'anthropic',
    description: 'Use uma chave da API Anthropic para modelos Claude.'
  },
  {
    name: 'API compatível',
    baseUrl: '',
    provider: 'custom',
    description: 'Configure outro servidor compatível com a API OpenAI.'
  }
]

export function ChatSettingsPanel({
  config,
  setConfig,
  skills,
  editingSkill,
  setEditingSkill,
  skillError,
  setSkillError,
  onImportSkill,
  onDeleteSkill,
  onSaveSkill
}: {
  config: AIConfig
  setConfig: Dispatch<SetStateAction<AIConfig>>
  skills: SkillItem[]
  editingSkill: SkillDraft
  setEditingSkill: Dispatch<SetStateAction<SkillDraft>>
  skillError: string | null
  setSkillError: Dispatch<SetStateAction<string | null>>
  onImportSkill: () => Promise<void>
  onDeleteSkill: (name: string) => Promise<void>
  onSaveSkill: () => Promise<void>
}): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [chatModels, setChatModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [draft, setDraft] = useState<AIProviderProfile | null>(null)
  const [draftModels, setDraftModels] = useState<string[]>([])
  const [modelsBusy, setModelsBusy] = useState(false)
  const [modelsError, setModelsError] = useState('')
  const [modelsFeedback, setModelsFeedback] = useState('')

  const refreshAccount = async (): Promise<void> => {
    const [nextSession, nextAccounts] = await Promise.all([
      window.electronAPI.ai.chatgpt.session(),
      window.electronAPI.ai.chatgpt.profiles()
    ])
    setSession(nextSession)
    setAccounts(nextAccounts)
    setChatModels(
      nextSession.sharing
        ? (await window.electronAPI.ai.chatgpt.models()).map((item) => item.displayName)
        : []
    )
  }
  useEffect(() => {
    if (!window.electronAPI.ai.chatgpt) return
    void Promise.all([
      window.electronAPI.ai.chatgpt.session(),
      window.electronAPI.ai.chatgpt.profiles()
    ])
      .then(([nextSession, nextAccounts]) => {
        setSession(nextSession)
        setAccounts(nextAccounts)
        if (nextSession.sharing) {
          void window.electronAPI.ai.chatgpt
            .models()
            .then((items) => setChatModels(items.map((item) => item.displayName)))
        }
      })
      .catch(() => undefined)
  }, [])

  const accountAction = (action: () => Promise<unknown>): void => {
    setBusy(true)
    setError('')
    void action()
      .then(refreshAccount)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a conta')
      })
      .finally(() => setBusy(false))
  }

  const saveProfile = (): void => {
    if (!draft?.name.trim() || !draft.baseUrl.trim() || !draft.model.trim()) return
    const saved = {
      ...draft,
      name: draft.name.trim().slice(0, 80),
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      modelComplex: draft.modelComplex?.trim() || undefined
    }
    setConfig((current) => ({
      ...current,
      providerProfiles: current.providerProfiles?.some((item) => item.id === saved.id)
        ? current.providerProfiles.map((item) => (item.id === saved.id ? saved : item))
        : [...(current.providerProfiles ?? []), saved]
    }))
    setDraft(null)
  }

  const startProfile = (preset: ProfilePreset): void => {
    setDraftModels([])
    setModelsError('')
    setModelsFeedback('')
    setDraft({
      id: crypto.randomUUID(),
      kind: 'api',
      name: preset.name,
      baseUrl: preset.baseUrl,
      provider: preset.provider,
      model: ''
    })
  }

  const openProfile = (profile: AIProviderProfile): void => {
    setDraftModels(
      profile.model ? [profile.model, ...(profile.modelComplex ? [profile.modelComplex] : [])] : []
    )
    setModelsError('')
    setModelsFeedback('')
    setDraft({ ...profile, apiKey: '' })
  }

  const loadDraftModels = (): void => {
    if (!draft?.baseUrl.trim()) return
    setModelsBusy(true)
    setModelsError('')
    setModelsFeedback('')
    // An unchanged, blank field means "use the encrypted saved key". A newly
    // typed key remains a one-shot draft until the profile is saved.
    const request = draft.hasApiKey && !draft.apiKey ? draft.id : {
      draft: {
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
        provider: draft.provider
      }
    }
    void window.electronAPI.ai
      .models(request)
      .then((response) => {
        if (!response.success) throw new Error(response.error ?? 'Falha ao carregar modelos')
        const models = response.models ?? []
        setDraftModels(models)
        setModelsFeedback(
          models.length > 0
            ? `Conexão verificada: ${models.length} modelo${models.length === 1 ? '' : 's'} disponível${models.length === 1 ? '' : 'is'}.`
            : 'A conexão respondeu, mas não liberou modelos para esta chave.'
        )
        setDraft((current) => {
          if (!current) return current
          return {
            ...current,
            model: models.includes(current.model) ? current.model : (models[0] ?? current.model),
            modelComplex:
              current.modelComplex && models.includes(current.modelComplex)
                ? current.modelComplex
                : undefined
          }
        })
      })
      .catch((reason: unknown) => setModelsError(modelCheckError(reason)))
      .finally(() => setModelsBusy(false))
  }

  const inputClass =
    'w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#ededed] placeholder:text-[#666] focus:border-violet-400 focus:outline-none'
  return (
    <div className="max-h-[70vh] shrink-0 space-y-4 overflow-y-auto border-b border-[#2b2b31] bg-[#121216] px-6 py-5">
      <section className="rounded-xl border border-[#2b2b31] bg-[#16161a] p-4">
        <h2 className="text-sm font-semibold text-[#ededed]">ChatGPT por assinatura</h2>
        <p className="mt-1 text-xs text-[#999]">
          {session?.sharing
            ? `Conectado: ${session.identity?.email ?? session.profileLabel ?? 'conta ChatGPT'}`
            : 'Conecte sua assinatura para conversar.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={() =>
              accountAction(() => window.electronAPI.ai.chatgpt.signIn(Boolean(session?.profileId)))
            }
            className="rounded-lg border border-[#2b2b31] px-3 py-1.5 text-xs text-[#d4d4d4] disabled:opacity-40"
          >
            {session?.profileId ? 'Trocar conta' : 'Conectar'}
          </button>
          {session?.sharing && (
            <>
              <button
                onClick={() => void window.electronAPI.ai.chatgpt.manageUsage()}
                className="rounded-lg border border-[#2b2b31] px-3 py-1.5 text-xs text-[#d4d4d4]"
              >
                Gerenciar uso
              </button>
              <button
                disabled={busy}
                onClick={() => accountAction(() => window.electronAPI.ai.chatgpt.disconnect())}
                className="rounded-lg border border-[#2b2b31] px-3 py-1.5 text-xs text-[#d4d4d4]"
              >
                Desconectar
              </button>
            </>
          )}
        </div>
        {accounts.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {accounts.map((account) => (
              <button
                key={account.id}
                onClick={() =>
                  accountAction(() => window.electronAPI.ai.chatgpt.select(account.id))
                }
                className="rounded border border-[#2b2b31] px-2 py-1 text-xs text-[#999]"
              >
                {account.label}
              </button>
            ))}
          </div>
        )}
        {chatModels.length > 0 && (
          <p className="mt-3 text-xs text-[#999]">Modelos da conta: {chatModels.join(', ')}</p>
        )}
        <p className="mt-2 text-xs text-amber-300">
          Nesta conexão, as ferramentas do Sagyou não estão disponíveis.
        </p>
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      </section>

      <section className="rounded-xl border border-[#2b2b31] bg-[#16161a] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[#ededed]">Perfis de API</h2>
          <span className="text-xs text-[#777]">Escolha uma API</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {API_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => startProfile(preset)}
              className="rounded-lg border border-[#2b2b31] p-3 text-left hover:border-violet-400"
            >
              <span className="block text-xs font-medium text-[#ededed]">{preset.name}</span>
              <span className="mt-1 block text-[11px] text-[#777]">{preset.description}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {(config.providerProfiles ?? []).map((profile) => (
            <div
              key={profile.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-[#2b2b31] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-[#ededed]">{profile.name}</p>
                <p className="truncate text-xs text-[#777]">
                  {profile.provider === 'anthropic'
                    ? 'Claude API · '
                    : profile.provider === 'openai'
                      ? 'OpenAI/Codex API · '
                      : ''}
                  {profile.model} · {profile.hasApiKey ? 'chave salva' : 'sem chave'}
                </p>
              </div>
              <button onClick={() => openProfile(profile)} className="text-xs text-violet-300">
                Editar
              </button>
              <button
                onClick={() => {
                  setDraftModels([])
                  setModelsError('')
                  setDraft({
                    ...profile,
                    id: crypto.randomUUID(),
                    name: `${profile.name} (cópia)`,
                    apiKey: '',
                    hasApiKey: false
                  })
                }}
                className="text-xs text-[#999]"
                title="Duplica os campos; a chave deverá ser informada novamente"
              >
                Duplicar
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Excluir o perfil ${profile.name}?`))
                    setConfig((current) => {
                      const providerProfiles = current.providerProfiles?.filter(
                        (item) => item.id !== profile.id
                      )
                      return {
                        ...current,
                        providerProfiles,
                        activeProviderProfileId:
                          current.activeProviderProfileId === profile.id
                            ? providerProfiles?.[0]?.id
                            : current.activeProviderProfileId
                      }
                    })
                }}
                className="text-xs text-red-300"
              >
                Excluir
              </button>
            </div>
          ))}
        </div>
        {(config.providerProfiles?.length ?? 0) === 0 && (
          <p className="mt-2 text-xs text-[#777]">
            Nenhum perfil salvo. Crie um perfil para usar uma API no chat.
          </p>
        )}
      </section>

      <button onClick={() => setAdvanced((value) => !value)} className="text-xs text-[#999]">
        {advanced ? 'Ocultar avançado' : 'Avançado'}
      </button>
      {advanced && (
        <section className="grid gap-3 rounded-xl border border-[#2b2b31] bg-[#16161a] p-4 sm:grid-cols-2">
          <label className="text-xs text-[#999]">
            Como a IA deve chamar você
            <input
              className={`${inputClass} mt-1`}
              value={config.userName ?? ''}
              onChange={(event) =>
                setConfig((current) => ({ ...current, userName: event.target.value }))
              }
            />
          </label>
          <label className="text-xs text-[#999]">
            Timeout (ms)
            <input
              className={`${inputClass} mt-1`}
              type="number"
              value={config.timeoutMs ?? ''}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  timeoutMs: event.target.value ? Number(event.target.value) : undefined
                }))
              }
            />
          </label>
          <label className="text-xs text-[#999]">
            Preço de entrada (USD / 1M tokens)
            <input
              className={`${inputClass} mt-1`}
              type="number"
              value={config.inputPricePer1M ?? ''}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  inputPricePer1M: event.target.value ? Number(event.target.value) : undefined
                }))
              }
            />
          </label>
          <label className="text-xs text-[#999]">
            Preço de saída (USD / 1M tokens)
            <input
              className={`${inputClass} mt-1`}
              type="number"
              value={config.outputPricePer1M ?? ''}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  outputPricePer1M: event.target.value ? Number(event.target.value) : undefined
                }))
              }
            />
          </label>
        </section>
      )}

      {advanced && (
        <section className="rounded-xl border border-[#2b2b31] bg-[#16161a] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm text-[#ededed]">Skills</h2>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSkillError(null)
                  setEditingSkill({ name: '', body: '' })
                }}
                className="text-xs text-violet-300"
              >
                Nova skill
              </button>
              <button onClick={() => void onImportSkill()} className="text-xs text-violet-300">
                Importar .md
              </button>
            </div>
          </div>
          {skills.map((skill) => (
            <div key={skill.name} className="mt-2 flex items-center gap-3 text-xs">
              <span className="flex-1 text-[#d4d4d4]">/{skill.name}</span>
              <button
                onClick={() => setEditingSkill({ name: skill.name, body: skill.body })}
                className="text-violet-300"
              >
                Editar
              </button>
              <button onClick={() => void onDeleteSkill(skill.name)} className="text-red-300">
                Excluir
              </button>
            </div>
          ))}
          {editingSkill && (
            <div className="mt-3 space-y-2">
              <input
                className={inputClass}
                placeholder="Nome"
                value={editingSkill.name}
                onChange={(event) => setEditingSkill({ ...editingSkill, name: event.target.value })}
              />
              <textarea
                className={inputClass}
                rows={6}
                value={editingSkill.body}
                onChange={(event) => setEditingSkill({ ...editingSkill, body: event.target.value })}
              />
              <div className="flex gap-2">
                <button onClick={() => void onSaveSkill()} className="text-xs text-violet-300">
                  Salvar
                </button>
                <button onClick={() => setEditingSkill(null)} className="text-xs text-[#999]">
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {skillError && <p className="mt-2 text-xs text-red-300">{skillError}</p>}
        </section>
      )}

      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Editar perfil de API"
        >
          <div className="w-full max-w-lg space-y-3 rounded-xl border border-[#2b2b31] bg-[#16161a] p-5">
            <h2 className="text-base text-[#ededed]">Perfil de API</h2>
            <label className="block text-xs text-[#999]">
              Nome
              <input
                className={`${inputClass} mt-1`}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label className="block text-xs text-[#999]">
              Base URL
              <input
                className={`${inputClass} mt-1`}
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              />
            </label>
            <label className="block text-xs text-[#999]">
              API key
              <input
                className={`${inputClass} mt-1`}
                type="password"
                value={draft.apiKey ?? ''}
                placeholder={
                  draft.hasApiKey ? 'Chave salva; digite para substituir' : 'Cole sua chave'
                }
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              />
            </label>
            <div className="flex items-end gap-2">
              <p className="flex-1 text-xs text-[#999]">
                Use a URL e a chave para carregar apenas os modelos disponíveis para esta conta.
              </p>
              <button
                type="button"
                disabled={!draft.baseUrl.trim() || (!draft.apiKey && !draft.hasApiKey) || modelsBusy}
                onClick={loadDraftModels}
                className="rounded-lg border border-[#2b2b31] px-3 py-2 text-xs text-violet-300 disabled:opacity-40"
              >
                {modelsBusy ? 'Verificando…' : 'Verificar chave e buscar modelos'}
              </button>
            </div>
            <label className="block text-xs text-[#999]">
              Modelo padrão
              <select
                className={`${inputClass} mt-1`}
                value={draft.model}
                disabled={draftModels.length === 0}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              >
                {draftModels.length === 0 ? (
                  <option value="">Busque os modelos para escolher</option>
                ) : (
                  draftModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))
                )}
              </select>
            </label>
            {draft.provider === 'openai' && (
              <p className="text-xs text-[#999]">
                A chave da API OpenAI é cobrada pela plataforma; ela não usa os limites da
                assinatura ChatGPT.
              </p>
            )}
            {draft.provider === 'anthropic' && (
              <p className="text-xs text-[#999]">
                O Sagyou usa a camada de compatibilidade OpenAI da API Anthropic para este perfil.
              </p>
            )}
            <label className="block text-xs text-[#999]">
              Modelo forte (opcional)
              <select
                className={`${inputClass} mt-1`}
                value={draft.modelComplex ?? ''}
                disabled={draftModels.length === 0}
                onChange={(event) =>
                  setDraft({ ...draft, modelComplex: event.target.value || undefined })
                }
              >
                <option value="">Usar somente o modelo padrão</option>
                {draftModels
                  .filter((model) => model !== draft.model)
                  .map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
              </select>
            </label>
            {modelsError && <p className="text-xs text-red-300">{modelsError}</p>}
            {modelsFeedback && <p className="text-xs text-emerald-300">{modelsFeedback}</p>}
            {!draft.apiKey && !draft.hasApiKey && (
              <p className="text-xs text-amber-300">Informe uma chave para verificar a conexão.</p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setDraft(null)} className="px-3 py-2 text-xs text-[#999]">
                Cancelar
              </button>
              <button
                disabled={!draft.name.trim() || !draft.baseUrl.trim() || !draft.model.trim()}
                onClick={saveProfile}
                className="rounded-lg bg-violet-700 px-3 py-2 text-xs text-white disabled:opacity-40"
              >
                Salvar perfil
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
