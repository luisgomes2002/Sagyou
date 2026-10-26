import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GraphView } from '../../components/views/GraphView'

const graph = vi.hoisted(() => {
  const nodes = [
    {
      id: 'project:one',
      type: 'project',
      label: 'Projeto',
      color: '#7d6fc0',
      radius: 20,
      entityId: 'one',
      connectionCount: 1,
      x: undefined as number | undefined,
      y: undefined as number | undefined
    },
    {
      id: 'task:one',
      type: 'task',
      label: 'Tarefa',
      color: '#5b84b8',
      radius: 8,
      entityId: 'one',
      projectId: 'one',
      connectionCount: 1,
      x: undefined as number | undefined,
      y: undefined as number | undefined
    },
    {
      id: 'goal:one',
      type: 'goal',
      label: 'Meta',
      color: '#b86a8e',
      radius: 12,
      entityId: 'goal-one',
      connectionCount: 0,
      x: undefined as number | undefined,
      y: undefined as number | undefined
    },
    {
      id: 'habit:one',
      type: 'habit',
      label: 'Hábito',
      color: '#4f9a6c',
      radius: 10,
      entityId: 'habit-one',
      connectionCount: 0,
      x: undefined as number | undefined,
      y: undefined as number | undefined
    },
    {
      id: 'memory:one',
      type: 'memory',
      label: 'Lembrança',
      color: '#5a9ea0',
      radius: 7,
      entityId: 'mem-one',
      connectionCount: 1,
      x: undefined as number | undefined,
      y: undefined as number | undefined
    },
    {
      id: 'general:general',
      type: 'general',
      label: 'Geral',
      color: '#8a8a94',
      radius: 20,
      entityId: 'general',
      connectionCount: 1,
      x: undefined as number | undefined,
      y: undefined as number | undefined
    }
  ]
  const edges = [
    { source: 'project:one', target: 'task:one', type: 'structural' },
    { source: 'memory:one', target: 'task:one', type: 'tag' }
  ]
  const listeners = new Map<string, () => void>()
  const buildGraph = vi.fn<(...args: unknown[]) => { nodes: typeof nodes; edges: typeof edges }>(
    () => ({ nodes, edges })
  )
  return { nodes, edges, listeners, buildGraph }
})

vi.mock('../../store/kanban', () => ({
  useKanbanStore: (selector: (state: Record<string, unknown[]>) => unknown) =>
    selector({ projects: [], tasks: [], notes: [], goals: [], habits: [], files: [] })
}))

vi.mock('../../utils/graph-layout', () => ({
  GRAPH_NODE_COLORS: {
    project: '#7d6fc0',
    task: '#5b84b8',
    note: '#c09a4a',
    goal: '#b86a8e',
    habit: '#4f9a6c',
    file: '#b87a4a',
    memory: '#5a9ea0',
    general: '#8a8a94'
  },
  buildGraph: graph.buildGraph,
  createLiveSimulation: () => {
    const simulation = {
      tick: () => {
        for (const node of graph.nodes) {
          node.x = (node.x ?? 0) + 1
          node.y = (node.y ?? 0) + 1
        }
        return simulation
      },
      stop: () => simulation,
      alpha: () => simulation,
      alphaTarget: () => simulation,
      restart: () => simulation,
      force: () => simulation,
      nodes: () => graph.nodes,
      on: (event: string, listener: () => void) => {
        graph.listeners.set(event, listener)
        return simulation
      }
    }
    return simulation
  }
}))

function stubMemoryList(list: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { ai: { memory: { list } } }
}

describe('Grafo', () => {
  beforeEach(() => {
    stubMemoryList(vi.fn().mockResolvedValue([]))
  })

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
    graph.buildGraph.mockClear()
    graph.listeners.clear()
    graph.nodes.forEach((node) => {
      node.x = undefined
      node.y = undefined
    })
    vi.unstubAllGlobals()
  })

  it('move nós e arestas durante a simulação e desloca o canvas durante o pan', () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrameId
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    const flushFrame = (): void => {
      const pending = [...frames.values()]
      frames.clear()
      act(() => pending.forEach((callback) => callback(performance.now())))
    }

    const { container } = render(<GraphView onNavigate={vi.fn()} />)
    flushFrame()

    const svg = container.querySelector('svg.flex-1')!
    const project = container.querySelector('circle[fill="#7d6fc0"]')!.parentElement!
    const edge = container.querySelector('line[stroke="#555"]')!
    const initialTick = svg.getAttribute('data-sim-tick')
    const initialPosition = project.getAttribute('transform')
    const initialEdgeX = edge.getAttribute('x1')

    graph.nodes[0].x! += 25
    graph.nodes[0].y! += 10
    graph.listeners.get('tick')!()
    flushFrame()

    expect(project.getAttribute('transform')).not.toBe(initialPosition)
    expect(edge.getAttribute('x1')).not.toBe(initialEdgeX)
    expect(svg.getAttribute('data-sim-tick')).toBe(initialTick)

    const viewport = svg.querySelector('g[transform]')!
    fireEvent.mouseDown(svg, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.mouseMove(svg, { clientX: 60, clientY: 30 })
    expect(viewport.getAttribute('transform')).toBe('translate(50,20) scale(1)')
    fireEvent.mouseUp(svg)
    expect(viewport.getAttribute('transform')).toBe('translate(50,20) scale(1)')

    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
      deltaY: -100
    })
    act(() => {
      svg.dispatchEvent(wheel)
    })
    expect(wheel.defaultPrevented).toBe(true)
    expect(viewport.getAttribute('transform')).toContain('scale(1.1)')
  })

  it('envia o ID ao navegar para uma meta ou hábito', () => {
    const onNavigate = vi.fn()
    graph.nodes[2].x = 20
    graph.nodes[2].y = 20
    graph.nodes[3].x = 40
    graph.nodes[3].y = 40
    const { container } = render(<GraphView onNavigate={onNavigate} />)

    fireEvent.doubleClick(container.querySelector('circle[fill="#b86a8e"]')!)
    fireEvent.doubleClick(container.querySelector('circle[fill="#4f9a6c"]')!)

    expect(onNavigate).toHaveBeenNthCalledWith(1, { type: 'goal', id: 'goal-one' })
    expect(onNavigate).toHaveBeenNthCalledWith(2, { type: 'habit', id: 'habit-one' })
  })

  it('passa as memórias ativas ao buildGraph', async () => {
    const memory = { id: 'mem-one', title: 'Lembrança' }
    const list = vi.fn().mockResolvedValue([memory])
    stubMemoryList(list)
    render(<GraphView onNavigate={vi.fn()} />)

    await waitFor(() => expect(graph.buildGraph.mock.lastCall?.[6]).toEqual([memory]))
    expect(list).toHaveBeenCalledWith({ includeArchived: false })
  })

  it('mostra aviso quando as memórias não carregam', async () => {
    stubMemoryList(vi.fn().mockRejectedValue(new Error('bloqueado')))
    graph.nodes[0].x = 10
    graph.nodes[0].y = 10
    const { container } = render(<GraphView onNavigate={vi.fn()} />)

    expect(await screen.findByText('Não foi possível carregar as memórias.')).toBeTruthy()
    expect(container.querySelector('circle[fill="#7d6fc0"]')).not.toBeNull()
  })

  it('envia o ID ao navegar para uma memória e ignora o Geral', () => {
    const onNavigate = vi.fn()
    graph.nodes[4].x = 20
    graph.nodes[4].y = 20
    graph.nodes[5].x = 40
    graph.nodes[5].y = 40
    const { container } = render(<GraphView onNavigate={onNavigate} />)

    fireEvent.doubleClick(container.querySelector('circle[fill="#5a9ea0"]')!)
    fireEvent.doubleClick(container.querySelector('circle[fill="#8a8a94"]')!)

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith({ type: 'memory', id: 'mem-one' })
  })

  it('desenha arestas por tag na cor própria', () => {
    graph.nodes[1].x = 10
    graph.nodes[1].y = 10
    graph.nodes[4].x = 20
    graph.nodes[4].y = 20
    const { container } = render(<GraphView onNavigate={vi.fn()} />)
    const tagEdge = container.querySelector('line[stroke="#4a7a7c"]')

    expect(tagEdge).not.toBeNull()
    expect(tagEdge!.getAttribute('marker-end')).toBeNull()
  })

  it('lista Geral na barra lateral acima dos projetos e na legenda', () => {
    render(<GraphView onNavigate={vi.fn()} />)
    const sidebar = screen.getByText('Projetos').parentElement!
    const buttons = sidebar.querySelectorAll('button')

    expect(buttons[0].textContent).toContain('Geral')
    expect(buttons[1].textContent).toContain('Projeto')
    expect(screen.getByText('Memória')).toBeTruthy()
    expect(screen.getAllByText('Geral').length).toBeGreaterThanOrEqual(2)
  })
})
