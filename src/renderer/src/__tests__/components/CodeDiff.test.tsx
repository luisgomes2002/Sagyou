import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeDiff, type CodeAgentDiff } from '../../components/ai/CodeDiff'
import { parseDiff } from '../../utils/diff'

/**
 * Real git output, not invented. Everything below is a shape git actually
 * produces — a parser tested against tidy fixtures of its own making passes
 * happily and mangles the real thing.
 */
const SIMPLE = `diff --git a/src/a.ts b/src/a.ts
index 7d8a328..5114db6 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
`

const NEW_FILE = `diff --git a/novo.ts b/novo.ts
new file mode 100644
index 0000000..193b572
--- /dev/null
+++ b/novo.ts
@@ -0,0 +1 @@
+export const novo = 1
`

describe('parseDiff', () => {
  it('splits a patch into files and marks each line', () => {
    const [file] = parseDiff(SIMPLE)

    expect(file.path).toBe('src/a.ts')
    expect(file.lines).toEqual([
      { kind: 'meta', text: '@@ -1,2 +1,3 @@' },
      { kind: 'ctx', text: 'const a = 1' },
      { kind: 'del', text: 'const b = 2' },
      { kind: 'add', text: 'const b = 3' },
      { kind: 'add', text: 'const c = 4' }
    ])
  })

  it('drops the +++/--- headers instead of reading them as changes', () => {
    // The trap: `--- a/src/a.ts` starts with '-' and `+++ b/src/a.ts` with '+',
    // so a naive parser shows every file as one deletion and one addition of
    // its own name.
    const [file] = parseDiff(SIMPLE)

    expect(file.lines.some((l) => l.text.includes('a/src/a.ts'))).toBe(false)
    expect(file.lines.filter((l) => l.kind === 'add')).toHaveLength(2)
    expect(file.lines.filter((l) => l.kind === 'del')).toHaveLength(1)
  })

  it('handles a new file, whose old side is /dev/null', () => {
    const [file] = parseDiff(NEW_FILE)

    expect(file.path).toBe('novo.ts')
    expect(file.lines).toContainEqual({ kind: 'add', text: 'export const novo = 1' })
  })

  it('keeps several files apart', () => {
    const files = parseDiff(SIMPLE + NEW_FILE)

    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'novo.ts'])
    expect(files[1].lines.some((l) => l.text.includes('const c = 4'))).toBe(false)
  })

  it('takes the b-side name, so a rename shows where the file ended up', () => {
    const renamed = `diff --git a/velho.ts b/novo/lugar.ts
similarity index 90%
rename from velho.ts
rename to novo/lugar.ts
index 111..222 100644
--- a/velho.ts
+++ b/novo/lugar.ts
@@ -1 +1 @@
-const x = 1
+const x = 2
`
    expect(parseDiff(renamed)[0].path).toBe('novo/lugar.ts')
  })

  it('does not mistake code that starts with - or + for a diff marker', () => {
    // A real hazard: diff markers and code share the first column.
    const tricky = `diff --git a/m.ts b/m.ts
index 1..2 100644
--- a/m.ts
+++ b/m.ts
@@ -1,2 +1,2 @@
-const n = -1
+const n = +1
`
    const [file] = parseDiff(tricky)

    expect(file.lines).toContainEqual({ kind: 'del', text: 'const n = -1' })
    expect(file.lines).toContainEqual({ kind: 'add', text: 'const n = +1' })
  })

  it('keeps a blank context line rather than dropping it', () => {
    const withBlank = `diff --git a/b.ts b/b.ts
index 1..2 100644
--- a/b.ts
+++ b/b.ts
@@ -1,3 +1,3 @@
 const a = 1

+const b = 2
`
    const [file] = parseDiff(withBlank)

    // Blank lines are structure in code; losing them misaligns the whole hunk.
    expect(file.lines.filter((l) => l.kind === 'ctx')).toHaveLength(2)
  })

  it('ignores the no-newline marker, which is not a change', () => {
    const noNewline = `diff --git a/c.ts b/c.ts
index 1..2 100644
--- a/c.ts
+++ b/c.ts
@@ -1 +1 @@
-a
\\ No newline at end of file
+b
`
    const [file] = parseDiff(noNewline)

    expect(file.lines.some((l) => l.text.includes('No newline'))).toBe(false)
  })

  it('returns nothing for an empty patch, rather than a phantom file', () => {
    expect(parseDiff('')).toEqual([])
  })
})

describe('CodeDiff', () => {
  const base: CodeAgentDiff = {
    patch: SIMPLE,
    files: [{ path: 'src/a.ts', added: 2, removed: 1 }],
    truncated: false,
    omittedNewFiles: []
  }

  it('shows the changes with their counts', () => {
    render(<CodeDiff diff={base} onRefresh={vi.fn()} />)

    expect(screen.getByText('src/a.ts')).toBeInTheDocument()
    expect(screen.getByText('const c = 4')).toBeInTheDocument()
    expect(screen.getAllByText('+2').length).toBeGreaterThan(0)
  })

  it('says the agent changed nothing, instead of showing an empty box', () => {
    // A common and real outcome — an agent that only read, or gave up. Silence
    // here reads as a bug in the app.
    render(
      <CodeDiff
        diff={{ patch: '', files: [], truncated: false, omittedNewFiles: [] }}
        onRefresh={vi.fn()}
      />
    )

    expect(screen.getByText(/não alterou nenhum arquivo/)).toBeInTheDocument()
  })

  it('explains why there is no diff rather than claiming there were no changes', () => {
    // "Not a git repo" and "changed nothing" are opposite facts; showing the
    // second when the first is true is a lie about the user's code.
    render(
      <CodeDiff
        diff={{
          patch: '',
          files: [],
          truncated: false,
          omittedNewFiles: [],
          error: 'Sem diff: esta pasta não é um repositório git'
        }}
        onRefresh={vi.fn()}
      />
    )

    expect(screen.getByText(/não é um repositório git/)).toBeInTheDocument()
    expect(screen.queryByText(/não alterou nenhum arquivo/)).not.toBeInTheDocument()
  })

  it('warns when it is only showing part of the diff', () => {
    render(<CodeDiff diff={{ ...base, truncated: true }} onRefresh={vi.fn()} />)

    expect(screen.getByText(/muito grande/)).toBeInTheDocument()
  })

  it('names the new files it could not show', () => {
    render(
      <CodeDiff diff={{ ...base, omittedNewFiles: ['x.ts', 'y.ts'] }} onRefresh={vi.fn()} />
    )

    expect(screen.getByText(/x\.ts, y\.ts/)).toBeInTheDocument()
  })

  it('can be asked to recalculate', async () => {
    const onRefresh = vi.fn()
    render(<CodeDiff diff={base} onRefresh={onRefresh} />)

    await userEvent.click(screen.getByText('Recarregar'))

    expect(onRefresh).toHaveBeenCalled()
  })
})
