// The live output of the external code agent (aider / codex), rendered as a
// terminal rather than a <pre>: the log is a pipe, so the ANSI the agent emits
// is literal bytes that parseAnsi turns into colour (and strips the cursor codes
// a <div> would otherwise show as garbage). Styled to read like a CLI session —
// dark inset, monospace, a title bar — because that's what the output *is*.

import { useEffect, useRef } from 'react'
import { parseAnsi } from '../utils/ansi'

export function AgentTerminal({
  log,
  running
}: {
  log: string
  running: boolean
}): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)
  // Follow the tail only while the user is already at the bottom — the same rule
  // the chat transcript uses, so reading back through the log isn't yanked down
  // by every new chunk.
  const stick = useRef(true)

  useEffect(() => {
    const el = bodyRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [log])

  const onScroll = (): void => {
    const el = bodyRef.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  const segments = parseAnsi(log)

  return (
    <div className="mx-6 mb-2 rounded-lg overflow-hidden border border-[#1c2030] bg-[#05070e] shadow-inner">
      {/* Terminal chrome: traffic lights + a mono label, like a CLI window. */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0b0e18] border-b border-[#1c2030]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-[10px] font-mono text-[#6b7280] tracking-wide">
          agent — {running ? 'running' : 'idle'}
        </span>
      </div>
      <div
        ref={bodyRef}
        onScroll={onScroll}
        style={{ resize: 'vertical', height: '14rem', maxHeight: '60vh' }}
        className="overflow-y-auto px-4 py-3 font-mono text-[11.5px] leading-[1.55] text-[#c9d1e3] whitespace-pre-wrap break-words"
      >
        {segments.map((s, i) => (
          <span
            key={i}
            style={{
              color: s.fg,
              fontWeight: s.bold ? 600 : undefined,
              opacity: s.dim ? 0.6 : undefined
            }}
          >
            {s.text}
          </span>
        ))}
        {/* A blinking block cursor while the agent is live, so an idle-looking
            pause reads as "still working" instead of "done". */}
        {running && (
          <span className="inline-block w-[7px] h-[13px] align-middle bg-[#4ade80] animate-pulse" />
        )}
      </div>
    </div>
  )
}
