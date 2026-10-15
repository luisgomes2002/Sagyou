import type { AIConfig } from '../../ai/agent'
import type { ChatConnection } from '../../store/aiRun'

interface Props {
  config: AIConfig
  connection: ChatConnection
  onConfigure: () => void
  onSwitch: () => void
  onOpenAgents: () => void
}

/** Make each connection's real boundary visible before the first request. */
export function ConnectionGuide({
  config,
  connection,
  onConfigure,
  onSwitch,
  onOpenAgents
}: Props): React.JSX.Element {
  const subscription = connection.provider === 'chatgpt'
  const profile = config.providerProfiles?.find((item) => item.id === connection.profileId)
  const configuredApi = Boolean(profile?.hasApiKey && profile.model)
  const title = subscription ? 'ChatGPT por assinatura' : (profile?.name ?? 'API não configurada')

  return (
    <section className="mx-auto w-full max-w-2xl rounded-xl border border-[#2b2b31] bg-[#16161a] p-4 text-left">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[#ededed]">{title}</p>
          <p className="mt-1 text-xs text-[#999]">
            {subscription
              ? 'Conversa normal pela sua assinatura.'
              : configuredApi
                ? 'Chat conectado por API.'
                : 'Escolha ou configure uma conexão para começar.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onSwitch}
          className="rounded-lg border border-[#2b2b31] px-3 py-1.5 text-xs text-violet-300 hover:border-violet-400"
        >
          Trocar conexão
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-[#101014] p-3 text-xs">
          <p className="font-medium text-[#d4d4d4]">Conversar</p>
          <p className="mt-1 text-[#999]">
            {subscription || configuredApi ? 'Disponível' : 'Configure uma conexão'}
          </p>
        </div>
        <div className="rounded-lg bg-[#101014] p-3 text-xs">
          <p className="font-medium text-[#d4d4d4]">Dados do Sagyou</p>
          <p
            className={`mt-1 ${subscription || !configuredApi ? 'text-amber-300' : 'text-emerald-300'}`}
          >
            {subscription || !configuredApi ? 'Exige perfil de API' : 'Ferramentas disponíveis'}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenAgents}
          className="rounded-lg bg-[#101014] p-3 text-left text-xs hover:outline hover:outline-1 hover:outline-violet-400"
        >
          <p className="font-medium text-[#d4d4d4]">Alterar código</p>
          <p className="mt-1 text-violet-300">Abrir Agentes → Agente de código</p>
        </button>
      </div>
      {(subscription || !configuredApi) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#999]">
          <span>
            {subscription
              ? 'Para criar tasks ou consultar finanças, conecte uma API.'
              : 'Uma chave de API permite usar as ferramentas do Sagyou.'}
          </span>
          <button
            type="button"
            onClick={onConfigure}
            className="text-violet-300 hover:text-violet-200"
          >
            Configurar API
          </button>
        </div>
      )}
    </section>
  )
}
