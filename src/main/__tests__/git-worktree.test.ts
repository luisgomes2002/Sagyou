// @vitest-environment node

import { afterAll, describe, expect, it } from 'vitest'
import { execFile } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { addDetachedWorktree, resolveWorktreeBase } from '../git-worktree'

const execFileAsync = promisify(execFile)
const made: string[] = []

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  return stdout.trim()
}

async function newRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sagyou-worktree-'))
  made.push(dir)
  await git(dir, ['init', '-q'])
  return dir
}

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true })
})

describe('resolveWorktreeBase', () => {
  it('creates an isolated base for an initialized repository without commits', async () => {
    const dir = await newRepo()
    await writeFile(join(dir, 'index.html'), '<h1>Murasaki</h1>')

    const base = await resolveWorktreeBase(dir)
    expect(base.temporary).toBe(true)
    expect(base.revision).toMatch(/^[0-9a-f]{40}$/)
    await expect(git(dir, ['rev-parse', '--verify', 'HEAD'])).rejects.toThrow()
    expect(await git(dir, ['status', '--short'])).toContain('?? index.html')

    const worktree = join(dir, '.sagyou-wt-test')
    await addDetachedWorktree(dir, worktree, base.revision)
    expect(await readFile(join(worktree, 'index.html'), 'utf8')).toBe('<h1>Murasaki</h1>')
    await git(dir, ['worktree', 'remove', '--force', worktree])
  })

  it('uses the real HEAD when the repository already has a commit', async () => {
    const dir = await newRepo()
    await git(dir, ['config', 'user.email', 'test@example.com'])
    await git(dir, ['config', 'user.name', 'Test'])
    await writeFile(join(dir, 'a.txt'), 'base')
    await git(dir, ['add', 'a.txt'])
    await git(dir, ['commit', '-qm', 'base'])

    const head = await git(dir, ['rev-parse', 'HEAD'])
    await expect(resolveWorktreeBase(dir)).resolves.toEqual({ revision: head, temporary: false })
  })
})
