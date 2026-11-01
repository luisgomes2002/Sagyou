// The live output of the external code agent (codex), rendered as a
// terminal rather than a <pre>: the log is a pipe, so the ANSI the agent emits
// is literal bytes that parseAnsi turns into colour (and strips the cursor codes
// a <div> would otherwise show as garbage). Styled to read like a CLI session —
// dark inset, monospace, a title bar — because that's what the output *is*.

import type { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import { parseAnsi } from '../../utils/ansi'
import { acquireLiveTerminal, attachLiveTerminal } from './liveTerminals'

function LogTerminal({
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
        'rounded-lg overflow-hidden border border-[#2b2b31] bg-[#101014] shadow-inner'
      }
    >
      {/* Terminal chrome: traffic lights + a mono label, like a CLI window. */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#101014] border-b border-[#2b2b31]">
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
          className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-[#999999] hover:text-[#d4d4d4] hover:bg-[#222227] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#999999] transition-colors"
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

interface InteractiveTerminalProps {
  log: string
  running: boolean
  runId: string
  onInput: (input: string) => Promise<void>
  onResize: (cols: number, rows: number) => Promise<void>
  initialCols?: number
  initialRows?: number
  compact?: boolean
}

/** A real terminal emulator attached to the harness' existing PTY. The xterm
 * itself outlives this panel (see liveTerminals): switching sessions hides it
 * instead of rebuilding it from main's truncated buffer. */
function InteractiveTerminal({
  log,
  running,
  runId,
  onInput,
  onResize,
  initialCols,
  initialRows,
  compact = false
}: InteractiveTerminalProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const latestLogRef = useRef(log)
  const callbacksRef = useRef({ onInput, onResize })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    latestLogRef.current = log
  })

  useEffect(() => {
    callbacksRef.current = { onInput, onResize }
  }, [onInput, onResize])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const session = acquireLiveTerminal(runId, {
      cols: initialCols,
      rows: initialRows,
      fallbackLog: latestLogRef.current
    })
    const { terminal, fit } = session
    const detach = attachLiveTerminal(session, host)
    terminalRef.current = terminal

    const resize = (): void => {
      if (!session.connected) return
      try {
        const beforeCols = terminal.cols
        const beforeRows = terminal.rows
        fit.fit()
        if (terminal.cols !== beforeCols || terminal.rows !== beforeRows)
          void callbacksRef.current.onResize(terminal.cols, terminal.rows)
      } catch {
        // Collapsed panels have no measurable terminal dimensions yet.
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    const frame = requestAnimationFrame(resize)
    const input = terminal.onData((data) => void callbacksRef.current.onInput(data))
    let disposed = false
    void session.ready.then(() => {
      if (!disposed) resize()
    })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      input.dispose()
      observer.disconnect()
      detach()
      terminalRef.current = null
    }
    // initialCols/initialRows only seed a terminal created for this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const copy = (): void => {
    const terminal = terminalRef.current
    if (!terminal) return
    navigator.clipboard.writeText(terminal.getSelection() || log)
    setCopied(true)
    setTimeout(() => setCopied(false), 2_000)
  }

  return (
    <div
      className={
        (compact ? '' : 'mx-6 mb-2 ') +
        'flex min-h-0 flex-1 flex-col rounded-lg overflow-hidden border border-[#2b2b31] bg-[#101014] shadow-inner'
      }
    >
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#101014] border-b border-[#2b2b31]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-[10px] font-mono text-[#999999] tracking-wide">
          terminal: {running ? 'ativo' : 'encerrado'}
        </span>
        <button
          onClick={copy}
          disabled={!log}
          title="Copiar seleção ou conteúdo do terminal"
          className="ml-auto px-1.5 py-0.5 rounded text-[10px] font-mono text-[#999999] hover:text-[#d4d4d4] hover:bg-[#222227] disabled:opacity-40 transition-colors"
        >
          {copied ? 'copiado' : 'copiar'}
        </button>
      </div>
      <div
        ref={hostRef}
        className="min-h-0 flex-1 overflow-hidden p-2 focus-within:ring-1 focus-within:ring-[#7c3aed]"
        aria-label="Terminal interativo do agente"
      />
    </div>
  )
}

export function AgentTerminal(
  props:
    | { log: string; running: boolean; compact?: boolean; interactive?: undefined }
    | (InteractiveTerminalProps & { interactive: true })
): React.JSX.Element {
  return props.interactive ? <InteractiveTerminal {...props} /> : <LogTerminal {...props} />
}
