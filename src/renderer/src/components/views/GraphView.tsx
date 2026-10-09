import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useKanbanStore } from '../../store/kanban'
import {
  buildGraph,
  createLiveSimulation,
  GRAPH_NODE_COLORS,
  type GraphNode,
  type GraphEdge,
  type NavigateTarget
} from '../../utils/graph-layout'
import type { Simulation } from 'd3-force'

interface Props {
  onNavigate: (target: NavigateTarget) => void
}

type ResolvedEdge = { source: GraphNode; target: GraphNode; type: 'explicit' | 'structural' }
type ViewportTransform = { x: number; y: number; scale: number }

const INITIAL_LAYOUT_TICKS = 100
const INITIAL_LAYOUT_FRAME_BUDGET_MS = 8
const INITIAL_LAYOUT_ALPHA = 0.6
const DRAG_ALPHA = 0.3
// Let the graph settle fully after an interaction so it remains readable when
// zoomed in. Dragging reheats the simulation through DRAG_ALPHA.
const IDLE_ALPHA_TARGET = 0

export function GraphView({ onNavigate }: Props) {
  const projects = useKanbanStore((s) => s.projects)
  const tasks = useKanbanStore((s) => s.tasks)
  const notes = useKanbanStore((s) => s.notes)
  const goals = useKanbanStore((s) => s.goals)
  const habits = useKanbanStore((s) => s.habits)
  const files = useKanbanStore((s) => s.files)

  const { nodes, edges } = useMemo(
    () => buildGraph(projects, tasks, notes, goals, habits, files),
    [projects, tasks, notes, goals, habits, files]
  )

  const nodeMap = useMemo(() => {
    const m = new Map<string, GraphNode>()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])
  const nodeElementsRef = useRef<Map<string, SVGGElement>>(new Map())
  const edgeElementsRef = useRef<Map<number, SVGLineElement>>(new Map())

  const paintPositions = useCallback((): void => {
    for (const node of nodes) {
      const element = nodeElementsRef.current.get(node.id)
      if (element && node.x != null && node.y != null) {
        element.setAttribute('transform', `translate(${node.x},${node.y})`)
      }
    }
    for (let i = 0; i < edges.length; i++) {
      const element = edgeElementsRef.current.get(i)
      if (!element) continue
      const edge = edges[i]
      const source =
        typeof edge.source === 'object' ? edge.source : nodeMap.get(String(edge.source))
      const target =
        typeof edge.target === 'object' ? edge.target : nodeMap.get(String(edge.target))
      if (source?.x == null || source.y == null || target?.x == null || target.y == null) continue
      element.setAttribute('x1', String(source.x))
      element.setAttribute('y1', String(source.y))
      element.setAttribute('x2', String(target.x))
      element.setAttribute('y2', String(target.y))
    }
  }, [nodes, edges, nodeMap])

  const [simTick, setSimTick] = useState(0)

  // d3 resolves link endpoints after the simulation starts; the initial commit refreshes them.
  const resolvedEdges = useMemo((): ResolvedEdge[] => {
    return edges
      .map((e) => {
        const src =
          typeof e.source === 'object' ? (e.source as GraphNode) : nodeMap.get(e.source as string)
        const tgt =
          typeof e.target === 'object' ? (e.target as GraphNode) : nodeMap.get(e.target as string)
        if (!src || !tgt) return null
        return { source: src, target: tgt, type: e.type }
      })
      .filter((e): e is ResolvedEdge => e !== null)
  }, [edges, nodeMap, simTick])

  const svgRef = useRef<SVGSVGElement>(null)
  const viewportRef = useRef<SVGGElement>(null)
  const transformRef = useRef<ViewportTransform>({ x: 0, y: 0, scale: 1 })
  const [labelScale, setLabelScale] = useState(1)
  const wheelCommitTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (wheelCommitTimerRef.current !== null) clearTimeout(wheelCommitTimerRef.current)
    }
  }, [])

  const applyViewportTransform = useCallback((next: ViewportTransform): void => {
    transformRef.current = next
    viewportRef.current?.setAttribute(
      'transform',
      `translate(${next.x},${next.y}) scale(${next.scale})`
    )
  }, [])
  const syncLabelScale = useCallback((scale: number): void => {
    setLabelScale((current) => {
      if (
        current > 0.3 === scale > 0.3 &&
        current > 0.6 === scale > 0.6 &&
        current > 0.8 === scale > 0.8
      ) {
        return current
      }
      return scale
    })
  }, [])

  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [highlightedNode, setHighlightedNode] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const initialFitRef = useRef(true)

  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0 })

  const simRef = useRef<Simulation<GraphNode, GraphEdge> | null>(null)
  const dragNodeId = useRef<string | null>(null)

  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const initialLayoutCompleteRef = useRef(false)

  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null)

  // ── Live simulation ──────────────────────────────────────────────────────
  useEffect(() => {
    if (nodes.length === 0) return

    // Reuse positions for existing nodes after store updates, avoiding a full
    // rearrangement when a task or note changes.
    for (const node of nodes) {
      const previous = positionsRef.current.get(node.id)
      if (previous) {
        node.x = previous.x
        node.y = previous.y
        node.vx = 0
        node.vy = 0
      }
    }

    const sim = createLiveSimulation(nodes, edges).stop()
    simRef.current = sim
    initialLayoutCompleteRef.current = false

    const savePositions = () => {
      positionsRef.current = new Map(
        nodes
          .filter((node) => node.x != null && node.y != null)
          .map((node) => [node.id, { x: node.x!, y: node.y! }])
      )
    }
    let pendingFrame: number | null = null
    let simulationTicks = 0
    let visualFrames = 0
    let settled = false
    let initialLayoutMs = 0
    let remainingLayoutTicks = INITIAL_LAYOUT_TICKS
    let initialLayoutFrame: number | null = null
    let hasRenderedInitialLayout = false
    const renderFrame = (): void => {
      if (pendingFrame !== null) return
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null
        visualFrames += 1
        paintPositions()
        if (settled && import.meta.env.DEV) {
          console.debug('[GraphView] simulation settled', {
            nodes: nodes.length,
            edges: edges.length,
            initialLayoutMs: +initialLayoutMs.toFixed(1),
            simulationTicks,
            visualFrames
          })
        }
      })
    }
    // Keep each layout chunk within one frame's budget. Running all 100 ticks
    // in this effect blocks the click that opens a large graph.
    const runInitialLayout = (): void => {
      initialLayoutFrame = null
      const startedAt = performance.now()
      do {
        sim.tick(1)
        remainingLayoutTicks -= 1
      } while (
        remainingLayoutTicks > 0 &&
        performance.now() - startedAt < INITIAL_LAYOUT_FRAME_BUDGET_MS
      )
      initialLayoutMs += performance.now() - startedAt
      if (!hasRenderedInitialLayout) {
        hasRenderedInitialLayout = true
        setSimTick((tick) => tick + 1)
      } else {
        paintPositions()
      }
      if (remainingLayoutTicks > 0) {
        initialLayoutFrame = requestAnimationFrame(runInitialLayout)
      } else {
        initialLayoutCompleteRef.current = true
        setSimTick((tick) => tick + 1)
        // Calling tick from the tick event re-enters d3 and accelerates forever.
        sim.alpha(INITIAL_LAYOUT_ALPHA).alphaTarget(IDLE_ALPHA_TARGET).restart()
      }
    }
    initialLayoutFrame = requestAnimationFrame(runInitialLayout)

    sim.on('tick', () => {
      simulationTicks += 1
      settled = false
      renderFrame()
    })
    // Centering is only useful during initial layout. Leaving it on after a
    // drag shifts every node to compensate for one local movement.
    sim.on('end', () => {
      sim.force('center', null)
      savePositions()
      settled = true
      renderFrame()
    })

    return () => {
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
      if (initialLayoutFrame !== null) cancelAnimationFrame(initialLayoutFrame)
      savePositions()
      sim.stop()
      simRef.current = null
    }
  }, [nodes, edges, paintPositions])

  // ── Initial fit ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!initialFitRef.current || nodes.length === 0 || !initialLayoutCompleteRef.current) return
    // Wait a few ticks for initial spread
    const timer = setTimeout(() => {
      const svg = svgRef.current
      if (!svg) return
      const w = svg.clientWidth
      const h = svg.clientHeight
      const xs: number[] = []
      const ys: number[] = []
      for (const n of nodes) {
        if (n.x != null && n.y != null) {
          xs.push(n.x)
          ys.push(n.y)
        }
      }
      if (xs.length === 0) return
      const minX = Math.min(...xs) - 60
      const maxX = Math.max(...xs) + 60
      const minY = Math.min(...ys) - 60
      const maxY = Math.max(...ys) + 60
      const graphW = maxX - minX || 1
      const graphH = maxY - minY || 1
      const scale = Math.min(w / graphW, h / graphH, 2)
      applyViewportTransform({
        x: (w - graphW * scale) / 2 - minX * scale,
        y: (h - graphH * scale) / 2 - minY * scale,
        scale
      })
      syncLabelScale(scale)
      initialFitRef.current = false
    }, 300)
    return () => clearTimeout(timer)
  }, [nodes, simTick, applyViewportTransform, syncLabelScale])

  // ── Coordinate helpers ───────────────────────────────────────────────────
  const toGraphCoords = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current!
    const rect = svg.getBoundingClientRect()
    const t = transformRef.current
    return {
      x: (clientX - rect.left - t.x) / t.scale,
      y: (clientY - rect.top - t.y) / t.scale
    }
  }, [])

  // ── Zoom / Pan ───────────────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handleWheel = (e: WheelEvent): void => {
      e.preventDefault()
      initialFitRef.current = false
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const t = transformRef.current
      const newScale = Math.max(0.1, Math.min(3, t.scale * delta))
      const rect = svg.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      applyViewportTransform({
        x: mx - (mx - t.x) * (newScale / t.scale),
        y: my - (my - t.y) * (newScale / t.scale),
        scale: newScale
      })
      if (wheelCommitTimerRef.current !== null) clearTimeout(wheelCommitTimerRef.current)
      wheelCommitTimerRef.current = window.setTimeout(() => {
        wheelCommitTimerRef.current = null
        syncLabelScale(transformRef.current.scale)
      }, 120)
    }
    svg.addEventListener('wheel', handleWheel, { passive: false })
    return () => svg.removeEventListener('wheel', handleWheel)
  }, [nodes.length, applyViewportTransform, syncLabelScale])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    isPanning.current = true
    initialFitRef.current = false
    if (wheelCommitTimerRef.current !== null) {
      clearTimeout(wheelCommitTimerRef.current)
      wheelCommitTimerRef.current = null
    }
    const current = transformRef.current
    panStart.current = { x: e.clientX - current.x, y: e.clientY - current.y }
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragNodeId.current) {
        const pos = toGraphCoords(e.clientX, e.clientY)
        const node = nodeMap.get(dragNodeId.current)
        if (node) {
          node.x = pos.x
          node.y = pos.y
          node.fx = pos.x
          node.fy = pos.y
          node.vx = 0
          node.vy = 0
        }
        paintPositions()
        return
      }
      if (!isPanning.current) return
      applyViewportTransform({
        ...transformRef.current,
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y
      })
    },
    [toGraphCoords, nodeMap, paintPositions, applyViewportTransform]
  )

  const handleMouseUp = useCallback(() => {
    isPanning.current = false
    if (dragNodeId.current) {
      const node = nodeMap.get(dragNodeId.current)
      if (node) {
        node.fx = null
        node.fy = null
      }
      dragNodeId.current = null
      const sim = simRef.current
      if (sim) {
        positionsRef.current = new Map(
          sim
            .nodes()
            .filter((currentNode) => currentNode.x != null && currentNode.y != null)
            .map((currentNode) => [currentNode.id, { x: currentNode.x!, y: currentNode.y! }])
        )
        // The energy decays smoothly to zero, so connected nodes settle without
        // an abrupt freeze.
        sim.alpha(DRAG_ALPHA).alphaTarget(IDLE_ALPHA_TARGET).restart()
      }
    }
  }, [nodeMap])

  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation()
      e.preventDefault()
      const node = nodeMap.get(nodeId)
      if (!node) return
      const pos = toGraphCoords(e.clientX, e.clientY)
      node.fx = pos.x
      node.fy = pos.y
      dragNodeId.current = nodeId
      simRef.current?.alpha(DRAG_ALPHA).alphaTarget(IDLE_ALPHA_TARGET).restart()
    },
    [toGraphCoords, nodeMap]
  )

  // ── Position getter ──────────────────────────────────────────────────────
  const getNodePos = useCallback(
    (nodeId: string): { x: number; y: number } | null => {
      const n = nodeMap.get(nodeId)
      if (!n || n.x == null || n.y == null) return null
      return { x: n.x, y: n.y }
    },
    [nodeMap]
  )

  // ── Highlight / search ───────────────────────────────────────────────────
  const handleNodeClick = useCallback((nodeId: string) => {
    setHighlightedNode((prev) => (prev === nodeId ? null : nodeId))
  }, [])

  const handleNodeDoubleClick = useCallback(
    (node: GraphNode) => {
      switch (node.type) {
        case 'project':
          onNavigate({ type: 'project', id: node.entityId })
          break
        case 'task':
          onNavigate({ type: 'task', id: node.entityId, projectId: node.projectId! })
          break
        case 'note':
          onNavigate({ type: 'note', id: node.entityId, projectId: node.projectId! })
          break
        case 'goal':
          onNavigate({ type: 'goal' })
          break
        case 'habit':
          onNavigate({ type: 'habit' })
          break
        case 'file':
          onNavigate({ type: 'file', projectId: node.projectId })
          break
      }
    },
    [onNavigate]
  )

  const neighborIds = useMemo(() => {
    if (!highlightedNode) return new Set<string>()
    const s = new Set<string>()
    s.add(highlightedNode)
    for (const e of resolvedEdges) {
      if (e.source.id === highlightedNode) s.add(e.target.id)
      if (e.target.id === highlightedNode) s.add(e.source.id)
    }
    return s
  }, [highlightedNode, resolvedEdges])

  const searchLower = search.toLowerCase().trim()
  const matchingNodeIds = useMemo(() => {
    if (!searchLower) return new Set<string>()
    const s = new Set<string>()
    for (const n of nodes) {
      if (n.label.toLowerCase().includes(searchLower)) s.add(n.id)
    }
    return s
  }, [nodes, searchLower])

  const activeHighlight: 'search' | 'click' | null = searchLower
    ? 'search'
    : highlightedNode
      ? 'click'
      : null

  const getNodeOpacity = useCallback(
    (nodeId: string) => {
      if (!activeHighlight) return 1
      if (activeHighlight === 'search') return matchingNodeIds.has(nodeId) ? 1 : 0.15
      return neighborIds.has(nodeId) ? 1 : 0.15
    },
    [activeHighlight, neighborIds, matchingNodeIds]
  )

  const getEdgeOpacity = useCallback(
    (srcId: string, tgtId: string) => {
      if (!activeHighlight) return 0.7
      if (activeHighlight === 'search')
        return matchingNodeIds.has(srcId) || matchingNodeIds.has(tgtId) ? 0.9 : 0.12
      return neighborIds.has(srcId) || neighborIds.has(tgtId) ? 0.9 : 0.12
    },
    [activeHighlight, neighborIds, matchingNodeIds]
  )

  const showLabel = useCallback(
    (node: GraphNode, nodeId: string) => {
      if (node.type === 'project' || node.type === 'goal') return true
      if (hoveredNode === nodeId) return true
      if (activeHighlight && getNodeOpacity(nodeId) === 1 && labelScale > 0.6) return true
      if (node.type === 'habit' && labelScale > 0.8) return true
      return false
    },
    [hoveredNode, activeHighlight, getNodeOpacity, labelScale]
  )

  const projectNodes = useMemo(
    () => nodes.filter((n) => n.type === 'project').sort((a, b) => a.label.localeCompare(b.label)),
    [nodes]
  )

  const focusProject = useCallback(
    (nodeId: string) => {
      const pos = getNodePos(nodeId)
      if (!pos || !svgRef.current) return
      const w = svgRef.current.clientWidth - 170
      const h = svgRef.current.clientHeight
      initialFitRef.current = false
      applyViewportTransform({
        x: w / 2 - pos.x * 1.6,
        y: h / 2 - pos.y * 1.6,
        scale: 1.6
      })
      syncLabelScale(1.6)
    },
    [getNodePos, applyViewportTransform, syncLabelScale]
  )

  // ── Render ───────────────────────────────────────────────────────────────
  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 bg-[#0b0b0f]">
        <div className="w-16 h-16 rounded-2xl bg-[#16161a] border border-[#2b2b31] flex items-center justify-center">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#999999"
            strokeWidth="1.5"
          >
            <circle cx="12" cy="12" r="3" />
            <circle cx="4" cy="7" r="2" />
            <circle cx="20" cy="7" r="2" />
            <circle cx="4" cy="17" r="2" />
            <circle cx="20" cy="17" r="2" />
            <line x1="7" y1="7" x2="9" y2="12" />
            <line x1="17" y1="7" x2="15" y2="12" />
            <line x1="7" y1="17" x2="9" y2="12" />
            <line x1="17" y1="17" x2="15" y2="12" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-[#d4d4d4] font-medium mb-1">Nenhum dado para exibir</p>
          <p className="text-sm text-[#999999]">Crie projetos, tasks, notas ou adicione arquivos</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0b0b0f] relative">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#2b2b31] shrink-0">
        <div className="relative flex-1 max-w-xs">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#666666"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nó..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-[#16161a] border border-[#2b2b31] text-[#d4d4d4] placeholder-[#666] focus:outline-none focus:border-[#7c3aed]"
          />
        </div>
        <div className="flex items-center gap-3 text-[10px] text-[#666] ml-auto">
          <span className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: GRAPH_NODE_COLORS.project }}
            />{' '}
            Projeto
          </span>
          <span className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: GRAPH_NODE_COLORS.habit }}
            />{' '}
            Hábito
          </span>
          <span className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: GRAPH_NODE_COLORS.task }}
            />{' '}
            Task
          </span>
          <span className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: GRAPH_NODE_COLORS.note }}
            />{' '}
            Nota
          </span>
          <span className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: GRAPH_NODE_COLORS.goal }}
            />{' '}
            Meta
          </span>
          <span className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: GRAPH_NODE_COLORS.file }}
            />{' '}
            Arquivo
          </span>
          <span className="text-[#555]">|</span>
          <span>Tom mais escuro = concluído</span>
          <span className="text-[#555]">|</span>
          <span>Scroll zoom · Arrastar nó · Pan fundo · Clique destaca · Duplo-clique navega</span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <svg
          ref={svgRef}
          className="flex-1 cursor-grab active:cursor-grabbing"
          data-sim-tick={simTick || undefined}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <defs>
            <marker
              id="graph-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#7c3aed" opacity="0.7" />
            </marker>
          </defs>
          <g ref={viewportRef} transform="translate(0,0) scale(1)">
            {edges.map((e, i) => {
              const src =
                typeof e.source === 'string' ? nodeMap.get(e.source) : (e.source as GraphNode)
              const tgt =
                typeof e.target === 'string' ? nodeMap.get(e.target) : (e.target as GraphNode)
              if (!src || !tgt) return null

              const srcPos = getNodePos(src.id)
              const tgtPos = getNodePos(tgt.id)
              if (!srcPos || !tgtPos) return null

              return (
                <line
                  key={i}
                  ref={(element) => {
                    if (element) edgeElementsRef.current.set(i, element)
                    else edgeElementsRef.current.delete(i)
                  }}
                  x1={srcPos.x}
                  y1={srcPos.y}
                  x2={tgtPos.x}
                  y2={tgtPos.y}
                  stroke={e.type === 'explicit' ? '#7c3aed' : '#555'}
                  strokeWidth={e.type === 'explicit' ? 1.5 : 0.8}
                  opacity={getEdgeOpacity(src.id, tgt.id)}
                  strokeDasharray={e.type === 'structural' ? '4 3' : undefined}
                  markerEnd={e.type === 'explicit' ? 'url(#graph-arrow)' : undefined}
                />
              )
            })}
            {nodes.map((n) => {
              const pos = getNodePos(n.id)
              if (!pos) return null
              const opacity = getNodeOpacity(n.id)
              const labelVisible = showLabel(n, n.id)
              const isActive =
                (hoveredNode === n.id || (activeHighlight && opacity === 1)) && labelScale > 0.3

              return (
                <g
                  key={n.id}
                  ref={(element) => {
                    if (element) nodeElementsRef.current.set(n.id, element)
                    else nodeElementsRef.current.delete(n.id)
                  }}
                  transform={`translate(${pos.x},${pos.y})`}
                >
                  {isActive && (
                    <circle
                      cx={0}
                      cy={0}
                      r={n.radius + 4}
                      fill="none"
                      stroke={n.color}
                      strokeWidth="1.5"
                      opacity="0.35"
                    />
                  )}
                  <circle
                    cx={0}
                    cy={0}
                    r={n.radius}
                    fill={n.color}
                    opacity={opacity}
                    className="cursor-grab active:cursor-grabbing"
                    onMouseDown={(e) => handleNodeMouseDown(e, n.id)}
                    onClick={() => handleNodeClick(n.id)}
                    onDoubleClick={() => handleNodeDoubleClick(n)}
                    onMouseEnter={(e) => {
                      if (isPanning.current) return
                      setHoveredNode(n.id)
                      setTooltip({ x: e.clientX, y: e.clientY, node: n })
                    }}
                    onMouseLeave={() => {
                      if (isPanning.current) return
                      setHoveredNode(null)
                      setTooltip(null)
                    }}
                  />
                  {labelVisible && (
                    <text
                      x={0}
                      y={n.radius + 11}
                      textAnchor="middle"
                      className="fill-[#999] text-[9px] select-none"
                      style={{ pointerEvents: 'none' }}
                    >
                      {n.label.length > 25 ? n.label.slice(0, 25) + '…' : n.label}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>

        {/* Project sidebar */}
        <div className="w-40 shrink-0 border-l border-[#2b2b31] bg-[#0b0b0f] flex flex-col overflow-hidden">
          <div className="px-3 py-2 border-b border-[#2b2b31] text-[10px] font-semibold uppercase tracking-wider text-[#555]">
            Projetos
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {projectNodes.length === 0 ? (
              <p className="px-3 py-2 text-[10px] text-[#555] italic">Nenhum projeto</p>
            ) : (
              projectNodes.map((p) => {
                const pos = getNodePos(p.id)
                const isHere = pos != null
                return (
                  <button
                    key={p.id}
                    onClick={() => focusProject(p.id)}
                    className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors flex items-center gap-2 ${
                      hoveredNode === p.id
                        ? 'text-white bg-[#2a2a30]'
                        : 'text-[#888] hover:text-[#ccc] hover:bg-[#222227]'
                    }`}
                    onMouseEnter={() => setHoveredNode(p.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: GRAPH_NODE_COLORS.project }}
                    />
                    <span className="truncate flex-1">{p.label}</span>
                    {isHere && <span className="text-[9px] text-[#555]">{p.connectionCount}</span>}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>

      {tooltip && (
        <div
          className="fixed z-50 px-2.5 py-1.5 rounded-md bg-[#16161a] border border-[#2b2b31] text-xs text-[#d4d4d4] shadow-lg pointer-events-none max-w-[260px]"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: tooltip.node.color }}
            />
            <span className="text-[10px] text-[#666] uppercase">
              {tooltip.node.type === 'project'
                ? 'Projeto'
                : tooltip.node.type === 'task'
                  ? 'Task'
                  : tooltip.node.type === 'note'
                    ? 'Nota'
                    : tooltip.node.type === 'goal'
                      ? 'Meta'
                      : tooltip.node.type === 'habit'
                        ? 'Hábito'
                        : 'Arquivo'}
            </span>
          </div>
          <span>{tooltip.node.label}</span>
        </div>
      )}

      <div className="absolute bottom-3 right-3 text-[10px] text-[#555] pointer-events-none select-none">
        {nodes.length} nós · {resolvedEdges.length} conexões
      </div>
    </div>
  )
}
