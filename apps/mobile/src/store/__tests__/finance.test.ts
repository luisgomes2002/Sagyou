import {
  createTable,
  deleteItem,
  updateTransaction as coreUpdate
} from '@sagyou/core/finance-actions'
import { YIELD_SUMMARY_CATEGORY } from '@sagyou/core/yieldSummary'
import { seedApp } from '../../__tests__/seed'
import { emptyState, type MobileState } from '../../data/state'
import { useLockState } from '../../lock/lockState'
import { useApp } from '../app'
import { useUndo } from '../undo'
import {
  DELETE_LOCKED_TEXT,
  DETAILS_EXCEED_TEXT,
  INVALID_AMOUNT_TEXT,
  LOCKED_TEXT,
  NOT_FOUND_TEXT,
  OVER_REMAINING_TEXT,
  YIELD_LOCKED_TEXT,
  addTransaction,
  applyFinance,
  deleteLock,
  editLock,
  financeErrorText,
  groupByDay,
  monthLabel,
  monthSummary,
  parseAmount,
  shiftMonth,
  tablesOfProfile,
  updateTransaction
} from '../finance'

type Tx = MobileState['lists'][number]['transactions'][number]
const tx = (id: string, type: Tx['type'], amount: string, date: string): Tx => ({
  id,
  description: id,
  amount,
  type,
  date
})

describe('resumo do mês e lista por dia', () => {
  it('soma entradas e saídas do mês civil em decimal, sem outros meses', () => {
    const txs = [
      tx('a', 'income', '10.10', '2026-11-01'),
      tx('b', 'income', '0.2', '2026-11-30'),
      tx('c', 'expense', '1500.5', '2026-11-15'),
      tx('d', 'expense', '999', '2026-10-31')
    ]
    expect(monthSummary(txs, '2026-11-01')).toEqual({ income: '10.3', expense: '1500.5' })
    expect(monthSummary([], '2026-11-01')).toEqual({ income: '0', expense: '0' })
  })

  it('agrupa por dia, mais recente primeiro, com Hoje e Ontem', () => {
    const txs = [
      tx('sexta', 'expense', '1', '2026-10-30'),
      tx('hoje1', 'expense', '1', '2026-11-01'),
      tx('ontem', 'income', '1', '2026-10-31'),
      tx('hoje2', 'income', '1', '2026-11-01')
    ]
    expect(groupByDay(txs, '2026-11-01').map((g) => [g.label, g.txs.map((t) => t.id)])).toEqual([
      ['Hoje', ['hoje1', 'hoje2']],
      ['Ontem', ['ontem']],
      ['sex., 30/10', ['sexta']]
    ])
  })
})

const T = '2026-10-01T00:00:00.000Z'
const NOW = new Date('2026-10-31T12:00:00.000Z')

function state(): MobileState {
  const s = emptyState()
  s.lists = [
    {
      id: 'brl',
      name: 'Conta',
      currency: 'BRL',
      profileId: 'personal',
      legacyFinancialMetadata: { budget: 500 },
      items: [],
      goals: [],
      transactions: [
        {
          id: 'tx1',
          description: 'Mercado',
          amount: '100',
          type: 'expense',
          date: '2026-10-10',
          receiptFileIds: ['f1'],
          details: [{ id: 'd1', description: 'Arroz', amount: '20' }],
          reconciledAt: T,
          audit: [{ at: T, changes: [{ field: 'category', before: 'A', after: 'B' }] }]
        },
        {
          id: 'pay',
          description: 'Parcela',
          amount: '50',
          type: 'expense',
          date: '2026-10-11',
          debtId: 'debt1'
        }
      ],
      createdAt: T,
      updatedAt: T
    } as MobileState['lists'][number],
    {
      id: 'jpy',
      name: '円',
      currency: 'JPY',
      profileId: 'trabalho',
      items: [],
      goals: [],
      transactions: [],
      createdAt: T,
      updatedAt: T
    } as MobileState['lists'][number]
  ]
  return s
}

describe('lançamentos no celular', () => {
  it('lê o valor com a moeda da tabela e grava string decimal', () => {
    expect(parseAmount('1.234,56', 'BRL')).toBe('1234.56')
    expect(parseAmount('1.000', 'JPY')).toBe('1000')
    expect(parseAmount('0', 'BRL')).toBeNull()
    expect(parseAmount('abc', 'BRL')).toBeNull()
    const { state: next, id } = addTransaction(
      state(),
      'brl',
      {
        type: 'expense',
        amount: parseAmount('1.234,56', 'BRL')!,
        date: '2026-10-31',
        category: 'Alimentação',
        description: 'Almoço'
      },
      NOW
    )
    expect(next.lists[0].transactions.find((t) => t.id === id)).toMatchObject({
      amount: '1234.56',
      type: 'expense',
      createdAt: NOW.toISOString()
    })
  })

  it('editar o valor audita, limpa a conciliação e preserva o resto', () => {
    const result = updateTransaction(state(), 'brl', 'tx1', { amount: '120' }, NOW)
    if ('error' in result) throw new Error(result.error)
    const table = result.state.lists[0]
    const tx = table.transactions[0]
    expect(tx.amount).toBe('120')
    expect(tx.reconciledAt).toBeUndefined()
    expect(tx.audit).toHaveLength(2)
    expect(tx.audit?.[0]).toEqual(state().lists[0].transactions[0].audit?.[0])
    expect(tx.audit?.[1].changes.map((c) => c.field)).toEqual(['amount', 'reconciledAt'])
    expect(tx.receiptFileIds).toEqual(['f1'])
    expect(tx.details).toEqual([{ id: 'd1', description: 'Arroz', amount: '20' }])
    expect(table.legacyFinancialMetadata).toEqual({ budget: 500 })
  })

  it('pagamento de dívida não é editável no celular', () => {
    expect(updateTransaction(state(), 'brl', 'pay', { amount: '1' }, NOW)).toEqual({
      error: LOCKED_TEXT
    })
  })

  it('o seletor mostra só as tabelas do perfil ativo', () => {
    expect(tablesOfProfile(state(), 'personal').map((t) => t.id)).toEqual(['brl'])
    expect(tablesOfProfile(state(), 'trabalho').map((t) => t.id)).toEqual(['jpy'])
  })
})

describe('escrita pelo core no celular', () => {
  beforeEach(() => useUndo.getState().dismiss())
  afterEach(() => useLockState.setState({ hidden: false }))

  it('traduz cada recusa do core', () => {
    expect([
      financeErrorText('invalid-amount'),
      financeErrorText('over-remaining'),
      financeErrorText('not-found')
    ]).toEqual([INVALID_AMOUNT_TEXT, OVER_REMAINING_TEXT, NOT_FOUND_TEXT])
    expect(INVALID_AMOUNT_TEXT).toBe('Valor inválido.')
    expect(OVER_REMAINING_TEXT).toBe('O pagamento passa do valor restante.')
    expect(NOT_FOUND_TEXT).toBe('Este item não existe mais.')
  })

  it('applyFinance grava a lista nova de uma vez só', () => {
    const { save } = seedApp(state())
    const outcome = applyFinance((tables, now) =>
      coreUpdate(tables, 'brl', 'tx1', { description: 'Feira' }, now)
    )
    expect(outcome).toEqual({ ok: true })
    expect(save).toHaveBeenCalledTimes(1)
    expect(useApp.getState().state.lists[0].transactions[0].description).toBe('Feira')
    // The rest of the state is carried over untouched.
    expect(useApp.getState().state.lists[1].id).toBe('jpy')
  })

  it('applyFinance devolve o id de uma tabela criada', () => {
    seedApp(state())
    const outcome = applyFinance((tables, now) =>
      createTable(tables, 'Nova', 'USD', 'personal', now)
    )
    expect(outcome).toEqual({ ok: true, id: expect.any(String) })
    expect(useApp.getState().state.lists.map((t) => t.name)).toEqual(['Conta', '円', 'Nova'])
  })

  it('applyFinance mostra o erro traduzido no aviso e não grava', () => {
    const { save } = seedApp(state())
    expect(applyFinance((tables, now) => deleteItem(tables, 'brl', 'nada', now))).toEqual({
      ok: false
    })
    expect(useUndo.getState()).toMatchObject({ message: NOT_FOUND_TEXT, canUndo: false })
    const onError = jest.fn()
    applyFinance((tables, now) => deleteItem(tables, 'brl', 'nada', now), onError)
    expect(onError).toHaveBeenCalledWith(NOT_FOUND_TEXT)
    expect(save).not.toHaveBeenCalled()
  })

  it('applyFinance não grava quando o core não muda nada', () => {
    const { save } = seedApp(state())
    // A debt payment is immutable: the core answers with the very same list.
    const outcome = applyFinance((tables, now) =>
      coreUpdate(tables, 'brl', 'pay', { amount: '1' }, now)
    )
    expect(outcome).toEqual({ ok: true })
    expect(save).not.toHaveBeenCalled()
  })

  it('applyFinance não grava em só leitura nem atrás do bloqueio', () => {
    const edit = (): ReturnType<typeof applyFinance> =>
      applyFinance((tables, now) => coreUpdate(tables, 'brl', 'tx1', { description: 'X' }, now))
    const readOnly = seedApp(state(), { readOnly: true })
    expect(edit()).toEqual({ ok: false })
    expect(readOnly.save).not.toHaveBeenCalled()
    const locked = seedApp(state())
    useLockState.setState({ hidden: true })
    expect(edit()).toEqual({ ok: false })
    expect(locked.save).not.toHaveBeenCalled()
    expect(useApp.getState().state.lists[0].transactions[0].description).toBe('Mercado')
  })

  it('addTransaction numa tabela que sumiu não acrescenta nada e devolve id vazio', () => {
    const before = state()
    const added = addTransaction(
      before,
      'sumiu',
      { type: 'expense', amount: '1', date: '2026-10-31', category: '', description: 'x' },
      NOW
    )
    expect(added).toEqual({ state: before, id: '' })
  })

  it('origem, pessoa e referência entram na edição, com auditoria', () => {
    const result = updateTransaction(
      state(),
      'brl',
      'tx1',
      { source: 'Nubank', counterparty: 'Mercado Bom', bankReference: 'E123' },
      NOW
    )
    if ('error' in result) throw new Error(result.error)
    const tx = result.state.lists[0].transactions[0]
    expect(tx).toMatchObject({
      source: 'Nubank',
      counterparty: 'Mercado Bom',
      bankReference: 'E123'
    })
    expect(tx.audit?.at(-1)?.changes.map((c) => c.field)).toEqual([
      'source',
      'counterparty',
      'bankReference'
    ])
  })
})

describe('travas do celular', () => {
  const summary = {
    id: 'ys',
    description: 'Rendimentos Outubro 2026',
    amount: '10',
    type: 'income' as const,
    date: '2026-10-01',
    category: YIELD_SUMMARY_CATEGORY
  }
  const plain = (id: string, extra: Partial<Tx> = {}): Tx => ({
    id,
    description: id,
    amount: '5',
    type: 'expense',
    date: '2026-10-12',
    ...extra
  })

  function locked(): MobileState {
    const s = state()
    s.lists[0].transactions.push(
      summary,
      plain('xfer', { currencyTransferId: 'g' }),
      plain('legacyParent', { linkedTransactionId: 'legacyChild' }),
      plain('legacyChild'),
      plain('invoice', {
        amount: '90',
        details: [{ id: 'd2', description: 'Item', amount: '90', linkedTransactionId: 'mirror' }]
      }),
      plain('plain')
    )
    s.lists[1].transactions.push(plain('mirror', { amount: '90' }))
    return s
  }

  const lock = (id: string, kind: 'edit' | 'delete'): string | null => {
    const all = locked().lists
    const tx = all.flatMap((t) => t.transactions).find((x) => x.id === id)!
    return kind === 'edit' ? editLock(all, tx) : deleteLock(all, tx)
  }

  it('o resumo de rendimento não se edita nem se exclui, com o texto dos rendimentos', () => {
    expect(YIELD_LOCKED_TEXT).toBe('Este lançamento vem dos rendimentos do mês.')
    expect([lock('ys', 'edit'), lock('ys', 'delete')]).toEqual([
      YIELD_LOCKED_TEXT,
      YIELD_LOCKED_TEXT
    ])
    // A transaction that only looks like one is not locked.
    const s = state()
    expect(editLock(s.lists, { ...summary, id: 'fake', category: 'Salário' })).toBeNull()
  })

  it('o pagamento de dívida não se edita, mas se exclui', () => {
    expect(lock('pay', 'edit')).toBe(LOCKED_TEXT)
    expect(lock('pay', 'delete')).toBeNull()
  })

  it('transferência, fatura e vínculo legado não se excluem, nos dois sentidos', () => {
    expect(DELETE_LOCKED_TEXT).toBe('Este lançamento só pode ser excluído no PC.')
    for (const id of ['xfer', 'legacyParent', 'legacyChild', 'invoice', 'mirror'])
      expect([id, lock(id, 'delete')]).toEqual([id, DELETE_LOCKED_TEXT])
    expect(lock('plain', 'delete')).toBeNull()
    expect(lock('tx1', 'delete')).toBeNull()
  })

  it('a edição segue a regra de hoje: transferência, vínculo legado e fatura travam', () => {
    for (const id of ['xfer', 'legacyParent', 'invoice'])
      expect([id, lock(id, 'edit')]).toEqual([id, LOCKED_TEXT])
    expect(lock('plain', 'edit')).toBeNull()
  })

  it('o espelho da fatura, em outra tabela, também não se edita (nos dois sentidos)', () => {
    // The invoice points at the mirror; the mirror lives in the other table and has no link itself.
    expect([lock('invoice', 'edit'), lock('mirror', 'edit')]).toEqual([LOCKED_TEXT, LOCKED_TEXT])
    // Looking only at the mirror's own table would have let it through.
    const all = locked().lists
    const mirror = all[1].transactions.find((x) => x.id === 'mirror')!
    expect(editLock([all[1]], mirror)).toBeNull()
    expect(editLock(all, mirror)).toBe(LOCKED_TEXT)
    expect(updateTransaction(locked(), 'jpy', 'mirror', { amount: '1' }, NOW)).toEqual({
      error: LOCKED_TEXT
    })
  })

  it('o valor não desce abaixo da soma dos itens da fatura: o aviso, sem perder a edição calado', () => {
    const s = state()
    s.lists[0].transactions.push(
      plain('fat', { amount: '90', details: [{ id: 'i1', description: 'Item', amount: '60' }] })
    )
    expect(updateTransaction(s, 'brl', 'fat', { amount: '50' }, NOW)).toEqual({
      error: DETAILS_EXCEED_TEXT
    })
    const ok = updateTransaction(s, 'brl', 'fat', { amount: '120' }, NOW)
    if ('error' in ok) throw new Error(ok.error)
    expect(ok.state.lists[0].transactions.find((x) => x.id === 'fat')).toMatchObject({
      amount: '120',
      details: [{ id: 'i1', description: 'Item', amount: '60' }]
    })
  })

  it('updateTransaction recusa o resumo de rendimento com o texto certo', () => {
    expect(updateTransaction(locked(), 'brl', 'ys', { amount: '1' }, NOW)).toEqual({
      error: YIELD_LOCKED_TEXT
    })
  })
})

describe('mês escolhido', () => {
  it('anda de mês em mês, virando o ano', () => {
    expect(shiftMonth('2026-10', 1)).toBe('2026-11')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2027-01', -1)).toBe('2026-12')
    expect(shiftMonth('2026-03', -14)).toBe('2025-01')
  })

  it('escreve "novembro de 2026"', () => {
    expect(monthLabel('2026-11')).toBe('novembro de 2026')
    expect(monthLabel('2027-03')).toBe('março de 2027')
  })
})
