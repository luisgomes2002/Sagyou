import { INVITE_EXPIRED_MESSAGE } from '@sagyou/core/sync/engine'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { type AppServices, useApp } from '../../store/app'
import { DOWNLOADING_TEXT, EXPIRED_TEXT, PairScreen } from '../PairScreen'

function withJoin(join: jest.Mock): void {
  useApp.setState({
    mode: 'pair',
    services: {
      runtime: { engine: { join } },
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
})
