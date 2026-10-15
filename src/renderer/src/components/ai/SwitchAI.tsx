import { useEffect, useState } from 'react'
import type { AIConfig } from '../../ai/agent'
import type { ChatConnection } from '../../store/aiRun'

interface Props {
  config: AIConfig
  current: ChatConnection
  onClose: () => void
  onConfirm: (connection: ChatConnection) => void
}

export function SwitchAI({ config, current, onClose, onConfirm }: Props): React.JSX.Element {
  const [provider, setProvider] = useState<ChatConnection['provider']>(current.provider)
  const [profileId, setProfileId] = useState(
    current.profileId ?? config.activeProviderProfileId ?? config.providerProfiles?.[0]?.id ?? ''
  )
  const [model, setModel] = useState(current.model)
  const [models, setModels] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    void window.electronAPI.ai.chatgpt?.session?.().then((session) => setConnected(session.sharing))
  }, [])

  useEffect(() => {
    let cancelled = false
    const profile = config.providerProfiles?.find((item) => item.id === profileId)
    const saved = profile?.model
    const strong = profile?.modelComplex
    const request =
      provider === 'chatgpt'
        ? window.electronAPI.ai.chatgpt.models().then((items) => items.map((item) => item.slug))
        : profileId
          ? window.electronAPI.ai.models(profileId).then((result) => {
              if (!result.success) throw new Error(result.error ?? 'Falha ao carregar modelos')
              return result.models ?? []
            })
          : Promise.resolve([])
    void request
      .then((items) => {
        if (cancelled) return
        const available = [
          ...new Set([
            ...(provider === 'api'
              ? [saved, strong].filter((item): item is string => Boolean(item))
              : []),
            ...items
          ])
        ]
        setModels(available)
        setModel((previous) => (available.includes(previous) ? previous : (available[0] ?? '')))
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setModels(
          provider === 'api' ? [saved, strong].filter((item): item is string => Boolean(item)) : []
        )
        setModel(saved && provider === 'api' ? saved : '')
        setError(reason instanceof Error ? reason.message : 'Falha ao carregar modelos')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [provider, profileId, config.providerProfiles])

  const choose = (nextProvider: ChatConnection['provider'], nextProfileId = ''): void => {
    setProvider(nextProvider)
    setProfileId(nextProfileId)
    setModel('')
    setLoading(true)
    setError('')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Trocar IA"
    >
      <div className="w-full max-w-lg rounded-xl border border-[#2b2b31] bg-[#16161a] p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-[#ededed]">Trocar IA</h2>
        <p className="mt-1 text-xs text-[#999999]">Esta escolha permanece nesta conversa.</p>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => choose('chatgpt')}
            disabled={!connected}
            className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${provider === 'chatgpt' ? 'border-violet-400 text-white' : 'border-[#2b2b31] text-[#d4d4d4]'} disabled:opacity-40`}
          >
            ChatGPT por assinatura{' '}
            {!connected && <span className="text-xs">· Conecte nas configurações</span>}
          </button>
          {(config.providerProfiles ?? []).map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => choose('api', profile.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${provider === 'api' && profileId === profile.id ? 'border-violet-400 text-white' : 'border-[#2b2b31] text-[#d4d4d4]'}`}
            >
              {profile.name}
              {profile.provider === 'anthropic'
                ? ' · Claude API'
                : profile.provider === 'openai'
                  ? ' · OpenAI/Codex API'
                  : ''}
              {!profile.hasApiKey && (
                <span className="text-xs text-amber-300"> · Sem chave salva</span>
              )}
            </button>
          ))}
        </div>
        <label className="mt-4 block text-xs text-[#999999]">
          Modelo
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
            disabled={loading || models.length === 0}
            className="mt-1 w-full rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2 text-sm text-[#ededed]"
          >
            {models.length === 0 && (
              <option value="">{loading ? 'Carregando…' : 'Nenhum modelo disponível'}</option>
            )}
            {models.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
        {provider === 'chatgpt' && (
          <p className="mt-2 text-xs text-amber-300">
            Ferramentas do Sagyou e imagens não estão disponíveis nesta conexão. Documentos enviados
            como texto continuam disponíveis.
          </p>
        )}
        <p className="mt-3 text-xs text-[#777]">
          Assinatura usa ChatGPT. Para uso por chave, selecione um perfil OpenAI/Codex ou Claude.
          Codex CLI, Claude Code e OpenCode continuam na área Agente de código.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-[#999999]"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={
              !model ||
              loading ||
              (provider === 'chatgpt' && !connected) ||
              (provider === 'api' && !profileId)
            }
            onClick={() =>
              onConfirm({
                provider,
                profileId: provider === 'api' ? profileId : undefined,
                model
              })
            }
            className="rounded-lg bg-violet-700 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            Usar nesta conversa
          </button>
        </div>
      </div>
    </div>
  )
}
