import { useEffect, useState } from 'react'
import { CodeDiff, type CodeAgentDiff } from '../CodeDiff'
import type { CodeAgentRunUI } from './useCodeAgentRuns'
import type { Harness } from './NewSessionPanel'
import { formatElapsed, formatProgress, formatTokens } from './format'

type Tab = 'activity' | 'changes' | 'context'

const TABS: { id: Tab; label: string }[] = [
  { id: 'activity', label: 'Atividade' },
  { id: 'changes', label: 'Alterações' },
  { id: 'context', label: 'Contexto' }
]

const CAPABILITY_LABEL: Record<string, string> = {
  available: 'disponível',
  unavailable: 'indisponível',
  unknown: 'não verificado'
}

function Fact({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-[#8a8a92]">{label}</dt>
      <dd className="mt-0.5 break-all text-xs text-[#d4d4d4]">{value}</dd>
    </div>
  )
}

function ActivityTab({ run }: { run: CodeAgentRunUI }): React.JSX.Element {
  const events = [...run.events].reverse()
  return (
    <div className="space-y-4">
      {run.progress && (
        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-[#8a8a92]">
            <span>
              Passo{' '}
              <span title={run.progress.maxSteps === 0 ? `Passo ${run.progress.step} — sem limite` : undefined}>
                {formatProgress(run.progress.step, run.progress.maxSteps)}
              </span>
            </span>
            <span className="tabular-nums">
              ↑ {run.progress.promptTokens.toLocaleString()} entrada · ↓{' '}
              {run.progress.completionTokens.toLocaleString()} saída
            </span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-[#2a2a30]"
            role="progressbar"
            aria-label="Progresso da execução"
            aria-valuemin={0}
            aria-valuemax={run.progress.maxSteps || undefined}
            aria-valuenow={run.progress.maxSteps ? run.progress.step : undefined}
          >
            <div
              className={
                run.progress.maxSteps
                  ? 'h-full rounded-full bg-[#8b5cf6] transition-all duration-500'
                  : 'h-full w-1/3 animate-pulse rounded-full bg-[#8b5cf6]'
              }
              style={
                run.progress.maxSteps
                  ? { width: `${Math.min(100, (run.progress.step / run.progress.maxSteps) * 100)}%` }
                  : undefined
              }
            />
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <p className="text-xs text-[#6f6f77]">
          {run.interactive
            ? 'Em sessões interativas as ações aparecem no terminal.'
            : 'Aguardando a primeira ação do agente…'}
        </p>
      ) : (
        <div>
          <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[#8a8a92]">
            Atividade recente
          </h3>
          <ol className="space-y-2">
            {events.map((event) => (
              <li key={event.id} className="flex min-w-0 items-start gap-2">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    event.phase === 'call' ? 'animate-pulse bg-[#a080f0]' : 'bg-[#46d478]'
                  }`}
                />
                <span className="min-w-0 text-[11px] text-[#d4d4d4]" title={event.detail}>
                  <span className="mr-1.5 text-[10px] text-[#8a8a92]">
                    {event.phase === 'call' ? 'fazendo' : 'feito'}
                  </span>
                  {event.detail}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function ChangesTab({ run }: { run: CodeAgentRunUI }): React.JSX.Element {
  const [diff, setDiff] = useState<CodeAgentDiff | null>(null)
  // The worktree is the only place the agent writes, so polling its diff is the
  // honest "what has it changed so far". Stops with the tab or the run.
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.electronAPI.ai.codeAgent
        .diff(run.id)
        .then((next) => alive && setDiff(next))
        .catch(() => {})
    }
    load()
    const timer = setInterval(load, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [run.id])

  if (!diff) return <p className="text-xs text-[#6f6f77]">Calculando alterações…</p>
  if (diff.error) return <p className="text-xs text-amber-300">{diff.error}</p>
  if (!diff.files.length && !diff.patch) {
    return <p className="text-xs text-[#6f6f77]">Nenhum arquivo alterado até agora.</p>
  }
  return <CodeDiff diff={diff} />
}

function ContextTab({
  run,
  harness,
  projectName
}: {
  run: CodeAgentRunUI
  harness?: Harness
  projectName: string
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])
  const modelKnown = harness?.capabilities.modelStatus === 'available' && run.model !== harness.label
  const total = run.progress ? run.progress.promptTokens + run.progress.completionTokens : 0
  return (
    <dl className="space-y-3">
      <Fact label="Executor" value={harness?.label ?? run.model} />
      <Fact label="Modelo" value={modelKnown ? run.model : 'não informado pelo harness'} />
      <Fact label="Projeto" value={projectName} />
      <Fact label="Raiz" value={run.codeRoot ?? run.dir} />
      <Fact label="Worktree" value={run.worktreeDir ?? 'indisponível'} />
      <Fact label="Tempo" value={formatElapsed(now - run.startedAt)} />
      {total > 0 && <Fact label="Tokens" value={`${formatTokens(total)} no total`} />}
      <Fact
        label="Instruções locais"
        value={run.localInstructions?.length ? run.localInstructions.join(', ') : 'nenhuma detectada'}
      />
      <Fact
        label="Skills detectadas"
        value={
          run.localSkills?.length
            ? `${run.localSkills.length} (uso pelo harness não verificável)`
            : 'nenhuma'
        }
      />
      {harness && (
        <Fact
          label="Capacidades"
          value={
            <span className="space-y-0.5">
              {(
                [
                  ['MCP', 'mcp'],
                  ['Terminal', 'interactiveTerminal'],
                  ['Retomar sessão', 'resumeSession'],
                  ['Aprovações', 'permissionPrompts']
                ] as const
              ).map(([label, key]) => (
                <span key={key} className="block">
                  {label}: {CAPABILITY_LABEL[harness.capabilities[key]]}
                </span>
              ))}
            </span>
          }
        />
      )}
    </dl>
  )
}

/** Right-hand inspector: secondary detail that must not compete with the terminal. */
export function Inspector({
  run,
  harness,
  projectName
}: {
  run: CodeAgentRunUI
  harness?: Harness
  projectName: string
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('activity')
  return (
    <aside aria-label="Inspetor" className="flex w-80 shrink-0 flex-col border-l border-[#2b2b31] bg-[#131317]">
      <div role="tablist" className="flex shrink-0 border-b border-[#2b2b31]">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
              tab === item.id
                ? 'border-b-2 border-violet-500 text-[#ededed]'
                : 'border-b-2 border-transparent text-[#8a8a92] hover:text-[#d4d4d4]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'activity' && <ActivityTab run={run} />}
        {tab === 'changes' && <ChangesTab run={run} />}
        {tab === 'context' && <ContextTab run={run} harness={harness} projectName={projectName} />}
      </div>
    </aside>
  )
}
