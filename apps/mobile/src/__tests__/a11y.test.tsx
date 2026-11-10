import { render, screen } from '@testing-library/react-native'
import { type ComponentType, useState } from 'react'
import { StyleSheet } from 'react-native'
import { ConflictScreen } from '../screens/ConflictScreen'
import { ConflictsScreen } from '../screens/ConflictsScreen'
import { ControlSetupScreen } from '../screens/ControlSetupScreen'
import { FinanceScreen } from '../screens/FinanceScreen'
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
  ['Todas as tarefas', () => <AllTasksList onOpenTask={jest.fn()} today="2026-11-01" />]
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
        const height = Number(style.minHeight ?? style.height ?? 0)
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
    ['Finanças', SCREENS[4][1], 'Nenhuma tabela neste perfil. Crie uma no Sagyou do PC.'],
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
