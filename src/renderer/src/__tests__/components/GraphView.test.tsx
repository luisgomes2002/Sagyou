import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { GraphView } from '../../components/views/GraphView'

const graph = vi.hoisted(() => {
  const nodes = [
    {
      id: 'project:one',
      type: 'project',
      label: 'Projeto',
      color: '#a78bfa',
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
      color: '#60a5fa',
      radius: 8,
      entityId: 'one',
      projectId: 'one',
      connectionCount: 1,
      x: undefined as number | undefined,
      y: undefined as number | undefined
    }
  ]
  const edges = [{ source: 'project:one', target: 'task:one', type: 'structural' }]
  const listeners = new Map<string, () => void>()
  return { nodes, edges, listeners }
})

vi.mock('../../store/kanban', () => ({
  useKanbanStore: (selector: (state: Record<string, unknown[]>) => unknown) =>
    selector({ projects: [], tasks: [], notes: [], goals: [], habits: [], files: [] })
}))

vi.mock('../../utils/graph-layout', () => ({
  GRAPH_NODE_COLORS: {
    project: '#a78bfa',
    task: '#60a5fa',
    note: '#fbbf24',
    goal: '#f472b6',
    habit: '#4ade80',
    file: '#fb923c'
  },
  buildGraph: () => ({ nodes: graph.nodes, edges: graph.edges }),
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

describe('Grafo', () => {
  afterEach(() => {
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
    const project = container.querySelector('circle[fill="#a78bfa"]')!.parentElement!
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
})
