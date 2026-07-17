// The code agent's changes, rendered so they can be reviewed here instead of in
// an editor.

import { parseDiff, type LineKind } from '../utils/diff'

const LINE_STYLE: Record<LineKind, string> = {
  add: 'bg-emerald-500/10 text-emerald-300',
  del: 'bg-red-500/10 text-red-300',
  ctx: 'text-[#8892a4]',
  meta: 'text-[#4a5068] bg-[#0d0f18]'
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
  onRefresh
}: {
  diff: CodeAgentDiff
  onRefresh: () => void
}): React.JSX.Element {
  if (diff.error) {
    return (
      <div className="px-3 py-2 rounded-lg bg-[#0d0f18] border border-[#2a2d42]">
        <p className="text-[11px] text-[#8892a4]">{diff.error}</p>
      </div>
    )
  }

  if (diff.patch === '' && diff.files.length === 0) {
    return (
      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#0d0f18] border border-[#2a2d42]">
        {/* "It changed nothing" is an answer, and a common one — an agent that
            only read the code, or gave up. Silence here reads as a bug. */}
        <p className="text-[11px] text-[#4a5068] italic">
          O agente não alterou nenhum arquivo.
        </p>
        <button
          onClick={onRefresh}
          className="text-[10px] text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
        >
          Recarregar
        </button>
      </div>
    )
  }

  const files = parseDiff(diff.patch)
  const totalAdded = diff.files.reduce((n, f) => n + f.added, 0)
  const totalRemoved = diff.files.reduce((n, f) => n + f.removed, 0)
  const statOf = (path: string): { added: number; removed: number } | undefined =>
    diff.files.find((f) => f.path === path)

  return (
    <div className="rounded-lg bg-[#0d0f18] border border-[#2a2d42] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2a2d42]">
        <span className="text-[11px] font-medium text-[#e2e8f0]">
          {diff.files.length} arquivo{diff.files.length === 1 ? '' : 's'}
        </span>
        <span className="text-[11px] text-emerald-400">+{totalAdded}</span>
        <span className="text-[11px] text-red-400">−{totalRemoved}</span>
        <button
          onClick={onRefresh}
          title="Recalcular o diff"
          className="ml-auto text-[10px] text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
        >
          Recarregar
        </button>
      </div>

      <div className="max-h-[420px] overflow-auto">
        {files.map((file) => {
          const stat = statOf(file.path)
          return (
            <div key={file.path} className="border-b border-[#2a2d42] last:border-b-0">
              <div className="sticky top-0 flex items-center gap-2 px-3 py-1.5 bg-[#13151f] border-b border-[#2a2d42]">
                <span className="text-[11px] font-mono text-[#e2e8f0] truncate">{file.path}</span>
                {stat && (
                  <span className="ml-auto shrink-0 text-[10px]">
                    <span className="text-emerald-400">+{stat.added}</span>{' '}
                    <span className="text-red-400">−{stat.removed}</span>
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
        <div className="px-3 py-2 border-t border-[#2a2d42] space-y-1">
          {diff.truncated && (
            <p className="text-[10px] text-amber-400/80">
              Diff muito grande — mostrando só o começo. Veja o resto no editor.
            </p>
          )}
          {diff.omittedNewFiles.length > 0 && (
            // Named, not silently dropped: "and N more" is information.
            <p className="text-[10px] text-amber-400/80">
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
