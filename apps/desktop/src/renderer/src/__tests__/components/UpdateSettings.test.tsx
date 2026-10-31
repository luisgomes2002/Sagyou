import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateSettings } from '../../components/settings/UpdateSettings'

type Status = Awaited<ReturnType<typeof window.electronAPI.update.status>>

const base: Status = {
  state: 'none',
  version: null,
  percent: null,
  releaseUrl: null,
  installError: false
}

let push: ((status: Status) => void) | undefined
const api = {
  status: vi.fn<() => Promise<Status>>(),
  check: vi.fn(),
  install: vi.fn(),
  openRelease: vi.fn(),
  onStatusChanged: vi.fn((cb: (status: Status) => void) => {
    push = cb
    return vi.fn()
  })
}

function withStatus(status: Partial<Status>): void {
  api.status.mockResolvedValue({ ...base, ...status })
}

beforeEach(() => {
  vi.clearAllMocks()
  push = undefined
  withStatus({})
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { update: api }
})

describe('Atualizações em Configurações', () => {
  it('verificando', async () => {
    withStatus({ state: 'checking' })
    render(<UpdateSettings />)
    expect(await screen.findByText('Verificando atualizações…')).toBeInTheDocument()
  })

  it('baixando com versão e progresso', async () => {
    withStatus({ state: 'downloading', version: '1.2.0', percent: 43 })
    render(<UpdateSettings />)
    expect(await screen.findByText('Baixando versão 1.2.0 — 43%')).toBeInTheDocument()
  })

  it('pronta: instala ao clicar', async () => {
    withStatus({ state: 'ready', version: '1.2.0', percent: 100 })
    render(<UpdateSettings />)
    expect(await screen.findByText('Atualização pronta')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar e instalar' }))
    expect(api.install).toHaveBeenCalled()
  })

  it('instalação que não salvou mostra o aviso', async () => {
    withStatus({ state: 'ready', version: '1.2.0', installError: true })
    render(<UpdateSettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível salvar antes de instalar; tente de novo'
    )
  })

  it('erro: tentar novamente consulta de novo', async () => {
    withStatus({ state: 'error' })
    render(<UpdateSettings />)
    expect(await screen.findByText('Não foi possível verificar atualizações')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(api.check).toHaveBeenCalled()
  })

  it('macOS: abre o Release', async () => {
    withStatus({
      state: 'manual',
      version: '1.2.0',
      releaseUrl: 'https://github.com/luisgomes2002/Sagyou/releases/tag/v1.2.0'
    })
    render(<UpdateSettings />)
    expect(await screen.findByText('Nova versão disponível')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Release' }))
    expect(api.openRelease).toHaveBeenCalled()
  })

  it('segue as mudanças enviadas pelo main', async () => {
    withStatus({ state: 'checking' })
    render(<UpdateSettings />)
    await screen.findByText('Verificando atualizações…')
    await act(async () => push?.({ ...base, state: 'downloading', version: '1.2.0', percent: 5 }))
    expect(screen.getByText('Baixando versão 1.2.0 — 5%')).toBeInTheDocument()
  })

  it('desligado não mostra estado de atualização', async () => {
    withStatus({ state: 'disabled' })
    render(<UpdateSettings />)
    expect(
      await screen.findByText('Atualização automática só funciona no app instalado.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
