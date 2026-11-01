import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutoLockSettings } from '../../components/settings/AutoLockSettings'

type View = Awaited<ReturnType<typeof window.electronAPI.desktop.getPrefs>>

const base: View = {
  closeToTray: true,
  idleLockMinutes: 15,
  lockOnSystemLock: true,
  trayNoticeShown: false,
  platform: 'win32',
  openAtLogin: false
}

const api = {
  getPrefs: vi.fn<() => Promise<View>>(),
  setPrefs: vi.fn<(patch: Partial<View>) => Promise<View>>(),
  setOpenAtLogin: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getPrefs.mockResolvedValue(base)
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { desktop: api }
})

describe('Bloqueio automático', () => {
  it('offers the idle options and saves the choice', async () => {
    api.setPrefs.mockResolvedValue({ ...base, idleLockMinutes: 5 })
    render(<AutoLockSettings passwordEnabled />)
    const select = await screen.findByLabelText('Bloquear automaticamente após')
    expect(
      Array.from((select as HTMLSelectElement).options).map((o) => [o.value, o.textContent])
    ).toEqual([
      ['0', 'Nunca'],
      ['5', '5 min'],
      ['15', '15 min'],
      ['30', '30 min'],
      ['60', '1 h']
    ])
    expect(select).toHaveValue('15')
    fireEvent.change(select, { target: { value: '5' } })
    expect(api.setPrefs).toHaveBeenCalledWith({ idleLockMinutes: 5 })
    await vi.waitFor(() => expect(select).toHaveValue('5'))
  })

  it('turns the screen-lock switch off', async () => {
    api.setPrefs.mockResolvedValue({ ...base, lockOnSystemLock: false })
    render(<AutoLockSettings passwordEnabled />)
    const box = await screen.findByRole('checkbox', {
      name: /Bloquear quando o Windows bloquear a tela/
    })
    fireEvent.click(box)
    expect(api.setPrefs).toHaveBeenCalledWith({ lockOnSystemLock: false })
  })

  it('is disabled without a password, and says why', async () => {
    render(<AutoLockSettings passwordEnabled={false} />)
    expect(await screen.findByLabelText('Bloquear automaticamente após')).toBeDisabled()
    expect(
      screen.getByRole('checkbox', { name: /Bloquear quando o Windows bloquear a tela/ })
    ).toBeDisabled()
    expect(screen.getByText('Ative uma senha para usar o bloqueio automático.')).toBeInTheDocument()
  })
})
