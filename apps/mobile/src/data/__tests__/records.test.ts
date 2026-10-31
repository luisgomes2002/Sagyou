import type { WireRecord } from '@sagyou/core/sync/batch'
import { extractDataRecords } from '@sagyou/core/sync/records'
import { replaceSyncableState } from '@sagyou/core/sync/replace'
import { createRecordRepo } from '../records'
import { SCHEMA_VERSION, migrate } from '../schema'
import { emptyState, type MobileState } from '../state'
import { openNodeDb } from './node-db'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const vectors = require('../../../../../packages/core/src/__tests__/fixtures/sync-vectors.json')

const T = '2026-10-30T12:00:00.000Z'
const NOW = Date.parse('2026-10-31T12:00:00.000Z')

function setup() {
  const db = openNodeDb()
  migrate(db)
  return { db, repo: createRecordRepo(db) }
}

function withTask(): MobileState {
  const state = emptyState()
  state.projects = [
    {
      id: 'p1',
      name: 'Sagyou',
      color: '#000',
      order: 0,
      createdAt: T,
      updatedAt: T,
      columns: [
        { id: 'c1', name: 'A fazer', order: 0 },
        { id: 'c2', name: 'Done', order: 1 }
      ]
    } as unknown as MobileState['projects'][number]
  ]
  state.tasks = [
    {
      id: 't1',
      projectId: 'p1',
      columnId: 'c2',
      title: 'Antes',
      priority: 'medium',
      tags: ['a'],
      order: 0,
      createdAt: T,
      updatedAt: T,
      completedAt: T,
      timeSpent: 3600,
      images: [{ id: 'img1', name: 'print.png', ext: '.png', size: 10, addedAt: T }]
    } as unknown as MobileState['tasks'][number]
  ]
  return state
}

const versions = (db: ReturnType<typeof openNodeDb>) =>
  db.all<{ kind: string; id: string; deleted: number }>(
    'SELECT kind, id, deleted FROM sync_records ORDER BY seq'
  )

describe('banco do celular', () => {
  it('migra de user_version 0 para a versão atual uma vez só', () => {
    const db = openNodeDb()
    migrate(db)
    expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(
      SCHEMA_VERSION
    )
    expect(() => migrate(db)).not.toThrow()
    expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(1)
  })

  it('editar só o título preserva imagens, tempo e conclusão no payload', () => {
    const { db, repo } = setup()
    repo.save(withTask(), NOW)
    const loaded = repo.loadState()
    loaded.tasks[0] = { ...loaded.tasks[0], title: 'Depois' }
    expect(repo.save(loaded, NOW + 1000)).toBe(1)
    const payload = JSON.parse(
      db.get<{ payload: string }>("SELECT payload FROM records WHERE kind='task' AND id='t1'")!
        .payload
    )
    expect(payload).toMatchObject({ title: 'Depois', timeSpent: 3600, completedAt: T })
    expect(payload.images).toEqual([
      { id: 'img1', name: 'print.png', ext: '.png', size: 10, addedAt: T }
    ])
  })

  it('salvar sem mudança não gera versão', () => {
    const { repo } = setup()
    repo.save(withTask(), NOW)
    expect(repo.save(repo.loadState(), NOW + 1000)).toBe(0)
  })

  it('excluir uma tarefa gera um tombstone', () => {
    const { db, repo } = setup()
    repo.save(withTask(), NOW)
    const state = repo.loadState()
    state.tasks = []
    expect(repo.save(state, NOW + 1000)).toBe(1)
    expect(versions(db).find((v) => v.kind === 'task')).toEqual({
      kind: 'task',
      id: 't1',
      deleted: 1
    })
    expect(db.get("SELECT 1 FROM records WHERE kind='task'")).toBeUndefined()
  })

  it('payloads recebidos (todos os tipos dos vetores) não geram versão ao carregar e salvar', () => {
    const { repo } = setup()
    // What a desktop really sends. The vector's time block was written by hand
    // without `order` and `type`; a desktop always has both (time_blocks.ord and
    // .type are NOT NULL), so its payload always carries order.
    const realistic = vectors.dataRecords.map(
      (r: { kind: WireRecord['kind']; id: string; payload: Record<string, unknown> }) =>
        r.kind === 'time_block' ? { ...r, payload: { ...r.payload, type: 'focus', order: 0 } } : r
    )
    const wire: WireRecord[] = realistic.map(
      (r: { kind: WireRecord['kind']; id: string; payload: Record<string, unknown> }) => ({
        kind: r.kind,
        id: r.id,
        hlc: '',
        baseHlc: null,
        deleted: false,
        payload: r.payload
      })
    )
    const expected = new Map<string, string>(
      extractDataRecords(replaceSyncableState(emptyState(), wire)).map((r) => [
        `${r.kind}:${r.id}`,
        r.hash
      ])
    )
    // Every kind round-trips: the payload stored is the payload received.
    for (const r of realistic) {
      const original = vectors.dataRecords.find(
        (v: { kind: string; id: string }) => v.kind === r.kind && v.id === r.id
      )
      if (r.kind !== 'time_block') expect(expected.get(`${r.kind}:${r.id}`)).toBe(original.hash)
    }
    // A received apply writes the payloads without minting versions.
    repo.persist(replaceSyncableState(emptyState(), wire))
    const stored = repo.currentRecords()
    for (const [key, hash] of expected) expect(stored.get(key)?.hash).toBe(hash)
    const reloaded = repo.loadState()
    expect(
      extractDataRecords(reloaded)
        .map((r) => r.hash)
        .sort()
    ).toEqual([...expected.values()].sort())
    // Only the received versions are missing from sync_records here, so the
    // capture must see the content as unchanged once they exist.
    repo.save(reloaded, NOW)
    expect(repo.save(repo.loadState(), NOW + 1000)).toBe(0)
  })

  it('uma memória recebida fica em records e não entra no estado', () => {
    const { repo } = setup()
    repo.writeMemory({
      kind: 'memory',
      id: 'm1',
      hlc: 'h',
      baseHlc: null,
      deleted: false,
      payload: vectors.memoryRecords[0].payload
    })
    expect(repo.memoryPayload('m1')).toEqual(vectors.memoryRecords[0].payload)
    expect(
      Object.values(repo.loadState()).every((list) => !JSON.stringify(list).includes('m1'))
    ).toBe(true)
  })

  it('cria o id do aparelho uma vez e o mantém', () => {
    const { repo, db } = setup()
    const id = repo.deviceId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(createRecordRepo(db).deviceId()).toBe(id)
  })
})
