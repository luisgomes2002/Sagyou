// Picks which code-agent run the panel is showing: the live one, or an archived
// one belonging to this conversation.
//
// A past run is a *snapshot* — its diff was frozen when the agent exited, and
// re-deriving it today would fold in every edit the user has made since and
// present that as the agent's work. So the panel says so when one is selected:
// "what the agent did" and "what the folder looks like now" stop being the same
// statement the moment the user keeps working, and the UI must not blur them.

import { useEffect, useRef, useState } from 'react'

/** Mirrors the main-process AgentRunMeta; see src/main/agent-runs.ts. */
export interface AgentRunMeta {
  id: string
  convId: string | null
  /** The model that ran it (native agent), or "codex" for old runs. */
  agent: string
  dir: string
  allowedWritePaths?: string[]
  readOnlyRoots?: { id: string; nome: string; path: string }[]
  task: string
  startedAt: number
  endedAt: number
  exitCode: number
  delivery?: 'applied' | 'merge_failed'
  fileCount: number
  /** Tokens billed across the run. Absent on old rows / no-usage providers. */
  tokens?: { promptTokens: number; completionTokens: number; reasoningTokens?: number }
}

/** "hoje 14:32" / "ontem 19:44" / "12/03 08:15" — a row has to be scannable. */
export function whenLabel(ts: number): string {
  const d = new Date(ts)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const dayMs = 86_400_000
  if (day === todayStart) return time
  if (day === todayStart - dayMs) return `ontem ${time}`
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`
}

function fileLabel(n: number): string {
  return n === 1 ? '1 arquivo' : `${n} arquivos`
}

/** "47.2k", "1.2M" — matches AIView's formatTokens; a row has to be scannable. */
function tokenLabel(t?: { promptTokens: number; completionTokens: number; reasoningTokens?: number }): string {
  if (!t) return ''
  const n = t.promptTokens + t.completionTokens + (t.reasoningTokens ?? 0)
  if (n <= 0) return ''
  const short = n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  return ` · ${short} tok`
}

function rowLabel(run: AgentRunMeta): string {
  return `${whenLabel(run.startedAt)} · ${run.agent} · ${fileLabel(run.fileCount)}${tokenLabel(run.tokens)}`
}

export function AgentRunPicker({
  runs,
  selectedId,
  live,
  onSelect
}: {
  runs: AgentRunMeta[]
  /** Null means the live run — always the first entry. */
  selectedId: string | null
  /** Whether there's live output to go back to. */
  live: boolean
  onSelect: (id: string | null) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on an outside click. Bound only while open, so the panel doesn't keep
  // a document listener alive for a dropdown nobody opened.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Nothing to pick between: one live run and no history is the normal case,
  // and a dropdown with a single entry is noise.
  if (runs.length === 0) return null

  const selected = runs.find((r) => r.id === selectedId)
  const label = selected ? rowLabel(selected) : live ? 'run atual' : 'selecionar run'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-[#999999] hover:bg-[#232323] hover:text-[#d4d4d4] transition-colors"
        title="Ver o log e as mudanças de uma run anterior"
      >
        {label}
        <svg
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Opens upward and to the right: this panel sits at the bottom of the
          window, between the transcript and the composer, so a menu dropping
          *down* from it runs into the root's overflow-hidden and is clipped.
          right-0 matches the view's other dropdowns and keeps a wide menu inside
          the frame instead of pushing it off the edge. */}
      {open && (
        <div className="absolute bottom-full right-0 z-40 mb-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] py-1 shadow-2xl">
          {live && (
            <button
              onClick={() => {
                onSelect(null)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-[#232323] ${
                selectedId === null ? 'text-[#7c3aed]' : 'text-[#d4d4d4]'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#20b858]" />
              run atual
            </button>
          )}
          {runs.map((run) => (
            <button
              key={run.id}
              onClick={() => {
                onSelect(run.id)
                setOpen(false)
              }}
              // The task is the only thing that tells two same-day runs apart.
              title={run.task || undefined}
              className={`block w-full px-3 py-1.5 text-left hover:bg-[#232323] ${
                selectedId === run.id ? 'text-[#7c3aed]' : 'text-[#d4d4d4]'
              }`}
            >
              <span className="block text-[11px]">{rowLabel(run)}</span>
              {run.task && (
                <span className="block truncate text-[10px] text-[#999999]">{run.task}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
