import { INVITE_EXPIRED_MESSAGE, SyncUserError } from '@sagyou/core/sync/engine'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { BackHandler } from 'react-native'
import { type AppServices, useApp } from '../../store/app'
import {
  DOWNLOAD_FAILED_TEXT,
  DOWNLOADING_TEXT,
  EXPIRED_TEXT,
  ON_PC_TEXT,
  PAIR_FAILED_TEXT,
  PAIR_STEPS,
  PairScreen,
  WELCOME_TEXT
} from '../PairScreen'
import { RECOVER_TITLE } from '../RecoverSync'

function withJoin(
  join: jest.Mock,
  engine: Record<string, unknown> = { status: () => ({ state: 'ok' }) }
): void {
  useApp.setState({
    mode: 'pair',
    services: {
      runtime: { engine: { join, ...engine } },
      repo: { loadState: jest.fn() }
    } as unknown as AppServices
  })
}

/** Steps 1 → 2: the code field lives on "No PC". */
async function toCodeStep(): Promise<void> {
  await render(<PairScreen />)
  await fireEvent.press(screen.getByRole('button', { name: 'Começar' }))
}

describe('PairScreen', () => {
  it('é um passo a passo: boas-vindas, depois o PC', async () => {
    withJoin(jest.fn())
    await render(<PairScreen />)
    expect(screen.getByText('1 de 3')).toBeTruthy()
    expect(screen.getByText(WELCOME_TEXT)).toBeTruthy()
    expect(WELCOME_TEXT).toBe('Leve suas tarefas, hábitos e finanças no bolso')
    await fireEvent.press(screen.getByRole('button', { name: 'Começar' }))
    expect(screen.getByText('2 de 3')).toBeTruthy()
    expect(screen.getByText(ON_PC_TEXT)).toBeTruthy()
    expect(ON_PC_TEXT).toBe(
      'Abra Configurações → Sincronização → Parear novo aparelho no Sagyou do PC, ou Ajustes → Parear outro aparelho num celular já pareado'
    )
    expect(screen.getByRole('button', { name: 'Ler QR' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Colar código' })).toBeTruthy()
    expect(PAIR_STEPS).toEqual(['Boas-vindas', 'No PC', 'Conectando'])
    // With 200% text or the keyboard up, the code step must scroll.
    expect(screen.getByTestId('pair-scroll').props.keyboardShouldPersistTaps).toBe('handled')
  })

  it('colar um código pareia substituindo os dados e mostra o download', async () => {
    let finish: () => void = () => undefined
    const join = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    withJoin(join)
    await toCodeStep()
    await fireEvent.changeText(screen.getByLabelText('Código de pareamento'), 'sagyou-sync:1:abc')
    await fireEvent.press(screen.getByRole('button', { name: 'Colar código' }))
    expect(await screen.findByText(DOWNLOADING_TEXT)).toBeTruthy()
    expect(join).toHaveBeenCalledWith('sagyou-sync:1:abc', 'replace', 'Pixel de teste')
    await act(async () => finish())
  })

  it('convite vencido mostra o texto do celular', async () => {
    withJoin(jest.fn(async () => Promise.reject(new SyncUserError(INVITE_EXPIRED_MESSAGE))))
    await toCodeStep()
    await fireEvent.changeText(screen.getByLabelText('Código de pareamento'), 'sagyou-sync:1:abc')
    await fireEvent.press(screen.getByRole('button', { name: 'Colar código' }))
    expect(await screen.findByText(EXPIRED_TEXT)).toBeTruthy()
    expect(EXPIRED_TEXT).toBe('Este código expirou. Gere outro no Sagyou do PC.')
  })

  // Review finding: when the first download failed the engine stayed paused
  // ('join') and the app opened empty, never syncing again.
  it('se o download inicial falha, fica no pareamento e tenta de novo pela nuvem', async () => {
    let state = 'paused'
    const resume = jest.fn(async () => {
      state = 'ok'
    })
    withJoin(
      jest.fn(async () => undefined),
      { status: () => ({ state }), resume }
    )
    await toCodeStep()
    await fireEvent.changeText(screen.getByLabelText('Código de pareamento'), 'sagyou-sync:1:abc')
    await fireEvent.press(screen.getByRole('button', { name: 'Colar código' }))
    expect(await screen.findByText(DOWNLOAD_FAILED_TEXT)).toBeTruthy()
    expect(useApp.getState().mode).toBe('pair')
    await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(resume).toHaveBeenCalledWith('take-cloud')
    expect(useApp.getState().mode).toBe('app')
  })

  it('erro que não é do motor vira uma mensagem genérica em pt-BR', async () => {
    withJoin(jest.fn(async () => Promise.reject(new TypeError('Network request failed'))))
    await toCodeStep()
    await fireEvent.changeText(screen.getByLabelText('Código de pareamento'), 'sagyou-sync:1:abc')
    await fireEvent.press(screen.getByRole('button', { name: 'Colar código' }))
    expect(await screen.findByText(PAIR_FAILED_TEXT)).toBeTruthy()
    expect(screen.queryByText('Network request failed')).toBeNull()
  })

  it('o link Como funciona abre o guia ali mesmo e Voltar volta ao passo', async () => {
    withJoin(jest.fn())
    await toCodeStep()
    await fireEvent.press(screen.getByRole('button', { name: 'Como funciona a sincronização' }))
    expect(screen.getByRole('header', { name: 'As chaves da sincronização' })).toBeTruthy()
    await fireEvent.press(screen.getAllByRole('button', { name: 'Voltar' })[0])
    expect(screen.getByText(ON_PC_TEXT)).toBeTruthy()
  })

  // Review finding: without a navigator, the system back left the app.
  it('o voltar do Android fecha o guia em vez de sair do app', async () => {
    withJoin(jest.fn())
    let onBack: (() => boolean) | undefined
    const add = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, handler) => {
      onBack = handler as () => boolean
      return { remove: jest.fn() }
    })
    await toCodeStep()
    await fireEvent.press(screen.getByRole('button', { name: 'Como funciona a sincronização' }))
    expect(add).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function))
    let handled = false
    await act(async () => {
      handled = onBack?.() ?? false
    })
    expect(handled).toBe(true)
    expect(screen.getByText(ON_PC_TEXT)).toBeTruthy()
    add.mockRestore()
  })

  describe('entrar com código de recuperação', () => {
    const CODE = 'ABCD-EFGH-IJKL'
    const TOKEN = 'senha-do-worker'

    async function fill(): Promise<void> {
      await toCodeStep()
      await fireEvent.press(screen.getByRole('button', { name: RECOVER_TITLE }))
      await fireEvent.changeText(screen.getByLabelText('Código de recuperação'), ` ${CODE} `)
      await fireEvent.changeText(screen.getByLabelText('Senha de configuração do Worker'), TOKEN)
      await fireEvent.changeText(
        screen.getByLabelText('Código do autenticador ou reserva'),
        ' 123456 '
      )
    }

    it('chama recover com os três valores e o nome do aparelho', async () => {
      const recover = jest.fn(async () => ({ state: 'ok' }))
      withJoin(jest.fn(), { status: () => ({ state: 'ok' }), recover })
      const paired = jest.fn()
      useApp.setState({ paired })
      await fill()
      await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }))
      expect(recover).toHaveBeenCalledWith(CODE, TOKEN, 'Pixel de teste', { totp: '123456' })
      expect(paired).toHaveBeenCalled()
    })

    it('fator errado mostra a mensagem e mantém os campos, sem log', async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined)
      const message = 'Prova da chave ou código do autenticador inválido.'
      const recover = jest.fn(async () => {
        throw new SyncUserError(message)
      })
      withJoin(jest.fn(), { status: () => ({ state: 'ok' }), recover })
      await fill()
      await fireEvent.press(screen.getByRole('button', { name: 'Entrar' }))
      expect(await screen.findByText(message)).toBeTruthy()
      expect(screen.getByLabelText('Código de recuperação').props.value).toBe(` ${CODE} `)
      expect(screen.getByLabelText('Senha de configuração do Worker').props.value).toBe(TOKEN)
      expect(screen.getByLabelText('Senha de configuração do Worker').props.secureTextEntry).toBe(
        true
      )
      expect(log).not.toHaveBeenCalled()
      log.mockRestore()
    })

    it('Entrar fica desligado até os três campos estarem preenchidos', async () => {
      withJoin(jest.fn())
      await toCodeStep()
      await fireEvent.press(screen.getByRole('button', { name: RECOVER_TITLE }))
      expect(screen.getByRole('button', { name: 'Entrar' }).props.accessibilityState).toMatchObject(
        { disabled: true }
      )
      await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }))
      expect(screen.getByRole('button', { name: 'Colar código' })).toBeTruthy()
    })
  })
})
