import type { Dispatch, SetStateAction } from 'react'
import {
  LOW_STEPS_WARNING,
  MAX_STEPS_LIMIT,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  type AIConfig
} from '../../ai/agent'
import { MODEL_PROVIDER, providerForModel } from '../../ai/model-catalog'

type HarnessStatus = Awaited<ReturnType<typeof window.electronAPI.ai.harnesses.status>>[number]
type SkillItem = Awaited<ReturnType<typeof window.electronAPI.ai.skills.list>>[number]
type JailStatus = Awaited<ReturnType<typeof window.electronAPI.ai.jail.status>>
type EditingSkill = { id?: string; name: string; body: string } | null

interface Props {
  config: AIConfig
  setConfig: Dispatch<SetStateAction<AIConfig>>
  models: string[]
  loadingModels: boolean
  modelsError: string | null
  handleLoadModels: () => Promise<void>
  codeAgentModels: string[]
  loadingCodeAgentModels: boolean
  codeAgentModelsError: string | null
  handleLoadCodeAgentModels: () => Promise<void>
  harnessStatuses: HarnessStatus[]
  loadingHarnessStatuses: boolean
  harnessCheckFeedback: string | null
  refreshHarnesses: (refresh?: boolean) => Promise<void>
  skills: SkillItem[]
  editingSkill: EditingSkill
  setEditingSkill: Dispatch<SetStateAction<EditingSkill>>
  skillError: string | null
  setSkillError: Dispatch<SetStateAction<string | null>>
  handleImportSkill: () => Promise<void>
  handleDeleteSkill: (name: string) => Promise<void>
  handleSaveSkill: () => Promise<void>
  jailStatus: JailStatus | null
  setShowOnboarding: Dispatch<SetStateAction<boolean>>
}

export function AIConfigPanel({
  config,
  setConfig,
  models,
  loadingModels,
  modelsError,
  handleLoadModels,
  codeAgentModels,
  loadingCodeAgentModels,
  codeAgentModelsError,
  handleLoadCodeAgentModels,
  harnessStatuses,
  loadingHarnessStatuses,
  harnessCheckFeedback,
  refreshHarnesses,
  skills,
  editingSkill,
  setEditingSkill,
  skillError,
  setSkillError,
  handleImportSkill,
  handleDeleteSkill,
  handleSaveSkill,
  jailStatus,
  setShowOnboarding
}: Props): React.JSX.Element {
  /** A USD-per-1M-tokens input. Blank means unset, which hides the cost. */
  const priceField = (
    label: string,
    key: 'inputPricePer1M' | 'outputPricePer1M'
  ): React.JSX.Element => (
    <label className="flex flex-col gap-1 shrink-0 w-44">
      <span className="text-[11px] font-medium text-[#999999]">{label}</span>
      <input
        type="number"
        min={0}
        step="0.01"
        value={config[key] ?? ''}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value.trim()
          setConfig((c) => ({ ...c, [key]: raw === '' ? undefined : Number(raw) }))
        }}
        className="px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]"
      />
    </label>
  )

  const field = (
    label: string,
    key: keyof AIConfig,
    type = 'text',
    placeholder = ''
  ): React.JSX.Element => (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-[#999999]">{label}</span>
      <input
        type={type}
        value={typeof config[key] === 'string' ? (config[key] as string) : ''}
        placeholder={placeholder}
        onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))}
        className="px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]"
      />
    </label>
  )

  /**
   * A field of the nested codeAgent config; blank falls back to the chat config.
   *
   * `options` turns it into a strict dropdown (no free typing) — used for Model, so
   * the user picks from the chat's loaded model list. The empty choice keeps the
   * "same as chat" fallback, and a stored value not in the list is preserved as its
   * own option (e.g. a model from a different endpoint set earlier).
   */
  const codeAgentField = (
    label: string,
    key: 'baseUrl' | 'apiKey' | 'model',
    type = 'text',
    placeholder = 'como o chat',
    options?: string[],
    loader?: { onLoad: () => void; loading: boolean }
  ): React.JSX.Element => {
    const current = config.codeAgent?.[key] ?? ''
    const setField = (raw: string): void =>
      setConfig((c) => {
        const next = { ...(c.codeAgent ?? {}), [key]: raw }
        // Drop empty fields so an all-blank block persists as absent (= fallback).
        const cleaned = Object.fromEntries(
          Object.entries(next).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
        )
        return { ...c, codeAgent: Object.keys(cleaned).length ? cleaned : undefined }
      })
    const inputClass =
      'px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]'
    const selectEl = options ? (
      <select
        value={current}
        onChange={(e) => setField(e.target.value)}
        className={`min-w-0 ${loader ? 'flex-1' : ''} ${inputClass}`}
      >
        <option value="">{placeholder}</option>
        {current && !options.includes(current) && <option value={current}>{current}</option>}
        {options.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    ) : (
      <input
        type={type}
        value={current}
        placeholder={placeholder}
        onChange={(e) => setField(e.target.value)}
        className={inputClass}
      />
    )
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-[#999999]">{label}</span>
        {loader ? (
          <div className="flex gap-1.5">
            {selectEl}
            <button
              onClick={loader.onLoad}
              disabled={loader.loading}
              title="Carregar modelos do endpoint do agente"
              className="shrink-0 px-2 py-1.5 rounded-md bg-[#2a2a2a] border border-[#3b3b3b] text-[#999999] hover:text-[#d4d4d4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loader.loading ? (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-[#7c3aed] border-t-transparent animate-spin" />
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              )}
            </button>
          </div>
        ) : (
          selectEl
        )}
      </label>
    )
  }

  return (
    <div className="max-h-[70vh] overflow-y-auto overscroll-contain px-6 py-4 border-b border-[#3b3b3b] bg-[#232323] shrink-0">
      <span className="text-[11px] font-medium text-[#999999]">Chat</span>
      <p className="mt-1 mb-2 text-[11px] leading-relaxed text-[#666666]">
        Provider e modelo que o assistente usa para <b>conversar com você</b> no chat — ler seus
        dados, analisar e responder. É o modelo principal do app.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {field('Base URL', 'baseUrl', 'text', 'https://api.openai.com/v1')}
        {field('API Key', 'apiKey', 'password', 'sk-...')}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-[#999999]">Model</span>
          <div className="flex gap-1.5">
            <select
              value={config.model}
              onChange={(e) => {
                const model = e.target.value
                setConfig((c) => {
                  // Auto-fill base URL when the model maps to a known provider
                  // and the current URL is empty or matches a different provider.
                  const url = providerForModel(model)
                  const currentUrl = c.baseUrl.trim()
                  const shouldFill =
                    url &&
                    (!currentUrl ||
                      Object.values(MODEL_PROVIDER).includes(currentUrl) ||
                      currentUrl.includes('localhost'))
                  return { ...c, model, ...(shouldFill ? { baseUrl: url } : {}) }
                })
              }}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed]"
            >
              {models.length === 0 && (
                <option value={config.model || ''}>{config.model || 'Carregue os modelos…'}</option>
              )}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              onClick={handleLoadModels}
              disabled={loadingModels || config.baseUrl.trim() === ''}
              title="Carregar modelos do endpoint"
              className="shrink-0 px-2 py-1.5 rounded-md bg-[#2a2a2a] border border-[#3b3b3b] text-[#999999] hover:text-[#d4d4d4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loadingModels ? (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-[#7c3aed] border-t-transparent animate-spin" />
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              )}
            </button>
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-[#999999]">
            Modelo do chat para conversar sobre código (opcional)
          </span>
          <select
            value={config.modelComplex ?? ''}
            onChange={(e) =>
              setConfig((c) => ({ ...c, modelComplex: e.target.value || undefined }))
            }
            className="px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed]"
          >
            <option value="">Mesmo do principal</option>
            {/* The loaded list, plus whatever is stored (may not be listed yet). */}
            {config.modelComplex && !models.includes(config.modelComplex) && (
              <option value={config.modelComplex}>{config.modelComplex}</option>
            )}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[#999999]">
        O <b>modelo principal</b> (acima) responde tudo no chat. Aqui você pode definir um{' '}
        <b>segundo modelo, mais forte, só para mensagens de código</b>: quando você escreve algo
        como &quot;tem um bug aqui&quot;, &quot;refatora essa função&quot; ou &quot;otimiza
        isso&quot;, a resposta usa este modelo; perguntas comuns (&quot;quantas tasks fiz essa
        semana?&quot;) continuam no principal — assim você só paga o modelo caro quando o assunto é
        código. Vale para o chat <b>conversar e analisar</b>; quem de fato <b>edita os arquivos</b>{' '}
        é o Agente de Código (mais abaixo). Deixe em &quot;mesmo do principal&quot; para usar um
        único modelo em tudo.
      </p>
      <label className="flex flex-col gap-1 mt-3">
        <span className="text-[11px] font-medium text-[#999999]">
          Esforço de raciocínio (DeepSeek)
        </span>
        <select
          value={config.reasoningEffort ?? ''}
          onChange={(e) =>
            setConfig((c) => ({
              ...c,
              reasoningEffort: (e.target.value || undefined) as
                | 'low'
                | 'medium'
                | 'high'
                | undefined
            }))
          }
          className="px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed]"
        >
          <option value="">Padrão do provedor</option>
          <option value="low">Baixo</option>
          <option value="medium">Médio</option>
          <option value="high">Alto</option>
        </select>
      </label>
      <div className="mt-3 flex items-start gap-3">
        <label className="flex flex-col gap-1 shrink-0 w-40">
          <span className="text-[11px] font-medium text-[#999999]">Passos máximos</span>
          <input
            type="number"
            min={1}
            max={MAX_STEPS_LIMIT}
            value={config.maxSteps ?? ''}
            placeholder="Padrão adaptativo (2–20)"
            onChange={(e) => {
              const raw = e.target.value.trim()
              // Empty means "unset" — that's what selects the per-mode default.
              setConfig((c) => ({
                ...c,
                maxSteps: raw === '' ? undefined : Number(raw)
              }))
            }}
            className="px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]"
          />
        </label>
        <div className="pt-5">
          <p className="text-[11px] text-[#666666] leading-relaxed">
            Quantas rodadas de ferramentas o assistente pode encadear numa resposta — cada rodada é
            uma chamada paga ao modelo. Em branco escolhe o orçamento pela tarefa: <b>2</b> para
            leitura pontual, <b>4</b> para ajuste simples, <b>8</b> para implementação normal e{' '}
            <b>15</b> para tarefa complexa (até <b>20</b> no automático). Um valor definido vale
            para os dois modos (máx. {MAX_STEPS_LIMIT}).
          </p>
          {config.maxSteps !== undefined && config.maxSteps < LOW_STEPS_WARNING && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[#f0b820] leading-relaxed">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="shrink-0 mt-0.5"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>
                Com apenas {config.maxSteps} passo{config.maxSteps === 1 ? '' : 's'}, tarefas
                maiores podem não ser concluídas — ler e pesquisar o código já consome vários passos
                antes de qualquer alteração. O assistente para no limite e responde com o que tiver
                feito até ali.
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-start gap-3">
        <label className="flex flex-col gap-1 shrink-0 w-40">
          <span className="text-[11px] font-medium text-[#999999]">Timeout (segundos)</span>
          <input
            type="number"
            min={MIN_TIMEOUT_MS / 1000}
            max={MAX_TIMEOUT_MS / 1000}
            value={config.timeoutMs === undefined ? '' : config.timeoutMs / 1000}
            placeholder={`Padrão (${DEFAULT_TIMEOUT_MS / 1000}s)`}
            onChange={(e) => {
              const raw = e.target.value.trim()
              // Stored in ms (the SDK's unit); shown in seconds, which is
              // how anyone actually thinks about a timeout.
              setConfig((c) => ({
                ...c,
                timeoutMs: raw === '' ? undefined : Math.round(Number(raw) * 1000)
              }))
            }}
            className="px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]"
          />
        </label>
        <p className="text-[11px] text-[#666666] pt-5 leading-relaxed">
          Quanto esperar o modelo <b>começar</b> a responder antes de desistir. Não corta respostas
          longas — vale só até a primeira resposta chegar. Em branco usa {DEFAULT_TIMEOUT_MS / 1000}
          s (mín. {MIN_TIMEOUT_MS / 1000}s, máx. {MAX_TIMEOUT_MS / 1000}s). Um timeout é tratado
          como falha temporária e entra no retry.
        </p>
      </div>

      <div className="mt-3 flex items-start gap-3">
        {priceField('Preço entrada (US$ / 1M tokens)', 'inputPricePer1M')}
        {priceField('Preço saída (US$ / 1M tokens)', 'outputPricePer1M')}
        <p className="text-[11px] text-[#666666] pt-5 leading-relaxed">
          Preços do seu provider, para estimar o custo da conversa. O app não tem como saber sozinho
          — ele fala com qualquer endpoint compatível com OpenAI, inclusive modelos locais (custo
          zero). Deixe em branco e o header mostra só os tokens.
        </p>
      </div>

      <div className="mt-3 flex items-start gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.usePromptCaching !== false}
            onChange={(e) => setConfig((c) => ({ ...c, usePromptCaching: e.target.checked }))}
            className="accent-[#7c3aed]"
          />
          <span className="text-[11px] font-medium text-[#999999]">Cache de prefixo ativo</span>
        </label>
        <p className="text-[11px] text-[#666666] pt-0 leading-relaxed">
          Quando ligado (padrão), mantém o histórico estável para maximizar o cache do provedor
          (DeepSeek ~50x mais barato, Claude, Gemini). Desligue se o provedor não tiver cache —
          resultados de leitura repetidos serão podados para economizar tokens.
        </p>
      </div>

      <div className="mt-3 pt-3 border-t border-[#3b3b3b]">
        <span className="text-[11px] font-medium text-[#999999]">Agente de Código</span>
        <p className="mt-1 mb-2 text-[11px] leading-relaxed text-[#666666]">
          Modelo que <b>escreve as alterações nos seus arquivos</b> quando o assistente decide mexer
          no código — diferente do chat acima, que só conversa e analisa. Tem provider próprio:
          deixe <b>Base URL</b> e <b>API Key</b> em branco para reaproveitar os do chat e preencha
          só o <b>Model</b> para apontar o agente a um modelo mais forte (ou a um modelo local,
          custo zero). Como editar código é a parte pesada, costuma valer um modelo melhor aqui do
          que no chat.
        </p>
        <div className="mb-3 rounded-lg border border-[#3b3b3b] bg-[#202020] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-medium text-[#d4d4d4]">Harness de execução</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-[#777777]">
                Define qual runtime executa tarefas que alteram código. A escolha é salva por
                dispositivo.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {config.codeHarness === 'sagyou' && (
                <span className="rounded-full border border-[#3b3b3b] bg-[#2a2a2a] px-2 py-0.5 text-[10px] font-medium text-[#e8bc70]">
                  EM TESTE
                </span>
              )}
              <button
                type="button"
                onClick={() => void refreshHarnesses(true)}
                disabled={loadingHarnessStatuses}
                className="text-[10px] text-[#a080f0] hover:text-[#d4d4d4] disabled:cursor-wait disabled:opacity-50"
              >
                {loadingHarnessStatuses
                  ? 'Verificando…'
                  : (harnessCheckFeedback ?? 'Verificar novamente')}
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['sagyou', 'Sagyou'],
                ['codex', 'Codex'],
                ['opencode', 'OpenCode'],
                ['claude-code', 'Claude Code']
              ] as const
            ).map(([value, label]) => {
              const selected = (config.codeHarness ?? 'sagyou') === value
              const status =
                value === 'sagyou' ? null : harnessStatuses.find((harness) => harness.id === value)
              const detail =
                value === 'sagyou'
                  ? 'Nativo · em teste'
                  : loadingHarnessStatuses
                    ? 'Verificando…'
                    : status?.installed
                      ? status.version
                        ? 'Instalado · ' + status.version
                        : 'Instalado'
                      : 'Não encontrado'
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setConfig((c) => ({ ...c, codeHarness: value }))}
                  className={
                    'rounded-md border px-2.5 py-2 text-left transition-colors ' +
                    (selected
                      ? 'border-[#a080f0] bg-[#3b3b3b] text-[#e3dcff]'
                      : 'border-[#3b3b3b] bg-[#181818] text-[#b0b0b0] hover:border-[#666666]')
                  }
                  aria-pressed={selected}
                >
                  <span className="block text-[11px] font-medium">{label}</span>
                  <span className="mt-0.5 block text-[10px] text-[#777777]">{detail}</span>
                </button>
              )
            })}
          </div>
          {config.codeHarness && config.codeHarness !== 'sagyou' ? (
            <p className="mt-2 text-[11px] leading-relaxed text-[#d7a347]">
              {config.codeHarness === 'claude-code'
                ? 'Claude Code'
                : config.codeHarness === 'opencode'
                  ? 'OpenCode'
                  : 'Codex'}{' '}
              {loadingHarnessStatuses
                ? 'está sendo verificado nesta máquina.'
                : harnessStatuses.find((harness) => harness.id === config.codeHarness)?.installed
                  ? 'vai executar em um worktree isolado e pedirá sua aprovação antes de aplicar o diff ao projeto. As credenciais e o modelo são configurados no próprio CLI.'
                  : 'não foi encontrado nesta máquina. Instale o CLI correspondente e use Verificar novamente.'}
            </p>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-[#e8bc70]">
              O harness Sagyou está em teste. Use aprovações manuais e confira o diff antes de
              aceitar alterações.
            </p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {codeAgentField('Base URL', 'baseUrl', 'text', config.baseUrl || 'como o chat')}
          {codeAgentField('API Key', 'apiKey', 'password', config.apiKey ? '••••' : 'como o chat')}
          {/* Dropdown estrito. Usa a lista própria do agente quando carregada
                    (botão ⟳), senão a do chat. O botão busca no endpoint do agente. */}
          {codeAgentField(
            'Model',
            'model',
            'text',
            config.model || 'como o chat',
            codeAgentModels.length ? codeAgentModels : models,
            { onLoad: handleLoadCodeAgentModels, loading: loadingCodeAgentModels }
          )}
        </div>
        {codeAgentModelsError && (
          <p className="mt-1.5 text-[11px] text-[#e04040]">
            Modelos do agente: {codeAgentModelsError}
          </p>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-[#3b3b3b]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-[#999999]">Skills</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSkillError(null)
                setEditingSkill({ name: '', body: '' })
              }}
              className="text-[11px] text-[#a080f0] hover:text-[#d4d4d4]"
            >
              + Nova skill
            </button>
            <button
              onClick={handleImportSkill}
              className="text-[11px] text-[#a080f0] hover:text-[#d4d4d4]"
            >
              Importar .md
            </button>
          </div>
        </div>

        {skills.length === 0 && !editingSkill && (
          <p className="text-[11px] text-[#666666] italic">
            Nenhuma skill ainda. Crie uma para usar com / no chat.
          </p>
        )}

        <div className="space-y-1">
          {skills.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate text-[11px] text-[#d4d4d4]">{s.name}</span>
              <button
                onClick={() => {
                  setSkillError(null)
                  setEditingSkill({ name: s.name, body: s.body })
                }}
                className="text-[11px] text-[#999999] hover:text-[#d4d4d4]"
              >
                Editar
              </button>
              <button
                onClick={() => handleDeleteSkill(s.name)}
                className="text-[11px] text-[#999999] hover:text-[#e04040]"
              >
                Apagar
              </button>
            </div>
          ))}
        </div>

        {editingSkill && (
          <div className="mt-2 space-y-2">
            <input
              value={editingSkill.name}
              onChange={(e) => setEditingSkill((s) => (s ? { ...s, name: e.target.value } : s))}
              placeholder="Nome da skill (ex: criar-projeto)"
              className="w-full px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-sm text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]"
            />
            <textarea
              aria-label="Conteúdo da skill"
              value={editingSkill.body}
              onChange={(e) => setEditingSkill((s) => (s ? { ...s, body: e.target.value } : s))}
              rows={8}
              spellCheck={false}
              className="w-full resize-y px-2.5 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-[11px] font-mono text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed]"
            />
            <p className="text-[10px] text-[#666666] leading-relaxed">
              O conteúdo da skill é enviado como contexto no chat. Use markdown.
            </p>
            {skillError && <p className="text-[11px] text-[#e04040]">{skillError}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveSkill}
                className="px-3 py-1 rounded-md bg-[#7c3aed] text-xs text-white font-medium hover:bg-[#6d28d9]"
              >
                Salvar
              </button>
              <button
                onClick={() => {
                  setEditingSkill(null)
                  setSkillError(null)
                }}
                className="px-3 py-1 rounded-md text-xs text-[#999999] hover:text-[#d4d4d4]"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sandbox toggle — the ONLY barrier between the native agent and the
                rest of the disk. Checked = required (default). Greyed when ai-jail
                isn't installed, with a way to open onboarding. Unchecking it
                runs shell commands unconfined. */}
      <div className="mt-4 pt-4 border-t border-[#3b3b3b]">
        <label
          className={`flex items-center gap-2 cursor-pointer select-none ${
            jailStatus && !jailStatus.available ? 'opacity-50' : ''
          }`}
        >
          <input
            type="checkbox"
            checked={config.sandboxEnabled !== false}
            disabled={!!jailStatus && !jailStatus.available}
            onChange={(e) => {
              setConfig((c) => ({
                ...c,
                sandboxEnabled: e.target.checked ? undefined : false
              }))
            }}
            className="w-3.5 h-3.5 accent-[#7c3aed]"
          />
          <span className="text-[12px] text-[#d4d4d4]">Sandbox (ai-jail)</span>
          {jailStatus?.available && jailStatus.version && (
            <span className="text-[10px] text-[#666666]">v{jailStatus.version}</span>
          )}
        </label>
        {jailStatus && !jailStatus.available && (
          <div className="mt-1.5 text-[11px] text-[#999999]">
            {/* When the kernel blocks the namespaces, ai-jail IS installed —
                      bail the user out without telling them to install it again. */}
            {/apparmor_restrict_unprivileged_userns/.test(jailStatus.reason ?? '')
              ? 'Sandbox indisponível.'
              : 'ai-jail não instalado.'}{' '}
            <button
              onClick={() => setShowOnboarding(true)}
              className="text-[#a080f0] hover:underline"
            >
              {/apparmor_restrict_unprivileged_userns/.test(jailStatus.reason ?? '')
                ? 'Ver detalhes'
                : 'Instalar ai-jail'}
            </button>
            {jailStatus.reason ? ` — ${jailStatus.reason}` : ''}
          </div>
        )}
        {config.sandboxEnabled === false && (
          <p className="mt-1.5 text-[11px] text-[#f0c210]">
            Desativar o sandbox permite que o agente acesse qualquer arquivo do sistema.
          </p>
        )}
      </div>

      {modelsError ? (
        <p className="mt-2 text-[11px] text-[#e04040]">Modelos: {modelsError}</p>
      ) : (
        <p className="mt-2 text-[11px] text-[#666666]">
          Endpoint compatível com OpenAI (<code>/chat/completions</code>). Os modelos vêm de{' '}
          <code>/models</code> — clique em atualizar para listar. A chave é salva localmente neste
          dispositivo.
        </p>
      )}
    </div>
  )
}
