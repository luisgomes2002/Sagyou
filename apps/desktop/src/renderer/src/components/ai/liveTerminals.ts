// One xterm per live PTY, kept for as long as that PTY runs — not for as long
// as its panel is on screen. Main only keeps the last few KB of raw output, and
// for a full-screen CLI (Codex, Claude Code) that tail starts in the middle of a
// redraw: rebuilding the terminal from it on every session switch showed a blank
// or scrambled screen until the CLI happened to repaint. A hidden terminal keeps
// parsing its stream, so showing it again is just re-attaching its element.

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

export interface LiveTerminal {
  terminal: Terminal
  fit: FitAddon
  /** Owned by the terminal, moved between panels; xterm can only `open` once. */
  element: HTMLDivElement
  /** Resolves once the reconnect snapshot is written; resizes wait for it. */
  ready: Promise<void>
  connected: boolean
}

type Entry = LiveTerminal & { opened: boolean; pending: string[] | null }

const live = new Map<string, Entry>()
let unsubscribe: (() => void) | null = null

/** Write without yanking a user who scrolled back to read. */
function writePreservingScroll(terminal: Terminal, data: string): void {
  if (!data) return
  const viewport = terminal.buffer.active.viewportY
  const scrolledUp = viewport < terminal.buffer.active.baseY
  terminal.write(data, () => {
    if (scrolledUp) terminal.scrollToLine(Math.min(viewport, terminal.buffer.active.baseY))
  })
}

/** One listener for every terminal, so N sessions don't add N IPC listeners. */
function listen(): void {
  if (unsubscribe) return
  const api = window.electronAPI.ai.codeAgent
  const offOutput = api.onOutput(({ runId, chunk }) => {
    const session = live.get(runId)
    if (!session) return
    if (session.pending) session.pending.push(chunk)
    else writePreservingScroll(session.terminal, chunk)
  })
  const offExit = api.onExit(({ runId }) => disposeLiveTerminal(runId))
  unsubscribe = () => {
    offOutput()
    offExit()
  }
}

const THEME = {
  background: '#101014',
  foreground: '#d4d4d4',
  cursor: '#46d478',
  selectionBackground: '#3a3158',
  black: '#101014',
  brightBlack: '#777777',
  red: '#ff7b72',
  green: '#46d478',
  yellow: '#f0b820',
  blue: '#79c0ff',
  magenta: '#c4a7e7',
  cyan: '#76e3ea',
  white: '#d4d4d4'
}

/** The terminal of a run, created (and reconnected to main's buffer) on first use. */
export function acquireLiveTerminal(
  runId: string,
  options: { cols?: number; rows?: number; fallbackLog: string }
): LiveTerminal {
  const existing = live.get(runId)
  if (existing) return existing
  listen()

  const terminal = new Terminal({
    cols: options.cols,
    rows: options.rows,
    cursorBlink: true,
    cursorStyle: 'block',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.35,
    scrollback: 10_000,
    theme: THEME
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  const element = document.createElement('div')
  element.style.width = '100%'
  element.style.height = '100%'

  let markReady = (): void => {}
  const session: Entry = {
    terminal,
    fit,
    element,
    ready: new Promise<void>((resolve) => (markReady = resolve)),
    connected: false,
    opened: false,
    // Chunks that arrive before the snapshot. Main answers the reconnect after
    // sending every chunk already in its buffer, so on success they are in the
    // snapshot and are dropped; without a snapshot they are all we have.
    pending: []
  }
  live.set(runId, session)

  const connect = (snapshot: { log?: string; cols?: number; rows?: number } | null): void => {
    if (live.get(runId) !== session) return
    const pending = session.pending ?? []
    session.pending = null
    if (snapshot) {
      if (snapshot.cols && snapshot.rows) terminal.resize(snapshot.cols, snapshot.rows)
      writePreservingScroll(terminal, snapshot.log ?? '')
    } else {
      writePreservingScroll(terminal, options.fallbackLog + pending.join(''))
    }
    session.connected = true
    markReady()
  }
  void Promise.resolve(window.electronAPI.ai.codeAgent.terminalReconnect?.(runId))
    .then((result) => connect(result?.success ? result : null))
    .catch(() => connect(null))

  return session
}

/** Show a run's terminal inside `host`; the returned function hides it again. */
export function attachLiveTerminal(session: LiveTerminal, host: HTMLElement): () => void {
  const entry = session as Entry
  host.appendChild(session.element)
  if (!entry.opened) {
    session.terminal.open(session.element)
    entry.opened = true
  } else {
    session.terminal.refresh(0, session.terminal.rows - 1)
  }
  return () => {
    if (session.element.parentElement === host) host.removeChild(session.element)
  }
}

export function disposeLiveTerminal(runId: string): void {
  const session = live.get(runId)
  if (!session) return
  live.delete(runId)
  session.element.remove()
  session.terminal.dispose()
}

/** For tests: forget every terminal and the shared IPC listener. */
export function disposeAllLiveTerminals(): void {
  for (const runId of [...live.keys()]) disposeLiveTerminal(runId)
  unsubscribe?.()
  unsubscribe = null
}
