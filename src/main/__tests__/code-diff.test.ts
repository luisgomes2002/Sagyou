/**
 * The agent's diff, against real git repos in temp directories.
 *
 * Stubbing git here would test a fiction: every hard part of this is a detail
 * of how git actually behaves — what `stash create` touches, what `diff` can
 * and cannot see, what a clean tree prints. Those are the things worth pinning.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  captureBase,
  diffSince,
  realGit,
  lineDiff,
  MAX_DIFF_CHARS,
  MAX_NEW_FILES,
  MAX_APPROVAL_DIFF_LINES,
  MAX_DIFFABLE_LINES,
  type GitRunner
} from '../code-diff'

const made: string[] = []
afterAll(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true })
})

/** A real repo with one commit. */
async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sagyou-diff-'))
  made.push(dir)
  await realGit(dir, ['init', '-q'])
  await realGit(dir, ['config', 'user.email', 't@t'])
  await realGit(dir, ['config', 'user.name', 'T'])
  await writeFile(join(dir, 'a.txt'), 'linha um\nlinha dois\n')
  await realGit(dir, ['add', '-A'])
  await realGit(dir, ['commit', '-qm', 'base'])
  return dir
}

const write = (dir: string, name: string, body: string): Promise<void> =>
  writeFile(join(dir, name), body)

describe('captureBase', () => {
  it('captures a dirty tree without disturbing it', async () => {
    const dir = await repo()
    await write(dir, 'a.txt', 'linha um\nMEXIDO PELO USUARIO\n')

    const snap = await captureBase(dir)

    expect(snap?.base).toMatch(/^[0-9a-f]{40}$/)
    // `git stash create` writes a commit object and touches nothing else. If it
    // ever did, this would be running against a repo the user has work in.
    const status = await realGit(dir, ['status', '--porcelain'])
    expect(status.stdout).toContain('M a.txt')
    const stashes = await realGit(dir, ['stash', 'list'])
    expect(stashes.stdout.trim()).toBe('')
  })

  it('falls back to HEAD on a clean tree, where stash create says nothing', async () => {
    const dir = await repo()

    const snap = await captureBase(dir)
    const head = await realGit(dir, ['rev-parse', 'HEAD'])

    expect(snap?.base).toBe(head.stdout.trim())
  })

  it('records what was already untracked, which is not the agent’s doing', async () => {
    const dir = await repo()
    await write(dir, 'rascunho.txt', 'do usuário')

    expect((await captureBase(dir))?.untrackedBefore).toEqual(['rascunho.txt'])
  })

  it('says no rather than throwing when the folder is not a repo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sagyou-nogit-'))
    made.push(dir)

    // A legitimate state: the agent still runs, there is just no diff.
    expect(await captureBase(dir)).toBeNull()
  })

  it('says no for a repo with no commits yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sagyou-empty-'))
    made.push(dir)
    await realGit(dir, ['init', '-q'])

    // Nothing to diff against: HEAD doesn't resolve.
    expect(await captureBase(dir)).toBeNull()
  })
})

describe('diffSince', () => {
  let dir: string
  beforeEach(async () => {
    dir = await repo()
  })

  it('shows the agent’s work and NOT the user’s, when both touched a file', async () => {
    // The reason the base is captured up front. The user was mid-edit when the
    // agent started; their line must appear as context, never as a change an AI
    // made to their code.
    await write(dir, 'a.txt', 'linha um\nMEXIDO PELO USUARIO\n')
    const snap = (await captureBase(dir))!

    await write(dir, 'a.txt', 'linha um\nMEXIDO PELO USUARIO\nADICIONADO PELO AGENTE\n')
    const res = await diffSince(snap)

    expect(res.patch).toContain('+ADICIONADO PELO AGENTE')
    expect(res.patch).not.toContain('+MEXIDO PELO USUARIO')
    expect(res.patch).toContain(' MEXIDO PELO USUARIO') // context
    expect(res.files).toEqual([{ path: 'a.txt', added: 1, removed: 0 }])
  })

  it('sees changes that were committed, not only uncommitted ones', async () => {
    const snap = (await captureBase(dir))!

    await write(dir, 'a.txt', 'linha um\nlinha dois\nDO AGENTE\n')
    await realGit(dir, ['add', '-A'])
    await realGit(dir, ['commit', '-qm', 'agente'])

    // A diff from a base commit to the working tree spans commits and dirt
    // alike, so one query covers either case.
    expect((await diffSince(snap)).patch).toContain('+DO AGENTE')
  })

  it('sees changes the agent left uncommitted — which is what codex exec does', async () => {
    const snap = (await captureBase(dir))!
    await write(dir, 'a.txt', 'linha um\nlinha dois\nSEM COMMIT\n')

    expect((await diffSince(snap)).patch).toContain('+SEM COMMIT')
  })

  it('shows a new file the agent left untracked, which git diff cannot see', async () => {
    const snap = (await captureBase(dir))!
    await write(dir, 'novo.ts', 'export const novo = 1\n')

    const res = await diffSince(snap)

    // Invisible to `git diff` — and the most interesting thing the agent did.
    expect(res.patch).toContain('novo.ts')
    expect(res.patch).toContain('+export const novo = 1')
    expect(res.files.some((f) => f.path === 'novo.ts')).toBe(true)
  })

  it('leaves the user’s own untracked files out of it', async () => {
    await write(dir, 'meu-rascunho.txt', 'anotações minhas')
    const snap = (await captureBase(dir))!
    await write(dir, 'do-agente.txt', 'gerado')

    const res = await diffSince(snap)

    expect(res.patch).toContain('do-agente.txt')
    expect(res.patch).not.toContain('meu-rascunho.txt')
  })

  it('reports nothing when the agent changed nothing', async () => {
    const snap = (await captureBase(dir))!

    const res = await diffSince(snap)

    // An empty diff is an answer ("it did nothing"), not a failure.
    expect(res.patch).toBe('')
    expect(res.files).toEqual([])
    expect(res.error).toBeUndefined()
  })

  it('counts additions and removals per file', async () => {
    const snap = (await captureBase(dir))!
    await write(dir, 'a.txt', 'linha um trocada\n')

    const res = await diffSince(snap)

    expect(res.files).toEqual([{ path: 'a.txt', added: 1, removed: 2 }])
  })

  it('survives a deleted file', async () => {
    const snap = (await captureBase(dir))!
    await rm(join(dir, 'a.txt'))

    const res = await diffSince(snap)

    expect(res.patch).toContain('-linha um')
    expect(res.files).toEqual([{ path: 'a.txt', added: 0, removed: 2 }])
  })

  it('does not choke on a binary file', async () => {
    const snap = (await captureBase(dir))!
    await writeFile(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 0, 3]))

    const res = await diffSince(snap)

    // numstat prints '-' for binary; 0/0 reads as "no lines", not NaN.
    const bin = res.files.find((f) => f.path === 'bin.dat')
    expect(bin).toMatchObject({ added: expect.any(Number), removed: expect.any(Number) })
    expect(Number.isNaN(bin?.added)).toBe(false)
  })

  it('finds a change made deep in the tree', async () => {
    await mkdir(join(dir, 'src', 'nested'), { recursive: true })
    await write(dir, join('src', 'nested', 'x.ts'), 'const x = 1\n')
    await realGit(dir, ['add', '-A'])
    await realGit(dir, ['commit', '-qm', 'nested'])
    const snap = (await captureBase(dir))!

    await write(dir, join('src', 'nested', 'x.ts'), 'const x = 2\n')

    expect((await diffSince(snap)).patch).toContain('+const x = 2')
  })

  it('caps a huge diff instead of shipping megabytes to the renderer', async () => {
    const snap = (await captureBase(dir))!
    await write(dir, 'a.txt', 'x'.repeat(MAX_DIFF_CHARS * 2) + '\n')

    const res = await diffSince(snap)

    expect(res.patch.length).toBeLessThanOrEqual(MAX_DIFF_CHARS)
    expect(res.truncated).toBe(true)
  })

  it('lists the new files it did not have room to show', async () => {
    const snap = (await captureBase(dir))!
    for (let i = 0; i < MAX_NEW_FILES + 5; i++) await write(dir, `n${i}.txt`, `conteúdo ${i}\n`)

    const res = await diffSince(snap)

    // Named rather than silently dropped: "and 5 more" is information.
    expect(res.omittedNewFiles).toHaveLength(5)
  })

  it('reports a git failure instead of pretending there were no changes', async () => {
    const snap = (await captureBase(dir))!
    // The base is gone (garbage-collected, or the repo was rewritten).
    const broken = { ...snap, base: '0000000000000000000000000000000000000000' }

    const res = await diffSince(broken)

    // An empty patch with no error would read as "the agent changed nothing".
    expect(res.error).toBeTruthy()
    expect(res.patch).toBe('')
  })

  it('never runs git through a shell', async () => {
    // `dir` is a path the user picked and the args carry filenames; a shell
    // would make a file named `; rm -rf ~` into someone else's command.
    const calls: string[][] = []
    const spy: GitRunner = async (_d, args) => {
      calls.push(args)
      return { code: 0, stdout: '', stderr: '' }
    }
    await diffSince({ dir, base: 'HEAD', untrackedBefore: [] }, spy)

    // Args arrive as a list, never spliced into one string.
    expect(calls.every((a) => Array.isArray(a))).toBe(true)
    expect(calls.flat().join(' ')).not.toContain('&&')
  })
})

describe('lineDiff — the approval-card write diff', () => {
  it('marks changed lines add/del and keeps surrounding context', () => {
    const { lines, skipped } = lineDiff('a\nb\nc', 'a\nB\nc')
    expect(skipped).toBe(false)
    const dels = lines.filter((l) => l.kind === 'del').map((l) => l.text)
    const adds = lines.filter((l) => l.kind === 'add').map((l) => l.text)
    expect(dels).toContain('b')
    expect(adds).toContain('B')
    // Unchanged neighbours are shown as context.
    expect(lines.some((l) => l.kind === 'ctx' && l.text === 'a')).toBe(true)
  })

  it('renders a brand-new file (empty old) as all additions', () => {
    const { lines } = lineDiff('', 'x\ny')
    expect(lines.every((l) => l.kind === 'add')).toBe(true)
    expect(lines.map((l) => l.text)).toEqual(['x', 'y'])
  })

  it('collapses long unchanged runs to a marker so the change stays visible', () => {
    const big = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n')
    const changed = big + '\nEXTRA'
    const { lines } = lineDiff(big, changed)
    expect(lines.some((l) => l.kind === 'meta' && /inalterada/.test(l.text))).toBe(true)
    expect(lines.some((l) => l.kind === 'add' && l.text === 'EXTRA')).toBe(true)
    // The 100 context lines did not survive verbatim.
    expect(lines.length).toBeLessThan(50)
  })

  it('skips the diff when a side is too large to review', () => {
    const huge = Array.from({ length: MAX_DIFFABLE_LINES + 1 }, (_, i) => `l${i}`).join('\n')
    const { skipped, lines } = lineDiff('a', huge)
    expect(skipped).toBe(true)
    expect(lines).toEqual([])
  })

  it('truncates a diff longer than the cap', () => {
    // Two disjoint files → every line is add or del, none collapsible.
    const oldT = Array.from({ length: MAX_APPROVAL_DIFF_LINES }, (_, i) => `old${i}`).join('\n')
    const newT = Array.from({ length: MAX_APPROVAL_DIFF_LINES }, (_, i) => `new${i}`).join('\n')
    const { lines, truncated } = lineDiff(oldT, newT)
    expect(truncated).toBe(true)
    expect(lines.length).toBe(MAX_APPROVAL_DIFF_LINES)
  })
})
