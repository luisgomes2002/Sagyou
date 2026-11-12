import type { FinancialDebt, FinancialGoal, FinancialTable } from '@sagyou/core/types'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { format } from 'date-fns'
import { Alert } from 'react-native'
import { T, seedApp, table } from '../../__tests__/seed'
import { expectWrappingActions } from '../../__tests__/wrapping'
import { useLockState } from '../../lock/lockState'
import { useApp } from '../../store/app'
import { OVER_REMAINING_TEXT, lastTablePref } from '../../store/finance'
import { useUndo } from '../../store/undo'
import { FinanceScreen, PICK_TABLE_TEXT } from '../FinanceScreen'

const debt = (
  id: string,
  name: string,
  original: string,
  remaining: string,
  extra: Partial<FinancialDebt> = {}
): FinancialDebt => ({
  id,
  name,
  originalAmount: original,
  remainingAmount: remaining,
  createdAt: T,
  updatedAt: T,
  ...extra
})

const goal = (
  id: string,
  name: string,
  target: string,
  month: number,
  year: number,
  extra: Partial<FinancialGoal> = {}
): FinancialGoal => ({
  id,
  name,
  targetAmount: target,
  targetMonth: month,
  targetYear: year,
  ...extra
})

/** One BRL table; the transactions are the ones the case needs. */
function seed(
  extra: { debts?: FinancialDebt[]; goals?: FinancialGoal[] },
  options: { readOnly?: boolean; transactions?: FinancialTable['transactions'] } = {}
): ReturnType<typeof seedApp> {
  const base = table('conta', 'Conta', 'personal', options.transactions ?? [])
  return seedApp(
    { lists: [{ ...base, debts: extra.debts ?? [], goals: extra.goals ?? [] }] },
    { readOnly: options.readOnly }
  )
}

const current = (): FinancialTable => useApp.getState().state.lists[0]
const buttonOf = (name: string): ReturnType<typeof screen.getByRole> =>
  screen.getByRole('button', { name })

describe('Dívidas no celular', () => {
  const TODAY = '2026-10-31'
  const open = (): Promise<unknown> => render(<FinanceScreen today={TODAY} initialTab="dividas" />)

  beforeEach(() => useUndo.getState().dismiss())
  afterEach(() => jest.restoreAllMocks())

  // Review: Pagar + "Excluir dívida" broke their labels on a 360 dp phone.
  it('as ações da dívida quebram de linha em tela estreita; quitada fica só com Excluir', async () => {
    seed({ debts: [debt('carro', 'Carro', '1000', '1000'), debt('moto', 'Moto', '500', '0')] })
    await open()
    expectWrappingActions('acoes-carro', 2)
    expectWrappingActions('acoes-moto', 1)
  })

  it('Nova dívida cria com o valor canônico e já aparece na lista', async () => {
    const { save } = seed({})
    await open()
    expect(screen.getByText('Nenhuma dívida nesta tabela.')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Nova dívida' }))
    // No name, no button.
    expect(buttonOf('Criar dívida').props.accessibilityState.disabled).toBe(true)
    await fireEvent.changeText(screen.getByLabelText('Nome da dívida'), '  Carro ')
    await fireEvent.changeText(screen.getByLabelText('Valor total (BRL)'), '1500,5')
    await fireEvent.press(screen.getByRole('button', { name: 'Criar dívida' }))
    expect(current().debts).toEqual([
      expect.objectContaining({
        name: 'Carro',
        originalAmount: '1500.5',
        remainingAmount: '1500.5'
      })
    ])
    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Nome da dívida')).toBeNull()
    const id = current().debts![0].id
    expect(screen.getByTestId(`restante-${id}`)).toHaveTextContent('R$ 1.500,50')
    expect(screen.getByTestId(`original-${id}`)).toHaveTextContent('R$ 1.500,50')
  })

  it('valor inválido ou zero na nova dívida diz "Valor inválido." e não grava', async () => {
    const { save } = seed({})
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Nova dívida' }))
    await fireEvent.changeText(screen.getByLabelText('Nome da dívida'), 'Carro')
    for (const raw of ['abc', '0', '-5', '']) {
      await fireEvent.changeText(screen.getByLabelText('Valor total (BRL)'), raw)
      await fireEvent.press(screen.getByRole('button', { name: 'Criar dívida' }))
      expect([raw, screen.queryByText('Valor inválido.') !== null]).toEqual([raw, true])
    }
    expect(current().debts).toEqual([])
    expect(save).not.toHaveBeenCalled()
  })

  it('Pagar grava a dívida e o lançamento num único commit', async () => {
    const { save } = seed({ debts: [debt('carro', 'Carro', '1000', '1000')] })
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar Carro' }))
    await fireEvent.changeText(screen.getByLabelText('Valor pago (BRL)'), '300')
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar' }))
    // Both halves of the payment landed in one save.
    expect(save).toHaveBeenCalledTimes(1)
    expect(current().debts![0]).toMatchObject({ remainingAmount: '700', originalAmount: '1000' })
    expect(current().debts![0].completedAt).toBeUndefined()
    expect(current().transactions).toEqual([
      expect.objectContaining({
        description: 'Pagamento de dívida: Carro',
        amount: '300',
        type: 'expense',
        date: TODAY,
        category: 'Dívidas',
        debtId: 'carro'
      })
    ])
    expect(screen.getByTestId('restante-carro')).toHaveTextContent('R$ 700,00')
    expect(screen.queryByLabelText('Valor pago (BRL)')).toBeNull()
  })

  it('a data do pagamento vem do calendário (Amanhã) e vai para o lançamento', async () => {
    seed({ debts: [debt('carro', 'Carro', '1000', '1000')] })
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar Carro' }))
    await fireEvent.changeText(screen.getByLabelText('Valor pago (BRL)'), '100')
    await fireEvent.press(screen.getByRole('button', { name: 'Amanhã' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar' }))
    expect(current().transactions[0].date).toBe('2026-11-01')
  })

  it('pagar acima do restante mostra o texto exato e não grava nada', async () => {
    const { save } = seed({ debts: [debt('carro', 'Carro', '1000', '400')] })
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar Carro' }))
    await fireEvent.changeText(screen.getByLabelText('Valor pago (BRL)'), '400,01')
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar' }))
    expect(screen.getByText('O pagamento passa do valor restante.')).toBeTruthy()
    expect(OVER_REMAINING_TEXT).toBe('O pagamento passa do valor restante.')
    expect(current().debts![0].remainingAmount).toBe('400')
    expect(current().transactions).toEqual([])
    expect(save).not.toHaveBeenCalled()
    // Typing again clears the notice; the exact remaining is accepted.
    await fireEvent.changeText(screen.getByLabelText('Valor pago (BRL)'), '400')
    expect(screen.queryByText('O pagamento passa do valor restante.')).toBeNull()
  })

  it('pagar valor inválido diz "Valor inválido."', async () => {
    const { save } = seed({ debts: [debt('carro', 'Carro', '1000', '1000')] })
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar Carro' }))
    await fireEvent.changeText(screen.getByLabelText('Valor pago (BRL)'), '0')
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar' }))
    expect(screen.getByText('Valor inválido.')).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })

  it('quitar a dívida a manda para o fim com "Quitada em <data>"', async () => {
    seed({
      debts: [
        debt('antiga', 'Antiga', '200', '0', { completedAt: '2026-10-20T12:00:00.000Z' }),
        debt('carro', 'Carro', '1000', '1000'),
        debt('moto', 'Moto', '500', '500')
      ]
    })
    await open()
    const order = (): unknown[] => screen.getAllByRole('header').map((h) => h.props.children)
    // The settled one is first in the data and last on screen.
    expect(order()).toEqual(['Carro', 'Moto', 'Antiga'])
    expect(screen.getByText('Quitada em 20/10/2026')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pagar Antiga' })).toBeNull()
    expect(screen.queryByTestId('restante-antiga')).toBeNull()

    await fireEvent.press(screen.getByRole('button', { name: 'Pagar Carro' }))
    await fireEvent.changeText(screen.getByLabelText('Valor pago (BRL)'), '1000')
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar' }))
    expect(current().debts!.find((d) => d.id === 'carro')).toMatchObject({
      remainingAmount: '0',
      completedAt: expect.any(String)
    })
    expect(order()).toEqual(['Moto', 'Antiga', 'Carro'])
    expect(screen.getByText(`Quitada em ${format(new Date(), 'dd/MM/yyyy')}`)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pagar Carro' })).toBeNull()
  })

  it('excluir a dívida confirma com o nome e mantém os pagamentos como lançamentos', async () => {
    const { save } = seed(
      { debts: [debt('carro', 'Carro', '1000', '700')] },
      {
        transactions: [
          {
            id: 'p1',
            description: 'Pagamento de dívida: Carro',
            amount: '300',
            type: 'expense',
            date: '2026-10-10',
            category: 'Dívidas',
            debtId: 'carro'
          }
        ]
      }
    )
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Excluir dívida Carro' }))
    expect(alert).toHaveBeenCalledWith('Excluir Carro?', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: expect.any(Function) }
    ])
    expect(current().debts).toHaveLength(1)
    expect(save).not.toHaveBeenCalled()
    await act(async () => {
      alert.mock.calls[0][2]!.find((b) => b.text === 'Excluir')?.onPress?.()
    })
    expect(current().debts).toEqual([])
    // The payment stays, only unlinked, and the balance of the table is the same.
    expect(current().transactions).toEqual([
      expect.objectContaining({ id: 'p1', amount: '300', debtId: undefined })
    ])
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('cancelar a confirmação não apaga nada', async () => {
    const { save } = seed({ debts: [debt('carro', 'Carro', '1000', '1000')] })
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Excluir dívida Carro' }))
    expect(alert.mock.calls[0][2]!.find((b) => b.text === 'Cancelar')?.onPress).toBeUndefined()
    expect(current().debts).toHaveLength(1)
    expect(save).not.toHaveBeenCalled()
  })

  it('fechar a folha com algo digitado pergunta "Descartar?"', async () => {
    seed({ debts: [debt('carro', 'Carro', '1000', '1000')] })
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar Carro' }))
    // Untouched: closes with no question.
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }))
    expect(alert).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar Carro' }))
    await fireEvent.changeText(screen.getByLabelText('Valor pago (BRL)'), '50')
    await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }))
    expect(alert.mock.calls[0][0]).toBe('Descartar?')
  })

  it('só leitura: Nova dívida, Pagar e Excluir dívida ficam desabilitados', async () => {
    const { save } = seed({ debts: [debt('carro', 'Carro', '1000', '1000')] }, { readOnly: true })
    await open()
    for (const name of ['Nova dívida', 'Pagar Carro', 'Excluir dívida Carro'])
      expect([name, buttonOf(name).props.accessibilityState.disabled]).toEqual([name, true])
    expect(save).not.toHaveBeenCalled()
  })

  it('no Consolidado a aba pede uma tabela', async () => {
    seed({})
    useApp.getState().services?.repo.writePref(lastTablePref('personal'), 'all')
    await open()
    expect(screen.getByText(PICK_TABLE_TEXT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Nova dívida' })).toBeNull()
  })

  describe('bloqueio', () => {
    afterEach(() => useLockState.setState({ hidden: false }))

    it('a folha de pagamento fecha atrás da tela de bloqueio, sem gravar', async () => {
      const { save } = seed({ debts: [debt('carro', 'Carro', '1000', '1000')] })
      await open()
      await fireEvent.press(screen.getByRole('button', { name: 'Pagar Carro' }))
      await fireEvent.changeText(screen.getByLabelText('Valor pago (BRL)'), '300')
      await act(async () => {
        useLockState.setState({ hidden: true })
      })
      expect(screen.queryByLabelText('Valor pago (BRL)')).toBeNull()
      expect(save).not.toHaveBeenCalled()
      await act(async () => {
        useLockState.setState({ hidden: false })
      })
      expect(screen.getByLabelText('Valor pago (BRL)').props.value).toBe('300')
    })
  })
})

describe('Metas financeiras no celular', () => {
  // Contas worked out by hand. Balance up to the 15th: 500 (the 25th's 300 is still future).
  const TXS: FinancialTable['transactions'] = [
    { id: 'a', description: 'Salário', amount: '500', type: 'income', date: '2026-10-01' },
    { id: 'b', description: 'Extra', amount: '300', type: 'income', date: '2026-10-25' }
  ]
  const TODAY = '2026-10-15'
  const open = (): Promise<unknown> => render(<FinanceScreen today={TODAY} initialTab="metas" />)

  beforeEach(() => useUndo.getState().dismiss())
  afterEach(() => jest.restoreAllMocks())

  // Review: Editar + Concluir + Excluir (three buttons) broke their labels on a 360 dp phone.
  it('as ações da meta quebram de linha em tela estreita (3 botões, também ao reabrir)', async () => {
    seed(
      {
        goals: [
          goal('g1', 'Viagem', '1000', 12, 2026),
          goal('g4', 'Feita', '100', 6, 2026, { completedAt: '2026-10-10' })
        ]
      },
      { transactions: TXS }
    )
    await open()
    expectWrappingActions('acoes-g1', 3)
    expectWrappingActions('acoes-g4', 3)
  })

  it('lista nome, valor alvo, prazo e o progresso do mês escolhido', async () => {
    seed(
      {
        goals: [
          goal('g1', 'Viagem', '1000', 12, 2026),
          goal('g3', 'Curso', '5000', 8, 2026),
          goal('g4', 'Feita', '100', 6, 2026, {
            completedAt: '2026-10-10',
            completionNote: 'Meta batida'
          })
        ]
      },
      { transactions: TXS }
    )
    await open()
    expect(screen.getByText('Meta de R$ 1.000,00 até Dezembro de 2026')).toBeTruthy()
    // 500 of 1000 on the 15th: half, 500 saved and 500 to go; two months left to the deadline.
    expect(screen.getByTestId('percent-g1')).toHaveTextContent('50%')
    expect(screen.getByTestId('acumulado-g1')).toHaveTextContent('R$ 500,00')
    expect(screen.getByTestId('faltam-g1')).toHaveTextContent('R$ 500,00')
    expect(screen.getByText('2 meses restantes')).toBeTruthy()
    expect(screen.getByText('Economizar R$ 250,00/mês para atingir no prazo')).toBeTruthy()
    // The overdue goal: deadline before the month, 500 of 5000 is not enough.
    expect(screen.getByText('Atrasada')).toBeTruthy()
    expect(screen.getByTestId('percent-g3')).toHaveTextContent('0%')
    // Not achieved first (by deadline), the completed one last.
    expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual([
      'Curso',
      'Viagem',
      'Feita'
    ])
  })

  it('a concluída mostra a data e a nota, e some o botão Concluir', async () => {
    seed(
      {
        goals: [
          goal('g4', 'Feita', '100', 6, 2026, {
            completedAt: '2026-10-10',
            completionNote: 'Meta batida'
          })
        ]
      },
      { transactions: TXS }
    )
    await open()
    expect(screen.getByText('Concluída')).toBeTruthy()
    expect(screen.getByText('Concluída em 10/10/2026')).toBeTruthy()
    expect(screen.getByTestId('nota-g4')).toHaveTextContent('Meta batida')
    expect(screen.getByTestId('percent-g4')).toHaveTextContent('100%')
    expect(screen.queryByRole('button', { name: 'Concluir Feita' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reabrir Feita' })).toBeTruthy()
  })

  it('"projetado": só os lançamentos futuros alcançam a meta', async () => {
    seed({ goals: [goal('g2', 'Reserva', '700', 6, 2027)] }, { transactions: TXS })
    await open()
    // On the 15th: 500 of 700, nothing special.
    expect(screen.getByTestId('percent-g2')).toHaveTextContent(/^71%$/)
    expect(screen.queryByText('Projetada')).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'Próximo mês' }))
    // November: 800 counting the 25th, but only 500 has happened.
    expect(screen.getByText('Projetada')).toBeTruthy()
    expect(screen.getByTestId('percent-g2')).toHaveTextContent('100% · só com lançamentos futuros')
    expect(screen.getByTestId('faltam-g2')).toHaveTextContent('R$ 0,00')
    expect(screen.getByTestId('acumulado-g2')).toHaveTextContent('R$ 700,00')
  })

  it('Nova meta cria com o valor canônico, o mês e o ano escolhidos', async () => {
    const { save } = seed({}, { transactions: TXS })
    await open()
    expect(screen.getByText('Nenhuma meta nesta tabela.')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Nova meta' }))
    expect(buttonOf('Criar meta').props.accessibilityState.disabled).toBe(true)
    // The deadline starts at the current month and year.
    expect(screen.getByRole('button', { name: 'Mês do prazo ▸ Outubro' })).toBeTruthy()
    expect(screen.getByLabelText('Ano do prazo').props.value).toBe('2026')
    await fireEvent.changeText(screen.getByLabelText('Nome da meta'), ' Notebook ')
    await fireEvent.changeText(screen.getByLabelText('Valor necessário (BRL)'), '2500,5')
    await fireEvent.press(screen.getByRole('button', { name: 'Mês do prazo ▸ Outubro' }))
    await fireEvent.press(screen.getByRole('radio', { name: 'Março' }))
    await fireEvent.changeText(screen.getByLabelText('Ano do prazo'), '2027')
    await fireEvent.press(screen.getByRole('button', { name: 'Criar meta' }))
    expect(current().goals).toEqual([
      expect.objectContaining({
        name: 'Notebook',
        targetAmount: '2500.5',
        targetMonth: 3,
        targetYear: 2027
      })
    ])
    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Meta de R$ 2.500,50 até Março de 2027')).toBeTruthy()
  })

  it('valor ou ano inválido não gravam e dizem o motivo', async () => {
    const { save } = seed({}, { transactions: TXS })
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Nova meta' }))
    await fireEvent.changeText(screen.getByLabelText('Nome da meta'), 'Notebook')
    await fireEvent.changeText(screen.getByLabelText('Valor necessário (BRL)'), '0')
    await fireEvent.press(screen.getByRole('button', { name: 'Criar meta' }))
    expect(screen.getByText('Valor inválido.')).toBeTruthy()
    await fireEvent.changeText(screen.getByLabelText('Valor necessário (BRL)'), '100')
    await fireEvent.changeText(screen.getByLabelText('Ano do prazo'), '2025')
    await fireEvent.press(screen.getByRole('button', { name: 'Criar meta' }))
    expect(screen.getByText('Informe um ano válido.')).toBeTruthy()
    expect(current().goals).toEqual([])
    expect(save).not.toHaveBeenCalled()
  })

  it('Editar muda só o que mudou e mantém o resto da meta', async () => {
    const { save } = seed(
      { goals: [goal('g1', 'Viagem', '1000.123', 12, 2026)] },
      { transactions: TXS }
    )
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Editar Viagem' }))
    expect(screen.getByLabelText('Nome da meta').props.value).toBe('Viagem')
    await fireEvent.changeText(screen.getByLabelText('Nome da meta'), 'Viagem Japão')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    // The legacy target with three decimals is not rounded by a save that did not touch it.
    expect(current().goals[0]).toMatchObject({
      name: 'Viagem Japão',
      targetAmount: '1000.123',
      targetMonth: 12,
      targetYear: 2026
    })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('Editar sem mudar nada fecha sem gravar', async () => {
    const { save } = seed(
      { goals: [goal('g1', 'Viagem', '1000', 12, 2026)] },
      { transactions: TXS }
    )
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Editar Viagem' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.queryByLabelText('Nome da meta')).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('uma meta atrasada continua editável (o ano antigo dela vale)', async () => {
    seed({ goals: [goal('g3', 'Curso', '5000', 8, 2025)] }, { transactions: TXS })
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Editar Curso' }))
    await fireEvent.changeText(screen.getByLabelText('Nome da meta'), 'Curso de japonês')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(current().goals[0]).toMatchObject({ name: 'Curso de japonês', targetYear: 2025 })
  })

  it('Excluir confirma com o nome e só apaga ao confirmar', async () => {
    const { save } = seed(
      { goals: [goal('g1', 'Viagem', '1000', 12, 2026)] },
      { transactions: TXS }
    )
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Excluir Viagem' }))
    expect(alert.mock.calls[0][0]).toBe('Excluir Viagem?')
    expect(current().goals).toHaveLength(1)
    expect(save).not.toHaveBeenCalled()
    await act(async () => {
      alert.mock.calls[0][2]!.find((b) => b.text === 'Excluir')?.onPress?.()
    })
    expect(current().goals).toEqual([])
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('Concluir pede a data e a nota; Reabrir devolve a meta ao progresso', async () => {
    const { save } = seed(
      { goals: [goal('g1', 'Viagem', '1000', 12, 2026)] },
      { transactions: TXS }
    )
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Concluir Viagem' }))
    // The day starts today and comes from the calendar chips, never typed.
    expect(screen.getByRole('button', { name: 'Hoje' }).props.accessibilityState.selected).toBe(
      true
    )
    await fireEvent.changeText(screen.getByLabelText('Descrição (opcional)'), '  Fechei antes  ')
    await fireEvent.press(screen.getByRole('button', { name: 'Concluir meta' }))
    expect(current().goals[0]).toMatchObject({
      completedAt: '2026-10-15',
      completionNote: 'Fechei antes'
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Concluída')).toBeTruthy()
    expect(screen.getByText('Concluída em 15/10/2026')).toBeTruthy()
    expect(screen.getByTestId('nota-g1')).toHaveTextContent('Fechei antes')
    expect(screen.getByTestId('percent-g1')).toHaveTextContent('100%')

    await fireEvent.press(screen.getByRole('button', { name: 'Reabrir Viagem' }))
    expect(current().goals[0].completedAt).toBeUndefined()
    expect(current().goals[0].completionNote).toBeUndefined()
    expect(save).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Concluída')).toBeNull()
    expect(screen.getByTestId('percent-g1')).toHaveTextContent('50%')
  })

  it('Concluir sem nota não grava nota', async () => {
    seed({ goals: [goal('g1', 'Viagem', '1000', 12, 2026)] }, { transactions: TXS })
    await open()
    await fireEvent.press(screen.getByRole('button', { name: 'Concluir Viagem' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Concluir meta' }))
    expect(current().goals[0].completedAt).toBe('2026-10-15')
    expect(current().goals[0].completionNote).toBeUndefined()
  })

  it('só leitura: todo botão de escrita fica desabilitado', async () => {
    const { save } = seed(
      {
        goals: [
          goal('g1', 'Viagem', '1000', 12, 2026),
          goal('g4', 'Feita', '100', 6, 2026, { completedAt: '2026-10-10' })
        ]
      },
      { readOnly: true, transactions: TXS }
    )
    await open()
    for (const name of [
      'Nova meta',
      'Editar Viagem',
      'Concluir Viagem',
      'Excluir Viagem',
      'Reabrir Feita'
    ])
      expect([name, buttonOf(name).props.accessibilityState.disabled]).toEqual([name, true])
    expect(save).not.toHaveBeenCalled()
  })

  it('no Consolidado a aba pede uma tabela', async () => {
    seed({})
    useApp.getState().services?.repo.writePref(lastTablePref('personal'), 'all')
    await open()
    expect(screen.getByText(PICK_TABLE_TEXT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Nova meta' })).toBeNull()
  })
})
