import { INVITE_EXPIRED_MESSAGE } from '@sagyou/core/sync/engine'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { type AppServices, useApp } from '../../store/app'
import {
  DOWNLOAD_FAILED_TEXT,
  DOWNLOADING_TEXT,
  EXPIRED_TEXT,
  PAIR_FAILED_TEXT,
  PairScreen
} from '../PairScreen'

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

describe('PairScreen', () => {
  it('colar um código pareia substituindo os dados e mostra o download', async () => {
    let finish: () => void = () => undefined
    const join = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    withJoin(join)
    await render(<PairScreen />)
    await fireEvent.changeText(screen.getByLabelText('Código de pareamento'), 'sagyou-sync:1:abc')
    await fireEvent.press(screen.getByRole('button', { name: 'Colar código' }))
    expect(await screen.findByText(DOWNLOADING_TEXT)).toBeTruthy()
    expect(join).toHaveBeenCalledWith('sagyou-sync:1:abc', 'replace', 'Pixel de teste')
    await act(async () => finish())
  })

  it('convite vencido mostra o texto do celular', async () => {
    withJoin(jest.fn(async () => Promise.reject(new Error(INVITE_EXPIRED_MESSAGE))))
    await render(<PairScreen />)
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
    await render(<PairScreen />)
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
    await render(<PairScreen />)
    await fireEvent.changeText(screen.getByLabelText('Código de pareamento'), 'sagyou-sync:1:abc')
    await fireEvent.press(screen.getByRole('button', { name: 'Colar código' }))
    expect(await screen.findByText(PAIR_FAILED_TEXT)).toBeTruthy()
    expect(screen.queryByText('Network request failed')).toBeNull()
  })
})
