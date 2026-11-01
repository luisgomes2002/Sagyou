import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateBanner } from '../../components/layout/UpdateBanner'

type Status = Awaited<ReturnType<typeof window.electronAPI.update.status>>

const ready: Status = {
  state: 'ready',
  version: '1.2.0',
  percent: 100,
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

beforeEach(() => {
  vi.clearAllMocks()
  push = undefined
  api.status.mockResolvedValue(ready)
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { update: api }
})

describe('faixa de atualização', () => {
  it('pronta: oferece instalar e depois', async () => {
    render(<UpdateBanner />)
    expect(await screen.findByText('Atualização pronta')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar e instalar' }))
    expect(api.install).toHaveBeenCalled()
  })

  it('"Depois" esconde a faixa sem falar com o main, até o estado mudar', async () => {
    render(<UpdateBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'Depois' }))
    expect(screen.queryByText('Atualização pronta')).toBeNull()
    expect(api.install).not.toHaveBeenCalled()
    await act(async () => push?.({ ...ready, installError: true }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível salvar antes de instalar; tente de novo'
    )
  })

  it('macOS: nova versão com link do Release', async () => {
    api.status.mockResolvedValue({
      ...ready,
      state: 'manual',
      releaseUrl: 'https://github.com/luisgomes2002/Sagyou/releases/tag/v1.2.0'
    })
    render(<UpdateBanner />)
    expect(await screen.findByText('Nova versão disponível')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Release' }))
    expect(api.openRelease).toHaveBeenCalled()
  })

  it('baixando ou sem versão, não aparece', async () => {
    api.status.mockResolvedValue({ ...ready, state: 'downloading', percent: 10 })
    const { container } = render(<UpdateBanner />)
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })
})
