import { YIELD_SUMMARY_CATEGORY } from '@sagyou/core/yieldSummary'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { seedApp, table } from '../../__tests__/seed'
import type { MobileState } from '../../data/state'
import { useLockState } from '../../lock/lockState'
import { useApp } from '../../store/app'
import {
  DELETE_LOCKED_TEXT,
  DETAILS_EXCEED_TEXT,
  LOCKED_TEXT,
  YIELD_LOCKED_TEXT
} from '../../store/finance'
import { TransactionDetailScreen } from '../finance/TransactionDetailScreen'

type Tx = MobileState['lists'][number]['transactions'][number]

const T = '2026-10-01T00:00:00.000Z'

const lunch: Tx = {
  id: 'e',
  description: 'Almoço',
  amount: '30',
  type: 'expense',
  date: '2026-10-31',
  category: 'Alimentação',
  source: 'Nubank',
  counterparty: 'Restaurante Bom',
  bankReference: 'E123',
  createdAt: '2026-10-31T15:30:00.000Z',
  reconciledAt: '2026-11-01',
  receiptFileIds: ['r1'],
  audit: [
    { at: '2026-10-31T16:00:00.000Z', changes: [{ field: 'amount', before: '25', after: '30' }] },
    { at: '2026-10-31T17:00:00.000Z', changes: [{ field: 'source', after: 'Nubank' }] }
  ]
}
const invoice: Tx = {
  id: 'fat',
  description: 'Fatura do cartão',
  amount: '100',
  type: 'expense',
  date: '2026-10-31',
  details: [
    { id: 'i1', description: 'Mercado', amount: '60', category: 'Alimentação', date: '2026-10-05' },
    { id: 'i2', description: 'Farmácia', amount: '40' }
  ]
}
const payment: Tx = {
  id: 'pay',
  description: 'Pagamento de dívida: Carro',
  amount: '50',
  type: 'expense',
  date: '2026-10-20',
  debtId: 'd1'
}
const summary: Tx = {
  id: 'ys',
  description: 'Rendimentos Outubro 2026',
  amount: '10',
  type: 'income',
  date: '2026-10-01',
  category: YIELD_SUMMARY_CATEGORY
}
const transfer: Tx = {
  id: 'xfer',
  description: 'Câmbio',
  amount: '100',
  type: 'expense',
  date: '2026-10-15',
  currencyTransferId: 'g1'
}
const linkedInvoice: Tx = {
  id: 'inv',
  description: 'Fatura vinculada',
  amount: '90',
  type: 'expense',
  date: '2026-10-10',
  details: [{ id: 'k1', description: 'Item', amount: '90', linkedTransactionId: 'mirror' }]
}
const mirror: Tx = {
  id: 'mirror',
  description: 'Espelho',
  amount: '90',
  type: 'expense',
  date: '2026-10-10'
}

function seed(options: { readOnly?: boolean } = {}): ReturnType<typeof seedApp> {
  const conta = table('conta', 'Conta', 'personal', [
    lunch,
    invoice,
    payment,
    summary,
    transfer,
    linkedInvoice
  ])
  conta.debts = [
    {
      id: 'd1',
      name: 'Carro',
      originalAmount: '200',
      remainingAmount: '100',
      createdAt: T,
      updatedAt: T
    }
  ]
  return seedApp({ lists: [conta, table('cartao', 'Cartão', 'personal', [mirror])] }, options)
}

const open = async (txId: string, tableId = 'conta'): Promise<jest.Mock> => {
  const goBack = jest.fn()
  await render(
    <TransactionDetailScreen route={{ params: { tableId, txId } }} navigation={{ goBack }} />
  )
  return goBack
}
const find = (id: string): Tx | undefined =>
  useApp
    .getState()
    .state.lists.flatMap((t) => t.transactions)
    .find((t) => t.id === id)
/** Presses the "Excluir" of the confirmation the screen raised. */
const confirm = async (alert: jest.SpyInstance, button: 'Excluir' | 'Cancelar'): Promise<void> => {
  await act(async () => {
    alert.mock.calls[0][2]?.find((b: { text?: string }) => b.text === button)?.onPress?.()
  })
}

describe('detalhes do lançamento', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    useLockState.setState({ hidden: false })
  })

  it('mostra valor, tipo, data, categoria, origem, pessoa, referência, criado e conferido em', async () => {
    seed()
    await open('e')
    expect(screen.getByText('Almoço')).toBeTruthy()
    expect(screen.getByTestId('valor')).toHaveTextContent(/30,00/)
    for (const text of [
      'Conta',
      'Gasto',
      '31/10/2026',
      'Alimentação',
      'Nubank',
      'Restaurante Bom',
      'E123',
      '01/11/2026'
    ])
      expect([text, screen.queryByText(text) !== null]).toEqual([text, true])
    for (const label of ['Origem', 'Pessoa', 'Referência', 'Criado em', 'Conferido em'])
      expect([label, screen.queryByText(label) !== null]).toEqual([label, true])
    // The creation moment, to the minute (the hour depends on the time zone of the test run).
    expect(screen.getAllByText(/^\d{2}\/\d{2}\/2026 \d{2}:\d{2}$/).length).toBeGreaterThan(0)
  })

  it('lista o histórico de alterações, com as mudanças de cada entrada', async () => {
    seed()
    await open('e')
    expect(screen.getByText('Histórico de alterações')).toBeTruthy()
    expect(screen.getByText('Valor: R$ 25,00 → R$ 30,00')).toBeTruthy()
    expect(screen.getByText('Origem: vazio → Nubank')).toBeTruthy()
  })

  it('mostra os itens de uma fatura', async () => {
    seed()
    await open('fat')
    expect(screen.getByText('Itens da fatura')).toBeTruthy()
    expect(screen.getByText('Mercado')).toBeTruthy()
    expect(screen.getByText('Farmácia')).toBeTruthy()
    expect(screen.getByText('R$ 60,00')).toBeTruthy()
    expect(screen.getByText('Alimentação · 05/10/2026')).toBeTruthy()
  })

  it('abrir e voltar sem editar não grava nada', async () => {
    const { save } = seed()
    const before = useApp.getState().state
    await open('e')
    expect(save).not.toHaveBeenCalled()
    expect(useApp.getState().state).toBe(before)
  })

  describe('editar', () => {
    it('grava pelo core, com os campos novos e a auditoria, sem tocar no resto', async () => {
      const { save } = seed()
      await open('e')
      await fireEvent.press(screen.getByRole('button', { name: 'Editar' }))
      expect(screen.getByLabelText('Origem').props.value).toBe('Nubank')
      await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '31,50')
      await fireEvent.changeText(screen.getByLabelText('Pessoa'), 'Bar do Zé')
      await fireEvent.changeText(screen.getByLabelText('Referência'), '')
      await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
      expect(save).toHaveBeenCalledTimes(1)
      const edited = find('e')
      expect(edited).toMatchObject({
        amount: '31.5',
        counterparty: 'Bar do Zé',
        bankReference: undefined,
        source: 'Nubank',
        receiptFileIds: ['r1'],
        createdAt: lunch.createdAt,
        date: '2026-10-31'
      })
      // The two earlier entries stay, and one new entry lists what changed. Changing the amount of
      // a checked transaction also clears the bank check (the core's rule), and says so.
      expect(edited?.audit).toHaveLength(3)
      expect(edited?.audit?.[2].changes.map((c) => c.field)).toEqual([
        'amount',
        'counterparty',
        'bankReference',
        'reconciledAt'
      ])
      expect(edited?.reconciledAt).toBeUndefined()
      // The screen now shows the new value.
      expect(screen.getByTestId('valor')).toHaveTextContent(/31,50/)
      expect(screen.getByText('Bar do Zé')).toBeTruthy()
    })

    it('salvar sem mudar nada não cria versão nem entrada de histórico', async () => {
      const { save } = seed()
      await open('e')
      await fireEvent.press(screen.getByRole('button', { name: 'Editar' }))
      await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
      expect(save).not.toHaveBeenCalled()
      expect(find('e')).toBe(lunch)
    })

    it('um item de fatura sobrevive a uma edição de valor, e o valor não desce da soma dos itens', async () => {
      const { save } = seed()
      await open('fat')
      await fireEvent.press(screen.getByRole('button', { name: 'Editar' }))
      await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '50')
      await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
      expect(screen.getByText(DETAILS_EXCEED_TEXT)).toBeTruthy()
      expect(save).not.toHaveBeenCalled()
      await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '150')
      await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
      expect(find('fat')).toMatchObject({ amount: '150', details: invoice.details })
      expect(screen.getByText('Mercado')).toBeTruthy()
    })
  })

  describe('excluir', () => {
    it('pede "Excluir <descrição>?" e só apaga ao confirmar, voltando para a lista', async () => {
      const { save } = seed()
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      const goBack = await open('e')
      await fireEvent.press(screen.getByRole('button', { name: 'Excluir' }))
      expect(alert).toHaveBeenCalledWith('Excluir Almoço?', undefined, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: expect.any(Function) }
      ])
      expect(find('e')).toBeDefined()
      expect(save).not.toHaveBeenCalled()
      await confirm(alert, 'Excluir')
      expect(find('e')).toBeUndefined()
      expect(save).toHaveBeenCalledTimes(1)
      expect(goBack).toHaveBeenCalledTimes(1)
    })

    it('Cancelar não apaga', async () => {
      const { save } = seed()
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      const goBack = await open('e')
      await fireEvent.press(screen.getByRole('button', { name: 'Excluir' }))
      await confirm(alert, 'Cancelar')
      expect(find('e')).toBeDefined()
      expect(save).not.toHaveBeenCalled()
      expect(goBack).not.toHaveBeenCalled()
    })

    it('excluir um pagamento de dívida devolve o valor à dívida, na mesma gravação', async () => {
      const { save } = seed()
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      await open('pay')
      await fireEvent.press(screen.getByRole('button', { name: 'Excluir' }))
      expect(alert.mock.calls[0][0]).toBe('Excluir Pagamento de dívida: Carro?')
      await confirm(alert, 'Excluir')
      expect(find('pay')).toBeUndefined()
      expect(useApp.getState().state.lists[0].debts?.[0]).toMatchObject({
        remainingAmount: '150'
      })
      expect(save).toHaveBeenCalledTimes(1)
    })

    it('atrás do bloqueio a exclusão confirmada não grava', async () => {
      const { save } = seed()
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      const goBack = await open('e')
      await fireEvent.press(screen.getByRole('button', { name: 'Excluir' }))
      await act(async () => {
        useLockState.setState({ hidden: true })
      })
      await confirm(alert, 'Excluir')
      await act(async () => {
        useLockState.setState({ hidden: false })
      })
      expect(find('e')).toBeDefined()
      expect(save).not.toHaveBeenCalled()
      expect(goBack).not.toHaveBeenCalled()
    })
  })

  describe('lançamentos travados', () => {
    it('o resumo de rendimento diz de onde vem e não tem Editar nem Excluir', async () => {
      seed()
      await open('ys')
      expect(screen.getByText(YIELD_LOCKED_TEXT)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
    })

    it('o pagamento de dívida mostra o aviso de edição, sem Editar, e pode ser excluído', async () => {
      seed()
      await open('pay')
      expect(screen.getByText(LOCKED_TEXT)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
      const remove = screen.getByRole('button', { name: 'Excluir' })
      expect(remove.props.accessibilityState.disabled).toBe(false)
    })

    it.each([
      ['a transferência entre moedas', 'xfer', 'conta'],
      ['a fatura vinculada', 'inv', 'conta'],
      ['o espelho dela, na outra tabela', 'mirror', 'cartao']
    ])('%s: sem Editar, e Excluir só avisa', async (_, txId, tableId) => {
      const { save } = seed()
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      await open(txId, tableId)
      expect(screen.getByText(LOCKED_TEXT)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
      await fireEvent.press(screen.getByRole('button', { name: 'Excluir' }))
      expect(screen.getByText(DELETE_LOCKED_TEXT)).toBeTruthy()
      expect(alert).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
    })
  })

  it('só leitura: Editar e Excluir ficam desabilitados', async () => {
    const { save } = seed({ readOnly: true })
    await open('e')
    for (const name of ['Editar', 'Excluir']) {
      const button = screen.getByRole('button', { name })
      expect([name, button.props.accessibilityState.disabled]).toEqual([name, true])
    }
    expect(save).not.toHaveBeenCalled()
  })

  it('a folha de edição aberta fecha atrás do bloqueio e o que se digitou volta depois', async () => {
    seed()
    await open('e')
    await fireEvent.press(screen.getByRole('button', { name: 'Editar' }))
    await fireEvent.changeText(screen.getByLabelText('Pessoa'), 'Outra')
    await act(async () => {
      useLockState.setState({ hidden: true })
    })
    expect(screen.queryByLabelText('Pessoa')).toBeNull()
    await act(async () => {
      useLockState.setState({ hidden: false })
    })
    expect(screen.getByLabelText('Pessoa').props.value).toBe('Outra')
  })

  it('um lançamento que sumiu (apagado em outro aparelho) fecha a tela', async () => {
    seed()
    const goBack = await open('e')
    await act(async () => {
      const state = useApp.getState().state
      useApp.setState({
        state: {
          ...state,
          lists: state.lists.map((t) => ({
            ...t,
            transactions: t.transactions.filter((x) => x.id !== 'e')
          }))
        }
      })
    })
    expect(goBack).toHaveBeenCalledTimes(1)
  })
})
