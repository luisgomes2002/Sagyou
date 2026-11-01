import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { useState } from 'react'
import { Pressable, Text } from 'react-native'
import { BottomSheet } from '../../components/BottomSheet'
import { emptyState } from '../../data/state'
import { seedApp } from '../../__tests__/seed'
import { useApp } from '../../store/app'
import { LockGate, type LockDeps } from '../LockGate'
import { useLockState } from '../lockState'
import { LOCKED_TITLE, NO_DEVICE_LOCK_TEXT, UNLOCK_PROMPT } from '../texts'

const SECRET = 'Saldo: R$ 950,00'

interface Harness {
  deps: LockDeps
  authenticate: jest.Mock
  emit: (state: string) => void
  advance: (ms: number) => void
  allow: (ok: boolean) => void
}

function harness(level = 3): Harness {
  let now = 1_000_000
  let ok = true
  const listeners: ((state: string) => void)[] = []
  const authenticate = jest.fn(async () => ({ success: ok }))
  return {
    authenticate,
    deps: {
      getEnrolledLevelAsync: async () => level,
      authenticateAsync: authenticate,
      appState: {
        addEventListener: (_type, listener) => {
          listeners.push(listener)
          return { remove: () => undefined }
        }
      },
      now: () => now
    },
    emit: (state) => listeners.forEach((l) => l(state)),
    advance: (ms) => {
      now += ms
    },
    allow: (value) => {
      ok = value
    }
  }
}

async function mount(h: Harness): Promise<void> {
  await render(
    <LockGate deps={h.deps}>
      <Text>{SECRET}</Text>
    </LockGate>
  )
}

describe('bloqueio do app', () => {
  it('a tela de bloqueio tem a marca do Sagyou e o título', async () => {
    const h = harness()
    h.allow(false)
    await mount(h)
    expect(await screen.findByText(LOCKED_TITLE)).toBeTruthy()
    expect(LOCKED_TITLE).toBe('Sagyou bloqueado')
    expect(screen.getByLabelText('Sagyou')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Desbloquear' })).toBeTruthy()
  })

  it('ao abrir mostra o bloqueio, não o conteúdo, e libera com sucesso', async () => {
    const h = harness()
    h.allow(false)
    await mount(h)
    expect(screen.queryByText(SECRET)).toBeNull()
    // The first prompt fails: the lock screen stays, with a button to try again.
    const retry = await screen.findByRole('button', { name: 'Desbloquear' })
    expect(h.authenticate).toHaveBeenCalledWith({ promptMessage: UNLOCK_PROMPT })
    expect(screen.queryByText(SECRET)).toBeNull()
    h.allow(true)
    await fireEvent.press(retry)
    expect(await screen.findByText(SECRET)).toBeTruthy()
  })

  it('fora por 299 s não pede de novo; por 300 s pede', async () => {
    const h = harness()
    await mount(h)
    expect(await screen.findByText(SECRET)).toBeTruthy()
    expect(h.authenticate).toHaveBeenCalledTimes(1)

    await act(async () => {
      h.emit('background')
      h.advance(299_000)
      h.emit('active')
    })
    expect(screen.getByText(SECRET)).toBeTruthy()
    expect(h.authenticate).toHaveBeenCalledTimes(1)

    h.allow(false)
    await act(async () => {
      h.emit('background')
      h.advance(300_000)
      h.emit('active')
    })
    expect(h.authenticate).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(SECRET)).toBeNull()
  })

  it('sem bloqueio de tela no Android, mostra o aviso e nunca o conteúdo', async () => {
    const h = harness(0)
    await mount(h)
    expect(await screen.findByText(NO_DEVICE_LOCK_TEXT)).toBeTruthy()
    expect(NO_DEVICE_LOCK_TEXT).toBe('Configure um bloqueio de tela no Android para usar o Sagyou.')
    expect(screen.queryByText(SECRET)).toBeNull()
    expect(h.authenticate).not.toHaveBeenCalled()
  })

  // Review finding: re-locking unmounted the app, losing a form in progress.
  it('travar de novo não perde o que estava sendo digitado', async () => {
    function Draft(): React.JSX.Element {
      const [count, setCount] = useState(0)
      return (
        <Pressable accessibilityRole="button" onPress={() => setCount((c) => c + 1)}>
          <Text>{`rascunho ${count}`}</Text>
        </Pressable>
      )
    }
    const h = harness()
    await render(
      <LockGate deps={h.deps}>
        <Draft />
      </LockGate>
    )
    await fireEvent.press(await screen.findByText('rascunho 0'))
    expect(screen.getByText('rascunho 1')).toBeTruthy()
    h.allow(false)
    await act(async () => {
      h.emit('background')
      h.advance(300_000)
      h.emit('active')
    })
    expect(screen.queryByText('rascunho 1')).toBeNull()
    h.allow(true)
    await fireEvent.press(await screen.findByRole('button', { name: 'Desbloquear' }))
    expect(await screen.findByText('rascunho 1')).toBeTruthy()
  })

  it('sem bloqueio de tela, "Tentar de novo" confere de novo depois de configurar', async () => {
    let level = 0
    const h = harness()
    h.deps.getEnrolledLevelAsync = async () => level
    await mount(h)
    expect(await screen.findByText(NO_DEVICE_LOCK_TEXT)).toBeTruthy()
    level = 3
    await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText(SECRET)).toBeTruthy()
  })
})

// Security review: an RN Modal is its own Android window, above the lock
// cover. A sheet left open must close while the app is away or locked.
describe('folhas abertas e o bloqueio', () => {
  afterEach(() => useLockState.setState({ hidden: false }))

  async function withSheet(h: Harness): Promise<void> {
    await render(
      <LockGate deps={h.deps}>
        <BottomSheet visible onClose={() => undefined}>
          <Text>{SECRET}</Text>
        </BottomSheet>
      </LockGate>
    )
  }

  // The test Modal renders nothing while invisible: absent means closed.
  const sheetVisible = (): boolean => screen.queryByTestId('bottom-sheet')?.props.visible === true

  it('some ao ir para segundo plano e volta se a ausência foi curta', async () => {
    const h = harness()
    await withSheet(h)
    expect(await screen.findByText(SECRET)).toBeTruthy()
    await waitFor(() => expect(sheetVisible()).toBe(true))
    await act(async () => h.emit('background'))
    await waitFor(() => expect(sheetVisible()).toBe(false))
    await act(async () => {
      h.advance(10_000)
      h.emit('active')
    })
    await waitFor(() => expect(sheetVisible()).toBe(true))
  })

  it('depois do re-bloqueio fica fechada até desbloquear, e nada grava', async () => {
    const h = harness()
    await withSheet(h)
    await screen.findByText(SECRET)
    seedApp({})
    h.allow(false)
    await act(async () => {
      h.emit('background')
      h.advance(300_000)
      h.emit('active')
    })
    await waitFor(() => expect(sheetVisible()).toBe(false))
    expect(useApp.getState().commit(emptyState())).toBe(false)
    h.allow(true)
    await fireEvent.press(await screen.findByRole('button', { name: 'Desbloquear' }))
    await screen.findByText(SECRET)
    await waitFor(() => expect(sheetVisible()).toBe(true))
    expect(useApp.getState().commit(emptyState())).toBe(true)
  })
})
