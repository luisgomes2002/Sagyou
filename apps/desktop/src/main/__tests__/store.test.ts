// @vitest-environment node
//
// loadData() used to fire one child query per parent (N+1) — hundreds of
// round-trips to SQLite on a real board. It now reads each child table once and
// buckets rows by parent id with groupByKey, then attaches with `.get(id) ?? []`.
//
// The whole risk of that refactor lives in groupByKey: a child must land under
// the RIGHT parent and nowhere else, and rows read in order (e.g. columns by
// `ord`) must stay ordered inside their bucket. That is what this test pins.
//
// The full DB round-trip can't be exercised here: better-sqlite3 is a native
// module built against Electron's Node ABI, which vitest's plain Node refuses to
// load — the same reason the suite has no other store test and handlers.test.ts
// drives an HTTP server instead of the DB. groupByKey is pure, so it needs none
// of that. store.ts still touches app.getPath at import, hence the electron mock.
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

const { groupByKey, diffEntities } = await import('../store')

// A fake statement + writer that record what a real save would do, so the diff
// logic can be exercised without better-sqlite3 (which won't load under vitest's
// Node ABI). The whole point of the granular save is that a tiny change touches
// almost nothing — that's what these assertions pin.
function recorder(): {
  del: { run: (id: string) => void; ids: string[] }
  written: string[]
  write: (e: { id: string }) => void
} {
  const delIds: string[] = []
  const written: string[] = []
  return {
    del: { run: (id: string) => { delIds.push(id) }, ids: delIds },
    written,
    write: (e) => { written.push(e.id) }
  }
}

describe('groupByKey', () => {
  it('buckets rows by the given key', () => {
    const rows = [
      { task_id: 'a', tag: 'x' },
      { task_id: 'b', tag: 'y' },
      { task_id: 'a', tag: 'z' }
    ]
    const m = groupByKey(rows, 'task_id')
    expect(m.get('a')?.map((r) => r.tag)).toEqual(['x', 'z'])
    expect(m.get('b')?.map((r) => r.tag)).toEqual(['y'])
  })

  it('preserves row order within a bucket (so ORDER BY survives grouping)', () => {
    // Columns arrive already sorted by `ord`; grouping must not reshuffle them.
    const rows = [
      { project_id: 'p', ord: 0, id: 'c1' },
      { project_id: 'q', ord: 0, id: 'c2' },
      { project_id: 'p', ord: 1, id: 'c3' },
      { project_id: 'p', ord: 2, id: 'c4' }
    ]
    expect(groupByKey(rows, 'project_id').get('p')?.map((r) => r.id)).toEqual(['c1', 'c3', 'c4'])
  })

  it('does not leak one parent\'s rows into another', () => {
    const rows = [
      { table_id: 'ft1', id: 'tx1' },
      { table_id: 'ft2', id: 'tx2' },
      { table_id: 'ft1', id: 'tx3' }
    ]
    const m = groupByKey(rows, 'table_id')
    expect(m.get('ft1')?.map((r) => r.id)).toEqual(['tx1', 'tx3'])
    expect(m.get('ft2')?.map((r) => r.id)).toEqual(['tx2'])
  })

  it('returns undefined for a parent with no children, so `?? []` handles it', () => {
    const m = groupByKey([{ goal_id: 'g1', id: 'e1' }], 'goal_id')
    expect(m.get('g2')).toBeUndefined()
    expect(m.get('g2') ?? []).toEqual([])
  })

  it('handles an empty table', () => {
    expect(groupByKey([], 'task_id').size).toBe(0)
  })
})

describe('diffEntities', () => {
  it('skips entities that did not change (the whole point — no flush on a rename elsewhere)', () => {
    const rows = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]
    // Same content, fresh objects (as a new IPC payload would be).
    const next = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]
    const r = recorder()
    diffEntities(rows, next, r.del, r.write)
    expect(r.written).toEqual([])
    expect(r.del.ids).toEqual([])
  })

  it('rewrites a changed entity: delete old (children cascade) then write', () => {
    const r = recorder()
    diffEntities([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }], r.del, r.write)
    expect(r.del.ids).toEqual(['a'])
    expect(r.written).toEqual(['a'])
  })

  it('writes a new entity without a pointless delete first', () => {
    const r = recorder()
    diffEntities([{ id: 'a', v: 1 }], [{ id: 'a', v: 1 }, { id: 'b', v: 9 }], r.del, r.write)
    expect(r.written).toEqual(['b'])
    expect(r.del.ids).toEqual([]) // 'a' unchanged, 'b' is new — nothing deleted
  })

  it('deletes an entity that is gone from the new state', () => {
    const r = recorder()
    diffEntities([{ id: 'a', v: 1 }, { id: 'b', v: 2 }], [{ id: 'a', v: 1 }], r.del, r.write)
    expect(r.del.ids).toEqual(['b'])
    expect(r.written).toEqual([])
  })

  it('touches only the one dirty entity among many (rename → 1 write)', () => {
    const prev = Array.from({ length: 100 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}` }))
    const next = prev.map((t) => (t.id === 't42' ? { ...t, title: 'Renamed' } : t))
    const r = recorder()
    diffEntities(prev, next, r.del, r.write)
    expect(r.written).toEqual(['t42'])
    expect(r.del.ids).toEqual(['t42'])
  })

  it('treats undefined collections as empty', () => {
    const r = recorder()
    diffEntities(undefined, undefined, r.del, r.write)
    expect(r.written).toEqual([])
    expect(r.del.ids).toEqual([])
  })
})
