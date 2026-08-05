// @vitest-environment node

import { describe, it, expect } from 'vitest'
import {
  diffFileCount,
  isRunId,
  normalizeRuns,
  pruneRuns,
  runsForConv,
  sortRuns,
  taskLabel,
  type AgentRunMeta
} from '../agent-runs'

const NOW = Date.now()

const run = (over: Partial<AgentRunMeta> = {}): AgentRunMeta => ({
  id: '00000000-0000-4000-8000-000000000000',
  convId: 'c1',
  agent: 'codex',
  dir: '/repo',
  task: 'faz algo',
  startedAt: NOW - 1000,
  endedAt: NOW - 500,
  exitCode: 0,
  fileCount: 1,
  ...over
})

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('isRunId', () => {
  it('accepts a uuid', () => {
    expect(isRunId(uuid(1))).toBe(true)
  })

  // The id comes back from the renderer to read a file, so it is a path in
  // disguise. These are the shapes that must never resolve to anything.
  it.each([
    '../../ai-config.json',
    '../ai-conversations.json',
    `${uuid(1)}/../../etc/passwd`,
    `${uuid(1)}.json`,
    '',
    'index',
    null,
    undefined,
    42,
    {}
  ])('rejects %p', (bad) => {
    expect(isRunId(bad)).toBe(false)
  })
})

describe('taskLabel', () => {
  it('collapses whitespace', () => {
    expect(taskLabel('  faz\n\n  algo  ')).toBe('faz algo')
  })

  it('truncates a long task', () => {
    const label = taskLabel('x'.repeat(500))
    expect(label.length).toBeLessThanOrEqual(201)
    expect(label.endsWith('…')).toBe(true)
  })

  it('takes a non-string as empty', () => {
    expect(taskLabel(undefined)).toBe('')
    expect(taskLabel(null)).toBe('')
  })
})

describe('normalizeRuns', () => {
  it('drops rows with no usable id — they could never be opened', () => {
    const out = normalizeRuns([run(), { ...run(), id: 'nope' }, null, 'x'])
    expect(out).toHaveLength(1)
  })

  // The agent field is now the model that ran (native agent) — preserved as-is.
  it('preserves the stored agent/model name', () => {
    const [r] = normalizeRuns([{ id: uuid(1), agent: 'gpt-4o' }])
    expect(r.agent).toBe('gpt-4o')
  })

  it('falls back to "codex" for a row with no agent (old external-agent runs)', () => {
    const [r] = normalizeRuns([{ id: uuid(1) }])
    expect(r.agent).toBe('codex')
  })

  it('takes a non-array as empty', () => {
    expect(normalizeRuns(null)).toEqual([])
    expect(normalizeRuns({ id: uuid(1) })).toEqual([])
  })

  it('defaults a hand-edited file back to something renderable', () => {
    const [r] = normalizeRuns([{ id: uuid(1), agent: 'wat', startedAt: 'x', fileCount: null }])
    expect(r.agent).toBe('wat')
    expect(r.startedAt).toBe(0)
    expect(r.fileCount).toBe(0)
    expect(r.convId).toBeNull()
  })

  it('keeps a recognized worktree delivery state', () => {
    const [out] = normalizeRuns([{ id: uuid(1), delivery: 'merge_failed' }])
    expect(out.delivery).toBe('merge_failed')
  })

  it('carries a valid tokens object through', () => {
    const [r] = normalizeRuns([
      { id: uuid(1), tokens: { promptTokens: 1200, completionTokens: 300 } }
    ])
    expect(r.tokens).toEqual({ promptTokens: 1200, completionTokens: 300 })
  })

  it('drops tokens that are absent or malformed (old rows / hand-edits)', () => {
    expect(normalizeRuns([{ id: uuid(1) }])[0].tokens).toBeUndefined()
    expect(normalizeRuns([{ id: uuid(1), tokens: 'x' }])[0].tokens).toBeUndefined()
    expect(
      normalizeRuns([{ id: uuid(1), tokens: { promptTokens: 'oops' } }])[0].tokens
    ).toBeUndefined()
  })
})

describe('sortRuns', () => {
  it('puts the newest first', () => {
    const out = sortRuns([
      run({ id: uuid(1), startedAt: 100 }),
      run({ id: uuid(2), startedAt: 300 }),
      run({ id: uuid(3), startedAt: 200 })
    ])
    expect(out.map((r) => r.startedAt)).toEqual([300, 200, 100])
  })
})

describe('runsForConv', () => {
  it('returns only that conversation, newest first', () => {
    const runs = [
      run({ id: uuid(1), convId: 'a', startedAt: 100 }),
      run({ id: uuid(2), convId: 'b', startedAt: 200 }),
      run({ id: uuid(3), convId: 'a', startedAt: 300 })
    ]
    expect(runsForConv(runs, 'a').map((r) => r.id)).toEqual([uuid(3), uuid(1)])
  })

  it('never matches a run with no conversation', () => {
    expect(runsForConv([run({ convId: null })], '')).toEqual([])
    expect(runsForConv([run({ convId: null })], null)).toEqual([])
  })
})

describe('pruneRuns', () => {
  it('keeps the newest per conversation and drops the rest', () => {
    const runs = Array.from({ length: 5 }, (_, i) =>
      run({ id: uuid(i), convId: 'a', startedAt: i })
    )
    const { keep, drop } = pruneRuns(runs, 3, 100)
    expect(keep.map((r) => r.startedAt)).toEqual([4, 3, 2])
    expect(drop.map((r) => r.startedAt)).toEqual([1, 0])
  })

  // The per-conversation cap is what stops one chatty project evicting every
  // other chat's history — a purely global cap would.
  it('budgets each conversation separately', () => {
    const runs = [
      ...Array.from({ length: 5 }, (_, i) => run({ id: uuid(i), convId: 'a', startedAt: i })),
      run({ id: uuid(90), convId: 'b', startedAt: 1 })
    ]
    const { keep } = pruneRuns(runs, 2, 100)
    expect(keep.filter((r) => r.convId === 'a')).toHaveLength(2)
    expect(keep.filter((r) => r.convId === 'b')).toHaveLength(1)
  })

  it('applies the global backstop across conversations', () => {
    const runs = Array.from({ length: 6 }, (_, i) =>
      run({ id: uuid(i), convId: `c${i}`, startedAt: i })
    )
    const { keep, drop } = pruneRuns(runs, 20, 4)
    expect(keep).toHaveLength(4)
    expect(drop).toHaveLength(2)
    // The ones dropped are the oldest, not an arbitrary four.
    expect(drop.map((r) => r.startedAt).sort()).toEqual([0, 1])
  })

  // Every dropped row must be handed back: the caller unlinks those payloads,
  // and an index that forgets a run without deleting its file leaks disk.
  it('accounts for every run exactly once', () => {
    const runs = Array.from({ length: 9 }, (_, i) =>
      run({ id: uuid(i), convId: i % 2 ? 'a' : 'b', startedAt: i })
    )
    const { keep, drop } = pruneRuns(runs, 2, 3)
    expect([...keep, ...drop].map((r) => r.id).sort()).toEqual(runs.map((r) => r.id).sort())
  })
})

describe('diffFileCount', () => {
  it('counts a real diff', () => {
    expect(diffFileCount({ files: [{ path: 'a' }, { path: 'b' }] })).toBe(2)
  })

  // A run in a non-git folder archives a null diff; that is a legitimate state,
  // not a reason to throw while writing the index.
  it('takes anything else as zero', () => {
    expect(diffFileCount(null)).toBe(0)
    expect(diffFileCount(undefined)).toBe(0)
    expect(diffFileCount({})).toBe(0)
    expect(diffFileCount({ files: 'no' })).toBe(0)
  })
})
