import { AgentTerminal } from '../AgentTerminal'
import { AttentionPanel } from './AttentionPanel'
import { Inspector } from './Inspector'
import type { Harness } from './NewSessionPanel'
import type { CodeAgentRunUI } from './useCodeAgentRuns'
import { STATUS_STYLE, formatProgress, type SessionStatus } from './format'

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
  'inline-flex items-center gap-1.5 rounded-lg border border-[#2b2b31] px-3 py-1.5 bg-[#2a2a30] text-xs text-[#ec6a6a] hover:bg-[#303036]'

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
                  className="accent-[#6d5bb8]"
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
