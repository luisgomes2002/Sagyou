import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectHarnessModel } from '../modules/agent/harness-model'

describe('detectHarnessModel', () => {
  let home: string
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('reads the latest model from a Claude Code transcript, skipping synthetic messages', () => {
    home = mkdtempSync(join(tmpdir(), 'harness-model-'))
    const cwd = join(home, 'wt-1')
    const dir = join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 's.jsonl'),
      [
        '{"type":"assistant","message":{"model":"claude-sonnet-5-5"}}',
        '{"type":"assistant","message":{"model":"claude-opus-5-5"}}',
        '{"type":"assistant","message":{"model":"<synthetic>"}}'
      ].join('\n')
    )
    expect(detectHarnessModel('claude-code', cwd, Date.now(), home)).toBe('claude-opus-5-5')
  })

  it('matches a Codex rollout by its recorded cwd', () => {
    home = mkdtempSync(join(tmpdir(), 'harness-model-'))
    const cwd = join(home, 'wt-2')
    const now = new Date()
    const dir = join(
      home,
      '.codex',
      'sessions',
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    )
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'other.jsonl'), '{"payload":{"cwd":"/elsewhere","model":"wrong"}}')
    writeFileSync(
      join(dir, 'mine.jsonl'),
      `{"type":"session_meta","payload":{"cwd":${JSON.stringify(cwd)},"model":"gpt-5"}}`
    )
    expect(detectHarnessModel('codex', cwd, Date.now(), home)).toBe('gpt-5')
  })

  it('returns null for harnesses without a readable transcript', () => {
    home = mkdtempSync(join(tmpdir(), 'harness-model-'))
    expect(detectHarnessModel('opencode', home, Date.now(), home)).toBeNull()
    expect(detectHarnessModel('claude-code', join(home, 'none'), Date.now(), home)).toBeNull()
  })
})
