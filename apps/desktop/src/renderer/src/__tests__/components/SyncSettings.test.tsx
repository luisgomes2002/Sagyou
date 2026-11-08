import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SyncSettings } from '../../components/settings/SyncSettings'
import { useKanbanStore } from '../../store/kanban'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AA==') }
}))

vi.mock('../../services/ElectronStorage', () => ({
  ElectronStorage: vi.fn(function ElectronStorage(this: Record<string, unknown>) {
    this.load = vi.fn().mockResolvedValue(null)
    this.save = vi.fn().mockResolvedValue(undefined)
  })
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

const conflict = {
  id: 'c1',
  type: 'lww' as const,
  kind: 'task' as const,
  recordId: 't1',
  createdAt: 0,
  local: {
    hlc: 'h1',
    at: Date.UTC(2026, 9, 30, 12),
    deviceName: 'Casa',
    deleted: false,
    payload: { id: 't1', title: 'Comprar pão' }
  },
  remote: {
    hlc: 'h2',
    at: Date.UTC(2026, 9, 30, 13),
    deviceName: 'Trabalho',
    deleted: false,
    payload: { id: 't1', title: 'Comprar pão integral' }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useKanbanStore.setState({ projects: [], tasks: [], notes: [], goals: [], habits: [], lists: [] })
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      security: { status: vi.fn().mockResolvedValue({ enabled: false, corrupt: false }) },
      sync: {
        status: vi.fn().mockResolvedValue(status),
        onStatusChanged: vi.fn(() => () => {}),
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
        conflicts: vi.fn().mockResolvedValue({ ok: true, conflicts: [] }),
        resolve: vi.fn().mockResolvedValue({ ok: true }),
        now: vi.fn().mockResolvedValue(status),
        invite: vi.fn().mockResolvedValue({
          ok: true,
          code: 'sagyou-pair:CODIGO',
          expiresAt: Date.UTC(2026, 9, 31, 12, 10)
        }),
        recoveryCode: vi.fn().mockResolvedValue({ ok: true, code: 'AAAA-BBBB\nhttps://x.dev' }),
        disable: vi.fn().mockResolvedValue({ ok: true }),
        resume: vi.fn().mockResolvedValue({ ok: true, status }),
        activate: vi.fn().mockResolvedValue({ ok: true, recoveryCode: 'CCCC-DDDD\nhttps://x.dev' }),
        join: vi.fn().mockResolvedValue({ ok: true, status }),
        recover: vi.fn().mockResolvedValue({ ok: true, status }),
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

const withStatus = (next: Partial<typeof status> | Record<string, unknown>): void => {
  vi.mocked(window.electronAPI.sync.status).mockResolvedValue({
    ...status,
    ...next
  } as never)
}

describe('Sincronização em espera pela atualização', () => {
  it('avisa que começa depois da atualização', async () => {
    vi.mocked(window.electronAPI.sync.status).mockResolvedValueOnce({
      ...status,
      state: 'update-pending'
    })
    render(<SyncSettings onToast={vi.fn()} />)
    expect(
      await screen.findByText('Sincronização em espera: começa depois da atualização')
    ).toBeInTheDocument()
  })
})

describe('Sincronização: estados', () => {
  it('mostra há quanto tempo sincronizou e o que falta enviar', async () => {
    withStatus({ lastSyncAt: Date.now() - 5 * 60000 - 1000, pendingCount: 3 })
    render(<SyncSettings onToast={vi.fn()} />)
    expect(await screen.findByText('Sincronizado há 5 min')).toBeInTheDocument()
    expect(screen.getByText('3 alterações aguardando envio')).toBeInTheDocument()
  })

  it('sem conexão', async () => {
    withStatus({ state: 'offline' })
    render(<SyncSettings onToast={vi.fn()} />)
    expect(
      await screen.findByText('Sem conexão: as alterações ficam guardadas')
    ).toBeInTheDocument()
  })

  it('pausado oferece as duas escolhas', async () => {
    withStatus({ state: 'paused', paused: 'restore' })
    render(<SyncSettings onToast={vi.fn()} />)
    expect(await screen.findByText('Pausado: escolha o que vale')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'A nuvem manda' }))
    await waitFor(() => expect(window.electronAPI.sync.resume).toHaveBeenCalledWith('take-cloud'))
  })

  it('desconectado', async () => {
    withStatus({ state: 'disconnected' })
    render(<SyncSettings onToast={vi.fn()} />)
    expect(
      await screen.findByText('Este aparelho foi desconectado da sincronização')
    ).toBeInTheDocument()
  })

  it('sem chaveiro diz por que não liga', async () => {
    withStatus({ state: 'no-keychain' })
    render(<SyncSettings onToast={vi.fn()} />)
    expect(
      await screen.findByText(
        'O chaveiro do sistema não está disponível; a sincronização não liga.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ativar' })).not.toBeInTheDocument()
  })

  it('"Sincronizar agora" chama o main', async () => {
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sincronizar agora' }))
    await waitFor(() => expect(window.electronAPI.sync.now).toHaveBeenCalled())
  })

  it('acompanha o estado empurrado pelo main', async () => {
    let push: (next: unknown) => void = () => {}
    vi.mocked(window.electronAPI.sync.onStatusChanged).mockImplementation((cb) => {
      push = cb as (next: unknown) => void
      return () => {}
    })
    render(<SyncSettings onToast={vi.fn()} />)
    await screen.findByRole('button', { name: 'Sincronizar agora' })
    push({ ...status, state: 'offline' })
    expect(
      await screen.findByText('Sem conexão: as alterações ficam guardadas')
    ).toBeInTheDocument()
  })
})

describe('Sincronização: conflitos', () => {
  // Review finding: a pull that closed one conflict and opened another kept
  // the count, so the list stayed stale and the closed card said "não encontrado".
  it('relê a lista a cada estado com conflitos, mesmo com o mesmo número', async () => {
    let push: (next: unknown) => void = () => {}
    vi.mocked(window.electronAPI.sync.onStatusChanged).mockImplementation((cb) => {
      push = cb as (next: unknown) => void
      return () => {}
    })
    vi.mocked(window.electronAPI.sync.conflicts)
      .mockResolvedValueOnce({ ok: true, conflicts: [conflict] })
      .mockResolvedValue({ ok: true, conflicts: [{ ...conflict, id: 'c2' }] })
    vi.mocked(window.electronAPI.sync.status).mockResolvedValue({ ...status, conflictCount: 1 })
    render(<SyncSettings onToast={vi.fn()} />)
    await screen.findByRole('group', { name: 'Versão de Trabalho' })
    const before = vi.mocked(window.electronAPI.sync.conflicts).mock.calls.length
    push({ ...status, conflictCount: 1 })
    await waitFor(() =>
      expect(vi.mocked(window.electronAPI.sync.conflicts).mock.calls.length).toBeGreaterThan(before)
    )
  })

  it('"Usar esta" chama resolve com a versão escolhida', async () => {
    vi.mocked(window.electronAPI.sync.conflicts).mockResolvedValue({
      ok: true,
      conflicts: [conflict]
    })
    render(<SyncSettings onToast={vi.fn()} />)
    const remote = await screen.findByRole('group', { name: 'Versão de Trabalho' })
    expect(within(remote).getByText(/Comprar pão integral/)).toBeInTheDocument()
    fireEvent.click(within(remote).getByRole('button', { name: 'Usar esta' }))
    await waitFor(() =>
      expect(window.electronAPI.sync.resolve).toHaveBeenCalledWith('c1', 'remote')
    )
  })

  it('um órfão só pode ser dispensado', async () => {
    vi.mocked(window.electronAPI.sync.conflicts).mockResolvedValue({
      ok: true,
      conflicts: [{ ...conflict, type: 'orphan' }]
    })
    render(<SyncSettings onToast={vi.fn()} />)
    expect(
      await screen.findByText('Removido: o item de origem foi apagado em outro aparelho')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Usar esta' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
    await waitFor(() => expect(window.electronAPI.sync.resolve).toHaveBeenCalledWith('c1', 'local'))
  })
})

describe('Sincronização: pareamento e código', () => {
  it('"Parear novo aparelho" pede o autenticador e mostra o QR e o texto do convite', async () => {
    render(<SyncSettings onToast={vi.fn()} />)
    const pair = await screen.findByRole('button', { name: 'Parear novo aparelho' })
    expect(pair).toBeDisabled()
    expect(screen.getByText('Ou um código reserva.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Código do autenticador'), {
      target: { value: ' 123456 ' }
    })
    fireEvent.click(pair)
    expect(await screen.findByAltText('QR para parear um aparelho')).toBeInTheDocument()
    expect(window.electronAPI.sync.invite).toHaveBeenCalledWith('123456')
    expect(screen.getByLabelText('Código de pareamento')).toHaveValue('sagyou-pair:CODIGO')
    // A TOTP code is good once: the field is emptied after it was used.
    expect(screen.getByLabelText('Código do autenticador')).toHaveValue('')
  })

  it('um erro do convite aparece como o engine escreveu', async () => {
    vi.mocked(window.electronAPI.sync.invite).mockResolvedValueOnce({
      ok: false,
      error: 'Código do autenticador inválido.'
    })
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('Código do autenticador'), {
      target: { value: '000000' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Parear novo aparelho' }))
    expect(await screen.findByText('Código do autenticador inválido.')).toBeInTheDocument()
    expect(screen.queryByAltText('QR para parear um aparelho')).not.toBeInTheDocument()
  })

  it('"Ver código de recuperação" pede a senha do app quando há uma', async () => {
    vi.mocked(window.electronAPI.security.status).mockResolvedValue({
      enabled: true,
      corrupt: false
    })
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ver código de recuperação' }))
    fireEvent.change(await screen.findByLabelText('Senha do app'), {
      target: { value: 'segredo' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar código' }))
    await waitFor(() =>
      expect(window.electronAPI.sync.recoveryCode).toHaveBeenCalledWith('segredo')
    )
    expect(await screen.findByText(/AAAA-BBBB/)).toBeInTheDocument()
  })

  it('"Ver código de recuperação" sem senha mostra direto', async () => {
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ver código de recuperação' }))
    expect(await screen.findByText(/AAAA-BBBB/)).toBeInTheDocument()
    expect(window.electronAPI.sync.recoveryCode).toHaveBeenCalledWith(undefined)
  })

  it('"Desativar sincronização" confirma antes', async () => {
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Desativar sincronização' }))
    expect(window.electronAPI.sync.disable).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(window.electronAPI.sync.disable).toHaveBeenCalled())
  })
})

describe('Sincronização: ligar', () => {
  it('ativar mostra o código e só conclui com "Guardei o código"', async () => {
    withStatus({ state: 'off' })
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('URL do servidor'), {
      target: { value: 'https://sync.example.dev' }
    })
    fireEvent.change(screen.getByLabelText('Token de configuração'), {
      target: { value: 'setup' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    await waitFor(() =>
      expect(window.electronAPI.sync.activate).toHaveBeenCalledWith(
        'https://sync.example.dev',
        'setup',
        undefined
      )
    )
    expect(await screen.findByText(/CCCC-DDDD/)).toBeInTheDocument()
    const done = screen.getByRole('button', { name: 'Concluir' })
    expect(done).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Guardei o código'))
    expect(done).toBeEnabled()
  })

  it('entrar com código num aparelho com dados pergunta juntar ou substituir', async () => {
    withStatus({ state: 'off' })
    useKanbanStore.setState({
      notes: [{ id: 'n1' } as never]
    })
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('Código para entrar'), {
      target: { value: 'sagyou-pair:CODIGO' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com código' }))
    expect(
      await screen.findByText(
        'Este aparelho já tem dados. Juntar com a nuvem ou substituir pelos da nuvem?'
      )
    ).toBeInTheDocument()
    expect(window.electronAPI.sync.join).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Juntar' }))
    await waitFor(() =>
      expect(window.electronAPI.sync.join).toHaveBeenCalledWith(
        'sagyou-pair:CODIGO',
        'merge',
        undefined
      )
    )
  })

  it('entrar com código num aparelho vazio junta direto', async () => {
    withStatus({ state: 'off' })
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('Código para entrar'), {
      target: { value: 'sagyou-pair:CODIGO' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com código' }))
    await waitFor(() =>
      expect(window.electronAPI.sync.join).toHaveBeenCalledWith(
        'sagyou-pair:CODIGO',
        'merge',
        undefined
      )
    )
  })
})

// Spec 2026-11-08-recuperacao-codigo.
describe('Sincronização: recuperar', () => {
  const CONFIRM =
    'Os dados deste PC serão substituídos pelos da nuvem. Um backup deste PC é feito antes.'
  const TOAST = 'Sincronização recuperada. Revogue os aparelhos perdidos em Aparelhos.'

  const fill = async (): Promise<void> => {
    fireEvent.change(await screen.findByLabelText('Código de recuperação'), {
      target: { value: 'CODE' }
    })
    fireEvent.change(screen.getByLabelText('Senha de configuração do Worker'), {
      target: { value: 'setup' }
    })
    fireEvent.change(screen.getByLabelText('Código do autenticador ou reserva'), {
      target: { value: '123456' }
    })
  }

  it('mostra a seção e só libera Recuperar com os três campos', async () => {
    withStatus({ state: 'off' })
    render(<SyncSettings onToast={vi.fn()} />)
    expect(await screen.findByText('Perdi todos os aparelhos')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Use quando nenhum aparelho pareado está à mão. Os dados deste PC serão substituídos pelos da nuvem (um backup é feito antes).'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recuperar' })).toBeDisabled()
    await fill()
    expect(screen.getByRole('button', { name: 'Recuperar' })).toBeEnabled()
  })

  it('confirma antes, e Cancelar não chama o motor e mantém os campos', async () => {
    withStatus({ state: 'off' })
    render(<SyncSettings onToast={vi.fn()} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar' }))
    expect(screen.getByText(CONFIRM)).toBeInTheDocument()
    expect(window.electronAPI.sync.recover).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Código de recuperação')).toHaveValue('CODE')
  })

  it('recupera, avisa e limpa os campos', async () => {
    withStatus({ state: 'off' })
    const onToast = vi.fn()
    render(<SyncSettings onToast={onToast} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar e substituir' }))
    await waitFor(() =>
      expect(window.electronAPI.sync.recover).toHaveBeenCalledWith('CODE', 'setup', undefined, {
        totp: '123456'
      })
    )
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(TOAST))
  })

  it('pausado depois do /setup limpa os campos sem dizer que recuperou', async () => {
    withStatus({ state: 'off' })
    vi.mocked(window.electronAPI.sync.recover).mockResolvedValue({
      ok: true,
      status: { ...status, state: 'paused', paused: 'join' }
    } as never)
    const onToast = vi.fn()
    render(<SyncSettings onToast={onToast} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar e substituir' }))
    await waitFor(() => expect(window.electronAPI.sync.recover).toHaveBeenCalled())
    await waitFor(() => expect(onToast).not.toHaveBeenCalledWith(TOAST))
    expect(onToast).not.toHaveBeenCalledWith(TOAST)
  })

  it('um erro mostra a mensagem e mantém os campos', async () => {
    withStatus({ state: 'off' })
    vi.mocked(window.electronAPI.sync.recover).mockResolvedValue({
      ok: false,
      error: 'Código de recuperação inválido.'
    } as never)
    render(<SyncSettings onToast={vi.fn()} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar e substituir' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Código de recuperação inválido.')
    expect(screen.getByLabelText('Código de recuperação')).toHaveValue('CODE')
  })

  it('desligado de novo depois do /setup (401) mostra o erro e mantém os campos', async () => {
    withStatus({ state: 'off' })
    vi.mocked(window.electronAPI.sync.recover).mockResolvedValue({
      ok: true,
      status: { ...status, state: 'off' }
    } as never)
    const onToast = vi.fn()
    render(<SyncSettings onToast={onToast} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar e substituir' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível recuperar a sincronização.'
    )
    expect(screen.getByLabelText('Código de recuperação')).toHaveValue('CODE')
    expect(onToast).not.toHaveBeenCalled()
  })

  it('com a sincronização ativa a seção não aparece', async () => {
    withStatus({ state: 'ok' })
    render(<SyncSettings onToast={vi.fn()} />)
    await screen.findByRole('status')
    expect(screen.queryByText('Perdi todos os aparelhos')).not.toBeInTheDocument()
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

  it('trocar o autenticador manda o código atual digitado', async () => {
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText(/Código atual do autenticador/), {
      target: { value: ' 654321 ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar ou trocar autenticador' }))
    await waitFor(() =>
      expect(window.electronAPI.sync.enrollTotp).toHaveBeenCalledWith({ totp: '654321' })
    )
  })

  it('o primeiro cadastro vai sem código', async () => {
    render(<SyncSettings onToast={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cadastrar ou trocar autenticador' }))
    await waitFor(() => expect(window.electronAPI.sync.enrollTotp).toHaveBeenCalledWith(undefined))
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
