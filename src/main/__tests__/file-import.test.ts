/**
 * Main-process code: runs in Node, not the suite's default jsdom.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createFileImportRegistry, FILE_IMPORT_LIMIT } from '../modules/files/file-import'

let root: string
let source: string
let filesDir: string
let clock: number
const index = vi.fn(async () => {})

const make = (): ReturnType<typeof createFileImportRegistry> =>
  createFileImportRegistry({ filesDir, index, now: () => clock })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sagyou-import-'))
  source = join(root, 'source')
  filesDir = join(root, 'files')
  await mkdir(source)
  await mkdir(filesDir)
  await writeFile(join(source, 'relatorio.pdf'), 'pdf-bytes')
  await mkdir(join(source, 'pasta'))
  clock = 1_000_000
  index.mockClear()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('file import registry', () => {
  it('copies a staged file under a new id, keeping the original extension', async () => {
    const registry = make()
    const { staged, skipped } = registry.stage([join(source, 'relatorio.pdf')])
    expect(skipped).toBe(0)
    expect(staged).toEqual([{ token: expect.any(String), name: 'relatorio.pdf', size: 9 }])

    const [file] = await registry.importStaged([{ token: staged[0].token, name: 'relatorio (2).pdf' }])
    expect(file).toMatchObject({ name: 'relatorio (2).pdf', ext: '.pdf', size: 9 })
    const stored = join(filesDir, `${file.id}.pdf`)
    expect(await readFile(stored, 'utf8')).toBe('pdf-bytes')
    expect(index).toHaveBeenCalledWith(file.id, stored, '.pdf')
  })

  it('skips folders, relative and missing paths', () => {
    const { staged, skipped } = make().stage([
      join(source, 'pasta'),
      'relatorio.pdf',
      join(source, 'nao-existe.txt'),
      join(source, 'relatorio.pdf')
    ])
    expect(staged).toHaveLength(1)
    expect(skipped).toBe(3)
  })

  it('stages at most FILE_IMPORT_LIMIT paths per call', () => {
    const paths = Array.from({ length: FILE_IMPORT_LIMIT + 1 }, () => join(source, 'relatorio.pdf'))
    const { staged, overLimit } = make().stage(paths)
    expect(staged).toHaveLength(FILE_IMPORT_LIMIT)
    expect(overLimit).toBe(1)
  })

  it('ignores non-array or non-string input', () => {
    expect(make().stage('x' as unknown as string[]).staged).toEqual([])
    expect(make().stage([42 as unknown as string]).skipped).toBe(1)
  })

  it('uses a token only once', async () => {
    const registry = make()
    const { staged } = registry.stage([join(source, 'relatorio.pdf')])
    const item = { token: staged[0].token, name: 'relatorio.pdf' }
    expect(await registry.importStaged([item])).toHaveLength(1)
    expect(await registry.importStaged([item])).toHaveLength(0)
    expect(await readdir(filesDir)).toHaveLength(1)
  })

  it('ignores an expired token', async () => {
    const registry = make()
    const { staged } = registry.stage([join(source, 'relatorio.pdf')])
    clock += 10 * 60 * 1000 + 1
    expect(await registry.importStaged([{ token: staged[0].token, name: 'a.pdf' }])).toEqual([])
    expect(await readdir(filesDir)).toHaveLength(0)
  })

  it('discarded tokens cannot be imported', async () => {
    const registry = make()
    const { staged } = registry.stage([join(source, 'relatorio.pdf')])
    expect(await readdir(filesDir)).toEqual([])
    registry.discard([staged[0].token])
    expect(await registry.importStaged([{ token: staged[0].token, name: 'a.pdf' }])).toEqual([])
    expect(await readdir(filesDir)).toEqual([])
  })

  it('falls back to the original name when the chosen one is invalid', async () => {
    const registry = make()
    for (const bad of ['', '../x.pdf', 'a\\b.pdf', 'x'.repeat(256), 42]) {
      const { staged } = registry.stage([join(source, 'relatorio.pdf')])
      const [file] = await registry.importStaged([
        { token: staged[0].token, name: bad as string }
      ])
      expect(file.name).toBe('relatorio.pdf')
    }
  })
})
