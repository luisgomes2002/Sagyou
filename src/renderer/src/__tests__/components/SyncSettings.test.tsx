import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SyncSettings } from '../../components/settings/SyncSettings'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AA==') }
}))

const status = {
  state: 'ok' as const,
  lastSyncAt: null,
  pendingCount: 0,
  paused: null,
  deviceName: 'Casa',
  conflictCount: 0
}

const revoke = vi.fn().mockResolvedValue({ ok: true })

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      sync: {
        status: vi.fn().mockResolvedValue(status),
        devices: vi.fn().mockResolvedValue({
          ok: true,
          devices: [
            {
              id: 'a'.repeat(32),
              name: 'Casa',
              current: true,
              lastSeen: 0,
              revokedAt: null,
              wipe: false,
              cursor: 0
            },
            {
              id: 'b'.repeat(32),
              name: 'Trabalho',
              current: false,
              lastSeen: 0,
              revokedAt: null,
              wipe: false,
              cursor: 0
            }
          ]
        }),
        enrollTotp: vi.fn().mockResolvedValue({
          ok: true,
          uri: 'otpauth://totp/Sagyou?secret=AAAAAAAA&issuer=Sagyou'
        }),
        confirmTotp: vi.fn().mockResolvedValue({ ok: true, backupCodes: ['ABCDEF0123456789'] }),
        revoke
      }
    }
  })
})

describe('Sincronização: autenticação e revogação', () => {
  it('mostra o QR e entrega os códigos reserva só depois da confirmação', async () => {
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar ou trocar autenticador' }))
    expect(await screen.findByAltText('QR para cadastrar o autenticador')).toBeInTheDocument()
    expect(screen.queryByText(/Guarde estes códigos reserva/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Código de confirmação'), {
      target: { value: '123456' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar código' }))
    expect(await screen.findByText(/Guarde estes códigos reserva/)).toBeInTheDocument()
    expect(screen.getByText('ABCDEF0123456789')).toBeInTheDocument()
  })

  it('apagar um aparelho pede código antes de chamar a revogação', async () => {
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar Trabalho' }))
    fireEvent.click(screen.getByLabelText('Também apagar os dados dele'))
    expect(screen.getByLabelText('Código do autenticador ou reserva')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar revogação' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Código do autenticador ou reserva'), {
      target: { value: '123456' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar revogação' }))
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith('b'.repeat(32), true, { totp: '123456' })
    )
  })

  it('revogar sem apagar não pede código', async () => {
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar Trabalho' }))
    expect(screen.queryByLabelText('Código do autenticador ou reserva')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar revogação' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('b'.repeat(32), false, undefined))
  })
})
