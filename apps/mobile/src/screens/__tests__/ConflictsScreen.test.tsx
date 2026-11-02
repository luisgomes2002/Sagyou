import { act, fireEvent, render, screen } from '@testing-library/react-native'
import type { SyncConflictView, SyncStatus } from '@sagyou/core/sync/engine'
import { SyncUserError } from '@sagyou/core/sync/engine'
import { versionTimeText } from '@sagyou/core/sync/view'
import { seedApp } from '../../__tests__/seed'
import { type AppServices, useApp } from '../../store/app'
import { ConflictsScreen, EMPTY_TEXT, EMPTY_TITLE, ORPHAN_TEXT } from '../ConflictsScreen'

const AT_LOCAL = Date.UTC(2026, 10, 2, 9, 0)
const AT_REMOTE = Date.UTC(2026, 10, 2, 9, 5)

const STATUS: SyncStatus = {
  state: 'ok',
  lastSyncAt: Date.now(),
  pendingCount: 0,
  paused: null,
  deviceName: 'Pixel',
  conflictCount: 1
}

function lww(id = 'c1'): SyncConflictView {
  return {
    id,
    type: 'lww',
    kind: 'task',
    recordId: 't1',
    createdAt: AT_REMOTE,
    local: {
      hlc: 'h1',
      at: AT_LOCAL,
      deviceName: 'Pixel',
      deleted: false,
      payload: { title: 'Comprar pão', priority: 'low' }
    },
    remote: {
      hlc: 'h2',
      at: AT_REMOTE,
      deviceName: 'PC de casa',
      deleted: false,
      payload: { title: 'Comprar pão e leite', priority: 'high' }
    }
  }
}

function orphan(): SyncConflictView {
  return {
    ...lww('c-orfao'),
    type: 'orphan',
    local: { ...lww().local, payload: { title: 'Tarefa solta' } },
    remote: { hlc: null, at: null, deviceName: 'PC de casa', deleted: true, payload: null }
  }
}

function withEngine(list: SyncConflictView[], resolve = jest.fn()): {
  conflicts: jest.Mock
  resolve: jest.Mock
} {
  seedApp()
  const conflicts = jest.fn(() => list)
  const services = useApp.getState().services as AppServices
  useApp.setState({
    status: STATUS,
    services: {
      ...services,
      runtime: { ...services.runtime, engine: { conflicts, resolve } }
    } as unknown as AppServices
  })
  return { conflicts, resolve }
}

describe('ConflictsScreen', () => {
  it('mostra as duas versões e "Usar esta" escolhe a do outro aparelho', async () => {
    const { resolve } = withEngine([lww()])
    await render(<ConflictsScreen />)
    expect(screen.getByText('Task: Comprar pão e leite')).toBeTruthy()
    expect(
      screen.getByLabelText(`Versão deste aparelho, ${versionTimeText(AT_LOCAL)}`)
    ).toBeTruthy()
    expect(
      screen.getByLabelText(`Versão de PC de casa, ${versionTimeText(AT_REMOTE)}`)
    ).toBeTruthy()
    expect(screen.getByText('title: Comprar pão')).toBeTruthy()
    expect(screen.getByText('priority: high')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Usar a versão deste aparelho' })).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Usar a versão de PC de casa' }))
    expect(resolve).toHaveBeenCalledWith('c1', 'remote')
    expect(screen.queryByText('Task: Comprar pão e leite')).toBeNull()
    expect(screen.getByText('Versão escolhida.')).toBeTruthy()
  })

  it('a versão deste aparelho vai como local', async () => {
    const { resolve } = withEngine([lww()])
    await render(<ConflictsScreen />)
    await fireEvent.press(screen.getByRole('button', { name: 'Usar a versão deste aparelho' }))
    expect(resolve).toHaveBeenCalledWith('c1', 'local')
  })

  it('órfão mostra o aviso e Dispensar', async () => {
    const { resolve } = withEngine([orphan()])
    await render(<ConflictsScreen />)
    expect(screen.getByText(ORPHAN_TEXT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Usar a versão/ })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'Dispensar' }))
    expect(resolve).toHaveBeenCalledWith('c-orfao', 'local')
    expect(screen.getByText('Conflito dispensado.')).toBeTruthy()
  })

  it('erro ao escolher mantém o conflito e mostra a mensagem', async () => {
    withEngine(
      [lww()],
      jest.fn(() => {
        throw new SyncUserError('Não foi possível usar esta versão.')
      })
    )
    await render(<ConflictsScreen />)
    await fireEvent.press(screen.getByRole('button', { name: 'Usar a versão de PC de casa' }))
    expect(screen.getByText('Não foi possível usar esta versão.')).toBeTruthy()
    expect(screen.getByText('Task: Comprar pão e leite')).toBeTruthy()
  })

  it('sem conflitos mostra o estado vazio', async () => {
    withEngine([])
    await render(<ConflictsScreen />)
    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy()
    expect(screen.getByText(EMPTY_TEXT)).toBeTruthy()
  })

  it('recarrega quando o status muda (conflito fechado sozinho em outro aparelho)', async () => {
    const list = [lww()]
    const { conflicts } = withEngine(list)
    await render(<ConflictsScreen />)
    expect(screen.getByText('Task: Comprar pão e leite')).toBeTruthy()
    list.length = 0
    await act(async () => {
      useApp.setState({ status: { ...STATUS, conflictCount: 0 } })
    })
    expect(conflicts.mock.calls.length).toBeGreaterThan(1)
    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy()
  })
})
