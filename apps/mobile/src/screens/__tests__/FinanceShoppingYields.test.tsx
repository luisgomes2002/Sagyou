import type {
  FinancialTable,
  FinancialTransaction,
  ShoppingItem,
  YieldEntry,
  YieldSource
} from '@sagyou/core/types'
import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { Alert, Linking } from 'react-native'
import { T, seedApp, table } from '../../__tests__/seed'
import { useLockState } from '../../lock/lockState'
import { useApp } from '../../store/app'
import { lastTablePref } from '../../store/finance'
import { useUndo } from '../../store/undo'
import { FinanceScreen, PICK_TABLE_TEXT } from '../FinanceScreen'
import type { FinanceTab } from '../finance/tabs'

const SUMMARY = 'Rendimento Mensal'

const item = (id: string, name: string, extra: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  name,
  qty: 1,
  done: false,
  ...extra
})

const source = (id: string, name: string): YieldSource => ({ id, name, createdAt: T })

const entry = (id: string, sourceId: string, date: string, amount: string): YieldEntry => ({
  id,
  sourceId,
  date,
  amount,
  createdAt: T
})

const summary = (
  id: string,
  month: 'Outubro' | 'Novembro',
  year: number,
  amount: string
): FinancialTransaction => ({
  id,
  description: `Rendimentos ${month} ${year}`,
  amount,
  type: 'income',
  date: `${year}-${month === 'Outubro' ? '10' : '11'}-01`,
  category: SUMMARY
})

/** One BRL table; only what the case needs. */
function seed(
  extra: Partial<FinancialTable>,
  options: { readOnly?: boolean; transactions?: FinancialTransaction[] } = {}
): ReturnType<typeof seedApp> {
  const base = table('conta', 'Conta', 'personal', options.transactions ?? [])
  return seedApp({ lists: [{ ...base, ...extra }] }, { readOnly: options.readOnly })
}

const current = (): FinancialTable => useApp.getState().state.lists[0]
const buttonOf = (name: string): ReturnType<typeof screen.getByRole> =>
  screen.getByRole('button', { name })
const confirmWith = async (alert: jest.SpyInstance): Promise<void> => {
  await act(async () => {
    alert.mock.calls[0][2]!.find((b: { text: string }) => b.text === 'Excluir')?.onPress?.()
  })
}

const TODAY = '2026-10-31'
const open = (tab: FinanceTab): Promise<unknown> =>
  render(<FinanceScreen today={TODAY} initialTab={tab} />)

describe('Compras no celular', () => {
  const openShopping = (): Promise<unknown> => open('compras')

  beforeEach(() => useUndo.getState().dismiss())
  afterEach(() => jest.restoreAllMocks())

  it('marcar um item com preço cria o gasto de hoje; desmarcar o apaga', async () => {
    const { save } = seed({ items: [item('arroz', 'Arroz', { qty: 2, price: '12.5' })] })
    await openShopping()
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Marcar Arroz como comprado' }))
    expect(current().transactions).toEqual([
      expect.objectContaining({
        description: 'Arroz',
        amount: '25',
        type: 'expense',
        date: TODAY,
        fromShopping: true,
        createdAt: expect.any(String)
      })
    ])
    expect(current().items[0]).toMatchObject({
      done: true,
      linkedTransactionId: current().transactions[0].id
    })
    expect(save).toHaveBeenCalledTimes(1)
    const box = screen.getByRole('checkbox', { name: 'Desmarcar Arroz' })
    expect(box.props.accessibilityState.checked).toBe(true)

    await fireEvent.press(box)
    expect(current().transactions).toEqual([])
    expect(current().items[0].done).toBe(false)
    expect(current().items[0].linkedTransactionId).toBeUndefined()
    expect(save).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('checkbox', { name: 'Marcar Arroz como comprado' })).toBeTruthy()
  })

  it('um item sem preço é marcado sem criar lançamento', async () => {
    seed({ items: [item('pao', 'Pão')] })
    await openShopping()
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Marcar Pão como comprado' }))
    expect(current().items[0].done).toBe(true)
    expect(current().transactions).toEqual([])
  })

  it('os comprados vão para o fim da lista', async () => {
    seed({
      items: [item('a', 'Antigo', { done: true }), item('b', 'Pão'), item('c', 'Leite')]
    })
    await openShopping()
    const order = (): unknown[] => screen.getAllByRole('header').map((h) => h.props.children)
    expect(order()).toEqual(['Pão', 'Leite', 'Antigo'])
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Marcar Pão como comprado' }))
    expect(order()).toEqual(['Leite', 'Antigo', 'Pão'])
  })

  it('mostra o andamento e o total em dinheiro', async () => {
    seed({
      items: [
        item('a', 'Arroz', { qty: 2, price: '12.5', done: true }),
        item('b', 'Feijão', { price: '8.25' })
      ]
    })
    await openShopping()
    expect(screen.getByTestId('compras-progresso')).toHaveTextContent('1/2 comprado · 50%')
    expect(screen.getByTestId('compras-gasto')).toHaveTextContent('R$ 25,00')
    expect(screen.getByTestId('compras-total')).toHaveTextContent('R$ 33,25')
    expect(screen.getByTestId('total-a')).toHaveTextContent('R$ 25,00')
  })

  it('lista vazia diz o que fazer', async () => {
    seed({ items: [] })
    await openShopping()
    expect(screen.getByText('Nenhum item nesta lista.')).toBeTruthy()
  })

  describe('adicionar', () => {
    it('Novo item grava com preço canônico, quantidade em número e o link sem espaços', async () => {
      const { save } = seed({})
      await openShopping()
      await fireEvent.press(buttonOf('Novo item'))
      // No name, no button.
      expect(buttonOf('Adicionar item').props.accessibilityState.disabled).toBe(true)
      await fireEvent.changeText(screen.getByLabelText('Nome do item'), '  Arroz ')
      await fireEvent.changeText(screen.getByLabelText('Quantidade'), '2,5')
      await fireEvent.changeText(screen.getByLabelText('Preço por unidade (BRL, opcional)'), '12,5')
      await fireEvent.changeText(
        screen.getByLabelText('Link (opcional)'),
        ' https://example.com/arroz '
      )
      await fireEvent.press(buttonOf('Adicionar item'))
      expect(current().items).toEqual([
        expect.objectContaining({
          name: 'Arroz',
          qty: 2.5,
          price: '12.5',
          done: false,
          link: 'https://example.com/arroz'
        })
      ])
      expect(save).toHaveBeenCalledTimes(1)
      expect(screen.queryByLabelText('Nome do item')).toBeNull()
      expect(screen.getByTestId(`total-${current().items[0].id}`)).toHaveTextContent('R$ 31,25')
    })

    it('o preço é opcional: vazio grava sem preço, quantidade 1 e sem link', async () => {
      seed({})
      await openShopping()
      await fireEvent.press(buttonOf('Novo item'))
      await fireEvent.changeText(screen.getByLabelText('Nome do item'), 'Pão')
      await fireEvent.press(buttonOf('Adicionar item'))
      expect(current().items[0]).toMatchObject({ name: 'Pão', qty: 1, done: false })
      expect(current().items[0].price).toBeUndefined()
      expect(current().items[0].link).toBeUndefined()
    })

    it('preço que não é número diz "Valor inválido." e não grava', async () => {
      const { save } = seed({})
      await openShopping()
      await fireEvent.press(buttonOf('Novo item'))
      await fireEvent.changeText(screen.getByLabelText('Nome do item'), 'Pão')
      for (const raw of ['abc', '0', '-5']) {
        await fireEvent.changeText(screen.getByLabelText('Preço por unidade (BRL, opcional)'), raw)
        await fireEvent.press(buttonOf('Adicionar item'))
        expect([raw, screen.queryByText('Valor inválido.') !== null]).toEqual([raw, true])
      }
      expect(current().items).toEqual([])
      expect(save).not.toHaveBeenCalled()
    })

    it('quantidade zero ou lixo diz "Quantidade inválida." e não grava', async () => {
      const { save } = seed({})
      await openShopping()
      await fireEvent.press(buttonOf('Novo item'))
      await fireEvent.changeText(screen.getByLabelText('Nome do item'), 'Pão')
      for (const raw of ['0', 'abc', '-1', '']) {
        await fireEvent.changeText(screen.getByLabelText('Quantidade'), raw)
        await fireEvent.press(buttonOf('Adicionar item'))
        expect([raw, screen.queryByText('Quantidade inválida.') !== null]).toEqual([raw, true])
      }
      expect(save).not.toHaveBeenCalled()
    })

    it('fechar com algo digitado pergunta "Descartar?"', async () => {
      seed({})
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      await openShopping()
      await fireEvent.press(buttonOf('Novo item'))
      await fireEvent.press(buttonOf('Cancelar'))
      expect(alert).not.toHaveBeenCalled()
      await fireEvent.press(buttonOf('Novo item'))
      await fireEvent.changeText(screen.getByLabelText('Nome do item'), 'Pão')
      await fireEvent.press(buttonOf('Cancelar'))
      expect(alert.mock.calls[0][0]).toBe('Descartar?')
    })
  })

  describe('editar', () => {
    it('Editar muda só o que mudou (um preço antigo com 3 casas não é arredondado)', async () => {
      const { save } = seed({
        items: [item('a', 'Arroz', { price: '3.456', link: 'http://x.com/a' })]
      })
      await openShopping()
      await fireEvent.press(buttonOf('Editar Arroz'))
      expect(screen.getByLabelText('Nome do item').props.value).toBe('Arroz')
      expect(screen.getByLabelText('Preço por unidade (BRL, opcional)').props.value).toBe('3,456')
      await fireEvent.changeText(screen.getByLabelText('Nome do item'), 'Arroz integral')
      await fireEvent.press(buttonOf('Salvar'))
      expect(current().items[0]).toMatchObject({
        name: 'Arroz integral',
        price: '3.456',
        qty: 1,
        link: 'http://x.com/a'
      })
      expect(save).toHaveBeenCalledTimes(1)
    })

    it('trocar preço e quantidade de um item comprado acerta o gasto dele', async () => {
      const { save } = seed(
        {
          items: [
            item('a', 'Arroz', { qty: 2, price: '12.5', done: true, linkedTransactionId: 't1' })
          ]
        },
        {
          transactions: [
            {
              id: 't1',
              description: 'Arroz',
              amount: '25',
              type: 'expense',
              date: '2026-10-10',
              fromShopping: true
            }
          ]
        }
      )
      await openShopping()
      await fireEvent.press(buttonOf('Editar Arroz'))
      await fireEvent.changeText(screen.getByLabelText('Quantidade'), '3')
      await fireEvent.changeText(screen.getByLabelText('Preço por unidade (BRL, opcional)'), '10')
      await fireEvent.press(buttonOf('Salvar'))
      expect(current().items[0]).toMatchObject({ qty: 3, price: '10' })
      expect(current().transactions[0]).toMatchObject({ id: 't1', amount: '30' })
      expect(save).toHaveBeenCalledTimes(1)
    })

    it('limpar o preço e o link tira os dois do item', async () => {
      seed({ items: [item('a', 'Arroz', { price: '5', link: 'https://x.com/a' })] })
      await openShopping()
      await fireEvent.press(buttonOf('Editar Arroz'))
      await fireEvent.changeText(screen.getByLabelText('Preço por unidade (BRL, opcional)'), '')
      await fireEvent.changeText(screen.getByLabelText('Link (opcional)'), '  ')
      await fireEvent.press(buttonOf('Salvar'))
      expect(current().items[0].price).toBeUndefined()
      expect(current().items[0].link).toBeUndefined()
    })

    it('Editar sem mudar nada fecha sem gravar', async () => {
      const { save } = seed({ items: [item('a', 'Arroz', { qty: 1.5, price: '5' })] })
      await openShopping()
      await fireEvent.press(buttonOf('Editar Arroz'))
      // A fractional quantity shows with the comma and parses back to the same number.
      expect(screen.getByLabelText('Quantidade').props.value).toBe('1,5')
      await fireEvent.press(buttonOf('Salvar'))
      expect(screen.queryByLabelText('Nome do item')).toBeNull()
      expect(save).not.toHaveBeenCalled()
    })
  })

  describe('excluir', () => {
    it('confirma com o nome e só apaga ao confirmar', async () => {
      const { save } = seed({ items: [item('a', 'Arroz')] })
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      await openShopping()
      await fireEvent.press(buttonOf('Excluir Arroz'))
      expect(alert).toHaveBeenCalledWith('Excluir Arroz?', undefined, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: expect.any(Function) }
      ])
      expect(current().items).toHaveLength(1)
      expect(save).not.toHaveBeenCalled()
      await confirmWith(alert)
      expect(current().items).toEqual([])
      expect(save).toHaveBeenCalledTimes(1)
    })

    it('excluir um item comprado leva o gasto dele junto', async () => {
      seed(
        { items: [item('a', 'Arroz', { price: '5', done: true, linkedTransactionId: 't1' })] },
        {
          transactions: [
            { id: 't1', description: 'Arroz', amount: '5', type: 'expense', date: '2026-10-10' },
            { id: 't2', description: 'Outro', amount: '9', type: 'expense', date: '2026-10-11' }
          ]
        }
      )
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      await openShopping()
      await fireEvent.press(buttonOf('Excluir Arroz'))
      await confirmWith(alert)
      expect(current().items).toEqual([])
      expect(current().transactions.map((t) => t.id)).toEqual(['t2'])
    })

    it('cancelar não apaga nada', async () => {
      const { save } = seed({ items: [item('a', 'Arroz')] })
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      await openShopping()
      await fireEvent.press(buttonOf('Excluir Arroz'))
      expect(alert.mock.calls[0][2]!.find((b) => b.text === 'Cancelar')?.onPress).toBeUndefined()
      expect(current().items).toHaveLength(1)
      expect(save).not.toHaveBeenCalled()
    })
  })

  describe('link', () => {
    it('abre por Linking.openURL quando é http ou https', async () => {
      seed({
        items: [
          item('a', 'Arroz', { link: 'https://example.com/arroz?x=1' }),
          item('b', 'Feijão', { link: ' http://example.com/feijao ' })
        ]
      })
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
      await openShopping()
      await fireEvent.press(buttonOf('Abrir link de Arroz'))
      expect(openURL).toHaveBeenLastCalledWith('https://example.com/arroz?x=1')
      await fireEvent.press(buttonOf('Abrir link de Feijão'))
      expect(openURL).toHaveBeenLastCalledWith('http://example.com/feijao')
      expect(openURL).toHaveBeenCalledTimes(2)
      expect(useUndo.getState().message).toBeNull()
    })

    it('qualquer outro esquema não abre e avisa', async () => {
      const links = [
        'javascript:alert(1)',
        'tel:+5511999999999',
        'file:///etc/passwd',
        'intent://scan/#Intent;scheme=zxing;end',
        'ftp://example.com/arquivo',
        'content://com.android.contacts/contacts',
        'example.com/arroz',
        'https:///sem-host',
        'https://exa mple.com',
        'xhttps://example.com'
      ]
      seed({ items: links.map((link, i) => item(`i${i}`, `Item ${i}`, { link })) })
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
      await openShopping()
      for (const [i, link] of links.entries()) {
        useUndo.getState().dismiss()
        await fireEvent.press(buttonOf(`Abrir link de Item ${i}`))
        expect([link, useUndo.getState().message]).toEqual([
          link,
          'Este link não pode ser aberto. Use um endereço que comece com http:// ou https://.'
        ])
      }
      expect(openURL).not.toHaveBeenCalled()
    })

    it('se o sistema não abre, diz isso', async () => {
      seed({ items: [item('a', 'Arroz', { link: 'https://example.com/a' })] })
      jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('sem app'))
      await openShopping()
      await fireEvent.press(buttonOf('Abrir link de Arroz'))
      await act(async () => undefined)
      expect(useUndo.getState().message).toBe('Não foi possível abrir o link.')
    })

    it('um item sem link não tem o botão', async () => {
      seed({ items: [item('a', 'Arroz')] })
      await openShopping()
      expect(screen.queryByRole('button', { name: 'Abrir link de Arroz' })).toBeNull()
    })
  })

  it('só leitura: todo botão de escrita fica desabilitado, o link continua', async () => {
    const { save } = seed(
      { items: [item('a', 'Arroz', { price: '5', link: 'https://example.com/a' })] },
      { readOnly: true }
    )
    await openShopping()
    for (const name of ['Novo item', 'Editar Arroz', 'Excluir Arroz'])
      expect([name, buttonOf(name).props.accessibilityState.disabled]).toEqual([name, true])
    expect(
      screen.getByRole('checkbox', { name: 'Marcar Arroz como comprado' }).props.accessibilityState
        .disabled
    ).toBe(true)
    expect(buttonOf('Abrir link de Arroz').props.accessibilityState.disabled).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('no Consolidado a aba pede uma tabela', async () => {
    seed({})
    useApp.getState().services?.repo.writePref(lastTablePref('personal'), 'all')
    await openShopping()
    expect(screen.getByText(PICK_TABLE_TEXT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Novo item' })).toBeNull()
  })

  describe('bloqueio', () => {
    afterEach(() => useLockState.setState({ hidden: false }))

    it('a folha de item fecha atrás da tela de bloqueio, sem gravar', async () => {
      const { save } = seed({})
      await openShopping()
      await fireEvent.press(buttonOf('Novo item'))
      await fireEvent.changeText(screen.getByLabelText('Nome do item'), 'Pão')
      await act(async () => {
        useLockState.setState({ hidden: true })
      })
      expect(screen.queryByLabelText('Nome do item')).toBeNull()
      expect(save).not.toHaveBeenCalled()
      await act(async () => {
        useLockState.setState({ hidden: false })
      })
      expect(screen.getByLabelText('Nome do item').props.value).toBe('Pão')
    })
  })
})

describe('Rendimentos no celular', () => {
  const openYields = (): Promise<unknown> => open('rendimentos')
  const DIV = source('div', 'Dividendos')
  const ALU = source('alu', 'Aluguel')
  /** Two sources, three entries (two in October, one in November) and each month's summary. */
  const FULL = (): Partial<FinancialTable> => ({
    yieldSources: [DIV, ALU],
    yieldEntries: [
      entry('e1', 'div', '2026-10-05', '100'),
      entry('e2', 'alu', '2026-10-20', '250.5'),
      entry('e3', 'div', '2026-11-03', '40')
    ]
  })
  const SUMMARIES = (): FinancialTransaction[] => [
    summary('s10', 'Outubro', 2026, '350.5'),
    summary('s11', 'Novembro', 2026, '40')
  ]
  const summaryOf = (id: string): FinancialTransaction | undefined =>
    current().transactions.find((t) => t.id === id)

  beforeEach(() => useUndo.getState().dismiss())
  afterEach(() => jest.restoreAllMocks())

  it('mostra as fontes e as entradas do mês escolhido', async () => {
    seed(FULL(), { transactions: SUMMARIES() })
    await openYields()
    expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual([
      'Dividendos',
      'Aluguel'
    ])
    expect(screen.getByTestId('rendimentos-total')).toHaveTextContent('R$ 350,50')
    expect(screen.getByTestId('fonte-div')).toHaveTextContent('R$ 100,00')
    expect(screen.getByTestId('entrada-e1')).toHaveTextContent('05/10/2026 · R$ 100,00')
    expect(screen.getByTestId('entrada-e2')).toHaveTextContent('20/10/2026 · R$ 250,50')
    expect(screen.queryByTestId('entrada-e3')).toBeNull()

    await fireEvent.press(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(screen.getByTestId('rendimentos-total')).toHaveTextContent('R$ 40,00')
    expect(screen.getByTestId('entrada-e3')).toHaveTextContent('03/11/2026 · R$ 40,00')
    expect(screen.queryByTestId('entrada-e1')).toBeNull()
    // Aluguel earned nothing in November.
    expect(screen.getByTestId('fonte-alu')).toHaveTextContent('-')
    expect(screen.getByText('Nenhum rendimento neste mês.')).toBeTruthy()
  })

  it('sem fontes diz o que fazer e não deixa lançar', async () => {
    seed({})
    await openYields()
    expect(
      screen.getByText('Nenhuma fonte cadastrada. Adicione fontes de rendimento para começar.')
    ).toBeTruthy()
    expect(buttonOf('Lançar rendimento').props.accessibilityState.disabled).toBe(true)
    expect(buttonOf('Nova fonte').props.accessibilityState.disabled).toBe(false)
  })

  describe('lançar entrada', () => {
    it('grava a entrada e cria o resumo do mês no dia 1, num commit só', async () => {
      const { save } = seed({ yieldSources: [DIV, ALU], yieldEntries: [] })
      await openYields()
      await fireEvent.press(buttonOf('Lançar rendimento'))
      // The day starts today (it is in the month on screen) and is chosen by touch.
      expect(screen.getByRole('button', { name: 'Hoje' }).props.accessibilityState.selected).toBe(
        true
      )
      expect(buttonOf('Fonte ▸ Dividendos')).toBeTruthy()
      await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '100,50')
      await fireEvent.press(buttonOf('Lançar'))
      expect(current().yieldEntries).toEqual([
        expect.objectContaining({
          sourceId: 'div',
          date: TODAY,
          amount: '100.5',
          createdAt: expect.any(String)
        })
      ])
      expect(current().transactions).toEqual([
        expect.objectContaining({
          description: 'Rendimentos Outubro 2026',
          amount: '100.5',
          type: 'income',
          date: '2026-10-01',
          category: SUMMARY
        })
      ])
      expect(save).toHaveBeenCalledTimes(1)
      expect(screen.queryByLabelText('Valor (BRL)')).toBeNull()
      expect(screen.getByTestId('rendimentos-total')).toHaveTextContent('R$ 100,50')
    })

    it('outra entrada soma no resumo que já existe', async () => {
      const { save } = seed(FULL(), { transactions: SUMMARIES() })
      await openYields()
      await fireEvent.press(buttonOf('Lançar rendimento'))
      await fireEvent.press(buttonOf('Fonte ▸ Dividendos'))
      await fireEvent.press(screen.getByRole('radio', { name: 'Aluguel' }))
      await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '10')
      await fireEvent.press(buttonOf('Lançar'))
      expect(current().yieldEntries).toHaveLength(4)
      expect(current().yieldEntries![3]).toMatchObject({ sourceId: 'alu', amount: '10' })
      // 100 + 250.5 + 10, the existing summary updated, never a second one.
      expect(summaryOf('s10')).toMatchObject({ amount: '360.5', date: '2026-10-01' })
      expect(current().transactions.filter((t) => t.category === SUMMARY)).toHaveLength(2)
      expect(save).toHaveBeenCalledTimes(1)
    })

    it('a mesma fonte no mesmo dia atualiza a entrada em vez de duplicar', async () => {
      seed({
        yieldSources: [DIV],
        yieldEntries: [entry('hoje', 'div', TODAY, '10')]
      })
      await openYields()
      await fireEvent.press(buttonOf('Lançar rendimento'))
      await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '20')
      await fireEvent.press(buttonOf('Lançar'))
      expect(current().yieldEntries).toEqual([
        expect.objectContaining({ id: 'hoje', amount: '20' })
      ])
      expect(current().transactions[0]).toMatchObject({ amount: '20' })
    })

    it('com outro mês na tela, a data começa no dia 1 dele', async () => {
      seed({ yieldSources: [DIV], yieldEntries: [] })
      await openYields()
      await fireEvent.press(screen.getByRole('button', { name: 'Próximo mês' }))
      await fireEvent.press(screen.getByRole('button', { name: 'Próximo mês' }))
      await fireEvent.press(buttonOf('Lançar rendimento'))
      // Neither today nor tomorrow: the custom chip shows the day.
      expect(screen.getByRole('button', { name: '01/12/2026' })).toBeTruthy()
      await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '5')
      await fireEvent.press(buttonOf('Lançar'))
      expect(current().yieldEntries![0].date).toBe('2026-12-01')
      expect(current().transactions[0]).toMatchObject({
        description: 'Rendimentos Dezembro 2026',
        date: '2026-12-01',
        amount: '5'
      })
    })

    it('valor inválido ou que arredonda para zero diz "Valor inválido." e não grava', async () => {
      const { save } = seed({ yieldSources: [DIV], yieldEntries: [] })
      await openYields()
      await fireEvent.press(buttonOf('Lançar rendimento'))
      for (const raw of ['abc', '0', '-5', '', '0,004']) {
        await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), raw)
        await fireEvent.press(buttonOf('Lançar'))
        expect([raw, screen.queryByText('Valor inválido.') !== null]).toEqual([raw, true])
      }
      expect(current().yieldEntries).toEqual([])
      expect(current().transactions).toEqual([])
      expect(save).not.toHaveBeenCalled()
    })
  })

  describe('editar entrada', () => {
    it('mudar o valor atualiza o resumo do mês', async () => {
      const { save } = seed(FULL(), { transactions: SUMMARIES() })
      await openYields()
      await fireEvent.press(buttonOf('Editar rendimento de Dividendos em 05/10/2026'))
      expect(screen.getByLabelText('Valor (BRL)').props.value).toBe('100,00')
      await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '150')
      await fireEvent.press(buttonOf('Salvar'))
      expect(current().yieldEntries!.find((e) => e.id === 'e1')).toMatchObject({
        amount: '150',
        date: '2026-10-05'
      })
      expect(summaryOf('s10')).toMatchObject({ amount: '400.5' })
      expect(save).toHaveBeenCalledTimes(1)
    })

    it('mover a entrada para outro mês acerta os dois resumos', async () => {
      seed(FULL(), { transactions: SUMMARIES() })
      await openYields()
      await fireEvent.press(buttonOf('Editar rendimento de Dividendos em 05/10/2026'))
      // Amanhã is 2026-11-01: November.
      await fireEvent.press(screen.getByRole('button', { name: 'Amanhã' }))
      await fireEvent.press(buttonOf('Salvar'))
      expect(current().yieldEntries!.find((e) => e.id === 'e1')).toMatchObject({
        date: '2026-11-01',
        amount: '100'
      })
      expect(summaryOf('s10')).toMatchObject({ amount: '250.5' })
      expect(summaryOf('s11')).toMatchObject({ amount: '140' })
    })

    it('mover para um dia em que a fonte já tem entrada recusa', async () => {
      const { save } = seed({
        yieldSources: [DIV],
        yieldEntries: [entry('e1', 'div', '2026-10-05', '100'), entry('hoje', 'div', TODAY, '10')]
      })
      await openYields()
      await fireEvent.press(buttonOf('Editar rendimento de Dividendos em 05/10/2026'))
      await fireEvent.press(screen.getByRole('button', { name: 'Hoje' }))
      await fireEvent.press(buttonOf('Salvar'))
      expect(screen.getByText('Já existe um rendimento desta fonte nesta data.')).toBeTruthy()
      expect(current().yieldEntries).toHaveLength(2)
      expect(save).not.toHaveBeenCalled()
    })

    it('sem mudar nada fecha sem gravar', async () => {
      const { save } = seed(FULL(), { transactions: SUMMARIES() })
      await openYields()
      await fireEvent.press(buttonOf('Editar rendimento de Dividendos em 05/10/2026'))
      await fireEvent.press(buttonOf('Salvar'))
      expect(screen.queryByLabelText('Valor (BRL)')).toBeNull()
      expect(save).not.toHaveBeenCalled()
    })
  })

  describe('excluir entrada', () => {
    it('confirma com a fonte e o dia, apaga e refaz o resumo', async () => {
      const { save } = seed(FULL(), { transactions: SUMMARIES() })
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      await openYields()
      await fireEvent.press(buttonOf('Excluir rendimento de Dividendos em 05/10/2026'))
      expect(alert.mock.calls[0][0]).toBe('Excluir rendimento de Dividendos em 05/10/2026?')
      expect(current().yieldEntries).toHaveLength(3)
      expect(save).not.toHaveBeenCalled()
      await confirmWith(alert)
      expect(current().yieldEntries!.map((e) => e.id)).toEqual(['e2', 'e3'])
      expect(summaryOf('s10')).toMatchObject({ amount: '250.5' })
      expect(save).toHaveBeenCalledTimes(1)
    })

    it('a última entrada do mês leva o resumo junto', async () => {
      seed(
        { yieldSources: [DIV], yieldEntries: [entry('e1', 'div', '2026-10-05', '100')] },
        { transactions: [summary('s10', 'Outubro', 2026, '100')] }
      )
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      await openYields()
      await fireEvent.press(buttonOf('Excluir rendimento de Dividendos em 05/10/2026'))
      await confirmWith(alert)
      expect(current().yieldEntries).toEqual([])
      expect(current().transactions).toEqual([])
    })

    it('cancelar não apaga nada', async () => {
      const { save } = seed(FULL(), { transactions: SUMMARIES() })
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      await openYields()
      await fireEvent.press(buttonOf('Excluir rendimento de Dividendos em 05/10/2026'))
      expect(alert.mock.calls[0][2]!.find((b) => b.text === 'Cancelar')?.onPress).toBeUndefined()
      expect(current().yieldEntries).toHaveLength(3)
      expect(save).not.toHaveBeenCalled()
    })
  })

  describe('fontes', () => {
    it('Nova fonte cria com o nome sem espaços', async () => {
      const { save } = seed({})
      await openYields()
      await fireEvent.press(buttonOf('Nova fonte'))
      expect(buttonOf('Criar fonte').props.accessibilityState.disabled).toBe(true)
      await fireEvent.changeText(screen.getByLabelText('Nome da fonte'), '  Dividendos ')
      await fireEvent.press(buttonOf('Criar fonte'))
      expect(current().yieldSources).toEqual([
        expect.objectContaining({ name: 'Dividendos', id: expect.any(String) })
      ])
      expect(save).toHaveBeenCalledTimes(1)
      expect(screen.getByText('Dividendos')).toBeTruthy()
      // With a source, "Lançar rendimento" is available.
      expect(buttonOf('Lançar rendimento').props.accessibilityState.disabled).toBe(false)
    })

    it('Renomear muda só o nome; o mesmo nome fecha sem gravar', async () => {
      const { save } = seed(FULL(), { transactions: SUMMARIES() })
      await openYields()
      await fireEvent.press(buttonOf('Renomear Dividendos'))
      expect(screen.getByLabelText('Nome da fonte').props.value).toBe('Dividendos')
      await fireEvent.press(buttonOf('Salvar'))
      expect(save).not.toHaveBeenCalled()
      await fireEvent.press(buttonOf('Renomear Dividendos'))
      await fireEvent.changeText(screen.getByLabelText('Nome da fonte'), ' Dividendos FII ')
      await fireEvent.press(buttonOf('Salvar'))
      expect(current().yieldSources!.find((s) => s.id === 'div')?.name).toBe('Dividendos FII')
      expect(current().yieldEntries).toHaveLength(3)
      expect(save).toHaveBeenCalledTimes(1)
    })

    it('excluir uma fonte com entradas avisa, apaga as entradas e refaz os resumos de todos os meses', async () => {
      const { save } = seed(FULL(), { transactions: SUMMARIES() })
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      await openYields()
      await fireEvent.press(buttonOf('Excluir fonte Dividendos'))
      expect(alert.mock.calls[0][0]).toBe('Excluir Dividendos?')
      expect(alert.mock.calls[0][1]).toBe(
        'Os rendimentos registrados desta fonte também serão apagados.'
      )
      expect(current().yieldSources).toHaveLength(2)
      expect(save).not.toHaveBeenCalled()
      await confirmWith(alert)
      expect(current().yieldSources!.map((s) => s.id)).toEqual(['alu'])
      expect(current().yieldEntries!.map((e) => e.id)).toEqual(['e2'])
      // October keeps Aluguel's 250.5; November had only Dividendos, so its summary is gone.
      expect(summaryOf('s10')).toMatchObject({ amount: '250.5' })
      expect(summaryOf('s11')).toBeUndefined()
      expect(save).toHaveBeenCalledTimes(1)
    })

    it('excluir uma fonte sem entradas não traz aviso de entradas', async () => {
      seed({ yieldSources: [DIV], yieldEntries: [] })
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
      await openYields()
      await fireEvent.press(buttonOf('Excluir fonte Dividendos'))
      expect(alert.mock.calls[0][1]).toBeUndefined()
      await confirmWith(alert)
      expect(current().yieldSources).toEqual([])
    })
  })

  it('só leitura: todo botão de escrita fica desabilitado', async () => {
    const { save } = seed(FULL(), { readOnly: true, transactions: SUMMARIES() })
    await openYields()
    for (const name of [
      'Nova fonte',
      'Lançar rendimento',
      'Renomear Dividendos',
      'Excluir fonte Dividendos',
      'Editar rendimento de Dividendos em 05/10/2026',
      'Excluir rendimento de Dividendos em 05/10/2026'
    ])
      expect([name, buttonOf(name).props.accessibilityState.disabled]).toEqual([name, true])
    expect(save).not.toHaveBeenCalled()
  })

  it('no Consolidado a aba pede uma tabela', async () => {
    seed({})
    useApp.getState().services?.repo.writePref(lastTablePref('personal'), 'all')
    await openYields()
    expect(screen.getByText(PICK_TABLE_TEXT)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Nova fonte' })).toBeNull()
  })

  describe('bloqueio', () => {
    afterEach(() => useLockState.setState({ hidden: false }))

    it('a folha da entrada fecha atrás da tela de bloqueio, sem gravar', async () => {
      const { save } = seed({ yieldSources: [DIV], yieldEntries: [] })
      await openYields()
      await fireEvent.press(buttonOf('Lançar rendimento'))
      await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '30')
      await act(async () => {
        useLockState.setState({ hidden: true })
      })
      expect(screen.queryByLabelText('Valor (BRL)')).toBeNull()
      expect(save).not.toHaveBeenCalled()
      await act(async () => {
        useLockState.setState({ hidden: false })
      })
      expect(screen.getByLabelText('Valor (BRL)').props.value).toBe('30')
    })
  })
})
