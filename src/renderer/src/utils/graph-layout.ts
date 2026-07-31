import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum
} from 'd3-force'
import type { Project, Task, StickyNote, Goal, Habit } from '../types'
import { isDoneColumn } from './columns'

export type GraphNodeType = 'project' | 'task' | 'note' | 'goal' | 'habit'

export interface GraphNode extends SimulationNodeDatum {
  id: string
  type: GraphNodeType
  label: string
  color: string
  radius: number
  entityId: string
  projectId?: string
  connectionCount: number
  completed?: boolean
}

export interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  type: 'explicit' | 'structural'
}

export type NavigateTarget =
  | { type: 'project'; id: string }
  | { type: 'task'; id: string; projectId: string }
  | { type: 'note'; id: string; projectId: string }
  | { type: 'goal' }
  | { type: 'habit' }

const NODE_COLOR: Record<GraphNodeType, string> = {
  project: '#a78bfa',
  task: '#60a5fa',
  note: '#fbbf24',
  goal: '#f472b6',
  habit: '#4ade80'
}

const COMPLETED_NODE_COLOR: Partial<Record<GraphNodeType, string>> = {
  task: '#3b6f9f',
  note: '#a87916'
}

export const GRAPH_NODE_COLORS = NODE_COLOR

function nodeColor(type: GraphNodeType, completed = false): string {
  return completed ? (COMPLETED_NODE_COLOR[type] ?? NODE_COLOR[type]) : NODE_COLOR[type]
}

// Explicit links carry the user's intent, while structural links only provide
// context. Keeping their forces distinct lets related ideas form clusters
// without collapsing every task around its project node.
const EXPLICIT_LINK_DISTANCE = 72
const STRUCTURAL_LINK_DISTANCE = 115
const EXPLICIT_LINK_STRENGTH = 0.5
const STRUCTURAL_LINK_STRENGTH = 0.3
const NODE_REPULSION = -120
const PROJECT_REPULSION = -1000
const REPULSION_DISTANCE_MAX = 260
const CENTER_STRENGTH = 0.08
const COLLISION_PADDING = 12

function computeRadius(baseRadius: number, connectionCount: number): number {
  return Math.min(30, baseRadius + Math.log2(connectionCount + 1) * 3)
}

export function buildGraph(
  projects: Project[],
  tasks: Task[],
  notes: StickyNote[],
  goals: Goal[],
  habits: Habit[]
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const activeProjects = projects.filter((p) => !p.archivedAt)
  const projectById = new Map(activeProjects.map((project) => [project.id, project]))

  const nodeRegistry = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  let nodeIdx = 0

  const addNode = (n: GraphNode): string => {
    const id = `n${nodeIdx++}`
    n.id = id
    nodeRegistry.set(id, n)
    return id
  }

  const projectNodeIds = new Map<string, string>()
  for (const p of activeProjects) {
    projectNodeIds.set(
      p.id,
      addNode({
        type: 'project',
        label: p.name,
        color: NODE_COLOR.project,
        radius: computeRadius(20, 0),
        entityId: p.id,
        connectionCount: 0
      } as GraphNode)
    )
  }

  const taskNodeIds = new Map<string, string>()
  for (const t of tasks) {
    if (!projectNodeIds.has(t.projectId)) continue
    const project = projectById.get(t.projectId)
    const completed =
      !!t.completedAt || isDoneColumn(project?.columns.find((column) => column.id === t.columnId))
    const id = addNode({
      type: 'task',
      label: t.title,
      color: nodeColor('task', completed),
      radius: computeRadius(8, 0),
      entityId: t.id,
      projectId: t.projectId,
      connectionCount: 0,
      completed
    } as GraphNode)
    taskNodeIds.set(t.id, id)
    edges.push({ source: id, target: projectNodeIds.get(t.projectId)!, type: 'structural' })
  }

  const noteNodeIds = new Map<string, string>()
  for (const n of notes) {
    if (!projectNodeIds.has(n.projectId)) continue
    const id = addNode({
      type: 'note',
      label: n.content.replace(/\n/g, ' ').slice(0, 40) || 'Nota',
      color: nodeColor('note', !!n.completedAt),
      radius: computeRadius(6, 0),
      entityId: n.id,
      projectId: n.projectId,
      connectionCount: 0,
      completed: !!n.completedAt
    } as GraphNode)
    noteNodeIds.set(n.id, id)

    // A note always belongs to its project. Task links add context; they must
    // not replace the project link or a note disappears from its own cluster.
    edges.push({ source: id, target: projectNodeIds.get(n.projectId)!, type: 'structural' })

    if (n.taskIds && n.taskIds.length > 0) {
      for (const tid of n.taskIds) {
        if (taskNodeIds.has(tid)) {
          edges.push({ source: id, target: taskNodeIds.get(tid)!, type: 'explicit' })
        }
      }
    }
  }

  for (const n of notes) {
    if (!n.connections || n.connections.length === 0) continue
    const sourceId = noteNodeIds.get(n.id)
    if (!sourceId) continue
    for (const targetNoteId of n.connections) {
      const targetId = noteNodeIds.get(targetNoteId)
      if (!targetId || targetId === sourceId) continue
      const exists = edges.some(
        (e) =>
          (e.source === sourceId && e.target === targetId) ||
          (e.source === targetId && e.target === sourceId)
      )
      if (!exists) {
        edges.push({ source: sourceId, target: targetId, type: 'explicit' })
      }
    }
  }

  for (const n of notes) {
    if (!n.goalIds || n.goalIds.length === 0) continue
    const sourceId = noteNodeIds.get(n.id)
    if (!sourceId) continue
    for (const goalId of n.goalIds) {
      const goalNodeId = Array.from(nodeRegistry.values()).find(
        (nd) => nd.type === 'goal' && nd.entityId === goalId
      )
      if (goalNodeId) {
        edges.push({ source: sourceId, target: goalNodeId.id, type: 'explicit' })
      }
    }
  }

  for (const g of goals) {
    const id = addNode({
      type: 'goal',
      label: g.title,
      color: NODE_COLOR.goal,
      radius: computeRadius(12, 0),
      entityId: g.id,
      projectId: g.projectId,
      connectionCount: 0
    } as GraphNode)

    if (g.projectId && projectNodeIds.has(g.projectId)) {
      edges.push({ source: id, target: projectNodeIds.get(g.projectId)!, type: 'structural' })
    } else {
      const firstProjectId = projectNodeIds.values().next().value
      if (firstProjectId) {
        edges.push({ source: id, target: firstProjectId, type: 'structural' })
      }
    }
  }

  const habitIds: string[] = []
  for (const h of habits) {
    habitIds.push(
      addNode({
        type: 'habit',
        label: h.name,
        color: NODE_COLOR.habit,
        radius: computeRadius(10, 0),
        entityId: h.id,
        connectionCount: 0
      } as GraphNode)
    )
  }
  for (let i = 1; i < habitIds.length; i++) {
    edges.push({ source: habitIds[i - 1], target: habitIds[i], type: 'structural' })
  }

  const counts = new Map<string, number>()
  for (const e of edges) {
    const src = e.source as string
    const tgt = e.target as string
    counts.set(src, (counts.get(src) ?? 0) + 1)
    counts.set(tgt, (counts.get(tgt) ?? 0) + 1)
  }

  const nodes = Array.from(nodeRegistry.values())
  const baseRadii: Record<GraphNodeType, number> = {
    project: 20,
    task: 8,
    note: 6,
    goal: 12,
    habit: 10
  }

  for (const n of nodes) {
    n.connectionCount = counts.get(n.id) ?? 0
    n.radius = computeRadius(baseRadii[n.type], n.connectionCount)
  }

  return { nodes, edges }
}

export function createLiveSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Simulation<GraphNode, GraphEdge> {
  return (
    forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        forceLink<GraphNode, GraphEdge>(edges)
          .id((d) => d.id)
          .distance((edge) =>
            edge.type === 'explicit' ? EXPLICIT_LINK_DISTANCE : STRUCTURAL_LINK_DISTANCE
          )
          .strength((edge) =>
            edge.type === 'explicit' ? EXPLICIT_LINK_STRENGTH : STRUCTURAL_LINK_STRENGTH
          )
      )
      // Repulsion is deliberately mild and short-range: projects may stay
      // close, while collisions still prevent any node overlap.
      .force(
        'charge',
        forceManyBody<GraphNode>()
          .strength((node) => (node.type === 'project' ? PROJECT_REPULSION : NODE_REPULSION))
          .distanceMax(REPULSION_DISTANCE_MAX)
      )
      .force('center', forceCenter().strength(CENTER_STRENGTH))
      .force(
        'collide',
        forceCollide<GraphNode>().radius((d) => d.radius + COLLISION_PADDING)
      )
      // A lower cooling rate leaves enough time for a displaced node to pass
      // its energy to connected nodes. GraphView reheats this simulation after
      // a drag, then lets it settle completely for a stable reading.
      .alphaDecay(0.02)
      .alphaMin(0.001)
      .velocityDecay(0.4)
  )
}
