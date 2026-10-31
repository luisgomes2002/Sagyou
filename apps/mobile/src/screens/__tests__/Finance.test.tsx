import { fireEvent, render, screen } from '@testing-library/react-native'
import { emptyState, type MobileState } from '../../data/state'
import { type AppServices, useApp } from '../../store/app'
import { LOCKED_TEXT, lastTablePref } from '../../store/finance'
import { FinanceScreen } from '../FinanceScreen'

const T = '2026-10-01T00:00:00.000Z'

function table(
  id: string,
  name: string,
  currency: 'BRL' | 'JPY',
  profileId: string,
  transactions: MobileState['lists'][number]['transactions'] = []
): MobileState['lists'][number] {
  return {
    id,
    name,
    currency,
    profileId,
    items: [],
    goals: [],
    transactions,
    createdAt: T,
    updatedAt: T
  }
}

function seed(prefs: Record<string, string> = {}): void {
  const state = emptyState()
  state.lists = [
    table('conta', 'Conta', 'BRL', 'personal', [
      { id: 'a', description: 'Salário', amount: '1000', type: 'income', date: '2026-10-05' },
      {
        id: 'b',
        description: 'Parcela',
        amount: '50',
        type: 'expense',
        date: '2026-10-06',
        debtId: 'd'
      }
    ]),
    table('cartao', 'Cartão', 'BRL', 'personal'),
    table('yen', '円 do trabalho', 'JPY', 'trabalho', [
      { id: 'c', description: 'Ramen', amount: '1200', type: 'expense', date: '2026-10-07' }
    ])
  ]
  useApp.setState({
    state,
    profileId: 'personal',
    readOnly: false,
    services: {
      repo: {
        save: jest.fn(),
        readPref: (key: string) => prefs[key] ?? null,
        writePref: jest.fn()
      },
      runtime: { engine: { notifySaved: jest.fn() } }
    } as unknown as AppServices
  })
}

describe('Finanças no celular', () => {
  it('esconde as tabelas de outro perfil', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    expect(screen.getByRole('button', { name: 'Conta' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cartão' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '円 do trabalho' })).toBeNull()
  })

  it('a última tabela usada volta pré-selecionada', async () => {
    seed({ [lastTablePref('personal')]: 'cartao' })
    await render(<FinanceScreen today="2026-10-31" />)
    expect(screen.getByRole('button', { name: 'Cartão' })).toBeSelected()
  })

  it('o saldo é só da tabela escolhida, na moeda dela', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    // 1000 - 50 in BRL; the JPY table of the other profile never enters.
    expect(screen.getByTestId('saldo')).toHaveTextContent(/950,00/)
    expect(screen.getByTestId('saldo')).not.toHaveTextContent(/1\.?200|¥/)
  })

  it('lança um gasto com o valor lido na moeda da tabela', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: 'Novo gasto' }))
    await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '1.234,56')
    await fireEvent.changeText(screen.getByLabelText('Descrição'), 'Almoço')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    const created = useApp
      .getState()
      .state.lists[0].transactions.find((t) => t.description === 'Almoço')
    expect(created).toMatchObject({ amount: '1234.56', type: 'expense' })
  })

  it('um pagamento de dívida não abre para edição', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: 'Parcela' }))
    expect(screen.getByText(LOCKED_TEXT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
  })
})
