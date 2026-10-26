import { describe, expect, it } from 'vitest'
import { GRAPH_NODE_COLORS, buildGraph } from '../../utils/graph-layout'
import type { Goal, Habit, Project, StickyNote, StoredFile, Task } from '../../types'

const NOW = '2025-01-01T00:00:00.000Z'

function makeProject(): Project {
  return {
    id: 'project-1',
    name: 'Projeto',
    color: '#6366f1',
    columns: [
      { id: 'todo', name: 'A fazer', order: 0 },
      { id: 'done', name: 'Done', order: 1 }
    ],
    createdAt: NOW,
    updatedAt: NOW
  }
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'project-1',
    columnId: 'todo',
    title: 'Task',
    priority: 'low',
    tags: [],
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function makeNote(overrides: Partial<StickyNote> & { id: string }): StickyNote {
  return {
    projectId: 'project-1',
    content: 'Nota',
    color: '#fef08a',
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function makeFile(overrides: Partial<StoredFile> & { id: string }): StoredFile {
  return {
    name: 'arquivo.pdf',
    ext: '.pdf',
    size: 10,
    createdAt: NOW,
    ...overrides
  }
}

function makeGoal(overrides: Partial<Goal> & { id: string }): Goal {
  return {
    title: 'Meta',
    entries: [],
    target: 1,
    unit: 'unidade',
    color: '#f472b6',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

function makeHabit(overrides: Partial<Habit> & { id: string }): Habit {
  return {
    name: 'Hábito',
    color: '#4ade80',
    completions: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

describe('buildGraph', () => {
  it('usa a paleta sóbria', () => {
    expect(GRAPH_NODE_COLORS).toMatchObject({
      project: '#7d6fc0',
      task: '#5b84b8',
      note: '#c09a4a',
      goal: '#b86a8e',
      habit: '#4f9a6c',
      file: '#b87a4a'
    })
  })

  it('mantém projetos arquivados e seus itens no grafo', () => {
    const project = { ...makeProject(), archivedAt: NOW }
    const task = makeTask({ id: 'task-archived' })
    const { nodes, edges } = buildGraph([project], [task], [], [], [])
    const projectNode = nodes.find((node) => node.entityId === project.id)!
    const taskNode = nodes.find((node) => node.entityId === task.id)!

    expect(projectNode).toMatchObject({ type: 'project' })
    expect(edges).toContainEqual({
      source: taskNode.id,
      target: projectNode.id,
      type: 'structural'
    })
  })

  it('ignora textos livres e conexões antigas que apontam para eles', () => {
    const text = makeNote({ id: 'heading', type: 'text' })
    const note = makeNote({ id: 'note', connections: [text.id] })
    const { nodes, edges } = buildGraph([makeProject()], [], [text, note], [], [])

    expect(nodes.some((node) => node.entityId === text.id)).toBe(false)
    expect(edges.some((edge) => edge.type === 'explicit')).toBe(false)
  })

  it('inclui tasks concluídas no grafo', () => {
    const completedTask = makeTask({
      id: 'task-done',
      columnId: 'done',
      completedAt: NOW
    })

    const { nodes, edges } = buildGraph([makeProject()], [completedTask], [], [], [])
    const task = nodes.find((node) => node.entityId === completedTask.id)
    const project = nodes.find((node) => node.entityId === 'project-1')

    expect(task).toMatchObject({ type: 'task', projectId: 'project-1' })
    expect(edges).toContainEqual({ source: task!.id, target: project!.id, type: 'structural' })
  })

  it('mantém a ligação de uma nota ao projeto quando ela também aponta para uma task', () => {
    const task = makeTask({ id: 'task-1' })
    const note = makeNote({ id: 'note-1', taskIds: [task.id] })

    const { nodes, edges } = buildGraph([makeProject()], [task], [note], [], [])
    const noteNode = nodes.find((node) => node.entityId === note.id)!
    const taskNode = nodes.find((node) => node.entityId === task.id)!
    const projectNode = nodes.find((node) => node.entityId === 'project-1')!

    expect(edges).toContainEqual({
      source: noteNode.id,
      target: projectNode.id,
      type: 'structural'
    })
    expect(edges).toContainEqual({ source: noteNode.id, target: taskNode.id, type: 'explicit' })
  })

  it('cria a ligação explícita entre uma nota e sua meta', () => {
    const goal = makeGoal({ id: 'goal-1', projectId: 'project-1' })
    const note = makeNote({ id: 'note-1', goalIds: [goal.id] })

    const { nodes, edges } = buildGraph([makeProject()], [], [note], [goal], [])
    const noteNode = nodes.find((node) => node.entityId === note.id)!
    const goalNode = nodes.find((node) => node.entityId === goal.id)!

    expect(edges).toContainEqual({
      source: noteNode.id,
      target: goalNode.id,
      type: 'explicit'
    })
  })

  it('não inventa ligações entre hábitos independentes', () => {
    const first = makeHabit({ id: 'habit-1', name: 'Ler' })
    const second = makeHabit({ id: 'habit-2', name: 'Exercitar' })

    const { nodes, edges } = buildGraph([], [], [], [], [first, second])

    expect(nodes.filter((node) => node.type === 'habit')).toHaveLength(2)
    expect(edges).toEqual([])
  })

  it('usa tons mais escuros para tasks e notas concluídas', () => {
    const activeTask = makeTask({ id: 'task-active' })
    const completedTask = makeTask({ id: 'task-done', completedAt: NOW })
    const activeNote = makeNote({ id: 'note-active' })
    const completedNote = makeNote({ id: 'note-done', completedAt: NOW })

    const { nodes } = buildGraph(
      [makeProject()],
      [activeTask, completedTask],
      [activeNote, completedNote],
      [],
      []
    )

    const activeTaskNode = nodes.find((node) => node.entityId === activeTask.id)!
    const completedTaskNode = nodes.find((node) => node.entityId === completedTask.id)!
    const activeNoteNode = nodes.find((node) => node.entityId === activeNote.id)!
    const completedNoteNode = nodes.find((node) => node.entityId === completedNote.id)!

    expect(activeTaskNode.color).toBe(GRAPH_NODE_COLORS.task)
    expect(completedTaskNode).toMatchObject({ color: '#3d5878', completed: true })
    expect(activeNoteNode.color).toBe(GRAPH_NODE_COLORS.note)
    expect(completedNoteNode).toMatchObject({ color: '#7f6732', completed: true })
  })

  it('inclui todos os arquivos e liga os associados ao projeto ativo', () => {
    const attachedFile = makeFile({ id: 'file-project', projectId: 'project-1' })
    const globalFile = makeFile({ id: 'file-global', name: 'manual.docx', ext: '.docx' })

    const { nodes, edges } = buildGraph([makeProject()], [], [], [], [], [attachedFile, globalFile])
    const project = nodes.find((node) => node.entityId === 'project-1')!
    const attachedNode = nodes.find((node) => node.entityId === attachedFile.id)!
    const globalNode = nodes.find((node) => node.entityId === globalFile.id)!

    expect(attachedNode).toMatchObject({
      type: 'file',
      label: attachedFile.name,
      projectId: 'project-1',
      color: GRAPH_NODE_COLORS.file
    })
    expect(globalNode).toMatchObject({ type: 'file', label: globalFile.name })
    expect(edges).toContainEqual({
      source: attachedNode.id,
      target: project.id,
      type: 'structural'
    })
    expect(
      edges.some((edge) => edge.source === globalNode.id || edge.target === globalNode.id)
    ).toBe(false)
  })
})
