import { describe, expect, it } from 'vitest'
import {
  CONFLICT_TEXTS,
  FIELD_LABELS,
  FIELD_ORDER,
  canChooseFields,
  compareConflict,
  conflictNames,
  sameValue,
  conflictSummary,
  fieldLabel,
  formatFieldValue,
  wordDiff,
  type NameLookup
} from '../conflict-view'
import type { SyncConflictView, SyncVersionView } from '../engine'
import { extractDataRecords, extractMemoryRecords, type SyncKind } from '../records'

const ISO = '2026-11-10T22:36:00.000Z'
const noNames: NameLookup = () => null

/** Every field of every kind filled, so the label check covers them all. */
function everyField(): ReturnType<typeof extractDataRecords> {
  const data = {
    projects: [
      {
        id: 'p1',
        name: 'Projeto',
        description: 'Desc',
        color: '#fff',
        order: 1,
        archivedAt: ISO,
        createdAt: ISO,
        updatedAt: ISO,
        columns: [{ id: 'c1', name: 'Feito', order: 1, color: '#000' }],
        links: [{ id: 'l1', label: 'Site', url: 'https://x.y' }]
      }
    ],
    tasks: [
      {
        id: 't1',
        projectId: 'p1',
        columnId: 'c1',
        title: 'T',
        description: 'D',
        priority: 'high',
        dueDate: '2026-11-10',
        sprintId: 's1',
        timeSpent: 10,
        order: 2,
        createdAt: ISO,
        updatedAt: ISO,
        completedAt: ISO,
        tags: ['a'],
        images: [{ id: 'i1', name: 'n', ext: '.png', size: 1, addedAt: ISO }]
      }
    ],
    sprints: [{ id: 's1', projectId: 'p1', name: 'S', createdAt: ISO, closedAt: ISO }],
    notes: [
      {
        id: 'n1',
        projectId: 'p1',
        content: 'C',
        color: '#fff',
        borderStyle: 'dashed',
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        taskId: 't1',
        taskIds: ['t1'],
        goalIds: ['g1'],
        fontSize: 14,
        type: 'text',
        completedAt: ISO,
        createdAt: ISO,
        updatedAt: ISO,
        connections: ['n2']
      }
    ],
    goals: [
      {
        id: 'g1',
        title: 'G',
        kind: 'quantity',
        target: 5,
        unit: 'km',
        color: '#fff',
        projectId: 'p1',
        createdAt: ISO,
        updatedAt: ISO,
        entries: [{ id: 'e1', date: '2026-11-10', label: 'L', value: 1, createdAt: ISO }]
      }
    ],
    habits: [
      {
        id: 'h1',
        name: 'H',
        color: '#fff',
        createdAt: ISO,
        updatedAt: ISO,
        completions: ['2026-11-10']
      }
    ],
    financialProfiles: [
      {
        id: 'fp1',
        name: 'P',
        createdAt: ISO,
        updatedAt: ISO,
        customCategories: ['x'],
        savedSources: ['y'],
        savedCounterparties: ['z']
      }
    ],
    lists: [
      {
        id: 'ft1',
        name: 'Conta',
        currency: 'BRL',
        createdAt: ISO,
        updatedAt: ISO,
        profileId: 'fp1',
        provider: 'Banco',
        actualBalance: '10',
        actualBalanceUpdatedAt: ISO,
        legacyFinancialMetadata: { budget: 1 },
        debts: [
          {
            id: 'd1',
            name: 'D',
            originalAmount: '10',
            remainingAmount: '5',
            createdAt: ISO,
            updatedAt: ISO,
            completedAt: ISO
          }
        ],
        transactions: [
          {
            id: 'tx1',
            description: 'T',
            amount: '1500.5',
            type: 'expense',
            date: '2026-11-10',
            category: 'Casa',
            fromShopping: true,
            linkedTransactionId: 'tx2',
            source: 'Banco',
            details: [{ id: 'dt1', description: 'x', amount: '1' }],
            receiptFileIds: ['f1'],
            bankReference: 'ref',
            counterparty: 'Ana',
            createdAt: ISO,
            updatedAt: ISO,
            reconciledAt: ISO,
            audit: [{ at: ISO, field: 'amount' }],
            currencyTransferId: 'ct1',
            currencyTransferFee: '1',
            currencyTransferFeeCurrency: 'BRL',
            debtId: 'd1'
          }
        ],
        items: [
          {
            id: 'si1',
            name: 'I',
            qty: 2,
            price: '3',
            done: true,
            link: 'https://x.y',
            linkedTransactionId: 'tx1'
          }
        ],
        goals: [
          {
            id: 'fg1',
            name: 'M',
            targetAmount: '100',
            targetMonth: 11,
            targetYear: 2026,
            completedAt: ISO,
            completionNote: 'ok'
          }
        ],
        yieldSources: [{ id: 'ys1', name: 'Y', createdAt: ISO }],
        yieldEntries: [
          { id: 'ye1', sourceId: 'ys1', date: '2026-11-10', amount: '1', createdAt: ISO }
        ]
      }
    ],
    files: [{ id: 'f1', name: 'F', ext: '.pdf', size: 10, createdAt: ISO, projectId: 'p1' }],
    timeBlocks: [
      {
        id: 'tb1',
        date: '2026-11-10',
        startTime: '09:00',
        endTime: '10:00',
        title: 'B',
        description: 'D',
        taskId: 't1',
        habitId: 'h1',
        type: 'task',
        color: '#fff',
        borderStyle: 'solid',
        order: 1,
        createdAt: ISO,
        updatedAt: ISO
      }
    ],
    routines: [
      {
        id: 'r1',
        title: 'R',
        description: 'D',
        startTime: '09:00',
        endTime: '10:00',
        daysOfWeek: [1],
        color: '#fff',
        borderStyle: 'solid',
        active: true,
        createdAt: ISO,
        updatedAt: ISO
      }
    ]
  }
  const memories = extractMemoryRecords([
    {
      id: 'm1',
      projectId: 'p1',
      type: 'decisao',
      title: 'M',
      body: 'B',
      tags: ['a'],
      pinned: true,
      source: 'user',
      createdAt: ISO,
      updatedAt: ISO,
      archivedAt: ISO
    } as never
  ])
  return [...extractDataRecords(data), ...memories]
}

function version(
  payload: Record<string, unknown> | null,
  hlc: string | null,
  deviceName: string,
  deleted = false
): SyncVersionView {
  return { hlc, at: hlc ? 1 : null, deviceName, deleted, payload }
}

const OLD = '000001794300000-0000-aaaa'
const NEW = '000001794400000-0000-bbbb'
const LONG_A = `${'palavra '.repeat(12)}primeira versão da descrição`
const LONG_B = `${'palavra '.repeat(12)}segunda versão da descrição`

function taskConflict(
  localNewer: boolean,
  localTime: number,
  remoteTime: number
): SyncConflictView {
  const base = { id: 't1', projectId: 'p1', title: 'Coletor — Remotive', updatedAt: ISO }
  return {
    id: 'c1',
    type: 'lww',
    kind: 'task',
    recordId: 't1',
    createdAt: 1,
    local: version(
      { ...base, description: LONG_A, timeSpent: localTime, order: 1 },
      localNewer ? NEW : OLD,
      'Este PC'
    ),
    remote: version(
      { ...base, description: LONG_B, timeSpent: remoteTime, order: 3, updatedAt: '2026-01-01' },
      localNewer ? OLD : NEW,
      'Dell'
    )
  }
}

describe('rótulos', () => {
  it('todo campo de todo tipo tem rótulo e está na lista de campos', () => {
    const seen = new Map<SyncKind, Set<string>>()
    for (const record of everyField()) {
      const fields = seen.get(record.kind) ?? new Set<string>()
      for (const key of Object.keys(record.payload)) fields.add(key)
      seen.set(record.kind, fields)
    }
    for (const [kind, fields] of seen) {
      for (const field of fields) {
        if (field === 'id' || field === 'updatedAt') continue
        expect(FIELD_ORDER[kind], `${kind}.${field}`).toContain(field)
        expect(FIELD_LABELS[kind]?.[field], `${kind}.${field}`).toBeTruthy()
      }
      // And the fixture leaves no listed field out.
      for (const field of FIELD_ORDER[kind]) expect(fields, `${kind}.${field}`).toContain(field)
    }
    expect([...seen.keys()].sort()).toEqual(Object.keys(FIELD_ORDER).sort())
  })

  it('nomes em português e rótulo genérico para campo desconhecido', () => {
    expect(fieldLabel('task', 'timeSpent')).toBe('Tempo gasto')
    expect(fieldLabel('task', 'order')).toBe('Posição na coluna')
    expect(fieldLabel('task', 'description')).toBe('Descrição')
    expect(fieldLabel('task', 'fooBar')).toBe('Foo bar')
  })
})

describe('valores legíveis', () => {
  const v = (field: string, value: unknown, kind: SyncKind = 'task', names = noNames): string =>
    formatFieldValue(kind, field, value, names)

  it('tempo, datas, sim/não, prioridade e posição', () => {
    expect(v('timeSpent', 7500)).toBe('2 h 05 min')
    expect(v('timeSpent', 2700)).toBe('45 min')
    expect(v('timeSpent', 30)).toBe('30 s')
    expect(v('timeSpent', 0)).toBe('0 s')
    expect(v('dueDate', '2026-11-10')).toBe('10/11/2026')
    expect(v('createdAt', ISO)).toBe(new Date(ISO).toLocaleString('pt-BR'))
    expect(v('done', true, 'shopping_item')).toBe('Sim')
    expect(v('priority', 'urgent')).toBe('Urgente')
    expect(v('priority', 'low')).toBe('Baixa')
    expect(v('priority', 'medium')).toBe('Média')
    expect(v('priority', 'high')).toBe('Alta')
    expect(v('order', 3)).toBe('Posição 4')
  })

  it('listas, imagens, dinheiro e referências', () => {
    expect(v('tags', ['a', 'b'])).toBe('a, b')
    expect(v('images', [{}, {}, {}])).toBe('3 imagens')
    expect(v('images', [{}])).toBe('1 imagem')
    expect(v('amount', '1500.5', 'transaction')).toBe('1500,5')
    const names: NameLookup = (kind, id) =>
      kind === 'project_column' && id === 'c1' ? 'Feito' : null
    expect(v('columnId', 'c1', 'task', names)).toBe('Feito')
    expect(v('columnId', 'c9', 'task', names)).toBe(CONFLICT_TEXTS.missingRef)
    expect(CONFLICT_TEXTS.missingRef).toBe('(item não encontrado)')
  })

  it('vazio', () => {
    expect(v('description', undefined)).toBe('(vazio)')
    expect(v('description', '')).toBe('(vazio)')
    expect(v('tags', [])).toBe('(vazio)')
  })
})

describe('diferença por palavras', () => {
  it('marca só o que mudou', () => {
    const diff = wordDiff('a b c', 'a x c')!
    expect(diff.local.filter((s) => s.changed).map((s) => s.text.trim())).toEqual(['b'])
    expect(diff.remote.filter((s) => s.changed).map((s) => s.text.trim())).toEqual(['x'])
    expect(diff.local.map((s) => s.text).join('')).toBe('a b c')
  })

  it('texto grande demais não calcula', () => {
    expect(wordDiff('a '.repeat(2001), 'b '.repeat(2001))).toBeNull()
  })
})

describe('comparação', () => {
  it('caso real: só os campos diferentes, na ordem do tipo, local mais recente', () => {
    const cmp = compareConflict(taskConflict(true, 7200, 6000), noNames)
    expect(cmp.choosable).toBe(true)
    expect(cmp.newer).toBe('local')
    expect(cmp.differing.map((r) => r.field)).toEqual(['description', 'timeSpent', 'place'])
    expect(cmp.equal.map((r) => r.field)).toContain('title')
    expect(cmp.equal.map((r) => r.field)).not.toContain('id')
    expect([...cmp.differing, ...cmp.equal].map((r) => r.field)).not.toContain('updatedAt')
    expect(cmp.initial).toEqual({ description: 'local', timeSpent: 'local', place: 'local' })
    expect(cmp.timeNote).toBe(false)
  })

  it('remoto mais recente, mas o maior tempo é o local', () => {
    const cmp = compareConflict(taskConflict(false, 7200, 6000), noNames)
    expect(cmp.newer).toBe('remote')
    expect(cmp.initial).toEqual({ description: 'remote', timeSpent: 'local', place: 'remote' })
    expect(cmp.timeNote).toBe(true)
  })

  it('campo só de um lado e destaque em texto longo', () => {
    const c = taskConflict(true, 1, 1)
    c.remote.payload = { ...c.remote.payload, completedAt: ISO }
    const cmp = compareConflict(c, noNames)
    const done = cmp.differing.find((r) => r.field === 'completedAt')!
    expect(done.local).toMatchObject({ present: false, text: '(vazio)' })
    expect(done.remote.present).toBe(true)
    expect(cmp.differing.find((r) => r.field === 'description')!.local.segments).toBeDefined()
    expect(cmp.equal.find((r) => r.field === 'title')!.local.segments).toBeUndefined()
  })

  it('quem não escolhe campo a campo', () => {
    const lww = taskConflict(true, 1, 2)
    expect(canChooseFields(lww)).toBe(true)
    expect(canChooseFields({ ...lww, kind: 'financial_debt', type: 'pending_choice' })).toBe(false)
    expect(canChooseFields({ ...lww, kind: 'memory' })).toBe(false)
    expect(canChooseFields({ ...lww, type: 'orphan' })).toBe(false)
    expect(canChooseFields({ ...lww, remote: version(null, NEW, 'Dell', true) })).toBe(false)
    const deleted = compareConflict({ ...lww, remote: version(null, NEW, 'Dell', true) }, noNames)
    expect(deleted).toMatchObject({ choosable: false, differing: [], initial: {} })
  })

  it('resumo', () => {
    const remoteNewer = taskConflict(false, 1, 2)
    expect(conflictSummary(remoteNewer, compareConflict(remoteNewer, noNames))).toBe(
      '3 campos diferentes · mais recente: Dell'
    )
    const one = taskConflict(false, 1, 1)
    one.remote.payload = { ...one.local.payload }
    one.remote.payload.order = 5
    expect(conflictSummary(one, compareConflict(one, noNames))).toBe(
      '1 campo diferente · mais recente: Dell'
    )
    const localNewer = taskConflict(true, 1, 2)
    expect(conflictSummary(localNewer, compareConflict(localNewer, noNames))).toBe(
      '3 campos diferentes · mais recente: Este aparelho'
    )
  })
})

describe('nomes das referências', () => {
  it('acha o nome de qualquer registro pelo tipo e id', () => {
    const names = conflictNames({
      projects: [{ id: 'p1', name: 'Casa', columns: [{ id: 'c1', name: 'Feito' }] }],
      tasks: [{ id: 't1', projectId: 'p1', title: 'Comprar pão' }],
      lists: [{ id: 'ft1', name: 'Conta', transactions: [{ id: 'tx1', description: 'Mercado' }] }]
    })
    expect(names('project_column', 'c1')).toBe('Feito')
    expect(names('task', 't1')).toBe('Comprar pão')
    expect(names('transaction', 'tx1')).toBe('Mercado')
    expect(names('task', 'nenhuma')).toBeNull()
  })
})

describe('grupos e exclusões da revisão', () => {
  it('projeto, coluna, sprint e posição viram uma escolha só, "Lugar"', () => {
    const c = taskConflict(false, 1, 1)
    c.local.payload = { ...c.local.payload, projectId: 'p2', columnId: 'c2', order: 0 }
    c.remote.payload = { ...c.remote.payload, projectId: 'p1', columnId: 'c1', sprintId: 's1', order: 3 }
    const names: NameLookup = (kind, id) =>
      ({ project: { p1: 'Casa', p2: 'Sagyou' }, project_column: { c1: 'Feito', c2: 'Backlog' }, sprint: { s1: 'Sprint 3' } } as Record<string, Record<string, string>>)[kind]?.[id] ?? null
    const cmp = compareConflict(c, names)
    const fields = cmp.differing.map((r) => r.field)
    expect(fields).toContain('place')
    for (const member of ['projectId', 'columnId', 'sprintId', 'order']) expect(fields).not.toContain(member)
    const place = cmp.differing.find((r) => r.field === 'place')!
    expect(place.label).toBe('Lugar')
    expect(place.local.text).toBe('Sagyou › Backlog › Posição 1')
    expect(place.remote.text).toBe('Casa › Feito › Sprint 3 › Posição 4')
    expect(cmp.initial.place).toBe('remote')
  })

  it('com o lugar igual, os campos ficam em "Igual nos dois" um a um', () => {
    const c = taskConflict(false, 1, 1)
    c.remote.payload = { ...c.remote.payload, order: 1 }
    const cmp = compareConflict(c, noNames)
    expect(cmp.differing.map((r) => r.field)).not.toContain('place')
    expect(cmp.equal.map((r) => r.field)).toContain('projectId')
  })

  it('nota: projeto e ligações andam juntos', () => {
    const c = taskConflict(false, 1, 1)
    c.kind = 'note'
    c.local.payload = { id: 'n1', projectId: 'p1', content: 'a', taskIds: ['t1'] }
    c.remote.payload = { id: 'n1', projectId: 'p2', content: 'a', taskIds: ['t2'] }
    const cmp = compareConflict(c, noNames)
    expect(cmp.differing.map((r) => r.field)).toEqual(['links'])
    expect(cmp.differing[0].label).toBe('Projeto e ligações')
  })

  it('financeiro é só versão inteira; perfil, tabela e fonte de rendimento continuam campo a campo', () => {
    const c = taskConflict(true, 1, 2)
    for (const kind of ['transaction', 'shopping_item', 'financial_goal', 'yield_entry', 'financial_debt'] as const)
      expect(canChooseFields({ ...c, kind }), kind).toBe(false)
    for (const kind of ['financial_profile', 'financial_table', 'yield_source'] as const)
      expect(canChooseFields({ ...c, kind }), kind).toBe(true)
  })

  it('a mesma igualdade da tela vale para o motor', () => {
    expect(sameValue('', undefined)).toBe(true)
    expect(sameValue([], undefined)).toBe(true)
    expect(sameValue({ a: [] }, {})).toBe(true)
    expect(sameValue('a', 'b')).toBe(false)
    expect(sameValue(['a'], ['a'])).toBe(true)
  })
})
