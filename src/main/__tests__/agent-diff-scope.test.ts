// @vitest-environment node

import { mkdtemp, mkdir, rm, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPatchScope, validatePatchScope } from '../agent-diff'

const made: string[] = []

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('final patch scope', () => {
  it('rejects real sibling paths and the entire mixed batch', () => {
    const result = checkPatchScope(['src/allowed.ts', 'src/sibling.ts'], ['src/allowed.ts'])

    expect(result).toEqual({ allowed: false, rejectedPaths: ['src/sibling.ts'] })
  })

  it('normalizes traversal and Windows path case without widening a sibling', () => {
    expect(checkPatchScope(['../outside.ts'], ['src/app.ts'])).toEqual({
      allowed: false,
      rejectedPaths: ['../outside.ts']
    })
    expect(checkPatchScope(['SRC\\App.ts'], ['src/app.ts'], { caseInsensitive: true })).toEqual({
      allowed: true,
      rejectedPaths: []
    })
    expect(checkPatchScope(['src-app.ts'], ['src/'], { caseInsensitive: true }).allowed).toBe(false)
  })

  it('checks both sides of a rename rather than allowing its destination alone', () => {
    const result = checkPatchScope(['private/old-name.ts', 'public/new-name.ts'], ['public/'])

    expect(result).toEqual({ allowed: false, rejectedPaths: ['private/old-name.ts'] })
  })

  it('rejects an allowed-looking path when it is a symlink', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sagyou-scope-link-'))
    made.push(dir)
    const outside = join(dir, 'outside')
    await mkdir(outside)
    await symlink(outside, join(dir, 'allowed-link'), 'junction')

    await expect(validatePatchScope(dir, ['allowed-link'], ['allowed-link'])).resolves.toEqual({
      allowed: false,
      rejectedPaths: ['allowed-link']
    })
  })
})
