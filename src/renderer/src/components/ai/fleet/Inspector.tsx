import { useEffect, useState } from 'react'
import type { CodeAgentRunUI } from './useCodeAgentRuns'
import type { Harness } from './NewSessionPanel'
import { formatElapsed, formatTokens } from './format'

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

function ContextFacts({
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
  return (
    <aside aria-label="Inspetor" className="flex w-80 shrink-0 flex-col border-l border-[#2b2b31] bg-[#131317]">
      <h2 className="shrink-0 border-b border-[#2b2b31] px-4 py-2.5 text-xs font-medium text-[#ededed]">
        Contexto
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ContextFacts run={run} harness={harness} projectName={projectName} />
      </div>
    </aside>
  )
}
