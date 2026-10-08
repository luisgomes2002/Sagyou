import type { TokenUsage } from '../../ai/agent'
import { formatCost, formatTokens } from '../../utils/aiDisplay'
import { cacheHitRate } from '../../utils/spend'

interface Props {
  totalTokens: number
  reasoningTokens?: number
  cost: number | null
  usage: TokenUsage
  spend: Awaited<ReturnType<typeof window.electronAPI.ai.usage.summary>> | null
  runMetrics: Awaited<ReturnType<typeof window.electronAPI.ai.runMetrics.summary>> | null
  showSpend: boolean
  onToggle: () => void
  onClose: () => void
}

export function SpendPanel({
  totalTokens,
  reasoningTokens,
  cost,
  usage,
  spend,
  runMetrics,
  showSpend,
  onToggle,
  onClose
}: Props): React.JSX.Element {
  return (
    <>
      {(totalTokens > 0 || (spend?.total.calls ?? 0) > 0) && (
        <div className="relative">
          <button
            onClick={() => {
              onToggle()
            }}
            title={
              totalTokens > 0
                ? `Entrada: ${usage.promptTokens.toLocaleString('pt-BR')} tokens\n` +
                  `Saída: ${usage.completionTokens.toLocaleString('pt-BR')} tokens\n` +
                  (reasoningTokens
                    ? `Raciocínio: ${reasoningTokens.toLocaleString('pt-BR')} tokens\n`
                    : '') +
                  'Soma de todas as chamadas desta conversa. Clique para ver os gastos.'
                : 'Ver o histórico de chamadas e gastos'
            }
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] tabular-nums transition-colors ${
              showSpend
                ? 'bg-[#3b3b3b] text-[#a080f0]'
                : 'bg-[#2a2a2a] text-[#999999] hover:text-[#d4d4d4]'
            }`}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="shrink-0"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v10M9.5 9.5h5M9.5 14.5h5" />
            </svg>
            {totalTokens > 0 ? (
              <>
                {formatTokens(totalTokens)} tokens
                {reasoningTokens ? (
                  <span className="text-[#a080f0]"> +{formatTokens(reasoningTokens)} rac.</span>
                ) : null}
                {cost !== null && <span className="text-[#a080f0]">· {formatCost(cost)}</span>}
              </>
            ) : (
              'Gastos'
            )}
          </button>

          {showSpend && spend && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => onClose()} />
              <div className="absolute right-0 top-full mt-1 z-40 w-80 max-h-[26rem] overflow-y-auto rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] shadow-2xl p-3">
                <p className="text-[11px] font-semibold text-[#d4d4d4] mb-2">Gastos com o modelo</p>

                <div className="space-y-1">
                  {(
                    [
                      ['Hoje', spend.today],
                      ['30 dias', spend.last30],
                      ['Total', spend.total]
                    ] as const
                  ).map(([label, b]) => (
                    <div key={label}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] text-[#999999]">{label}</span>
                        <span className="text-[11px] text-[#d4d4d4] tabular-nums">
                          {b.calls} {b.calls === 1 ? 'chamada' : 'chamadas'} ·{' '}
                          {formatTokens(b.promptTokens + b.completionTokens)} ·{' '}
                          {b.unpricedCalls === b.calls ? (
                            <span className="text-[#666666]">sem preço</span>
                          ) : (
                            <span className="text-[#a080f0]">{formatCost(b.cost)}</span>
                          )}
                        </span>
                      </div>
                      {cacheHitRate(b) !== null && (
                        <div>
                          <div className="w-full h-1 bg-[#3b3b3b] rounded-full mt-0.5">
                            <div
                              className="h-full bg-[#46d478] rounded-full"
                              style={{ width: `${Math.round(cacheHitRate(b)! * 100)}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-[#46d478]">
                            {Math.round(cacheHitRate(b)! * 100)}% cache
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {spend.total.unpricedCalls > 0 && (
                  <p className="mt-2 text-[10px] text-[#666666] leading-relaxed">
                    {spend.total.unpricedCalls} chamada
                    {spend.total.unpricedCalls === 1 ? '' : 's'} sem preço configurado na época —
                    não {spend.total.unpricedCalls === 1 ? 'entra' : 'entram'} no total.
                  </p>
                )}

                {spend.byModel.length > 0 && (
                  <>
                    <p className="mt-3 mb-1 text-[10px] font-medium text-[#999999] uppercase tracking-wide">
                      Por modelo
                    </p>
                    {spend.byModel.map(({ model, bucket }) => (
                      <div key={model}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] text-[#d4d4d4] truncate">{model}</span>
                          <span className="text-[11px] text-[#999999] tabular-nums shrink-0">
                            {bucket.calls}× ·{' '}
                            {bucket.unpricedCalls === bucket.calls ? '—' : formatCost(bucket.cost)}
                          </span>
                        </div>
                        {cacheHitRate(bucket) !== null && (
                          <div>
                            <div className="w-full h-1 bg-[#3b3b3b] rounded-full mt-0.5">
                              <div
                                className="h-full bg-[#46d478] rounded-full"
                                style={{
                                  width: `${Math.round(cacheHitRate(bucket)! * 100)}%`
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-[#46d478]">
                              {Math.round(cacheHitRate(bucket)! * 100)}% cache
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}

                {runMetrics && runMetrics.byModel.length > 0 && (
                  <>
                    <p className="mt-3 mb-1 text-[10px] font-medium text-[#999999] uppercase tracking-wide">
                      Eficiência por modelo
                    </p>
                    <p className="mb-1.5 text-[10px] text-[#666666] leading-relaxed">
                      Média por execução do agente ({runMetrics.runs}{' '}
                      {runMetrics.runs === 1 ? 'execução' : 'execuções'}). Menos tokens/passo é mais
                      eficiente.
                    </p>
                    {runMetrics.byModel.map((m) => (
                      <div key={m.model} className="mb-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[11px] text-[#d4d4d4] truncate">{m.model}</span>
                          <span className="text-[11px] text-[#999999] tabular-nums shrink-0">
                            {m.runs}× · {formatTokens(Math.round(m.avgTotalTokens))}/exec
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 text-[10px] text-[#666666] tabular-nums">
                          <span>
                            {m.avgSteps.toFixed(1)} passos ·{' '}
                            {formatTokens(Math.round(m.avgTokensPerStep))}/passo
                          </span>
                          <span className="shrink-0">
                            {m.avgRedundantSearches + m.avgRepeatedReads > 0.05 && (
                              <span
                                className="text-[#f0b820]"
                                title="buscas redundantes + releituras freadas, por execução"
                              >
                                {(m.avgRedundantSearches + m.avgRepeatedReads).toFixed(1)}
                              </span>
                            )}
                            {m.cappedRate > 0 && (
                              <span
                                className="ml-1.5"
                                title="execuções que bateram o limite de passos"
                              >
                                cap {Math.round(m.cappedRate * 100)}%
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {spend.recent.length > 0 && (
                  <>
                    <p className="mt-3 mb-1 text-[10px] font-medium text-[#999999] uppercase tracking-wide">
                      Últimas chamadas
                    </p>
                    <div className="space-y-0.5">
                      {spend.recent.map((e, i) => (
                        <div
                          key={`${e.at}-${i}`}
                          className="flex items-baseline justify-between gap-2"
                        >
                          <span className="text-[10px] text-[#666666] tabular-nums shrink-0">
                            {new Date(e.at).toLocaleString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                          <span className="text-[10px] text-[#999999] tabular-nums">
                            {formatTokens(e.promptTokens)}→{formatTokens(e.completionTokens)}
                            {typeof e.cost === 'number' && (
                              <span className="text-[#a080f0]"> {formatCost(e.cost)}</span>
                            )}
                            {typeof e.cachedPromptTokens === 'number' && (
                              <span className="text-[#46d478]"> cache</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {spend.total.calls === 0 && (
                  <p className="text-[11px] text-[#666666] italic">
                    Nenhuma chamada registrada ainda.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
