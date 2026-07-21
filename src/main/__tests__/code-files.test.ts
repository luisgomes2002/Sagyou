/**
 * Main-process code: runs in Node, not the suite's default jsdom.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { confineToRoot, walkFiles, detectSymbols, extractSymbol, extractLines } from '../code-files'

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sagyou-walk-'))
  await mkdir(join(root, 'src', 'nested'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(join(root, '.git'), { recursive: true })
  await mkdir(join(root, '.hidden'), { recursive: true })
  await writeFile(join(root, 'top.ts'), 'a')
  await writeFile(join(root, 'src', 'a.ts'), 'a')
  await writeFile(join(root, 'src', 'nested', 'b.ts'), 'b')
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'x')
  await writeFile(join(root, '.git', 'config'), 'x')
  await writeFile(join(root, '.hidden', 'secret.txt'), 'x')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('confineToRoot', () => {
  it('resolves a path inside the root', () => {
    expect(confineToRoot('/project', 'src/a.ts')).toBe(resolve('/project/src/a.ts'))
  })

  it('allows the root itself', () => {
    expect(confineToRoot('/project', '.')).toBe(resolve('/project'))
  })

  it('refuses to climb out', () => {
    // The only thing between the assistant and the rest of the disk.
    expect(confineToRoot('/project', '../secrets')).toBeNull()
    expect(confineToRoot('/project', '../../etc/passwd')).toBeNull()
    expect(confineToRoot('/project', 'src/../../outside')).toBeNull()
  })

  it('refuses an absolute path elsewhere', () => {
    expect(confineToRoot('/project', '/etc/passwd')).toBeNull()
  })

  it('does not mistake a sibling with the same prefix for a child', () => {
    // "/project-evil" starts with "/project" as a string but is not inside it.
    expect(confineToRoot('/project', `..${sep}project-evil${sep}x`)).toBeNull()
  })
})

describe('walkFiles', () => {
  it('lists files relative to the root, sorted', async () => {
    const { files } = await walkFiles(root, '.', 100)
    expect(files).toEqual(['src/a.ts', 'src/nested/b.ts', 'top.ts'])
  })

  it('skips node_modules, .git and dot-directories', async () => {
    const { files } = await walkFiles(root, '.', 100)
    // Walking node_modules is what made this slow; dot-dirs hold credentials.
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
    expect(files.some((f) => f.includes('.git'))).toBe(false)
    expect(files.some((f) => f.includes('.hidden'))).toBe(false)
  })

  it('walks a subdirectory only', async () => {
    const { files } = await walkFiles(root, 'src', 100)
    expect(files).toEqual(['src/a.ts', 'src/nested/b.ts'])
  })

  it('reports truncation when the cap bites', async () => {
    const { files, truncated } = await walkFiles(root, '.', 2)
    expect(files).toHaveLength(2)
    expect(truncated).toBe(true)
  })

  it('does not claim truncation when everything fit', async () => {
    const { truncated } = await walkFiles(root, '.', 100)
    expect(truncated).toBe(false)
  })

  it('returns nothing for a path outside the root', async () => {
    const { files } = await walkFiles(root, '../..', 100)
    expect(files).toEqual([])
  })

  it('returns nothing for a missing directory instead of throwing', async () => {
    await expect(walkFiles(root, 'nope', 100)).resolves.toEqual({ files: [], truncated: false })
  })

  it('yields to the event loop instead of blocking it', async () => {
    // The whole point of the ticket: a timer queued before the walk must get to
    // run while it is still going. A sync walk would starve it until it ended.
    let ticked = false
    const walk = walkFiles(root, '.', 100)
    const timer = new Promise<void>((r) => setImmediate(() => ((ticked = true), r())))
    await Promise.race([walk, timer])
    expect(ticked).toBe(true)
    await walk
  })
})

// Sample module used across the scoped-reading tests below.
const SAMPLE = [
  "import x from 'y'", // 1
  '', // 2
  'export function exportBackup(data: string) {', // 3
  '  const out = serialize(data)', // 4
  '  return out', // 5
  '}', // 6
  '', // 7
  'const PI = 3.14', // 8
  '', // 9
  'export class Store {', // 10
  '  save() {', // 11
  '    return true', // 12
  '  }', // 13
  '}', // 14
  '', // 15
  'type Money = string' // 16
].join('\n')

describe('detectSymbols', () => {
  it('maps top-level and exported declarations to their line and kind', () => {
    expect(detectSymbols(SAMPLE)).toEqual([
      { nome: 'exportBackup', linha: 3, tipo: 'function' },
      { nome: 'PI', linha: 8, tipo: 'const' },
      { nome: 'Store', linha: 10, tipo: 'class' },
      { nome: 'Money', linha: 16, tipo: 'type' }
    ])
  })

  it('honours the cap so a huge file cannot flood the map', () => {
    const big = Array.from({ length: 50 }, (_, i) => `const v${i} = ${i}`).join('\n')
    expect(detectSymbols(big, 10)).toHaveLength(10)
  })
})

describe('extractSymbol', () => {
  it('returns a function body via brace matching, with 1-based bounds', () => {
    const r = extractSymbol(SAMPLE, 'exportBackup')
    expect(r).toEqual({
      content: 'export function exportBackup(data: string) {\n  const out = serialize(data)\n  return out\n}',
      linhaInicio: 3,
      linhaFim: 6
    })
  })

  it('returns a class including its methods', () => {
    const r = extractSymbol(SAMPLE, 'Store')
    expect(r?.linhaInicio).toBe(10)
    expect(r?.linhaFim).toBe(14)
  })

  it('ends a block-less statement at the semicolon', () => {
    const r = extractSymbol('const PI = 3.14;\nconst E = 2.7;', 'PI')
    expect(r).toEqual({ content: 'const PI = 3.14;', linhaInicio: 1, linhaFim: 1 })
  })

  it('returns null when the name is not a declaration', () => {
    // A bare call site must not match — only declaration-looking lines do.
    expect(extractSymbol('foo()\nbar()', 'foo')).toBeNull()
    expect(extractSymbol(SAMPLE, 'inexistente')).toBeNull()
  })
})

describe('extractLines', () => {
  it('returns an inclusive 1-based range', () => {
    expect(extractLines(SAMPLE, 3, 6)).toEqual({
      content: 'export function exportBackup(data: string) {\n  const out = serialize(data)\n  return out\n}',
      linhaInicio: 3,
      linhaFim: 6
    })
  })

  it('defaults the start to line 1 and the end to the last line', () => {
    expect(extractLines('a\nb\nc', undefined, 2)).toMatchObject({ linhaInicio: 1, linhaFim: 2 })
    expect(extractLines('a\nb\nc', 2).content).toBe('b\nc')
  })

  it('clamps out-of-range bounds instead of returning empty', () => {
    const r = extractLines('a\nb\nc', 2, 999)
    expect(r).toEqual({ content: 'b\nc', linhaInicio: 2, linhaFim: 3 })
  })
})
