import { render, screen } from '@testing-library/react-native'
import { type ComponentType, useState } from 'react'
import { StyleSheet } from 'react-native'
import { ConflictScreen } from '../screens/ConflictScreen'
import { ConflictsScreen } from '../screens/ConflictsScreen'
import { ControlSetupScreen } from '../screens/ControlSetupScreen'
import { FinanceScreen } from '../screens/FinanceScreen'
import { DebtSheet } from '../screens/finance/DebtSheet'
import { CompleteGoalSheet, GoalSheet } from '../screens/finance/GoalSheet'
import { TransactionDetailScreen } from '../screens/finance/TransactionDetailScreen'
import { HabitsScreen } from '../screens/HabitsScreen'
import { NotesScreen } from '../screens/NotesScreen'
import { PairDeviceScreen } from '../screens/PairDeviceScreen'
import { PcScreen } from '../screens/PcScreen'
import { RecoverSync } from '../screens/RecoverSync'
import { SearchScreen } from '../screens/SearchScreen'
import { SettingsScreen } from '../screens/SettingsScreen'
import { SyncGuideScreen } from '../screens/SyncGuideScreen'
import { AllTasksList, ProjectBoard, ProjectList, UpcomingList } from '../screens/tasks/TaskLists'
import type { MobileState } from '../data/state'
import { useRemote } from '../remote/store'
import { useApp } from '../store/app'
import { lastTablePref } from '../store/finance'
import { MIN_TOUCH } from '../theme'
import { T, project, seedApp, table } from './seed'
import { installEngine, lww, orphan } from './conflicts'

const SYNCED = {
  state: 'ok' as const,
  lastSyncAt: Date.now(),
  pendingCount: 0,
  paused: null,
  deviceName: 'Pixel',
  conflictCount: 0
}

const FULL: Partial<MobileState> = {
  projects: [project('p1', 'Sagyou')],
  tasks: [
    {
      id: 't1',
      projectId: 'p1',
      columnId: 'p1-todo',
      title: 'Pagar conta',
      priority: 'urgent',
      tags: ['casa', 'contas', 'mês'],
      order: 0,
      createdAt: T,
      updatedAt: T,
      dueDate: '2026-11-01'
    }
  ],
  habits: [
    { id: 'h1', name: 'Ler', color: '#46d478', completions: [], createdAt: T, updatedAt: T }
  ],
  notes: [
    {
      id: 'n1',
      projectId: 'p1',
      content: 'Ideia',
      color: '#fef08a',
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      createdAt: T,
      updatedAt: T
    }
  ],
  lists: [
    table('conta', 'Conta', 'personal', [
      {
        id: 'x1',
        description: 'Almoço',
        amount: '30',
        type: 'expense',
        date: '2026-11-01',
        category: 'Alimentação'
      },
      {
        id: 'x2',
        description: 'Fatura do cartão',
        amount: '100',
        type: 'expense',
        date: '2026-11-01',
        source: 'Nubank',
        counterparty: 'Banco',
        bankReference: 'E123',
        createdAt: '2026-11-01T12:00:00.000Z',
        reconciledAt: '2026-11-02',
        details: [{ id: 'd1', description: 'Mercado', amount: '60' }],
        audit: [
          {
            at: '2026-11-01T13:00:00.000Z',
            changes: [{ field: 'amount', before: '90', after: '100' }]
          }
        ]
      },
      {
        id: 'x3',
        description: 'Pagamento de dívida: Carro',
        amount: '50',
        type: 'expense',
        date: '2026-11-01',
        debtId: 'carro'
      }
    ])
  ],
  financialProfiles: [{ id: 'personal', name: 'Minhas finanças' }] as never
}

const PC_NOW = 1_800_000_000_000

/** The PC tab with every kind of control on screen: lock, power, update, servers and a card. */
function PcSample(): React.JSX.Element {
  useState(() =>
    useRemote.setState({
      authorized: 'yes',
      view: {
        state: 'ready',
        esp32Offline: true,
        esp32NoAnswer: false,
        forcedShutdownUntil: null,
        missing: []
      },
      status: {
        v: 1,
        at: PC_NOW,
        locked: true,
        servers: [
          { name: 'Sagyou', up: false, projectId: 'p1', state: 'stopped', autostart: true },
          { name: 'Murasaki', up: true, projectId: 'p2', state: 'running' },
          { name: 'Antigo', up: true }
        ],
        pendingCards: 1,
        shutdownAt: null,
        suspendedUntil: null,
        updateVersion: '1.6.0'
      },
      cards: [
        {
          id: 'c1',
          session: 'claude',
          tool: 'delete_task',
          resumo: 'Excluir tarefa',
          expiresAt: PC_NOW + 60_000
        }
      ],
      error: null,
      connection: null,
      busy: false
    })
  )
  return <PcScreen now={() => PC_NOW} />
}

function ConflictListSample(): React.JSX.Element {
  useState(() => installEngine([lww(), orphan()]))
  return <ConflictsScreen navigation={{ navigate: jest.fn() }} />
}

function ConflictSample(): React.JSX.Element {
  useState(() => installEngine([lww()]))
  return (
    <ConflictScreen
      route={{ params: { id: 'c1' } }}
      navigation={{ goBack: jest.fn(), navigate: jest.fn() }}
    />
  )
}

/** The Consolidado: the table pref says "all" before the screen reads it. */
function ConsolidatedSample(): React.JSX.Element {
  useState(() => useApp.getState().services?.repo.writePref(lastTablePref('personal'), 'all'))
  return <FinanceScreen today="2026-11-01" />
}

/** The Consolidado on its Resumo tab: one card per currency. */
function ConsolidatedSummarySample(): React.JSX.Element {
  useState(() => useApp.getState().services?.repo.writePref(lastTablePref('personal'), 'all'))
  return <FinanceScreen today="2026-11-01" initialTab="resumo" />
}

/** The "conta" table with an open debt, a settled one and goals in every state, before the screen reads it. */
function withDebtsAndGoals(): void {
  const current = useApp.getState().state
  useApp.setState({
    state: {
      ...current,
      lists: current.lists.map((t) =>
        t.id !== 'conta'
          ? t
          : {
              ...t,
              debts: [
                {
                  id: 'carro',
                  name: 'Carro',
                  originalAmount: '1000',
                  remainingAmount: '700',
                  createdAt: T,
                  updatedAt: T
                },
                {
                  id: 'antiga',
                  name: 'Antiga',
                  originalAmount: '200',
                  remainingAmount: '0',
                  createdAt: T,
                  updatedAt: T,
                  completedAt: '2026-10-20T12:00:00.000Z'
                }
              ],
              goals: [
                {
                  id: 'g1',
                  name: 'Viagem',
                  targetAmount: '1000',
                  targetMonth: 12,
                  targetYear: 2026
                },
                { id: 'g2', name: 'Curso', targetAmount: '5000', targetMonth: 8, targetYear: 2026 },
                {
                  id: 'g3',
                  name: 'Feita',
                  targetAmount: '100',
                  targetMonth: 6,
                  targetYear: 2026,
                  completedAt: '2026-10-10',
                  completionNote: 'Meta batida'
                }
              ]
            }
      )
    }
  })
}

function DebtsSample(): React.JSX.Element {
  useState(withDebtsAndGoals)
  return <FinanceScreen today="2026-11-01" initialTab="dividas" />
}

function GoalsSample(): React.JSX.Element {
  useState(withDebtsAndGoals)
  return <FinanceScreen today="2026-11-01" initialTab="metas" />
}

const CONTA = (FULL.lists ?? [])[0]
const CARRO = {
  id: 'carro',
  name: 'Carro',
  originalAmount: '1000',
  remainingAmount: '700',
  createdAt: T,
  updatedAt: T
}
const VIAGEM = {
  id: 'g1',
  name: 'Viagem',
  targetAmount: '1000',
  targetMonth: 12,
  targetYear: 2026
}

function DetailSample({ txId }: { txId: string }): React.JSX.Element {
  return (
    <TransactionDetailScreen
      route={{ params: { tableId: 'conta', txId } }}
      navigation={{ goBack: jest.fn() }}
    />
  )
}

const SCREENS: [string, ComponentType][] = [
  [
    'Tarefas',
    () => (
      <ProjectList onOpen={jest.fn()} onUpcoming={jest.fn()} onAll={jest.fn()} today="2026-11-01" />
    )
  ],
  [
    'Projeto',
    () => (
      <ProjectBoard
        projectId="p1"
        onOpenTask={jest.fn()}
        onNewTask={jest.fn()}
        today="2026-11-01"
      />
    )
  ],
  ['Próximas', () => <UpcomingList onOpenTask={jest.fn()} today="2026-11-01" />],
  ['Hábitos', () => <HabitsScreen today={new Date(2026, 10, 1, 12)} />],
  ['Finanças', () => <FinanceScreen today="2026-11-01" />],
  ['Notas', () => <NotesScreen now={new Date('2026-11-01T12:00:00.000Z')} />],
  ['Busca', () => <SearchScreen onOpen={jest.fn()} />],
  ['Ajustes', () => <SettingsScreen />],
  ['Como funciona', () => <SyncGuideScreen />],
  ['Parear outro aparelho', () => <PairDeviceScreen />],
  ['Controlar o PC', () => <ControlSetupScreen />],
  ['PC', PcSample],
  ['Conflitos', ConflictListSample],
  ['Conflito', ConflictSample],
  [
    'Entrar com código de recuperação',
    () => <RecoverSync busy={false} error={null} onSubmit={jest.fn()} onBack={jest.fn()} />
  ],
  ['Todas as tarefas', () => <AllTasksList onOpenTask={jest.fn()} today="2026-11-01" />],
  ['Finanças: Resumo', () => <FinanceScreen today="2026-11-01" initialTab="resumo" />],
  ['Finanças: Dívidas', () => <FinanceScreen today="2026-11-01" initialTab="dividas" />],
  ['Finanças: Metas', () => <FinanceScreen today="2026-11-01" initialTab="metas" />],
  ['Finanças: Compras', () => <FinanceScreen today="2026-11-01" initialTab="compras" />],
  ['Finanças: Rendimentos', () => <FinanceScreen today="2026-11-01" initialTab="rendimentos" />],
  ['Finanças: Consolidado', ConsolidatedSample],
  ['Lançamento', () => <DetailSample txId="x2" />],
  ['Lançamento: travado', () => <DetailSample txId="x3" />],
  ['Finanças: Resumo do Consolidado', ConsolidatedSummarySample],
  ['Finanças: Dívidas com dados', DebtsSample],
  ['Finanças: Metas com dados', GoalsSample],
  [
    'Finanças: Nova dívida',
    () => <DebtSheet visible onClose={jest.fn()} table={CONTA} today="2026-11-01" />
  ],
  [
    'Finanças: Pagar dívida',
    () => <DebtSheet visible onClose={jest.fn()} table={CONTA} debt={CARRO} today="2026-11-01" />
  ],
  [
    'Finanças: Nova meta',
    () => <GoalSheet visible onClose={jest.fn()} table={CONTA} today="2026-11-01" />
  ],
  [
    'Finanças: Editar meta',
    () => <GoalSheet visible onClose={jest.fn()} table={CONTA} goal={VIAGEM} today="2026-11-01" />
  ],
  [
    'Finanças: Concluir meta',
    () => (
      <CompleteGoalSheet
        visible
        onClose={jest.fn()}
        table={CONTA}
        goal={VIAGEM}
        today="2026-11-01"
      />
    )
  ]
]

const INTERACTIVE = ['button', 'checkbox', 'radio', 'tab'] as const

describe('varredura de acessibilidade', () => {
  // PcSample seeds the remote store; the other screens start from a phone without control.
  beforeEach(() => useRemote.setState({ authorized: 'none', view: null, status: null, cards: [] }))

  it.each(SCREENS)('%s: todo controle tem nome e alvo de 48 dp', async (_, Screen) => {
    seedApp(FULL)
    useApp.setState({ status: SYNCED })
    await render(<Screen />)
    for (const role of INTERACTIVE)
      for (const el of screen.queryAllByRole(role)) {
        const label = el.props.accessibilityLabel as string | undefined
        const style = StyleSheet.flatten(el.props.style) ?? {}
        // A scrim that fills its window (the sheet's "Fechar") is as big as the screen.
        const fills =
          style.position === 'absolute' &&
          style.top === 0 &&
          style.bottom === 0 &&
          style.left === 0 &&
          style.right === 0
        const height = fills ? MIN_TOUCH : Number(style.minHeight ?? style.height ?? 0)
        expect([role, label, height >= MIN_TOUCH]).toEqual([
          role,
          expect.stringMatching(/\S/),
          true
        ])
      }
  })

  it.each(SCREENS)('%s: nenhum texto ignora o tamanho de fonte do sistema', async (_, Screen) => {
    seedApp(FULL)
    useApp.setState({ status: SYNCED })
    await render(<Screen />)
    // RNTL v14 has no findAll: walk the host tree by hand.
    type Node = { props: Record<string, unknown>; children: (Node | string)[] }
    const fixed: unknown[] = []
    const walk = (node: Node | string | null): void => {
      if (!node || typeof node === 'string') return
      if (node.props.allowFontScaling === false) fixed.push(node.props.children)
      node.children.forEach(walk)
    }
    walk(screen.root as unknown as Node)
    expect(fixed).toEqual([])
  })

  const EMPTY: [string, ComponentType, string][] = [
    ['Tarefas', SCREENS[0][1], 'Nenhum projeto ainda. Crie um no Sagyou do PC.'],
    ['Hábitos', SCREENS[3][1], 'Nenhum hábito ainda. Crie um no Sagyou do PC.'],
    ['Finanças', SCREENS[4][1], 'Nenhuma tabela neste perfil.'],
    ['Notas', SCREENS[5][1], 'Nenhum projeto ainda. Crie um no Sagyou do PC.']
  ]

  it.each(EMPTY)('%s vazio depois de sincronizar mostra o que fazer', async (_, Screen, text) => {
    seedApp({})
    useApp.setState({ status: SYNCED })
    await render(<Screen />)
    expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByTestId('skeleton')).toBeNull()
  })

  it.each(EMPTY)(
    '%s vazio antes da primeira sincronização mostra o skeleton',
    async (_, Screen, text) => {
      seedApp({})
      useApp.setState({ status: { ...SYNCED, lastSyncAt: null } })
      await render(<Screen />)
      expect(screen.getByTestId('skeleton')).toBeTruthy()
      expect(screen.queryByText(text)).toBeNull()
    }
  )
})
