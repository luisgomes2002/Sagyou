// The core also runs on the phone (Hermes). The ESLint block for
// packages/core/src forbids Node, Electron and UI imports and the Buffer/process
// globals; this test runs it so a slip fails CI, not the phone build.
import { join } from 'path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const repo = join(__dirname, '..', '..', '..', '..')

describe('packages/core sem Node', () => {
  it('não importa módulos do Node, Electron ou React e não usa Buffer', async () => {
    const eslint = new ESLint({ cwd: repo })
    const results = await eslint.lintFiles(['packages/core/src/**/*.ts'])
    const violations = results.flatMap((r) =>
      r.messages
        .filter((m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-globals')
        .map((m) => `${r.filePath}:${m.line} ${m.message}`)
    )
    expect(results.length).toBeGreaterThan(10)
    expect(violations).toEqual([])
  }, 60000)
})
