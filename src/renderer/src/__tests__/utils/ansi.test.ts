import { describe, it, expect } from 'vitest'
import { parseAnsi } from '../../utils/ansi'

// The join of every segment's text is what the user actually reads — no escape
// byte, and nothing dropped, should ever change it beyond the intended overwrite.
const flat = (input: string): string =>
  parseAnsi(input)
    .map((s) => s.text)
    .join('')

describe('parseAnsi', () => {
  it('passes plain text through as one uncoloured segment', () => {
    expect(parseAnsi('hello world')).toEqual([{ text: 'hello world' }])
  })

  it('colours the run between an SGR set and its reset', () => {
    const segs = parseAnsi('\x1b[32mok\x1b[0m done')
    expect(segs).toEqual([{ text: 'ok', fg: '#4ade80' }, { text: ' done' }])
  })

  it('carries a colour with no explicit reset to the end', () => {
    const segs = parseAnsi('a\x1b[31mb')
    expect(segs).toEqual([{ text: 'a' }, { text: 'b', fg: '#f87171' }])
  })

  it('tracks bold and dim intensity, and clears them on reset', () => {
    const segs = parseAnsi('\x1b[1mB\x1b[0m\x1b[2mD\x1b[22mN')
    expect(segs).toEqual([
      { text: 'B', bold: true },
      { text: 'D', dim: true },
      { text: 'N' }
    ])
  })

  it('applies combined params in one SGR sequence', () => {
    expect(parseAnsi('\x1b[1;36mx')).toEqual([{ text: 'x', fg: '#22d3ee', bold: true }])
  })

  it('treats a bare \\x1b[m as a reset', () => {
    const segs = parseAnsi('\x1b[33my\x1b[mz')
    expect(segs).toEqual([{ text: 'y', fg: '#fbbf24' }, { text: 'z' }])
  })

  it('drops cursor/erase control sequences without leaking them as text', () => {
    // hide cursor, clear line, move cursor — none should reach the output
    expect(flat('\x1b[?25l\x1b[2K\x1b[1;1Hhi')).toBe('hi')
  })

  it('drops OSC sequences (window title) terminated by BEL', () => {
    expect(flat('\x1b]0;my title\x07text')).toBe('text')
  })

  it('collapses carriage-return overwrites to the last write on the line', () => {
    // a spinner redrawing itself must not stack
    expect(flat('load 10%\rload 50%\rload 99%')).toBe('load 99%')
  })

  it('applies carriage-return overwrite per line, keeping newlines', () => {
    expect(flat('one\rtwo\nthree')).toBe('two\nthree')
  })

  it('applies an erase-in-line code instead of leaving the erased text behind', () => {
    // What a redrawing agent actually emits: erase the line, then rewrite it.
    // Dropping the \x1b[2K used to leave both states stacked on one line.
    expect(flat('lendo arquivo A\x1b[2K\rlendo arquivo B')).toBe('lendo arquivo B')
    expect(flat('velho\x1b[Knovo')).toBe('novo')
  })

  it('keeps the colour of a redraw that re-emits it after the \\r', () => {
    // The overwrite is applied to the parsed line, not to the raw bytes, so the
    // escape after the \r is still an escape and not counted as text.
    expect(parseAnsi('a\r\x1b[32mok')).toEqual([{ text: 'ok', fg: '#4ade80' }])
  })

  it('does not let a redraw on one line erase the lines above it', () => {
    expect(flat('feito 1\nfeito 2\nprogresso 10%\rprogresso 90%')).toBe(
      'feito 1\nfeito 2\nprogresso 90%'
    )
  })

  it('ignores unknown SGR codes (256-colour) rather than printing them', () => {
    // 38;5;213 is a 256-colour foreground we don't model; text must survive plain
    expect(parseAnsi('\x1b[38;5;213mhi\x1b[0m')).toEqual([{ text: 'hi' }])
  })

  it('returns nothing for empty input', () => {
    expect(parseAnsi('')).toEqual([])
  })
})
