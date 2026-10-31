import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RestoreSyncDialog } from '../../components/modals/RestoreSyncDialog'
import { syncAsksAfterRestore } from '../../utils/sync-view'

const afterRestore = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  afterRestore.mockResolvedValue({ ok: true, status: {} })
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { sync: { afterRestore } }
})

describe('pergunta depois de restaurar um backup', () => {
  it('só pergunta com o sync ligado', () => {
    expect(syncAsksAfterRestore('off')).toBe(false)
    expect(syncAsksAfterRestore('no-keychain')).toBe(false)
    expect(syncAsksAfterRestore('disconnected')).toBe(false)
    expect(syncAsksAfterRestore('ok')).toBe(true)
    expect(syncAsksAfterRestore('offline')).toBe(true)
    expect(syncAsksAfterRestore('paused')).toBe(true)
    expect(syncAsksAfterRestore('update-pending')).toBe(true)
  })

  it('mostra a pergunta da spec', () => {
    render(<RestoreSyncDialog open onDone={vi.fn()} />)
    expect(screen.getByText('Restaurar também nos outros aparelhos?')).toBeInTheDocument()
  })

  it('"Sim" propaga', async () => {
    const onDone = vi.fn()
    render(<RestoreSyncDialog open onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sim, restaurar nos outros' }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(afterRestore).toHaveBeenCalledWith('propagate')
  })

  it('"Não" pausa', async () => {
    const onDone = vi.fn()
    render(<RestoreSyncDialog open onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Não, só neste aparelho' }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(afterRestore).toHaveBeenCalledWith('pause')
  })

  it('fechar sem escolher pausa, para não espalhar a restauração sem querer', async () => {
    const onDone = vi.fn()
    render(<RestoreSyncDialog open onDone={onDone} />)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(afterRestore).toHaveBeenCalledWith('pause')
  })

  it('fechado não mostra nada', () => {
    const { container } = render(<RestoreSyncDialog open={false} onDone={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
