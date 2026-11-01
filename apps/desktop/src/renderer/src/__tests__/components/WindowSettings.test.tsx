import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WindowSettings } from '../../components/settings/WindowSettings'

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
  setOpenAtLogin: vi.fn<(on: boolean) => Promise<View>>()
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getPrefs.mockResolvedValue(base)
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { desktop: api }
})

describe('Janela e inicialização', () => {
  it('turns close-to-tray off through main', async () => {
    api.setPrefs.mockResolvedValue({ ...base, closeToTray: false })
    render(<WindowSettings />)
    expect(screen.getByText('Janela e inicialização')).toBeInTheDocument()
    const box = await screen.findByRole('checkbox', {
      name: /Fechar a janela mantém o Sagyou na bandeja/
    })
    expect(screen.getByText('Use Sair no ícone da bandeja para encerrar.')).toBeInTheDocument()
    expect(box).toBeChecked()
    fireEvent.click(box)
    expect(api.setPrefs).toHaveBeenCalledWith({ closeToTray: false })
    await vi.waitFor(() => expect(box).not.toBeChecked())
  })

  it('offers "Iniciar com o Windows" only on Windows', async () => {
    api.setOpenAtLogin.mockResolvedValue({ ...base, openAtLogin: true })
    const { unmount } = render(<WindowSettings />)
    const box = await screen.findByRole('checkbox', {
      name: /Iniciar com o Windows \(na bandeja\)/
    })
    fireEvent.click(box)
    expect(api.setOpenAtLogin).toHaveBeenCalledWith(true)
    await vi.waitFor(() => expect(box).toBeChecked())
    unmount()

    api.getPrefs.mockResolvedValue({ ...base, platform: 'linux', closeToTray: false })
    render(<WindowSettings />)
    await screen.findByRole('checkbox', { name: /Fechar a janela/ })
    expect(screen.queryByText(/Iniciar com o Windows/)).not.toBeInTheDocument()
  })

  it('keeps the switch where it was when saving fails', async () => {
    api.setPrefs.mockRejectedValue(new Error('IPC'))
    render(<WindowSettings />)
    const box = await screen.findByRole('checkbox', { name: /Fechar a janela/ })
    fireEvent.click(box)
    expect(await screen.findByText('Não foi possível salvar.')).toBeInTheDocument()
    expect(box).toBeChecked()
  })
})
