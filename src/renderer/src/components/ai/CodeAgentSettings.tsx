import { useEffect, useState } from 'react'
import type { AIConfig } from '../../ai/agent'
import { SandboxOnboarding, type JailStatus } from '../modals/SandboxOnboarding'

type Harness = NonNullable<AIConfig['codeHarness']>
type Status = Awaited<ReturnType<typeof window.electronAPI.ai.harnesses.status>>[number]

const HARNESS_INFO: Record<Harness, { label: string; detail: string; mode: string }> = {
  sagyou: {
    label: 'Sagyou nativo',
    detail: 'Usa o perfil de API escolhido abaixo; escrita e comandos pedem aprovação.',
    mode: 'Execução por tarefa · sandbox obrigatório'
  },
  codex: {
    label: 'Codex',
    detail: 'Usa a conta autenticada no Codex CLI desta máquina.',
    mode: 'Por tarefa ou terminal ao vivo · worktree isolado'
  },
  'claude-code': {
    label: 'Claude Code',
    detail: 'Usa a conta autenticada no Claude Code desta máquina.',
    mode: 'Por tarefa ou terminal ao vivo · worktree isolado'
  },
  opencode: {
    label: 'OpenCode',
    detail: 'Usa o provedor configurado no OpenCode desta máquina.',
    mode: 'Por tarefa ou terminal ao vivo · worktree isolado'
  }
}

export function CodeAgentSettings(): React.JSX.Element {
  const [config, setConfig] = useState<AIConfig | null>(null)
  const [statuses, setStatuses] = useState<Status[]>([])
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [jailStatus, setJailStatus] = useState<JailStatus | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)

  const refreshJail = (redetect = false): void => {
    void window.electronAPI.ai.jail.status(redetect).then((status) => {
      setJailStatus(status as JailStatus)
      if (!status.available && status.enabled && !status.onboardingDismissed)
        setShowOnboarding(true)
    })
  }

  useEffect(() => {
    if (!window.electronAPI.ai.config?.get || !window.electronAPI.ai.harnesses?.status) {
      return
    }
    void Promise.all([window.electronAPI.ai.config.get(), window.electronAPI.ai.harnesses.status()])
      .then(([next, available]) => {
        setConfig(next)
        setStatuses(available)
      })
      .catch(() => setError('Não foi possível carregar a configuração do agente'))
    if (window.electronAPI.ai.jail) refreshJail()
  }, [])

  const save = (next: AIConfig): void => {
    setConfig(next)
    setError('')
    void window.electronAPI.ai.config
      .set(next)
      .then(() => {
        setKey('')
        setConfig((current) =>
          current
            ? {
                ...current,
                codeAgent: current.codeAgent && { ...current.codeAgent, apiKey: undefined }
              }
            : current
        )
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Falha ao salvar')
      )
  }

  if (!config)
    return <div className="mb-4 text-xs text-[#999]">{error || 'Carregando agente de código…'}</div>
  const names: [Harness, string][] = [
    ['sagyou', 'Sagyou'],
    ['codex', 'Codex'],
    ['claude-code', 'Claude Code']
  ]
  const selectedHarness = config.codeHarness ?? 'sagyou'
  const selectedInfo = HARNESS_INFO[selectedHarness]
  return (
    <section className="mb-5 rounded-xl border border-[#2b2b31] bg-[#16161a] p-4">
      {showOnboarding && jailStatus && (
        <SandboxOnboarding
          status={jailStatus}
          onDismiss={() => setShowOnboarding(false)}
          onInstalled={() => refreshJail(true)}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[#ededed]">Agente de código</h2>
          <p className="mt-1 text-xs text-[#999]">
            {selectedInfo.label} · {selectedInfo.mode}
          </p>
        </div>
        <button onClick={() => setOpen((value) => !value)} className="text-xs text-violet-300">
          {open ? 'Fechar configuração' : 'Configurar'}
        </button>
      </div>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-[#2b2b31] bg-[#101014] p-3 text-xs text-[#999]">
            <p className="font-medium text-[#d4d4d4]">1. Escolha como executar</p>
            <p className="mt-1">
              O mesmo pedido parte desta área em todos os modos. O resultado sempre fica visível
              para revisão; CLIs externos só alcançam o projeto depois da aprovação do patch.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {names.map(([id, name]) => {
              const status = statuses.find((item) => item.id === id)
              const info = HARNESS_INFO[id]
              const selected = selectedHarness === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => save({ ...config, codeHarness: id })}
                  disabled={id !== 'sagyou' && !status?.installed}
                  className={`rounded-lg border px-3 py-2 text-left text-xs disabled:opacity-40 ${selected ? 'border-violet-400 text-white' : 'border-[#2b2b31] text-[#d4d4d4]'}`}
                >
                  <span className="block">{name}</span>
                  <span className="mt-1 block text-[#777]">
                    {id === 'sagyou'
                      ? 'Nativo · em teste'
                      : status?.installed
                        ? (status.version ?? 'Instalado')
                        : 'Não encontrado'}
                  </span>
                  {id !== 'sagyou' && status?.installed && (
                    <span className="mt-1 block text-[10px] text-[#777]">
                      {status.authentication === 'authenticated'
                        ? 'Conta confirmada'
                        : status.authentication === 'unauthenticated'
                          ? 'Faça login no CLI'
                          : 'Conta verificada ao iniciar'}
                    </span>
                  )}
                  <span className="mt-1 block text-[10px] text-[#777]">{info.mode}</span>
                </button>
              )
            })}
          </div>
          {selectedHarness === 'sagyou' ? (
            <div className="space-y-3 rounded-lg border border-[#2b2b31] p-3">
              <p className="text-xs font-medium text-[#d4d4d4]">2. Configure o agente nativo</p>
              <label className="flex items-center gap-2 text-xs text-[#d4d4d4]">
                <input
                  type="checkbox"
                  checked={config.sandboxEnabled !== false}
                  onChange={(event) => save({ ...config, sandboxEnabled: event.target.checked })}
                />{' '}
                Sandbox para comandos do agente nativo
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-xs text-[#999]">
                  Base URL
                  <input
                    className="mt-1 w-full rounded border border-[#2b2b31] bg-[#101014] p-2 text-[#ededed]"
                    value={config.codeAgent?.baseUrl ?? ''}
                    placeholder="Usar perfil de API ativo"
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        codeAgent: { ...config.codeAgent, baseUrl: event.target.value }
                      })
                    }
                  />
                </label>
                <label className="text-xs text-[#999]">
                  API key
                  <input
                    type="password"
                    className="mt-1 w-full rounded border border-[#2b2b31] bg-[#101014] p-2 text-[#ededed]"
                    value={key}
                    placeholder="Usar chave do perfil ativo"
                    onChange={(event) => setKey(event.target.value)}
                  />
                </label>
                <label className="text-xs text-[#999]">
                  Modelo
                  <input
                    className="mt-1 w-full rounded border border-[#2b2b31] bg-[#101014] p-2 text-[#ededed]"
                    value={config.codeAgent?.model ?? ''}
                    placeholder="Usar modelo do perfil ativo"
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        codeAgent: { ...config.codeAgent, model: event.target.value }
                      })
                    }
                  />
                </label>
              </div>
              <button
                onClick={() =>
                  save({
                    ...config,
                    codeAgent: { ...config.codeAgent, ...(key && { apiKey: key }) }
                  })
                }
                className="rounded-lg bg-violet-700 px-3 py-2 text-xs text-white"
              >
                Salvar configuração do agente nativo
              </button>
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-[#2b2b31] p-3 text-xs text-[#999]">
              <p className="font-medium text-[#d4d4d4]">2. Use sua conta no {selectedInfo.label}</p>
              <p>
                {selectedInfo.detail} As chaves e o modelo são configurados no próprio CLI; o Sagyou
                não os copia nem solicita.
              </p>
              <button
                onClick={() => void window.electronAPI.ai.harnesses.status(true).then(setStatuses)}
                className="text-violet-300"
              >
                Verificar CLI novamente
              </button>
              <p>
                Esta verificação confirma o executável. A autenticação é confirmada pelo CLI ao
                iniciar uma sessão, sem abrir login nem enviar nada antes da sua tarefa.
              </p>
            </div>
          )}
          <div className="rounded-lg border border-[#2b2b31] bg-[#101014] p-3 text-xs text-[#999]">
            <p className="font-medium text-[#d4d4d4]">3. Revise a entrega</p>
            <p className="mt-1">
              Acompanhe a execução aqui, revise o diff e só então aplique as mudanças ao projeto. Em
              CLI externo, o worktree impede alterações diretas até essa aprovação.
            </p>
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
        </div>
      )}
    </section>
  )
}
