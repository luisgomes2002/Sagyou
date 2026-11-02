import { render, screen } from '@testing-library/react-native'
import type { ComponentType } from 'react'
import { StyleSheet } from 'react-native'
import { FinanceScreen } from '../screens/FinanceScreen'
import { HabitsScreen } from '../screens/HabitsScreen'
import { NotesScreen } from '../screens/NotesScreen'
import { SearchScreen } from '../screens/SearchScreen'
import { SettingsScreen } from '../screens/SettingsScreen'
import { SyncGuideScreen } from '../screens/SyncGuideScreen'
import { ProjectBoard, ProjectList, UpcomingList } from '../screens/tasks/TaskLists'
import type { MobileState } from '../data/state'
import { useApp } from '../store/app'
import { MIN_TOUCH } from '../theme'
import { T, project, seedApp, table } from './seed'

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

const SCREENS: [string, ComponentType][] = [
  ['Tarefas', () => <ProjectList onOpen={jest.fn()} onUpcoming={jest.fn()} today="2026-11-01" />],
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
  ['Como funciona', () => <SyncGuideScreen />]
]

const INTERACTIVE = ['button', 'checkbox', 'radio', 'tab'] as const

describe('varredura de acessibilidade', () => {
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
