// @vitest-environment node
//
// Per-record conflict rule. A received version conflicts when its sender did
// not see this device's current version; then the newer HLC wins and the loser
// is kept. Debts never resolve on their own, and a child whose parent is
// missing waits, or becomes a conflict when the parent was deleted.
import { describe, expect, it } from 'vitest'
import type { WireRecord } from '../modules/sync/sync-batch'
import { decideIncoming, parentOf, type LocalVersion } from '../modules/sync/sync-merge'
import { hashPayload } from '../modules/sync/sync-records'

const OLD = '000000000001000-0000-a'
const MID = '000000000002000-0000-a'
const NEW = '000000000003000-0000-b'

function incoming(over: Partial<WireRecord> = {}): WireRecord {
  return {
    kind: 'task',
    id: 't1',
    hlc: NEW,
    baseHlc: MID,
    deleted: false,
    payload: { id: 't1', projectId: 'p1', columnId: 'c1', title: 'Remota' },
    ...over
  }
}

function local(over: Partial<LocalVersion> = {}): LocalVersion {
  return { hlc: MID, hash: hashPayload({ title: 'Local' }), deleted: false, ...over }
}

const parentOk = { present: true, deleted: false }

describe('decideIncoming', () => {
  it('applies a record this device has never seen', () => {
    expect(decideIncoming(incoming(), null, parentOk)).toEqual({ type: 'apply' })
  })

  it('skips a version already applied', () => {
    expect(decideIncoming(incoming(), local({ hlc: NEW }), parentOk)).toEqual({ type: 'skip' })
  })

  it('skips the same content', () => {
    const same = local({ hlc: OLD, hash: hashPayload(incoming().payload!) })
    expect(decideIncoming(incoming(), same, parentOk)).toEqual({ type: 'skip' })
  })

  it('applies a newer edit made on top of the local version, without conflict', () => {
    expect(decideIncoming(incoming(), local(), parentOk)).toEqual({ type: 'apply' })
  })

  it('keeps the local version and stores the incoming one when the local edit is newer', () => {
    const newerLocal = local({ hlc: '000000000009000-0000-a' })
    expect(decideIncoming(incoming({ baseHlc: OLD }), newerLocal, parentOk)).toEqual({
      type: 'keep-local-and-keep-loser',
      loser: 'incoming'
    })
  })

  it('applies the incoming edit and stores the local one when the incoming is newer', () => {
    expect(decideIncoming(incoming({ baseHlc: OLD }), local(), parentOk)).toEqual({
      type: 'apply-and-keep-loser',
      loser: 'local'
    })
  })

  it('never resolves a debt on its own, whichever side is newer', () => {
    const debt = (hlc: string): WireRecord =>
      incoming({
        kind: 'financial_debt',
        id: 'd1',
        hlc,
        baseHlc: OLD,
        payload: { tableId: 'ft1', remainingAmount: '100' }
      })
    expect(decideIncoming(debt(NEW), local(), parentOk)).toEqual({ type: 'pending-choice' })
    expect(decideIncoming(debt('000000000000500-0000-b'), local(), parentOk)).toEqual({
      type: 'pending-choice'
    })
  })

  it('waits for a missing parent', () => {
    expect(decideIncoming(incoming(), null, { present: false, deleted: false })).toEqual({
      type: 'wait-parent'
    })
  })

  it('turns a child of a deleted parent into a conflict', () => {
    expect(decideIncoming(incoming(), null, { present: false, deleted: true })).toEqual({
      type: 'orphan-conflict'
    })
  })

  it('keeps a newer local edit against a remote delete', () => {
    const newerLocal = local({ hlc: '000000000009000-0000-a' })
    const tombstone = incoming({ deleted: true, payload: undefined, baseHlc: OLD })
    expect(decideIncoming(tombstone, newerLocal, null)).toEqual({
      type: 'keep-local-and-keep-loser',
      loser: 'incoming'
    })
  })
})

describe('parentOf', () => {
  it('reads the parent as extractDataRecords writes it', () => {
    expect(parentOf(incoming())).toEqual({ kind: 'project', id: 'p1' })
    expect(
      parentOf(
        incoming({
          kind: 'habit_completion',
          id: 'h1:2026-10-30',
          payload: { habitId: 'h1', date: '2026-10-30' }
        })
      )
    ).toEqual({ kind: 'habit', id: 'h1' })
    expect(parentOf(incoming({ kind: 'transaction', payload: { tableId: 'ft1' } }))).toEqual({
      kind: 'financial_table',
      id: 'ft1'
    })
  })

  it('gives no parent to a file without project, a tombstone or a memory', () => {
    expect(parentOf(incoming({ kind: 'file', payload: { name: 'a.pdf' } }))).toBeNull()
    expect(parentOf(incoming({ deleted: true, payload: undefined }))).toBeNull()
    expect(parentOf(incoming({ kind: 'memory', payload: { title: 'x' } }))).toBeNull()
  })
})
