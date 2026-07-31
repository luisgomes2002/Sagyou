import { describe, expect, it } from 'vitest'
import { GRAPH_NODE_COLORS, buildGraph } from '../../utils/graph-layout'
import type { Project, StickyNote, Task } from '../../types'

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

describe('buildGraph', () => {
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
    expect(completedTaskNode).toMatchObject({ color: '#3b6f9f', completed: true })
    expect(activeNoteNode.color).toBe(GRAPH_NODE_COLORS.note)
    expect(completedNoteNode).toMatchObject({ color: '#a87916', completed: true })
  })
})
