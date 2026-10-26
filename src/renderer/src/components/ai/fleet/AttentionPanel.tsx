import type { CodeAgentRunUI } from './useCodeAgentRuns'

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
  if (!approvals.length && !questions.length && !hint) return null

  return (
    <div className="max-h-64 shrink-0 space-y-2 overflow-y-auto border-b border-[#2b2b31] bg-[#16161a] px-4 py-3">
      {questions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-[#a080f0]">
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
          <p className="text-xs font-medium text-[#d9a640]">
            Aguardando sua aprovação ({approvals.length})
          </p>
          {approvals.map((approval) => (
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
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => onApprove(run.id, approval.id, false)}
                    className="rounded border border-[#2b2b31] bg-[#2a2a30] px-2.5 py-1 text-xs text-[#ec6a6a] hover:bg-[#303036]"
                  >
                    Recusar
                  </button>
                  <button
                    type="button"
                    onClick={() => onApprove(run.id, approval.id, true)}
                    className="rounded bg-[#6d5bb8] px-2.5 py-1 text-xs text-white hover:bg-[#7b69c6]"
                  >
                    Aprovar
                  </button>
                </div>
              </div>
              {approval.diff && approval.diff.length > 0 && (
                <details className="mt-2 rounded border border-[#2b2b31] bg-[#0b0b0f]">
                  <summary className="cursor-pointer px-2 py-1 text-[10px] text-[#a080f0]">
                    Ver diff para revisão{approval.diffTruncated ? ' (resumido)' : ''}
                  </summary>
                  <pre className="max-h-56 overflow-auto border-t border-[#2b2b31] p-2 text-[10px] leading-relaxed">
                    {approval.diff.map((line, index) => (
                      <span
                        key={index}
                        className={
                          line.kind === 'add'
                            ? 'text-[#46d478]'
                            : line.kind === 'del'
                              ? 'text-[#ec6a6a]'
                              : line.kind === 'meta'
                                ? 'text-[#a080f0]'
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
          ))}
        </div>
      )}

      {hint && (
        <div className="rounded-lg border border-[#2b2b31] bg-[#101014] px-3 py-2">
          <p className="text-xs font-medium text-[#d9a640]">{hint.title}</p>
          <p className="mt-0.5 text-[11px] text-[#d4d4d4]">{hint.detail}</p>
          {hint.command && (
            <code className="mt-1 block overflow-x-auto rounded bg-[#0b0b0f] px-2 py-1 text-[10px] text-[#a080f0]">
              {hint.command}
            </code>
          )}
        </div>
      )}
    </div>
  )
}
