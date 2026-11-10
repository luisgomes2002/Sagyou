import { fireEvent, render, screen } from '@testing-library/react-native'
import * as Haptics from 'expo-haptics'
import { StyleSheet } from 'react-native'
import { createRecordRepo } from '../../data/records'
import { migrate } from '../../data/schema'
import { emptyState, type MobileState } from '../../data/state'
import { openNodeDb } from '../../data/__tests__/node-db'
import { T, project, seedApp } from '../../__tests__/seed'
import { type AppServices, useApp } from '../../store/app'
import { NO_DONE_COLUMN_TEXT } from '../../store/tasks'
import { useEditing } from '../../store/editing'
import { useUndo } from '../../store/undo'
import { lightTheme } from '../../theme'
import { NEW_SPRINT, TaskForm } from '../tasks/TaskForm'
import { ProjectBoard, ProjectList, UpcomingList } from '../tasks/TaskLists'

type TaskT = MobileState['tasks'][number]

const task = (id: string, extra: Partial<TaskT> = {}): TaskT => ({
  id,
  projectId: 'p1',
  columnId: 'p1-todo',
  title: id,
  priority: 'medium',
  tags: [],
  order: 0,
  createdAt: T,
  updatedAt: T,
  ...extra
})

const sprints: MobileState['sprints'] = [
  { id: 's1', projectId: 'p1', name: 'Sprint 1', createdAt: '2026-10-01T00:00:00.000Z' },
  { id: 's2', projectId: 'p1', name: 'Sprint 2', createdAt: '2026-10-15T00:00:00.000Z' }
]

function seed(extra: Partial<MobileState> = {}, readOnly = false): ReturnType<typeof seedApp> {
  return seedApp({ projects: [project('p1', 'Sagyou')], sprints, ...extra }, { readOnly })
}

/** A task row's label starts with its title (then priority, due date, project…). */
const row = (title: string): RegExp => new RegExp(`^${title}(,|$)`)

const color = (testID: string): string | undefined =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style)?.color

describe('Tarefas no celular', () => {
  beforeEach(() => {
    useUndo.getState().dismiss()
    jest.clearAllMocks()
  })

  it('o cartão Hoje resume os prazos e abre Próximas', async () => {
    seed({ tasks: [task('a', { dueDate: '2026-11-04' }), task('b', { dueDate: '2026-11-03' })] })
    const onUpcoming = jest.fn()
    await render(<ProjectList onOpen={jest.fn()} onUpcoming={onUpcoming} today="2026-11-04" />)
    expect(screen.getByText('1 para hoje · 1 atrasada')).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: /^Hoje/ }))
    expect(
      screen.getByRole('button', { name: 'Sagyou, 2 abertas, 0 de 2 concluídas' })
    ).toBeTruthy()
    expect(onUpcoming).toHaveBeenCalled()
  })

  it('cada projeto mostra as abertas e a barra de progresso', async () => {
    seed({ tasks: [task('a'), task('b'), task('c', { columnId: 'p1-done' })] })
    await render(<ProjectList onOpen={jest.fn()} onUpcoming={jest.fn()} today="2026-11-04" />)
    expect(screen.getByText('2 abertas')).toBeTruthy()
    expect(screen.getByTestId('progress-p1').props.accessibilityValue).toEqual({
      min: 0,
      max: 3,
      now: 1
    })
  })

  it('as colunas viram chips com contagem, e Done fica por último', async () => {
    const p = project('p1', 'Sagyou', [
      { id: 'p1-done', name: 'Done', order: 0 },
      { id: 'p1-todo', name: 'A fazer', order: 1 },
      { id: 'p1-doing', name: 'Fazendo', order: 2 }
    ])
    seed({ projects: [p], tasks: [task('a'), task('b', { columnId: 'p1-doing' })] })
    await render(
      <ProjectBoard
        projectId="p1"
        onOpenTask={jest.fn()}
        onNewTask={jest.fn()}
        today="2026-11-04"
      />
    )
    const chips = screen
      .getAllByRole('button')
      .map((b) => b.props.accessibilityLabel as string)
      .filter((l) => / · \d+$/.test(l ?? ''))
    expect(chips).toEqual(['A fazer · 1', 'Fazendo · 1', 'Done · 0'])
    expect(screen.getByRole('button', { name: 'A fazer · 1' })).toBeSelected()
    expect(screen.getByRole('button', { name: row('a') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: row('b') })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'Fazendo · 1' }))
    expect(screen.getByRole('button', { name: row('b') })).toBeTruthy()
  })

  it('prazo atrasado em vermelho e de hoje em atenção', async () => {
    seed({
      tasks: [task('velha', { dueDate: '2026-11-03' }), task('hoje', { dueDate: '2026-11-04' })]
    })
    await render(
      <ProjectBoard
        projectId="p1"
        onOpenTask={jest.fn()}
        onNewTask={jest.fn()}
        today="2026-11-04"
      />
    )
    expect(color('due-velha')).toBe(lightTheme.red)
    expect(color('due-hoje')).toBe(lightTheme.attention)
  })

  it('"Concluir" conclui, vibra e oferece Desfazer, que volta a tarefa', async () => {
    const { save } = seed({ tasks: [task('a')] })
    await render(
      <ProjectBoard
        projectId="p1"
        onOpenTask={jest.fn()}
        onNewTask={jest.fn()}
        today="2026-11-04"
      />
    )
    await fireEvent(screen.getByRole('button', { name: row('a') }), 'accessibilityAction', {
      nativeEvent: { actionName: 'concluir' }
    })
    expect(useApp.getState().state.tasks[0].columnId).toBe('p1-done')
    expect(Haptics.impactAsync).toHaveBeenCalled()
    expect(useUndo.getState()).toMatchObject({ message: 'Tarefa concluída', canUndo: true })
    useUndo.getState().run()
    expect(useApp.getState().state.tasks[0]).toMatchObject({ columnId: 'p1-todo', order: 0 })
    expect(useApp.getState().state.tasks[0].completedAt).toBeUndefined()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('a caixinha "Concluir <título>" conclui com Desfazer; nada de arrastar', async () => {
    seed({ tasks: [task('a')] })
    await render(
      <ProjectBoard
        projectId="p1"
        onOpenTask={jest.fn()}
        onNewTask={jest.fn()}
        today="2026-11-04"
      />
    )
    expect(screen.queryByTestId('swipeable')).toBeNull()
    const box = screen.getByRole('checkbox', { name: 'Concluir a' })
    expect(box.props.accessibilityState).toMatchObject({ checked: false, disabled: false })
    expect(Number(StyleSheet.flatten(box.props.style)?.minHeight)).toBeGreaterThanOrEqual(48)
    await fireEvent.press(box)
    expect(useApp.getState().state.tasks[0].columnId).toBe('p1-done')
    expect(useUndo.getState()).toMatchObject({ message: 'Tarefa concluída', canUndo: true })
  })

  it('somente leitura: a caixinha fica desabilitada e nada é gravado', async () => {
    const { save } = seed({ tasks: [task('a')] }, true)
    await render(
      <ProjectBoard
        projectId="p1"
        onOpenTask={jest.fn()}
        onNewTask={jest.fn()}
        today="2026-11-04"
      />
    )
    const box = screen.getByRole('checkbox', { name: 'Concluir a' })
    expect(box.props.accessibilityState).toMatchObject({ disabled: true })
    await fireEvent.press(box)
    expect(save).not.toHaveBeenCalled()
    expect(useApp.getState().state.tasks[0].columnId).toBe('p1-todo')
  })

  it('Próximas também conclui pela caixinha', async () => {
    seed({ tasks: [task('vencida', { dueDate: '2026-10-20' })] })
    await render(<UpcomingList onOpenTask={jest.fn()} today="2026-11-04" />)
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Concluir vencida' }))
    expect(useApp.getState().state.tasks[0].columnId).toBe('p1-done')
  })

  it('sem coluna Done, avisa e não grava nem vibra', async () => {
    const p = project('p1', 'Sagyou', [{ id: 'p1-todo', name: 'A fazer', order: 0 }])
    const { save } = seed({ projects: [p], tasks: [task('a')] })
    await render(
      <ProjectBoard
        projectId="p1"
        onOpenTask={jest.fn()}
        onNewTask={jest.fn()}
        today="2026-11-04"
      />
    )
    await fireEvent(screen.getByRole('button', { name: row('a') }), 'accessibilityAction', {
      nativeEvent: { actionName: 'concluir' }
    })
    expect(useUndo.getState()).toMatchObject({ message: NO_DONE_COLUMN_TEXT, canUndo: false })
    expect(NO_DONE_COLUMN_TEXT).toBe('Este projeto não tem coluna Done.')
    expect(save).not.toHaveBeenCalled()
    expect(Haptics.impactAsync).not.toHaveBeenCalled()
  })

  it('somente leitura: não há ação de concluir', async () => {
    seed({ tasks: [task('a')] }, true)
    await render(
      <ProjectBoard
        projectId="p1"
        onOpenTask={jest.fn()}
        onNewTask={jest.fn()}
        today="2026-11-04"
      />
    )
    expect(screen.getByRole('button', { name: row('a') }).props.accessibilityActions ?? []).toEqual(
      []
    )
  })

  it('Próximas mostra só as seções com tarefas, em ordem', async () => {
    seed({
      tasks: [
        task('depois', { dueDate: '2026-11-30' }),
        task('amanha', { dueDate: '2026-11-05' }),
        task('vencida', { dueDate: '2026-10-20' })
      ]
    })
    await render(<UpcomingList onOpenTask={jest.fn()} today="2026-11-04" />)
    expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual([
      'Atrasadas',
      'Amanhã',
      'Mais tarde'
    ])
    expect(screen.getByRole('button', { name: row('vencida') })).toBeTruthy()
  })

  it('o formulário completo esconde o (+) enquanto está aberto', async () => {
    seed()
    const view = await render(<TaskForm projectId="p1" onDone={jest.fn()} />)
    expect(useEditing.getState().count).toBe(1)
    await view.unmount()
    expect(useEditing.getState().count).toBe(0)
  })

  it('a sprint vem preenchida com a aberta mais recente', async () => {
    seed()
    await render(<TaskForm projectId="p1" onDone={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'Sprint 2' })).toBeSelected()
    expect(screen.getByRole('button', { name: 'Sprint 1' })).not.toBeSelected()
  })

  it('"Nova sprint…" cria a sprint e a seleciona', async () => {
    seed()
    await render(<TaskForm projectId="p1" onDone={jest.fn()} />)
    await fireEvent.press(screen.getByRole('button', { name: NEW_SPRINT }))
    await fireEvent.changeText(screen.getByLabelText('Nome da sprint'), 'Sprint 3')
    await fireEvent.press(screen.getByRole('button', { name: 'Criar sprint' }))
    expect(useApp.getState().state.sprints.map((s) => s.name)).toContain('Sprint 3')
    expect(screen.getByRole('button', { name: 'Sprint 3' })).toBeSelected()
  })

  it('o formulário traz o título do (+) e o prazo vem dos chips', async () => {
    seed()
    const onDone = jest.fn()
    await render(<TaskForm projectId="p1" draftTitle="Comprar pão" onDone={onDone} />)
    expect(screen.getByLabelText('Título').props.value).toBe('Comprar pão')
    await fireEvent.press(screen.getByRole('button', { name: 'Hoje' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(useApp.getState().state.tasks).toEqual([
      expect.objectContaining({ title: 'Comprar pão', sprintId: 's2', columnId: 'p1-todo' })
    ])
    expect(useApp.getState().state.tasks[0].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(onDone).toHaveBeenCalled()
  })

  it('"Sem prazo" tira o prazo de uma tarefa', async () => {
    seed({ tasks: [task('a', { dueDate: '2026-11-04' })] })
    await render(<TaskForm projectId="p1" taskId="a" onDone={jest.fn()} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Sem prazo' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(useApp.getState().state.tasks[0].dueDate).toBeUndefined()
  })

  it('abrir as listas sobre os dados do banco não gera versão', async () => {
    const db = openNodeDb()
    migrate(db)
    const repo = createRecordRepo(db)
    const base = emptyState()
    base.projects = [project('p1', 'Sagyou')]
    base.tasks = [task('a', { dueDate: '2026-11-04', tags: ['x', 'y', 'z'] })]
    repo.save(base, Date.now())
    useApp.setState({
      state: repo.loadState(),
      readOnly: false,
      services: {
        repo,
        runtime: { engine: { notifySaved: jest.fn() } },
        search: () => []
      } as unknown as AppServices
    })
    await render(<ProjectList onOpen={jest.fn()} onUpcoming={jest.fn()} today="2026-11-04" />)
    await render(
      <ProjectBoard
        projectId="p1"
        onOpenTask={jest.fn()}
        onNewTask={jest.fn()}
        today="2026-11-04"
      />
    )
    await render(<UpcomingList onOpenTask={jest.fn()} today="2026-11-04" />)
    expect(repo.save(useApp.getState().state, Date.now() + 1000)).toBe(0)
  })
})
