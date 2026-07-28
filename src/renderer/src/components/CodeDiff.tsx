// The code agent's changes, rendered so they can be reviewed here instead of in
// an editor.

import { parseDiff, type LineKind } from '../utils/diff'

const LINE_STYLE: Record<LineKind, string> = {
  add: 'bg-[#46d478]/10 text-[#46d478]',
  del: 'bg-[#e04040]/10 text-[#e04040]',
  ctx: 'text-[#999999]',
  meta: 'text-[#666666] bg-[#1b1b1b]'
}

const MARK: Record<LineKind, string> = { add: '+', del: '-', ctx: ' ', meta: '' }

/**
 * What `ai:code-agent:diff` hands back. Mirrors DiffResult in main/code-diff.ts
 * — the preload's copy is module-scoped, so it can't be shared across the
 * process boundary and this is the renderer's word for the same shape.
 */
export interface CodeAgentDiff {
  /** Unified diff, git's own output. Empty means the agent changed nothing. */
  patch: string
  files: { path: string; added: number; removed: number }[]
  truncated: boolean
  /** New files there wasn't room to show in `patch`. */
  omittedNewFiles: string[]
  /** Set when no diff could be produced (not a repo, base gone, git failed). */
  error?: string
}

export function CodeDiff({
  diff,
  onRefresh,
  running = false
}: {
  diff: CodeAgentDiff
  /**
   * Recompute the diff. Omitted for an archived run, whose diff was frozen when
   * the agent exited — recomputing there would measure today's tree and present
   * the user's own later edits as the agent's work.
   */
  onRefresh?: () => void
  /** The agent is still working — an empty diff means "not yet", not "never". */
  running?: boolean
}): React.JSX.Element {
  if (diff.error) {
    return (
      <div className="px-3 py-2 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b]">
        <p className="text-[11px] text-[#999999]">{diff.error}</p>
      </div>
    )
  }

  if (diff.patch === '' && diff.files.length === 0) {
    return (
      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b]">
        {/* "It changed nothing" is an answer, and a common one — an agent that
            only read the code, or gave up. Silence here reads as a bug. But
            mid-run it is not that answer yet: the same empty diff means the
            agent is still reading, and saying "changed nothing" there is false. */}
        <p className="text-[11px] text-[#666666] italic">
          {running
            ? 'Nenhuma alteração ainda — o agente está trabalhando.'
            : 'O agente não alterou nenhum arquivo.'}
        </p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="text-[10px] text-[#999999] hover:text-[#d4d4d4] transition-colors"
          >
            Recarregar
          </button>
        )}
      </div>
    )
  }

  const files = parseDiff(diff.patch)
  const totalAdded = diff.files.reduce((n, f) => n + f.added, 0)
  const totalRemoved = diff.files.reduce((n, f) => n + f.removed, 0)
  const statOf = (path: string): { added: number; removed: number } | undefined =>
    diff.files.find((f) => f.path === path)

  return (
    <div className="rounded-lg bg-[#1b1b1b] border border-[#3b3b3b] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#3b3b3b]">
        <span className="text-[11px] font-medium text-[#d4d4d4]">
          {diff.files.length} arquivo{diff.files.length === 1 ? '' : 's'}
        </span>
        <span className="text-[11px] text-[#46d478]">+{totalAdded}</span>
        <span className="text-[11px] text-[#e04040]">−{totalRemoved}</span>
        {onRefresh && (
          <button
            onClick={onRefresh}
            title="Recalcular o diff"
            className="ml-auto text-[10px] text-[#999999] hover:text-[#d4d4d4] transition-colors"
          >
            Recarregar
          </button>
        )}
      </div>

      <div className="max-h-[420px] overflow-auto">
        {files.map((file) => {
          const stat = statOf(file.path)
          return (
            <div key={file.path} className="border-b border-[#3b3b3b] last:border-b-0">
              <div className="sticky top-0 flex items-center gap-2 px-3 py-1.5 bg-[#232323] border-b border-[#3b3b3b]">
                <span className="text-[11px] font-mono text-[#d4d4d4] truncate">{file.path}</span>
                {stat && (
                  <span className="ml-auto shrink-0 text-[10px]">
                    <span className="text-[#46d478]">+{stat.added}</span>{' '}
                    <span className="text-[#e04040]">−{stat.removed}</span>
                  </span>
                )}
              </div>
              <div className="py-1">
                {file.lines.map((line, i) => (
                  <div
                    key={i}
                    className={`flex px-3 text-[11px] font-mono leading-[1.6] ${LINE_STYLE[line.kind]}`}
                  >
                    <span className="select-none w-3 shrink-0 opacity-60">{MARK[line.kind]}</span>
                    {/* pre-wrap, not truncate: a long line is usually the one
                        worth reading, and code is whitespace-significant. */}
                    <span className="whitespace-pre-wrap break-all">{line.text || ' '}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {(diff.truncated || diff.omittedNewFiles.length > 0) && (
        <div className="px-3 py-2 border-t border-[#3b3b3b] space-y-1">
          {diff.truncated && (
            <p className="text-[10px] text-[#f0b820]/80">
              Diff muito grande — mostrando só o começo. Veja o resto no editor.
            </p>
          )}
          {diff.omittedNewFiles.length > 0 && (
            // Named, not silently dropped: "and N more" is information.
            <p className="text-[10px] text-[#f0b820]/80">
              +{diff.omittedNewFiles.length} arquivo(s) novo(s) não mostrado(s):{' '}
              {diff.omittedNewFiles.slice(0, 5).join(', ')}
              {diff.omittedNewFiles.length > 5 ? '…' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
