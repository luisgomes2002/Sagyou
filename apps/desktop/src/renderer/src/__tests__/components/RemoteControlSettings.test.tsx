import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RemoteControlSettings } from '../../components/settings/RemoteControlSettings'
import {
  ENABLE_DESCRIPTION,
  ENABLE_LABEL,
  ESP32_ONCE_TEXT,
  ESP32_SUGGESTION,
  suspendedText
} from '../../utils/remoteControlText'

const PHONE = 'a'.repeat(32)
const NEW_PHONE = 'b'.repeat(32)

const base = {
  supported: true,
  enabled: true,
  running: true,
  syncActive: true,
  error: null as string | null,
  suspendedUntil: null as number | null,
  controllers: [{ id: PHONE, name: 'Pixel 8', since: '2026-11-03T12:00:00.000Z' }],
  servers: [
    { name: 'Sagyou', up: true },
    { name: 'Murasaki', up: false }
  ],
  pending: [] as { id: string; name: string; code: string; expiresAt: number }[],
  hasEsp32Key: false
}

let api: Record<string, ReturnType<typeof vi.fn>>
let statusListener: ((s: typeof base) => void) | undefined
const toast = vi.fn()

function mount(status: Partial<typeof base> = {}): ReturnType<typeof render> {
  api.status.mockResolvedValue({ ...base, ...status })
  return render(<RemoteControlSettings onToast={toast} suggestions={['Sagyou', 'Living']} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  statusListener = undefined
  api = {
    status: vi.fn().mockResolvedValue(base),
    enable: vi.fn().mockResolvedValue({ ok: true }),
    disable: vi.fn().mockResolvedValue({ ok: true }),
    authorize: vi.fn().mockResolvedValue({ ok: true }),
    refuse: vi.fn().mockResolvedValue({ ok: true }),
    revoke: vi.fn().mockResolvedValue({ ok: true }),
    setServers: vi.fn().mockResolvedValue({ ok: true }),
    createEsp32: vi.fn().mockResolvedValue({ ok: true, token: 'tok-123', key: 'ab'.repeat(32) }),
    onStatusChanged: vi.fn((cb: (s: typeof base) => void) => {
      statusListener = cb
      return vi.fn()
    })
  }
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { remote: api }
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true
  })
})

describe('RemoteControlSettings', () => {
  it('desligado: mostra o interruptor e pede o código do autenticador para ativar', async () => {
    mount({ enabled: false, controllers: [], servers: [] })
    const toggle = await screen.findByRole('checkbox', { name: ENABLE_LABEL })
    expect(screen.getByText(ENABLE_DESCRIPTION)).toBeInTheDocument()
    expect(screen.queryByText('Celulares autorizados')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    fireEvent.change(screen.getByLabelText('Código do autenticador'), {
      target: { value: '123456' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    await waitFor(() => expect(api.enable).toHaveBeenCalledWith({ totp: '123456' }))
  })

  it('erro ao ativar aparece como alerta', async () => {
    mount({ enabled: false })
    api.enable.mockResolvedValue({ ok: false, error: 'Ative a sincronização antes.' })
    fireEvent.click(await screen.findByRole('checkbox', { name: ENABLE_LABEL }))
    fireEvent.change(screen.getByLabelText('Código do autenticador'), {
      target: { value: '123456' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ative a sincronização antes.')
  })

  it('fora do Windows o interruptor fica desligado', async () => {
    mount({ supported: false, enabled: false })
    expect(await screen.findByRole('checkbox', { name: ENABLE_LABEL })).toBeDisabled()
    expect(screen.getByText('Só funciona no Windows.')).toBeInTheDocument()
  })

  it('pedido de autorização: senha errada mostra "Senha incorreta." e o pedido continua', async () => {
    mount({
      pending: [{ id: NEW_PHONE, name: 'Pixel 9', code: '482913', expiresAt: Date.now() + 600_000 }]
    })
    expect(
      await screen.findByText('Pixel 9 quer controlar este PC — código 482 913')
    ).toBeInTheDocument()
    api.authorize.mockResolvedValueOnce({ ok: false, error: 'Senha incorreta.' })
    fireEvent.change(screen.getByLabelText('Senha do Sagyou'), { target: { value: 'errada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Autorizar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Senha incorreta.')
    expect(api.authorize).toHaveBeenCalledWith(NEW_PHONE, 'errada')
    expect(screen.getByText(/Pixel 9 quer controlar/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }))
    await waitFor(() => expect(api.refuse).toHaveBeenCalledWith(NEW_PHONE))
  })

  it('revogar confirma e sugere gerar nova chave do ESP32', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar' }))
    expect(
      screen.getByText('Revogar Pixel 8? Ele deixa de controlar este PC na hora.')
    ).toBeInTheDocument()
    const confirm = screen.getAllByRole('button', { name: 'Revogar' }).at(-1)!
    fireEvent.click(confirm)
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith(PHONE))
    expect(await screen.findByText(ESP32_SUGGESTION)).toBeInTheDocument()
  })

  it('servidores mostram Rodando/Parado, adicionam e removem', async () => {
    mount()
    expect(await screen.findByText('Rodando')).toBeInTheDocument()
    expect(screen.getByText('Parado')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Nome do servidor'), { target: { value: 'Living' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() =>
      expect(api.setServers).toHaveBeenCalledWith(['Sagyou', 'Murasaki', 'Living'])
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remover Murasaki' }))
    await waitFor(() => expect(api.setServers).toHaveBeenLastCalledWith(['Sagyou']))
  })

  it('token do ESP32 aparece uma vez e some ao sair da seção', async () => {
    const { unmount } = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar' }))
    fireEvent.change(screen.getByLabelText('Código do autenticador'), {
      target: { value: '654321' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Gerar' }).at(-1)!)
    expect(await screen.findByText(ESP32_ONCE_TEXT)).toBeInTheDocument()
    expect(api.createEsp32).toHaveBeenCalledWith({ totp: '654321' })
    expect(screen.getByText('tok-123')).toBeInTheDocument()
    expect(screen.getByText('ab'.repeat(32))).toBeInTheDocument()
    unmount()
    mount({ hasEsp32Key: true })
    expect(await screen.findByRole('button', { name: 'Gerar novo' })).toBeInTheDocument()
    expect(screen.queryByText('tok-123')).not.toBeInTheDocument()
  })

  it('suspenso mostra até quando; o estado vindo do main atualiza a tela', async () => {
    const until = new Date(2026, 10, 3, 14, 32).getTime()
    mount({ suspendedUntil: until })
    expect(await screen.findByText(suspendedText(until))).toBeInTheDocument()
    expect(suspendedText(until)).toBe(
      'Controle remoto suspenso até 14:32 por pedidos recusados.'
    )
    act(() => statusListener?.({ ...base, error: 'Atualize o Worker para usar o controle remoto.' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Atualize o Worker para usar o controle remoto.'
    )
  })
})
