import type { SyncConflictView, SyncStatus } from '@sagyou/core/sync/engine'
import { type AppServices, useApp } from '../store/app'
import { seedApp } from './seed'

export const OLD_HLC = '000001794300000-0000-aaaa'
export const NEW_HLC = '000001794400000-0000-bbbb'
export const AT_LOCAL = Date.UTC(2026, 10, 2, 9, 0)
export const AT_REMOTE = Date.UTC(2026, 10, 2, 9, 5)
const LONG_A = `${'palavra '.repeat(12)}primeira versão`
const LONG_B = `${'palavra '.repeat(12)}segunda versão`

export const CONFLICT_STATUS: SyncStatus = {
  state: 'ok',
  lastSyncAt: Date.now(),
  pendingCount: 0,
  paused: null,
  deviceName: 'Pixel',
  conflictCount: 1
}

/** A task changed here and on "PC de casa"; the PC's version is newer. */
export function lww(id = 'c1'): SyncConflictView {
  const base = { id: 't1', projectId: 'p1', title: 'Comprar pão', updatedAt: 'x' }
  return {
    id,
    type: 'lww',
    kind: 'task',
    recordId: 't1',
    createdAt: AT_REMOTE,
    current: 'remote',
    local: {
      hlc: OLD_HLC,
      at: AT_LOCAL,
      deviceName: 'Pixel',
      deleted: false,
      payload: { ...base, description: LONG_A, timeSpent: 7200, priority: 'low' }
    },
    remote: {
      hlc: NEW_HLC,
      at: AT_REMOTE,
      deviceName: 'PC de casa',
      deleted: false,
      payload: { ...base, description: LONG_B, timeSpent: 6000, priority: 'high' }
    }
  }
}

export function orphan(): SyncConflictView {
  return {
    ...lww('c-orfao'),
    type: 'orphan',
    current: 'local',
    local: { ...lww().local, payload: { title: 'Tarefa solta' } },
    remote: { hlc: null, at: null, deviceName: 'PC de casa', deleted: true, payload: null }
  }
}

/** Like the real engine: a resolved conflict is no longer listed. */
export function withEngine(
  list: SyncConflictView[],
  resolve: jest.Mock = jest.fn((id: string) => {
    const i = list.findIndex((c) => c.id === id)
    if (i >= 0) list.splice(i, 1)
  })
): { conflicts: jest.Mock; resolve: jest.Mock } {
  seedApp()
  return installEngine(list, resolve)
}

/** Swaps only the engine, keeping whatever data the test seeded. */
export function installEngine(
  list: SyncConflictView[],
  resolve: jest.Mock = jest.fn()
): { conflicts: jest.Mock; resolve: jest.Mock } {
  const conflicts = jest.fn(() => [...list])
  const services = useApp.getState().services as AppServices
  useApp.setState({
    status: CONFLICT_STATUS,
    services: {
      ...services,
      runtime: { ...services.runtime, engine: { conflicts, resolve } }
    } as unknown as AppServices
  })
  return { conflicts, resolve }
}
