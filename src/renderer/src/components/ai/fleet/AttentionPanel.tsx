import { useEffect, useState } from 'react'
import type { CodeAgentRunUI } from './useCodeAgentRuns'

/** "4:59" for the time left until `expiresAt`, or null once it has passed. */
function timeLeft(expiresAt: string, now: number): string | null {
  const seconds = Math.ceil((Date.parse(expiresAt) - now) / 1000)
  if (seconds <= 0) return null
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Everything that is blocking a run on the user, in one place above the
 * workspace: approvals, questions and environment hints. When nothing is
 * blocked it renders nothing, so the terminal gets the whole height.
 */
export function AttentionPanel({
  run,
  onApprove
}: {
  run: CodeAgentRunUI
  onApprove: (runId: string, approvalId: string, approved: boolean) => void
}): React.JSX.Element | null {
  const { approvals, questions, hint } = run
  // MCP cards expire in main; ticking here keeps a dead card from looking answerable.
  const counting = approvals.some((approval) => approval.expiresAt)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!counting) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [counting])
  if (!approvals.length && !questions.length && !hint) return null

  return (
    <div className="max-h-64 shrink-0 space-y-2 overflow-y-auto border-b border-[#f0b820]/30 bg-[#1a1812] px-4 py-3">
      {questions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-[#c4b5fd]">
            Aguardando sua resposta ({questions.length})
          </p>
          {questions.map((question) => (
            <p key={question.id} className="mt-1 text-xs text-[#d4d4d4]">
              {question.question}
            </p>
          ))}
        </div>
      )}

      {approvals.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[#f0b820]">
            Aguardando sua aprovação ({approvals.length})
          </p>
          {approvals.map((approval) => {
            const left = approval.expiresAt ? timeLeft(approval.expiresAt, now) : null
            const expired = Boolean(approval.expiresAt) && left === null
            return (
              <div
                key={approval.id}
                className="rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-[#d4d4d4]">{approval.resumo}</p>
                    {approval.name.startsWith('mcp:') && (
                      <p className="mt-0.5 text-[10px] text-[#8a8a92]">
                        Escrita solicitada pelo MCP desta sessão.
                      </p>
                    )}
                    {approval.irreversivel && (
                      <p className="mt-0.5 text-[10px] text-[#e04040]">Não pode ser desfeita.</p>
                    )}
                    {left && <p className="mt-0.5 text-[10px] text-[#8a8a92]">Expira em {left}</p>}
                    {expired && (
                      <p className="mt-0.5 text-[10px] text-[#f0b820]">
                        Expirou sem resposta; o agente recebeu uma recusa e pode pedir de novo.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => onApprove(run.id, approval.id, false)}
                      className="rounded border border-[#2b2b31] px-2.5 py-1 text-xs text-[#e04040] hover:bg-[#222227]"
                    >
                      {expired ? 'Dispensar' : 'Recusar'}
                    </button>
                    <button
                      type="button"
                      disabled={expired}
                      onClick={() => onApprove(run.id, approval.id, true)}
                      className="rounded bg-violet-700 px-2.5 py-1 text-xs text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-violet-700"
                    >
                      Aprovar
                    </button>
                  </div>
                </div>
                {approval.diff && approval.diff.length > 0 && (
                  <details className="mt-2 rounded border border-[#2b2b31] bg-[#0b0b0f]">
                    <summary className="cursor-pointer px-2 py-1 text-[10px] text-violet-300">
                      Ver diff para revisão{approval.diffTruncated ? ' (resumido)' : ''}
                    </summary>
                    <pre className="max-h-56 overflow-auto border-t border-[#2b2b31] p-2 text-[10px] leading-relaxed">
                      {approval.diff.map((line, index) => (
                        <span
                          key={index}
                          className={
                            line.kind === 'add'
                              ? 'text-emerald-300'
                              : line.kind === 'del'
                                ? 'text-red-300'
                                : line.kind === 'meta'
                                  ? 'text-violet-300'
                                  : 'text-[#999]'
                          }
                        >
                          {line.text}
                          {'\n'}
                        </span>
                      ))}
                    </pre>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}

      {hint && (
        <div className="rounded-lg border border-[#f0b820]/30 px-3 py-2">
          <p className="text-xs font-medium text-[#f0b820]">{hint.title}</p>
          <p className="mt-0.5 text-[11px] text-[#d4d4d4]">{hint.detail}</p>
          {hint.command && (
            <code className="mt-1 block overflow-x-auto rounded bg-[#0b0b0f] px-2 py-1 text-[10px] text-[#c4b5fd]">
              {hint.command}
            </code>
          )}
        </div>
      )}
    </div>
  )
}
