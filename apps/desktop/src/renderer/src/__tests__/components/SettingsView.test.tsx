import type { JSX } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SettingsView } from '../../components/views/SettingsView'
import { ALL_FEATURE_IDS, type UiPreferences } from '../../types'

// Sync and updates have their own suites; here only their placement matters.
vi.mock('../../components/settings/SyncSettings', () => ({
  SyncSettings: ({
    onOneTimeSecretChange
  }: {
    onOneTimeSecretChange?: (shown: boolean) => void
  }): JSX.Element => (
    <div>
      <p>controles de sincronização</p>
      <input aria-label="campo de sincronização" />
      <button type="button" onClick={() => onOneTimeSecretChange?.(true)}>
        mostrar códigos reserva
      </button>
    </div>
  )
}))
vi.mock('../../components/settings/UpdateSettings', () => ({
  UpdateSettings: () => <p>controles de atualização</p>
}))

const ui: UiPreferences = {
  theme: 'dark',
  fontSize: 'default',
  reduceMotion: false,
  highContrast: false
} as UiPreferences

const enable = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    ai: {
      config: {
        get: vi.fn().mockResolvedValue({ userName: 'Luis' }),
        set: vi.fn().mockResolvedValue(undefined)
      }
    },
    security: {
      status: vi.fn().mockResolvedValue({ enabled: false, corrupt: false }),
      enable
    },
    desktop: {
      getPrefs: vi.fn().mockResolvedValue({
        closeToTray: true,
        idleLockMinutes: 15,
        lockOnSystemLock: true,
        trayNoticeShown: false,
        platform: 'win32',
        openAtLogin: false
      }),
      setPrefs: vi.fn(),
      setOpenAtLogin: vi.fn()
    }
  }
})

type Handlers = Record<
  'onSetFeaturePreferences' | 'onSetUiPreferences' | 'onToast' | 'onOpenGuide',
  ReturnType<typeof vi.fn>
>

function renderSettings(props: Partial<Parameters<typeof SettingsView>[0]> = {}): Handlers {
  const handlers = {
    onSetFeaturePreferences: vi.fn(),
    onSetUiPreferences: vi.fn(),
    onToast: vi.fn(),
    onOpenGuide: vi.fn()
  }
  render(
    <SettingsView
      uiPreferences={ui}
      featurePreferences={ALL_FEATURE_IDS}
      {...handlers}
      {...props}
    />
  )
  return handlers
}

const nav = (): HTMLElement => screen.getByRole('navigation', { name: 'Configurações' })
const openSection = (label: string): boolean =>
  fireEvent.click(within(nav()).getByRole('button', { name: label }))
const heading = (): HTMLElement => screen.getByRole('heading', { level: 2 })

describe('SettingsView', () => {
  it('opens on Geral', async () => {
    renderSettings()
    expect(heading()).toHaveTextContent('Geral')
    expect(await screen.findByDisplayValue('Luis')).toBeInTheDocument()
  })

  it('lists the eight sections in order', () => {
    renderSettings()
    expect(
      within(nav())
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual([
      'Geral',
      'Aparência',
      'Barra lateral',
      'Segurança',
      'Sincronização',
      'Acesso MCP externo',
      'Sistema',
      'Sobre'
    ])
  })

  it('no longer has the empty encryption card', () => {
    renderSettings()
    for (const label of [
      'Geral',
      'Aparência',
      'Barra lateral',
      'Segurança',
      'Sincronização',
      'Sistema',
      'Sobre'
    ]) {
      openSection(label)
      expect(screen.queryByText(/Criptografia/)).not.toBeInTheDocument()
    }
  })

  it('opens the requested section, with window and update settings under Sistema', async () => {
    renderSettings({ initialSection: 'sistema' })
    expect(heading()).toHaveTextContent('Sistema')
    expect(await screen.findByText('Janela e inicialização')).toBeInTheDocument()
    expect(screen.getByText('controles de atualização')).toBeInTheDocument()
  })

  it('links Sincronização to its guide chapter', () => {
    const { onOpenGuide } = renderSettings()
    openSection('Sincronização')
    expect(screen.getByText('controles de sincronização')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Como funciona a sincronização' }))
    expect(onOpenGuide).toHaveBeenCalledWith('sync-o-que-e')
  })

  it('shows the version and opens the guide from Sobre', () => {
    const { onOpenGuide } = renderSettings()
    openSection('Sobre')
    expect(screen.getByText('Versão 0.0.0-test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir o Como funciona' }))
    expect(onOpenGuide).toHaveBeenCalledWith(undefined)
  })

  it('changes only the theme in the saved preferences', () => {
    const { onSetUiPreferences } = renderSettings()
    openSection('Aparência')
    fireEvent.click(screen.getByRole('radio', { name: 'Claro' }))
    expect(onSetUiPreferences).toHaveBeenCalledWith({ ...ui, theme: 'light' })
  })

  it('hides an area from the sidebar', () => {
    const { onSetFeaturePreferences } = renderSettings()
    openSection('Barra lateral')
    fireEvent.click(screen.getByRole('checkbox', { name: /Hábitos/ }))
    expect(onSetFeaturePreferences).toHaveBeenCalledWith(
      ALL_FEATURE_IDS.filter((feature) => feature !== 'habits')
    )
  })

  it('keeps Sincronização mounted across sections, so codes shown once survive', () => {
    renderSettings()
    openSection('Sincronização')
    fireEvent.change(screen.getByLabelText('campo de sincronização'), {
      target: { value: 'códigos na tela' }
    })
    openSection('Geral')
    openSection('Sincronização')
    expect(screen.getByLabelText('campo de sincronização')).toHaveValue('códigos na tela')
  })

  it('does not leave for the guide while a one-time code is on screen', () => {
    const { onOpenGuide } = renderSettings()
    openSection('Sincronização')
    fireEvent.click(screen.getByRole('button', { name: 'mostrar códigos reserva' }))
    const link = screen.getByRole('button', { name: 'Como funciona a sincronização' })
    expect(link).toBeDisabled()
    expect(
      screen.getByText('Anote os códigos abaixo antes de sair: eles aparecem uma vez só.')
    ).toBeInTheDocument()
    fireEvent.click(link)
    expect(onOpenGuide).not.toHaveBeenCalled()
  })

  it('drops a half-typed password when leaving the section, without saving it', async () => {
    renderSettings()
    openSection('Segurança')
    const field = await screen.findByLabelText('Nova senha')
    fireEvent.change(field, { target: { value: 'segredo' } })
    openSection('Geral')
    openSection('Segurança')
    expect(await screen.findByLabelText('Nova senha')).toHaveValue('')
    expect(enable).not.toHaveBeenCalled()
  })
})
