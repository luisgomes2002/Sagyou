import { fireEvent, render, screen } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { seedApp, table } from '../../__tests__/seed'
import { useApp } from '../../store/app'
import { LOCKED_TEXT, lastTablePref } from '../../store/finance'
import { useUndo } from '../../store/undo'
import { lightTheme } from '../../theme'
import { FinanceScreen } from '../FinanceScreen'

function seed(prefs: Record<string, string> = {}): ReturnType<typeof seedApp> {
  return seedApp(
    {
      lists: [
        table('conta', 'Conta', 'personal', [
          {
            id: 'a',
            description: 'Salário',
            amount: '1000',
            type: 'income',
            date: '2026-10-30',
            category: 'Salário'
          },
          {
            id: 'b',
            description: 'Parcela',
            amount: '50',
            type: 'expense',
            date: '2026-10-31',
            debtId: 'd'
          },
          {
            id: 'e',
            description: 'Almoço',
            amount: '30',
            type: 'expense',
            date: '2026-10-31',
            category: 'Alimentação'
          }
        ]),
        table('cartao', 'Cartão', 'personal', [
          { id: 'f', description: 'Tênis', amount: '400', type: 'expense', date: '2026-10-20' }
        ]),
        table(
          'yen',
          '円 do trabalho',
          'trabalho',
          [{ id: 'c', description: 'Ramen', amount: '1200', type: 'expense', date: '2026-10-07' }],
          'JPY'
        )
      ]
    },
    { prefs }
  )
}

describe('Finanças no celular', () => {
  beforeEach(() => useUndo.getState().dismiss())

  it('o seletor mostra a tabela e lista só as do perfil', async () => {
    const { writePref } = seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: 'Tabela ▸ Conta' }))
    expect(screen.getByRole('radio', { name: 'Conta' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Cartão' })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: '円 do trabalho' })).toBeNull()
    await fireEvent.press(screen.getByRole('radio', { name: 'Cartão' }))
    expect(screen.getByRole('button', { name: 'Tabela ▸ Cartão' })).toBeTruthy()
    expect(writePref).toHaveBeenCalledWith(lastTablePref('personal'), 'cartao')
  })

  it('a última tabela usada volta pré-selecionada', async () => {
    seed({ [lastTablePref('personal')]: 'cartao' })
    await render(<FinanceScreen today="2026-10-31" />)
    expect(screen.getByRole('button', { name: 'Tabela ▸ Cartão' })).toBeTruthy()
  })

  it('o resumo mostra saldo, entradas e saídas do mês na moeda da tabela', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    expect(screen.getByText('Saldo atual')).toBeTruthy()
    // 1000 - 50 - 30 in BRL; the JPY table of the other profile never enters.
    expect(screen.getByTestId('saldo')).toHaveTextContent(/920,00/)
    expect(screen.getByTestId('saldo')).not.toHaveTextContent(/1\.?200|¥/)
    expect(screen.getByText('Entradas do mês')).toBeTruthy()
    expect(screen.getByTestId('entradas')).toHaveTextContent(/1\.000,00/)
    expect(screen.getByText('Saídas do mês')).toBeTruthy()
    expect(screen.getByTestId('saidas')).toHaveTextContent(/80,00/)
  })

  it('com fonte grande os valores encolhem até 0,85 e a descrição quebra', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    for (const id of ['saldo', 'entradas', 'saidas']) {
      const el = screen.getByTestId(id)
      expect([id, el.props.adjustsFontSizeToFit, el.props.minimumFontScale]).toEqual([
        id,
        true,
        0.85
      ])
    }
    expect(screen.getByText('Almoço').props.numberOfLines).toBe(2)
  })

  it('saldo negativo fica vermelho', async () => {
    seed({ [lastTablePref('personal')]: 'cartao' })
    await render(<FinanceScreen today="2026-10-31" />)
    expect(StyleSheet.flatten(screen.getByTestId('saldo').props.style).color).toBe(lightTheme.red)
  })

  it('lista agrupada por dia, com o ícone da categoria', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual(['Hoje', 'Ontem'])
    expect(screen.getByTestId('cat-Alimentação')).toBeTruthy()
  })

  it('os botões de novo gasto e receita saem: criar vem do (+)', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    expect(screen.queryByRole('button', { name: 'Novo gasto' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nova receita' })).toBeNull()
  })

  it('um pagamento de dívida não abre: só um aviso', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: /^Parcela,/ }))
    expect(useUndo.getState()).toMatchObject({ message: LOCKED_TEXT, canUndo: false })
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
  })

  it('editar abre a folha com a data do lançamento e salva com auditoria', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: /^Almoço,/ }))
    expect(screen.getByLabelText('Valor (BRL)').props.value).toBe('30,00')
    await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '1.234,56')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    const edited = useApp.getState().state.lists[0].transactions.find((t) => t.id === 'e')
    expect(edited).toMatchObject({ amount: '1234.56', date: '2026-10-31', type: 'expense' })
    expect(edited?.audit?.length).toBeGreaterThan(0)
  })
})
