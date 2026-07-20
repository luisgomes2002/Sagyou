// Turns a raw agent log (aider / codex, streamed over ai:code-agent:output) into
// styled segments the terminal panel can render. It exists because the log is a
// *pipe*, not a console: whatever ANSI the agent emits arrives as literal bytes,
// so without this the panel showed `[36mProcessing[0m` as text. It also strips
// the control codes a real terminal would act on but a <div> can only mangle
// (cursor moves, screen erases, the `?25l` hide-cursor a spinner emits) and
// collapses carriage-return overwrites the way a terminal would — the last write
// to a line wins, so a progress line that redraws itself doesn't stack.
//
// Deliberately partial: only SGR colour/intensity is interpreted (that's all the
// agents use for output). 256-colour / truecolour and background codes are
// swallowed rather than rendered — an unknown code must never leak as text.

export interface AnsiSegment {
  text: string
  /** CSS colour, or undefined for the terminal's default foreground. */
  fg?: string
  bold?: boolean
  dim?: boolean
}

// A palette tuned to the app's dark panel rather than raw VGA — same intent as
// CodeDiff's colours, so the terminal reads as part of the UI, not a foreign box.
const FG: Record<number, string> = {
  30: '#6b7280', // black → grey (pure black is invisible on the dark panel)
  31: '#f87171', // red
  32: '#4ade80', // green
  33: '#fbbf24', // yellow
  34: '#60a5fa', // blue
  35: '#c084fc', // magenta
  36: '#22d3ee', // cyan
  37: '#cbd5e1', // white
  90: '#8892a4', // bright black (grey)
  91: '#fca5a5',
  92: '#86efac',
  93: '#fde047',
  94: '#93c5fd',
  95: '#d8b4fe',
  96: '#67e8f9',
  97: '#f8fafc'
}

// A terminal's carriage return means "back to column 0" — the next write
// overwrites. For a scrollback view the faithful result is: within each physical
// line, only the text after the last \r survives. This is what stops aider's and
// codex's spinner/progress lines from piling up into a wall.
function collapseCarriageReturns(input: string): string {
  if (!input.includes('\r')) return input
  return input
    .split('\n')
    .map((line) => {
      const i = line.lastIndexOf('\r')
      return i === -1 ? line : line.slice(i + 1)
    })
    .join('\n')
}

export function parseAnsi(input: string): AnsiSegment[] {
  const text = collapseCarriageReturns(input)
  const segments: AnsiSegment[] = []

  let fg: string | undefined
  let bold = false
  let dim = false
  let buf = ''
  const flush = (): void => {
    if (buf) {
      segments.push({ text: buf, ...(fg && { fg }), ...(bold && { bold }), ...(dim && { dim }) })
      buf = ''
    }
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch !== '\x1b') {
      buf += ch
      i++
      continue
    }
    const next = text[i + 1]
    if (next === '[') {
      // CSI: parameter/intermediate bytes (0x20–0x3F) then a final byte (0x40–0x7E).
      let j = i + 2
      while (j < text.length && !/[@-~]/.test(text[j])) j++
      const final = text[j]
      if (final === undefined) break // sequence split across chunks — resolves on the next parse
      if (final === 'm') {
        flush()
        const params = text.slice(i + 2, j)
        const codes = params === '' ? [0] : params.split(';').map((p) => parseInt(p || '0', 10))
        for (const code of codes) {
          if (code === 0) {
            fg = undefined
            bold = false
            dim = false
          } else if (code === 1) bold = true
          else if (code === 2) dim = true
          else if (code === 22) {
            bold = false
            dim = false
          } else if (code === 39) fg = undefined
          else if (FG[code]) fg = FG[code]
          // everything else (backgrounds, 256/truecolour) is intentionally ignored
        }
      }
      // any non-'m' CSI (cursor move, erase, ?25l …) is dropped entirely
      i = j + 1
    } else if (next === ']') {
      // OSC: runs until BEL (\x07) or ST (ESC \). Window-title sets and the like.
      let j = i + 2
      while (j < text.length && text[j] !== '\x07' && !(text[j] === '\x1b' && text[j + 1] === '\\'))
        j++
      i = text[j] === '\x07' ? j + 1 : j + 2
    } else {
      // Lone ESC or a two-byte escape we don't model — drop ESC and the byte after.
      i += 2
    }
  }
  flush()
  return segments
}
