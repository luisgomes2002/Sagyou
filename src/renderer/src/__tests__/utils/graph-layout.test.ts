import { describe, expect, it } from 'vitest'
import { GRAPH_NODE_COLORS, buildGraph } from '../../utils/graph-layout'
import type { AiMemory, Goal, Habit, Project, StickyNote, StoredFile, Task } from '../../types'

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

function makeMemory(overrides: Partial<AiMemory> & { id: string }): AiMemory {
  return {
    projectId: null,
    type: 'fato',
    title: 'Memória',
    body: 'Corpo',
    tags: [],
    pinned: false,
    source: 'usuario',
    sourceConversationId: null,
    createdAt: NOW,
    updatedAt: NOW,
    lastAccessedAt: NOW,
    accessCount: 0,
    archivedAt: null,
    ...overrides
  }
}

function graphWithMemories(memories: AiMemory[], projects: Project[] = []) {
  return buildGraph(projects, [], [], [], [], [], memories)
}

function tagEdgesOf(edges: { source: unknown; target: unknown; type: string }[], id: string) {
  return edges.filter((edge) => edge.type === 'tag' && (edge.source === id || edge.target === id))
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

  it('liga hábitos ao nó Geral sem ligá-los entre si', () => {
    const first = makeHabit({ id: 'habit-1', name: 'Ler' })
    const second = makeHabit({ id: 'habit-2', name: 'Exercitar' })

    const { nodes, edges } = buildGraph([], [], [], [], [first, second])
    const general = nodes.find((node) => node.type === 'general')!
    const habitIds = nodes.filter((node) => node.type === 'habit').map((node) => node.id)

    expect(habitIds).toHaveLength(2)
    expect(general).toMatchObject({ label: 'Geral', color: GRAPH_NODE_COLORS.general })
    expect(edges).toEqual(
      habitIds.map((id) => ({ source: id, target: general.id, type: 'structural' }))
    )
  })

  it('liga meta sem projeto ao Geral e não ao primeiro projeto', () => {
    const goal = makeGoal({ id: 'goal-loose' })
    const { nodes, edges } = buildGraph(
      [makeProject()],
      [makeTask({ id: 'task-1' })],
      [],
      [goal],
      []
    )
    const goalNode = nodes.find((node) => node.entityId === goal.id)!
    const general = nodes.find((node) => node.type === 'general')!
    const project = nodes.find((node) => node.type === 'project')!

    expect(edges).toContainEqual({ source: goalNode.id, target: general.id, type: 'structural' })
    expect(
      edges.some(
        (edge) =>
          (edge.source === goalNode.id && edge.target === project.id) ||
          (edge.source === project.id && edge.target === goalNode.id)
      )
    ).toBe(false)
  })

  it('liga meta e arquivo de projeto removido ao Geral', () => {
    const goal = makeGoal({ id: 'goal-orphan', projectId: 'missing' })
    const file = makeFile({ id: 'file-orphan', projectId: 'missing' })
    const { nodes, edges } = buildGraph([], [], [], [goal], [], [file])
    const general = nodes.find((node) => node.type === 'general')!

    for (const entityId of [goal.id, file.id]) {
      const node = nodes.find((item) => item.entityId === entityId)!
      expect(edges).toContainEqual({ source: node.id, target: general.id, type: 'structural' })
    }
  })

  it('não cria o nó Geral quando nada depende dele', () => {
    const { nodes } = buildGraph([makeProject()], [makeTask({ id: 'task-1' })], [], [], [])

    expect(nodes.some((node) => node.type === 'general')).toBe(false)
  })

  it('liga projeto sem itens ao Geral', () => {
    const { nodes, edges } = buildGraph([makeProject()], [], [], [], [])
    const project = nodes.find((node) => node.type === 'project')!
    const general = nodes.find((node) => node.type === 'general')!

    expect(edges).toEqual([{ source: project.id, target: general.id, type: 'structural' }])
  })

  it('não deixa nenhum nó sem ligação', () => {
    const { nodes } = buildGraph(
      [makeProject()],
      [makeTask({ id: 'task-1' })],
      [makeNote({ id: 'note-1' })],
      [makeGoal({ id: 'goal-project', projectId: 'project-1' }), makeGoal({ id: 'goal-loose' })],
      [makeHabit({ id: 'habit-1' })],
      [makeFile({ id: 'file-project', projectId: 'project-1' }), makeFile({ id: 'file-loose' })]
    )

    expect(nodes.filter((node) => node.connectionCount < 1)).toEqual([])
  })

  it('usa ids estáveis por entidade', () => {
    const project = makeProject()
    const task = makeTask({ id: 't1' })
    const first = buildGraph([project], [task], [], [], [makeHabit({ id: 'h1' })])
    const second = buildGraph(
      [project],
      [task],
      [],
      [],
      [makeHabit({ id: 'h0' }), makeHabit({ id: 'h1' })]
    )

    expect(first.nodes.find((node) => node.entityId === 't1')!.id).toBe('task:t1')
    expect(first.nodes.find((node) => node.type === 'general')!.id).toBe('general:general')
    const secondIds = new Set(second.nodes.map((node) => node.id))
    for (const node of first.nodes) expect(secondIds.has(node.id)).toBe(true)
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

  it('liga arquivos ao seu projeto e os sem projeto ao Geral', () => {
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
    const general = nodes.find((node) => node.type === 'general')!
    expect(edges).toContainEqual({ source: globalNode.id, target: general.id, type: 'structural' })
  })

  describe('memórias', () => {
    it('liga memória de projeto ao projeto e memória global ao Geral', () => {
      const scoped = makeMemory({ id: 'mem-project', projectId: 'project-1', title: 'Decisão' })
      const global = makeMemory({ id: 'mem-global' })
      const { nodes, edges } = graphWithMemories([scoped, global], [makeProject()])

      expect(nodes.find((node) => node.id === 'memory:mem-project')).toMatchObject({
        type: 'memory',
        label: 'Decisão',
        entityId: 'mem-project',
        projectId: 'project-1',
        color: GRAPH_NODE_COLORS.memory
      })
      expect(edges).toContainEqual({
        source: 'memory:mem-project',
        target: 'project:project-1',
        type: 'structural'
      })
      expect(edges).toContainEqual({
        source: 'memory:mem-global',
        target: 'general:general',
        type: 'structural'
      })
    })

    it('liga memória de projeto removido ao Geral', () => {
      const { edges } = graphWithMemories([makeMemory({ id: 'mem', projectId: 'missing' })])

      expect(edges).toContainEqual({
        source: 'memory:mem',
        target: 'general:general',
        type: 'structural'
      })
    })

    it('ignora memórias arquivadas', () => {
      const { nodes } = graphWithMemories([makeMemory({ id: 'mem', archivedAt: NOW })])

      expect(nodes).toEqual([])
    })

    it('liga memórias com tag em comum, ignorando caixa e espaços', () => {
      const { edges } = graphWithMemories([
        makeMemory({ id: 'a', tags: ['Electron'] }),
        makeMemory({ id: 'b', tags: [' electron '] }),
        makeMemory({ id: 'c', tags: ['  ', 'outra'] })
      ])

      expect(edges.filter((edge) => edge.type === 'tag')).toEqual([
        { source: 'memory:a', target: 'memory:b', type: 'tag' }
      ])
    })

    it('não liga handoffs por tag', () => {
      const { edges } = graphWithMemories(
        [
          makeMemory({ id: 'handoff', type: 'handoff', projectId: 'project-1', tags: ['x'] }),
          makeMemory({ id: 'other', tags: ['x'] })
        ],
        [makeProject()]
      )

      expect(tagEdgesOf(edges, 'memory:handoff')).toEqual([])
      expect(edges).toContainEqual({
        source: 'memory:handoff',
        target: 'project:project-1',
        type: 'structural'
      })
    })

    it('limita a 3 ligações por tag por memória', () => {
      const memories = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id) =>
        makeMemory({ id, tags: ['x'] })
      )
      const { edges } = graphWithMemories(memories)
      const tagEdges = edges.filter((edge) => edge.type === 'tag')
      const pairs = tagEdges.map((edge) => [edge.source, edge.target].sort().join('|'))

      expect(tagEdges.length).toBeGreaterThan(0)
      for (const memory of memories) {
        expect(tagEdgesOf(edges, `memory:${memory.id}`).length).toBeLessThanOrEqual(3)
      }
      expect(new Set(pairs).size).toBe(pairs.length)
      expect(tagEdges.some((edge) => edge.source === edge.target)).toBe(false)
    })

    it('prefere as memórias com mais tags em comum', () => {
      const { edges } = graphWithMemories([
        makeMemory({ id: 'c', tags: ['x'], updatedAt: '2026-01-01T00:00:00.000Z' }),
        makeMemory({ id: 'd', tags: ['x'], updatedAt: '2026-01-01T00:00:00.000Z' }),
        makeMemory({ id: 'e', tags: ['x'], updatedAt: '2026-01-01T00:00:00.000Z' }),
        makeMemory({ id: 'a', tags: ['x', 'y'] }),
        makeMemory({ id: 'b', tags: ['y', 'x'] })
      ])

      expect(
        edges.some(
          (edge) =>
            edge.type === 'tag' &&
            [edge.source, edge.target].sort().join('|') === 'memory:a|memory:b'
        )
      ).toBe(true)
    })
  })
})
