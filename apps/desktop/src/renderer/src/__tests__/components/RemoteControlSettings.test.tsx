import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RemoteControlSettings } from '../../components/settings/RemoteControlSettings'
import {
  ENABLE_DESCRIPTION,
  ENABLE_LABEL,
  ESP32_ONCE_TEXT,
  ESP32_SUGGESTION,
  accessCutPcText,
  suspendedText
} from '../../utils/remoteControlText'
import type { RcServerView } from '../../utils/rcServers'

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
  pending: [] as { id: string; name: string; code: string; expiresAt: number }[],
  hasEsp32Key: false,
  accessCutAt: null as number | null
}

let api: Record<string, ReturnType<typeof vi.fn>>
let rc: Record<string, ReturnType<typeof vi.fn>>
let statusListener: ((s: typeof base) => void) | undefined
const toast = vi.fn()

function mount(status: Partial<typeof base> = {}): ReturnType<typeof render> {
  api.status.mockResolvedValue({ ...base, ...status })
  return render(<RemoteControlSettings onToast={toast} />)
}

function server(overrides: Partial<RcServerView> = {}): RcServerView {
  return {
    projectId: 'p-sagyou',
    name: 'Sagyou',
    enabled: true,
    autostart: false,
    state: 'stopped',
    confirmed: true,
    error: null,
    ...overrides
  }
}

function withServers(servers: RcServerView[], supported = true): void {
  rc.list.mockResolvedValue({ supported, servers })
}

const row = (name: string): HTMLElement => screen.getByRole('listitem', { name })

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
    restoreAccess: vi.fn().mockResolvedValue({ ok: true }),
    createEsp32: vi.fn().mockResolvedValue({ ok: true, token: 'tok-123', key: 'ab'.repeat(32) }),
    onStatusChanged: vi.fn((cb: (s: typeof base) => void) => {
      statusListener = cb
      return vi.fn()
    })
  }
  rc = {
    list: vi.fn().mockResolvedValue({ supported: true, servers: [] }),
    configure: vi.fn().mockResolvedValue({ success: true }),
    start: vi.fn().mockResolvedValue({ success: true, result: 'ok' }),
    stop: vi.fn().mockResolvedValue({ success: true, result: 'ok' }),
    onChanged: vi.fn(() => vi.fn())
  }
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { remote: api, rcServers: rc }
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true
  })
})

describe('RemoteControlSettings', () => {
  it('acesso cortado: faixa "Acesso cortado pelo celular em …" e Restaurar acesso', async () => {
    const at = Date.UTC(2026, 10, 7, 17, 32)
    mount({ accessCutAt: at })
    expect(await screen.findByText(accessCutPcText(at))).toBeInTheDocument()
    const d = new Date(at)
    const pad = (n: number): string => String(n).padStart(2, '0')
    expect(accessCutPcText(at)).toBe(
      `Acesso cortado pelo celular em ${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}.`
    )
    api.status.mockResolvedValue({ ...base, accessCutAt: null })
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar acesso' }))
    await waitFor(() => expect(api.restoreAccess).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(accessCutPcText(at))).toBeNull())
  })

  it('acesso cortado aparece mesmo com o controle remoto desligado', async () => {
    const at = Date.UTC(2026, 10, 7, 17, 32)
    mount({ enabled: false, controllers: [], accessCutAt: at })
    expect(await screen.findByText(accessCutPcText(at))).toBeInTheDocument()
  })

  it('desligado: mostra o interruptor e pede o código do autenticador para ativar', async () => {
    mount({ enabled: false, controllers: [] })
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
    expect(suspendedText(until)).toBe('Controle remoto suspenso até 14:32 por pedidos recusados.')
    act(() =>
      statusListener?.({ ...base, error: 'Atualize o Worker para usar o controle remoto.' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Atualize o Worker para usar o controle remoto.'
    )
  })

  describe('Servidores de Remote Control', () => {
    it('uma linha por projeto da lista, com os estados em texto exato, e o rodapé', async () => {
      withServers([
        server({ projectId: 'p1', name: 'Sagyou', state: 'running' }),
        server({ projectId: 'p2', name: 'Murasaki', state: 'stopped' }),
        server({ projectId: 'p3', name: 'Kanji', state: 'starting' }),
        server({ projectId: 'p4', name: 'Blog', state: 'needs-confirm', confirmed: false }),
        server({ projectId: 'p5', name: 'Site', state: 'external' })
      ])
      mount()
      expect(await screen.findByText('Servidores de Remote Control')).toBeInTheDocument()
      expect(within(row('Sagyou')).getByText('Rodando')).toBeInTheDocument()
      expect(within(row('Murasaki')).getByText('Parado')).toBeInTheDocument()
      expect(within(row('Kanji')).getByText('Iniciando…')).toBeInTheDocument()
      expect(within(row('Blog')).getByText('Confirme no Fleet')).toBeInTheDocument()
      expect(within(row('Site')).getByText('Rodando (fora do Sagyou)')).toBeInTheDocument()
      expect(within(row('Murasaki')).getByRole('button', { name: 'Ligar' })).toBeInTheDocument()
      expect(within(row('Sagyou')).getByRole('button', { name: 'Desligar' })).toBeInTheDocument()
      expect(within(row('Site')).getByRole('button', { name: 'Desligar' })).toBeInTheDocument()
      expect(screen.getByText('Só aparecem projetos com uma pasta de código.')).toBeInTheDocument()
    })

    it('"Servidor de Remote Control" e "Iniciar com o Sagyou" chamam configure', async () => {
      withServers([server({ projectId: 'p1', name: 'Sagyou', enabled: true, autostart: false })])
      mount()
      await screen.findByText('Servidores de Remote Control')
      fireEvent.click(within(row('Sagyou')).getByRole('checkbox', { name: 'Iniciar com o Sagyou' }))
      await waitFor(() => expect(rc.configure).toHaveBeenCalledWith('p1', { autostart: true }))
      await waitFor(() =>
        expect(
          within(row('Sagyou')).getByRole('checkbox', { name: 'Servidor de Remote Control' })
        ).not.toBeDisabled()
      )
      fireEvent.click(
        within(row('Sagyou')).getByRole('checkbox', { name: 'Servidor de Remote Control' })
      )
      await waitFor(() => expect(rc.configure).toHaveBeenCalledWith('p1', { enabled: false }))
    })

    it('Ligar chama start e abre a aba do servidor no Fleet', async () => {
      withServers([server({ projectId: 'p1', name: 'Sagyou', state: 'stopped' })])
      const onOpenServer = vi.fn()
      render(<RemoteControlSettings onToast={toast} onOpenServer={onOpenServer} />)
      await screen.findByText('Servidores de Remote Control')
      fireEvent.click(within(row('Sagyou')).getByRole('button', { name: 'Ligar' }))
      await waitFor(() => expect(rc.start).toHaveBeenCalledWith('p1'))
      await waitFor(() => expect(onOpenServer).toHaveBeenCalledWith('p1'))
    })

    it('Ligar recusado não abre o Fleet e mostra o erro na linha', async () => {
      withServers([server({ projectId: 'p1', name: 'Sagyou', state: 'stopped' })])
      rc.start.mockResolvedValue({ success: false, result: 'cut' })
      const onOpenServer = vi.fn()
      render(<RemoteControlSettings onToast={toast} onOpenServer={onOpenServer} />)
      await screen.findByText('Servidores de Remote Control')
      fireEvent.click(within(row('Sagyou')).getByRole('button', { name: 'Ligar' }))
      expect(await within(row('Sagyou')).findByRole('alert')).toHaveTextContent(
        'O acesso está cortado. Restaure antes de ligar um servidor.'
      )
      expect(onOpenServer).not.toHaveBeenCalled()
    })

    it('Desligar chama stop', async () => {
      withServers([server({ projectId: 'p1', name: 'Sagyou', state: 'running' })])
      mount()
      await screen.findByText('Servidores de Remote Control')
      fireEvent.click(within(row('Sagyou')).getByRole('button', { name: 'Desligar' }))
      await waitFor(() => expect(rc.stop).toHaveBeenCalledWith('p1'))
    })

    it('a dica da 1ª vez aparece em needs-confirm', async () => {
      withServers([
        server({ projectId: 'p1', name: 'Sagyou', state: 'needs-confirm', confirmed: false })
      ])
      mount()
      expect(
        await screen.findByText(
          'Responda às perguntas do Claude no Fleet. Depois disso, o celular também liga este servidor.'
        )
      ).toBeInTheDocument()
    })

    it('o erro do servidor aparece na linha', async () => {
      withServers([
        server({ projectId: 'p1', name: 'Sagyou', error: 'Claude Code não encontrado' })
      ])
      mount()
      await screen.findByText('Servidores de Remote Control')
      expect(within(row('Sagyou')).getByRole('alert')).toHaveTextContent(
        'Claude Code não encontrado'
      )
    })

    it('fora do Windows (supported: false) a seção não aparece', async () => {
      withServers([server()], false)
      mount({ supported: false, enabled: false })
      await screen.findByText('Só funciona no Windows.')
      await waitFor(() => expect(rc.list).toHaveBeenCalled())
      expect(screen.queryByText('Servidores de Remote Control')).not.toBeInTheDocument()
      expect(
        screen.queryByText('Só aparecem projetos com uma pasta de código.')
      ).not.toBeInTheDocument()
    })

    it('com o controle remoto desligado e supported, a seção aparece', async () => {
      withServers([server({ projectId: 'p1', name: 'Sagyou' })])
      mount({ enabled: false, controllers: [] })
      expect(await screen.findByText('Servidores de Remote Control')).toBeInTheDocument()
      expect(within(row('Sagyou')).getByText('Parado')).toBeInTheDocument()
      expect(screen.queryByText('Celulares autorizados')).not.toBeInTheDocument()
    })

    it('a lista acompanha rc-server:changed', async () => {
      let changed: ((list: unknown) => void) | undefined
      rc.onChanged.mockImplementation((cb: (list: unknown) => void) => {
        changed = cb
        return vi.fn()
      })
      withServers([server({ projectId: 'p1', name: 'Sagyou', state: 'stopped' })])
      mount()
      expect(await screen.findByText('Parado')).toBeInTheDocument()
      act(() =>
        changed?.({
          supported: true,
          servers: [server({ projectId: 'p1', name: 'Sagyou', state: 'running' })]
        })
      )
      expect(await screen.findByText('Rodando')).toBeInTheDocument()
    })
  })
})
