// The live output of the external code agent (codex), rendered as a
// terminal rather than a <pre>: the log is a pipe, so the ANSI the agent emits
// is literal bytes that parseAnsi turns into colour (and strips the cursor codes
// a <div> would otherwise show as garbage). Styled to read like a CLI session —
// dark inset, monospace, a title bar — because that's what the output *is*.

import { useEffect, useRef, useState } from 'react'
import { parseAnsi } from '../../utils/ansi'

export function AgentTerminal({
  log,
  running,
  compact = false
}: {
  log: string
  running: boolean
  /** Removes outer spacing when the terminal is embedded inside an agent card. */
  compact?: boolean
}): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)
  // Follow the tail only while the user is already at the bottom — the same rule
  // the chat transcript uses, so reading back through the log isn't yanked down
  // by every new chunk.
  const stick = useRef(true)
  const [copied, setCopied] = useState(false)

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

  // Copy what's on screen, not the raw pipe: the segments are already ANSI-free
  // and have \r / erase-in-line resolved, so pasting into an issue gives the
  // rendered session instead of a string full of escape bytes.
  const handleCopy = (): void => {
    navigator.clipboard.writeText(segments.map((s) => s.text).join(''))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={
        (compact ? '' : 'mx-6 mb-2 ') +
        'rounded-lg overflow-hidden border border-[#232323] bg-[#1b1b1b] shadow-inner'
      }
    >
      {/* Terminal chrome: traffic lights + a mono label, like a CLI window. */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1b1b1b] border-b border-[#232323]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-[10px] font-mono text-[#999999] tracking-wide">
          agent: {running ? 'running' : 'idle'}
        </span>
        <button
          onClick={handleCopy}
          disabled={!log}
          title="Copiar log"
          className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-[#999999] hover:text-[#d4d4d4] hover:bg-[#232323] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#999999] transition-colors"
        >
          {copied ? (
            <>
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              copiado
            </>
          ) : (
            <>
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              copiar
            </>
          )}
        </button>
      </div>
      <div
        ref={bodyRef}
        onScroll={onScroll}
        style={{ resize: 'vertical', height: '14rem', maxHeight: '60vh' }}
        className="overflow-y-auto px-4 py-3 font-mono text-[11.5px] leading-[1.55] text-[#d4d4d4] whitespace-pre-wrap break-words"
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
          <span className="inline-block w-[7px] h-[13px] align-middle bg-[#46d478] animate-pulse" />
        )}
      </div>
    </div>
  )
}
