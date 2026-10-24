import type { ChatMessage, TokenUsage } from '../../../store/aiRun'
import { AgentTerminal } from '../AgentTerminal'
import { AttentionPanel } from './AttentionPanel'
import { Inspector } from './Inspector'
import type { Harness } from './NewSessionPanel'
import type { CodeAgentRunUI } from './useCodeAgentRuns'
import { STATUS_STYLE, formatProgress, formatTokens, type SessionStatus } from './format'

function StatusPill({ status, label }: { status: SessionStatus; label?: string }): React.JSX.Element {
  const style = STATUS_STYLE[status]
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${style.text}`}>
      <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden="true" />
      {label ?? style.label}
    </span>
  )
}

function Header({
  title,
  status,
  statusLabel,
  chips,
  actions
}: {
  title: string
  status: SessionStatus
  statusLabel?: string
  chips: string[]
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#2b2b31] px-5 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-[#ededed]" title={title}>
          {title}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusPill status={status} label={statusLabel} />
          {chips.filter(Boolean).map((chip) => (
            <span key={chip} className="text-[11px] text-[#8a8a92]">
              {chip}
            </span>
          ))}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

const stopButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-[#2b2b31] px-3 py-1.5 text-xs text-[#e04040] hover:bg-[#222227]'

// ---------------------------------------------------------------------------
// A code agent that is running right now
// ---------------------------------------------------------------------------

export function LiveRunWorkspace({
  run,
  harness,
  projectName,
  onApprove,
  onStop,
  onSetAuto,
  onTerminalInput,
  onTerminalResize
}: {
  run: CodeAgentRunUI
  harness?: Harness
  projectName: string
  onApprove: (runId: string, approvalId: string, approved: boolean) => void
  onStop: (runId: string) => void
  onSetAuto: (runId: string, enabled: boolean) => void
  onTerminalInput: (runId: string, input: string) => Promise<void>
  onTerminalResize: (runId: string, cols: number, rows: number) => Promise<void>
}): React.JSX.Element {
  const attention = run.approvals.length > 0 || run.questions.length > 0
  const status: SessionStatus = attention ? 'attention' : 'running'
  const step = run.progress ? `passo ${formatProgress(run.progress.step, run.progress.maxSteps)}` : ''
  const title = run.interactive && /^Abra uma sessão interativa/.test(run.task) ? 'Sessão interativa' : run.task

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header
        title={title}
        status={status}
        statusLabel={
          run.questions.length
            ? 'Aguardando sua resposta'
            : run.approvals.length
              ? 'Aguardando sua aprovação'
              : undefined
        }
        chips={[harness?.label ?? run.model, projectName, step]}
        actions={
          run.interactive ? (
            <span className="text-[11px] text-[#8a8a92]">Encerre digitando /exit no terminal</span>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[#8a8a92]">
                <input
                  type="checkbox"
                  checked={run.autoApprove}
                  onChange={(event) => onSetAuto(run.id, event.target.checked)}
                  className="accent-violet-600"
                />
                Aprovar ações automaticamente
              </label>
              <button
                type="button"
                onClick={() => onStop(run.id)}
                aria-label={`Parar agente: ${run.task}`}
                title="Parar este agente de código"
                className={stopButton}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                </svg>
                Parar
              </button>
            </>
          )
        }
      />
      <AttentionPanel run={run} onApprove={onApprove} />
      <div className="flex min-h-0 flex-1">
        <section aria-label="Terminal" className="flex min-h-0 min-w-0 flex-1 flex-col p-3">
          {run.interactive ? (
            <AgentTerminal
              log={run.log}
              running
              interactive
              runId={run.id}
              onInput={(input) => onTerminalInput(run.id, input)}
              onResize={(cols, rows) => onTerminalResize(run.id, cols, rows)}
              initialCols={run.terminalCols}
              initialRows={run.terminalRows}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AgentTerminal log={run.log} running />
            </div>
          )}
        </section>
        <Inspector run={run} harness={harness} projectName={projectName} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A chat agent (Sagyou assistant loop) running in the background
// ---------------------------------------------------------------------------

export function ChatAgentWorkspace({
  title,
  projectName,
  activity,
  awaiting,
  progress,
  tokens,
  recent,
  onOpen,
  onStop
}: {
  title: string
  projectName: string
  activity: string
  awaiting: boolean
  progress: { step: number; maxSteps: number } | null
  tokens: TokenUsage
  recent: ChatMessage[]
  onOpen: () => void
  onStop: () => void
}): React.JSX.Element {
  const reasoning = tokens.reasoningTokens ?? 0
  const total = tokens.promptTokens + tokens.completionTokens + reasoning
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header
        title={title}
        status={awaiting ? 'attention' : 'running'}
        statusLabel={awaiting ? 'Aguardando sua aprovação' : undefined}
        chips={['Chat do assistente', projectName, progress ? `passo ${formatProgress(progress.step, progress.maxSteps)}` : '']}
        actions={
          <>
            <button
              type="button"
              onClick={onOpen}
              className="rounded-lg border border-[#2b2b31] bg-[#16161a] px-3 py-1.5 text-xs font-medium text-[#d4d4d4] hover:bg-[#2a2a30]"
            >
              Abrir chat
            </button>
            <button type="button" onClick={onStop} title="Parar este agente" className={stopButton}>
              Parar
            </button>
          </>
        }
      />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <p className="text-sm text-[#d4d4d4]">{awaiting ? 'Aguardando sua aprovação…' : activity}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums text-[#8a8a92]">
          <span title="tokens de entrada desta execução">↑ {formatTokens(tokens.promptTokens)} entrada</span>
          <span title="tokens de saída desta execução">↓ {formatTokens(tokens.completionTokens)} saída</span>
          {reasoning > 0 && <span>🧠 {formatTokens(reasoning)} rac.</span>}
          <span>= {formatTokens(total)} total</span>
        </div>
        {recent.length > 0 && (
          <section aria-label="Atividade recente">
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[#8a8a92]">
              Atividade recente
            </h3>
            <ul className="space-y-2">
              {recent.map((status, index) => (
                <li key={index} className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      status.done === false ? 'animate-pulse bg-[#a080f0]' : 'bg-[#46d478]'
                    }`}
                  />
                  <span className="truncate text-xs text-[#d4d4d4]" title={status.content}>
                    {status.content}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
