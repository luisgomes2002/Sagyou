// Reading git's unified diff.
//
// Parsing git's own format rather than asking the main process for something
// friendlier: it is stable, it is what every other tool shows, and a bespoke
// shape would mean inventing a second description of the same thing.
//
// Lives apart from the component so that file exports only a component (fast
// refresh needs that), and so the parser can be tested as what it is: a pure
// function over text.

/** One line of a hunk. Context lines carry no marker. */
export type LineKind = 'add' | 'del' | 'ctx' | 'meta'

interface DiffLine {
  kind: LineKind
  text: string
}

export interface ParsedFile {
  path: string
  lines: DiffLine[]
}

/**
 * Split a unified diff into files.
 *
 * `diff --git a/x b/x` starts a file. The `+++`/`---` headers are dropped —
 * they repeat the path already in the heading, and shown raw they read as a
 * huge addition and a huge deletion, which is exactly backwards.
 */
export function parseDiff(patch: string): ParsedFile[] {
  const files: ParsedFile[] = []
  let current: ParsedFile | null = null

  // Drop the terminating newline before splitting, and only that one: git's
  // output ends with '\n', so a plain split leaves a final '' that becomes a
  // phantom blank line at the foot of every file. Blank lines *inside* a hunk
  // are real structure and must survive — hence trimming the terminator rather
  // than filtering empties.
  const body = patch.endsWith('\n') ? patch.slice(0, -1) : patch
  for (const raw of body.split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw)
    if (header) {
      // The b-side name: for a rename that's where the file ended up.
      current = { path: header[2], lines: [] }
      files.push(current)
      continue
    }
    if (!current) continue
    // Noise between the heading and the first hunk: index/mode/similarity, plus
    // the +++/--- pair. None of it is a change.
    if (/^(index |old mode|new mode|similarity|rename |new file|deleted file|\+\+\+ |--- )/.test(raw)) {
      continue
    }
    if (raw.startsWith('@@')) {
      current.lines.push({ kind: 'meta', text: raw })
      continue
    }
    if (raw.startsWith('+')) current.lines.push({ kind: 'add', text: raw.slice(1) })
    else if (raw.startsWith('-')) current.lines.push({ kind: 'del', text: raw.slice(1) })
    else if (raw.startsWith('\\')) continue // "\ No newline at end of file"
    else current.lines.push({ kind: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw })
  }
  // A file whose body was entirely headers (a pure rename, a mode change) has
  // nothing to show but is still a change — keep it, the heading says enough.
  return files
}
