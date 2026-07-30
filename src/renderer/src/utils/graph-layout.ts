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
  project: '#a0a0c0',
  task: '#888',
  note: '#6e6e6e',
  goal: '#a09090',
  habit: '#7a9b7a'
}

export const GRAPH_NODE_COLORS = NODE_COLOR

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

  const doneColumnIds = new Set<string>()
  for (const p of activeProjects) {
    const doneCol = p.columns.find((c) => c.name.toLowerCase() === 'done')
    if (doneCol) doneColumnIds.add(`${p.id}:${doneCol.id}`)
  }

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
    if (doneColumnIds.has(`${t.projectId}:${t.columnId}`)) continue
    const id = addNode({
      type: 'task',
      label: t.title,
      color: NODE_COLOR.task,
      radius: computeRadius(8, 0),
      entityId: t.id,
      projectId: t.projectId,
      connectionCount: 0
    } as GraphNode)
    taskNodeIds.set(t.id, id)
    edges.push({ source: id, target: projectNodeIds.get(t.projectId)!, type: 'structural' })
  }

  const noteNodeIds = new Map<string, string>()
  for (const n of notes) {
    if (!projectNodeIds.has(n.projectId)) continue
    if (n.completedAt) continue
    const id = addNode({
      type: 'note',
      label: n.content.replace(/\n/g, ' ').slice(0, 40) || 'Nota',
      color: NODE_COLOR.note,
      radius: computeRadius(6, 0),
      entityId: n.id,
      projectId: n.projectId,
      connectionCount: 0
    } as GraphNode)
    noteNodeIds.set(n.id, id)

    if (n.taskIds && n.taskIds.length > 0) {
      let hasTaskEdge = false
      for (const tid of n.taskIds) {
        if (taskNodeIds.has(tid)) {
          edges.push({ source: id, target: taskNodeIds.get(tid)!, type: 'explicit' })
          hasTaskEdge = true
        }
      }
      if (!hasTaskEdge) {
        edges.push({ source: id, target: projectNodeIds.get(n.projectId)!, type: 'structural' })
      }
    } else {
      edges.push({ source: id, target: projectNodeIds.get(n.projectId)!, type: 'structural' })
    }
  }

  for (const n of notes) {
    if (n.completedAt) continue
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
    if (n.completedAt) continue
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
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  return forceSimulation<GraphNode>(nodes)
    .force(
      'link',
      forceLink<GraphNode, GraphEdge>(edges)
        .id((d) => d.id)
        .distance((e) => {
          const tgtId = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id
          const tgt = nodeMap.get(tgtId)
          const count = tgt?.connectionCount ?? 0
          return e.type === 'explicit' ? 70 : 80 + Math.max(0, 100 - count * 3)
        })
        .strength((e) => {
          const srcId = typeof e.source === 'string' ? e.source : (e.source as GraphNode).id
          const tgtId = typeof e.target === 'string' ? e.target : (e.target as GraphNode).id
          const src = nodeMap.get(srcId)
          const tgt = nodeMap.get(tgtId)
          const maxCount = Math.max(src?.connectionCount ?? 0, tgt?.connectionCount ?? 0)
          return 0.15 + Math.min(maxCount * 0.04, 0.65)
        })
    )
    .force('charge', forceManyBody<GraphNode>().strength((d) => -(d.radius * 25 + 50)))
    .force('center', forceCenter().strength(0.25))
    .force(
      'collide',
      forceCollide<GraphNode>().radius((d) => d.radius + 6)
    )
    .alphaDecay(0.015)
    .alphaMin(0.001)
    .velocityDecay(0.4)
}
