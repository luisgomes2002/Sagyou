import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useDebtConflictIds, useSyncOnReconnect } from '../../hooks/useSync'

const status = {
  state: 'ok' as const,
  lastSyncAt: null,
  pendingCount: 0,
  paused: null,
  deviceName: 'Casa',
  conflictCount: 1
}

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      sync: {
        now: vi.fn().mockResolvedValue(status),
        status: vi.fn().mockResolvedValue(status),
        onStatusChanged: vi.fn(() => () => {}),
        conflicts: vi.fn().mockResolvedValue({
          ok: true,
          conflicts: [
            { id: 'c1', type: 'pending_choice', kind: 'financial_debt', recordId: 'd1' },
            { id: 'c2', type: 'lww', kind: 'financial_debt', recordId: 'd2' },
            { id: 'c3', type: 'pending_choice', kind: 'task', recordId: 'd3' }
          ]
        })
      }
    }
  })
})

describe('useSyncOnReconnect', () => {
  it('sincroniza quando a rede volta', () => {
    const { unmount } = renderHook(() => useSyncOnReconnect())
    expect(window.electronAPI.sync.now).not.toHaveBeenCalled()
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(window.electronAPI.sync.now).toHaveBeenCalledTimes(1)
    unmount()
    window.dispatchEvent(new Event('online'))
    expect(window.electronAPI.sync.now).toHaveBeenCalledTimes(1)
  })
})

describe('useDebtConflictIds', () => {
  it('lista só as dívidas com escolha pendente', async () => {
    const { result } = renderHook(() => useDebtConflictIds())
    await waitFor(() => expect([...result.current]).toEqual(['d1']))
  })

  it('não pede a lista quando não há conflito', async () => {
    vi.mocked(window.electronAPI.sync.status).mockResolvedValue({ ...status, conflictCount: 0 })
    const { result } = renderHook(() => useDebtConflictIds())
    await waitFor(() => expect(window.electronAPI.sync.status).toHaveBeenCalled())
    expect(window.electronAPI.sync.conflicts).not.toHaveBeenCalled()
    expect(result.current.size).toBe(0)
  })
})
