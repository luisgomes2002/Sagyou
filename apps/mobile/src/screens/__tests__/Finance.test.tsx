import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { Alert, StyleSheet } from 'react-native'
import { seedApp, table } from '../../__tests__/seed'
import { TransactionSheet } from '../../components/TransactionSheet'
import { useLockState } from '../../lock/lockState'
import { useApp } from '../../store/app'
import { lastTablePref } from '../../store/finance'
import { useUndo } from '../../store/undo'
import { lightTheme } from '../../theme'
import { FinanceScreen, NO_TABLE_TEXT, PICK_TABLE_TEXT } from '../FinanceScreen'

const SYNCED = {
  state: 'ok' as const,
  lastSyncAt: Date.now(),
  pendingCount: 0,
  paused: null,
  deviceName: 'Pixel',
  conflictCount: 0
}

function seed(
  prefs: Record<string, string> = {},
  options: { readOnly?: boolean } = {}
): ReturnType<typeof seedApp> {
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
    { prefs, ...options }
  )
}

const names = (): string[] => useApp.getState().state.lists.map((t) => t.name)

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

  it('tocar num lançamento abre os detalhes, qualquer que seja ele', async () => {
    seed()
    const open = jest.fn()
    await render(<FinanceScreen today="2026-10-31" onOpenTransaction={open} />)
    await fireEvent.press(screen.getByRole('button', { name: /^Almoço,/ }))
    expect(open).toHaveBeenLastCalledWith('conta', 'e')
    // A debt payment cannot be edited, but its details open like any other: the lock is told there.
    await fireEvent.press(screen.getByRole('button', { name: /^Parcela,/ }))
    expect(open).toHaveBeenLastCalledWith('conta', 'b')
    expect(useUndo.getState().message).toBeNull()
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
  })

  it('abrir um lançamento não grava nada', async () => {
    const { save } = seed()
    await render(<FinanceScreen today="2026-10-31" onOpenTransaction={jest.fn()} />)
    await fireEvent.press(screen.getByRole('button', { name: /^Almoço,/ }))
    expect(save).not.toHaveBeenCalled()
  })

  it('a busca acha sem diferenciar acento nem maiúscula', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.changeText(screen.getByLabelText('Buscar lançamento'), 'ALMOCO')
    expect(screen.getByText('Almoço')).toBeTruthy()
    expect(screen.queryByText('Salário')).toBeNull()
    await fireEvent.changeText(screen.getByLabelText('Buscar lançamento'), 'salario')
    expect(screen.getByText('Salário')).toBeTruthy()
    expect(screen.queryByText('Almoço')).toBeNull()
  })

  it('os chips Tipo e Categoria filtram o mês, e as categorias são as usadas nele', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: 'Tipo: Todos' }))
    expect(screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual([
      'Todos',
      'Receitas',
      'Gastos'
    ])
    await fireEvent.press(screen.getByRole('radio', { name: 'Receitas' }))
    expect(screen.getByRole('button', { name: 'Tipo: Receitas' })).toBeTruthy()
    expect(screen.getByText('Salário')).toBeTruthy()
    expect(screen.queryByText('Almoço')).toBeNull()
    expect(screen.queryByText('Parcela')).toBeNull()

    await fireEvent.press(screen.getByRole('button', { name: 'Tipo: Receitas' }))
    await fireEvent.press(screen.getByRole('radio', { name: 'Gastos' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Categoria: Todas' }))
    // Only what the month uses (Salário, Alimentação), never the whole catalogue.
    expect(screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual([
      'Todas',
      'Alimentação',
      'Salário'
    ])
    await fireEvent.press(screen.getByRole('radio', { name: 'Alimentação' }))
    expect(screen.getByRole('button', { name: 'Categoria: Alimentação' })).toBeTruthy()
    expect(screen.getByText('Almoço')).toBeTruthy()
    expect(screen.queryByText('Parcela')).toBeNull()
  })

  it('filtros sem resultado mostram o aviso e Limpar filtros devolve tudo', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: 'Tipo: Todos' }))
    await fireEvent.press(screen.getByRole('radio', { name: 'Receitas' }))
    await fireEvent.changeText(screen.getByLabelText('Buscar lançamento'), 'almoco')
    expect(screen.getByText('Nenhum lançamento com estes filtros.')).toBeTruthy()
    expect(screen.queryByText('Nenhum lançamento neste mês.')).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.queryByText('Nenhum lançamento com estes filtros.')).toBeNull()
    expect(screen.getByLabelText('Buscar lançamento').props.value).toBe('')
    expect(screen.getByRole('button', { name: 'Tipo: Todos' })).toBeTruthy()
    expect(screen.getByText('Almoço')).toBeTruthy()
    expect(screen.getByText('Salário')).toBeTruthy()
  })

  it('um mês sem lançamentos diz isso, mesmo com filtros', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.changeText(screen.getByLabelText('Buscar lançamento'), 'xyz')
    await fireEvent.press(screen.getByRole('button', { name: 'Mês anterior' }))
    expect(screen.getByText('Nenhum lançamento neste mês.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull()
  })

  it('no Consolidado a lista traz as tabelas do perfil com o nome, sem saldo nem criar', async () => {
    seed({ [lastTablePref('personal')]: 'all' })
    const open = jest.fn()
    await render(<FinanceScreen today="2026-10-31" onOpenTransaction={open} />)
    expect(screen.getByText('Almoço')).toBeTruthy()
    expect(screen.getByText('Tênis')).toBeTruthy()
    // The other profile's table never shows.
    expect(screen.queryByText('Ramen')).toBeNull()
    expect(screen.getAllByTestId('tx-table').map((n) => n.props.children)).toEqual([
      'Conta',
      'Conta',
      'Conta',
      'Cartão'
    ])
    // Each currency has its own balance: none is shown over a list that mixes tables.
    expect(screen.queryByText('Saldo atual')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Novo gasto' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nova receita' })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: /^Tênis,/ }))
    expect(open).toHaveBeenCalledWith('cartao', 'f')
  })

  it('só leitura: a lista continua abrindo os detalhes', async () => {
    seed({}, { readOnly: true })
    const open = jest.fn()
    await render(<FinanceScreen today="2026-10-31" onOpenTransaction={open} />)
    await fireEvent.press(screen.getByRole('button', { name: /^Almoço,/ }))
    expect(open).toHaveBeenCalledWith('conta', 'e')
  })

  it('o seletor lista Consolidado, as tabelas do perfil e Nova tabela…', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: 'Tabela ▸ Conta' }))
    expect(screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual([
      'Consolidado',
      'Conta',
      'Cartão',
      'Nova tabela…'
    ])
  })

  it('Consolidado fica lembrado na pref e aparece no seletor', async () => {
    const { writePref } = seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: 'Tabela ▸ Conta' }))
    await fireEvent.press(screen.getByRole('radio', { name: 'Consolidado' }))
    expect(screen.getByRole('button', { name: 'Tabela ▸ Consolidado' })).toBeTruthy()
    expect(writePref).toHaveBeenCalledWith(lastTablePref('personal'), 'all')
  })

  it('Nova tabela… cria a tabela com nome e moeda no perfil ativo e abre nela', async () => {
    const { save, writePref } = seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: 'Tabela ▸ Conta' }))
    await fireEvent.press(screen.getByRole('radio', { name: 'Nova tabela…' }))
    const create = screen.getByRole('button', { name: 'Criar tabela' })
    expect(create.props.accessibilityState.disabled).toBe(true)
    await fireEvent.changeText(screen.getByLabelText('Nome da tabela'), '  Poupança ')
    await fireEvent.press(screen.getByRole('button', { name: 'USD' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Criar tabela' }))
    const created = useApp.getState().state.lists.find((t) => t.name === 'Poupança')
    expect(created).toMatchObject({ currency: 'USD', profileId: 'personal', transactions: [] })
    expect(save).toHaveBeenCalledTimes(1)
    expect(writePref).toHaveBeenCalledWith(lastTablePref('personal'), created?.id)
    expect(screen.getByRole('button', { name: 'Tabela ▸ Poupança' })).toBeTruthy()
    expect(screen.queryByLabelText('Nome da tabela')).toBeNull()
  })

  it('Renomear troca só o nome e mantém moeda e lançamentos', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: 'Ações da tabela' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Renomear' }))
    expect(screen.getByLabelText('Nome da tabela').props.value).toBe('Conta')
    await fireEvent.changeText(screen.getByLabelText('Nome da tabela'), 'Conta corrente')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(names()).toEqual(['Conta corrente', 'Cartão', '円 do trabalho'])
    const renamed = useApp.getState().state.lists[0]
    expect(renamed.currency).toBe('BRL')
    expect(renamed.transactions).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Tabela ▸ Conta corrente' })).toBeTruthy()
  })

  it('Excluir pede a confirmação exata e só apaga ao confirmar', async () => {
    const { save } = seed()
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: 'Ações da tabela' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Excluir' }))
    expect(alert).toHaveBeenCalledWith(
      'Excluir a tabela Conta e todos os lançamentos dela?',
      undefined,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: expect.any(Function) }
      ]
    )
    expect(names()).toContain('Conta')
    expect(save).not.toHaveBeenCalled()
    const buttons = alert.mock.calls[0][2]!
    await act(async () => {
      buttons.find((b) => b.text === 'Excluir')?.onPress?.()
    })
    expect(names()).toEqual(['Cartão', '円 do trabalho'])
    expect(save).toHaveBeenCalledTimes(1)
    // The screen falls to the profile's first table left.
    expect(screen.getByRole('button', { name: 'Tabela ▸ Cartão' })).toBeTruthy()
    alert.mockRestore()
  })

  it('o mês tem setas, e tocar no nome volta ao atual', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    expect(screen.getByText('outubro de 2026')).toBeTruthy()
    expect(screen.getByText('Almoço')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Mês anterior' }))
    expect(screen.getByText('setembro de 2026')).toBeTruthy()
    expect(screen.getByText('Nenhum lançamento neste mês.')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Próximo mês' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(screen.getByText('novembro de 2026')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'novembro de 2026' }))
    expect(screen.getByText('outubro de 2026')).toBeTruthy()
    expect(screen.getByText('Almoço')).toBeTruthy()
  })

  it('a virada de ano anda de dezembro a janeiro', async () => {
    seed()
    await render(<FinanceScreen today="2026-12-15" />)
    await fireEvent.press(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(screen.getByText('janeiro de 2027')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Mês anterior' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Mês anterior' }))
    expect(screen.getByText('novembro de 2026')).toBeTruthy()
  })

  it('as seis abas existem e trocam o conteúdo', async () => {
    seed()
    await render(<FinanceScreen today="2026-10-31" />)
    expect(screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel)).toEqual([
      'Lançamentos',
      'Resumo',
      'Dívidas',
      'Metas',
      'Compras',
      'Rendimentos'
    ])
    const selected = (name: string): boolean =>
      screen.getByRole('tab', { name }).props.accessibilityState.selected
    expect(selected('Lançamentos')).toBe(true)
    expect(screen.getByText('Saldo atual')).toBeTruthy()
    await fireEvent.press(screen.getByRole('tab', { name: 'Dívidas' }))
    expect([selected('Dívidas'), selected('Lançamentos')]).toEqual([true, false])
    expect(screen.queryByText('Saldo atual')).toBeNull()
    await fireEvent.press(screen.getByRole('tab', { name: 'Lançamentos' }))
    expect(screen.getByText('Saldo atual')).toBeTruthy()
  })

  it('no Consolidado, as áreas de tabela pedem para escolher uma', async () => {
    seed({ [lastTablePref('personal')]: 'all' })
    await render(<FinanceScreen today="2026-10-31" />)
    expect(screen.getByRole('button', { name: 'Tabela ▸ Consolidado' })).toBeTruthy()
    for (const tab of ['Dívidas', 'Metas', 'Compras', 'Rendimentos']) {
      await fireEvent.press(screen.getByRole('tab', { name: tab }))
      expect([tab, screen.queryByText(PICK_TABLE_TEXT) !== null]).toEqual([tab, true])
    }
    // Nothing to rename or delete in the Consolidado.
    expect(screen.queryByRole('button', { name: 'Ações da tabela' })).toBeNull()
  })

  it('só leitura: criar, renomear e excluir ficam desabilitados', async () => {
    seed({}, { readOnly: true })
    await render(<FinanceScreen today="2026-10-31" />)
    const more = screen.getByRole('button', { name: 'Ações da tabela' })
    expect(more.props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(screen.getByRole('button', { name: 'Tabela ▸ Conta' }))
    const create = screen.getByRole('radio', { name: 'Nova tabela…' })
    expect(create.props.accessibilityState.disabled).toBe(true)
    // Choosing a table is only reading: still allowed.
    expect(screen.getByRole('radio', { name: 'Cartão' }).props.accessibilityState.disabled).toBe(
      false
    )
  })

  it('o menu da tabela desabilita Renomear e Excluir quando passa a só leitura', async () => {
    const { save } = seed()
    await render(<FinanceScreen today="2026-10-31" />)
    await fireEvent.press(screen.getByRole('button', { name: 'Ações da tabela' }))
    await act(async () => {
      useApp.setState({ readOnly: true })
    })
    const rename = screen.getByRole('button', { name: 'Renomear' })
    const remove = screen.getByRole('button', { name: 'Excluir' })
    expect([rename, remove].map((b) => b.props.accessibilityState.disabled)).toEqual([true, true])
    expect(save).not.toHaveBeenCalled()
  })

  it('sem tabela: o aviso e o botão Nova tabela, que cria a primeira', async () => {
    seedApp({}, {})
    useApp.setState({ status: SYNCED })
    await render(<FinanceScreen today="2026-10-31" />)
    expect(screen.getByText(NO_TABLE_TEXT)).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Nova tabela' }))
    await fireEvent.changeText(screen.getByLabelText('Nome da tabela'), 'Conta')
    await fireEvent.press(screen.getByRole('button', { name: 'Criar tabela' }))
    expect(useApp.getState().state.lists).toEqual([
      expect.objectContaining({ name: 'Conta', currency: 'BRL', profileId: 'personal' })
    ])
    expect(screen.getByRole('button', { name: 'Tabela ▸ Conta' })).toBeTruthy()
  })

  it('sem tabela e só leitura: Nova tabela fica desabilitado', async () => {
    seedApp({}, { readOnly: true })
    useApp.setState({ status: SYNCED })
    await render(<FinanceScreen today="2026-10-31" />)
    const button = screen.getByRole('button', { name: 'Nova tabela' })
    expect(button.props.accessibilityState.disabled).toBe(true)
  })

  it('salvar um gasto estando no Consolidado não troca a pref da tabela', async () => {
    const { writePref, prefs } = seed({ [lastTablePref('personal')]: 'all' })
    await render(
      <TransactionSheet
        visible
        onClose={jest.fn()}
        type="expense"
        today={new Date(2026, 9, 31, 12)}
      />
    )
    await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '12,50')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    // Only "all" is remembered, so the sheet falls to the first table and saves there.
    expect(useApp.getState().state.lists[0].transactions.at(-1)).toMatchObject({ amount: '12.5' })
    expect(writePref).not.toHaveBeenCalled()
    expect(prefs[lastTablePref('personal')]).toBe('all')
  })

  describe('bloqueio', () => {
    afterEach(() => useLockState.setState({ hidden: false }))

    it('uma folha aberta fecha atrás da tela de bloqueio e não grava', async () => {
      const { save } = seed()
      await render(<FinanceScreen today="2026-10-31" />)
      await fireEvent.press(screen.getByRole('button', { name: 'Tabela ▸ Conta' }))
      await fireEvent.press(screen.getByRole('radio', { name: 'Nova tabela…' }))
      await fireEvent.changeText(screen.getByLabelText('Nome da tabela'), 'Poupança')
      await act(async () => {
        useLockState.setState({ hidden: true })
      })
      expect(screen.queryByLabelText('Nome da tabela')).toBeNull()
      expect(names()).not.toContain('Poupança')
      expect(save).not.toHaveBeenCalled()
      // Back from the lock: what was typed is still there.
      await act(async () => {
        useLockState.setState({ hidden: false })
      })
      expect(screen.getByLabelText('Nome da tabela').props.value).toBe('Poupança')
    })
  })

  afterEach(() => jest.restoreAllMocks())
})
