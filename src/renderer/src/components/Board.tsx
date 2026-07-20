import { useState, useMemo } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  arrayMove
} from '@dnd-kit/sortable'
import type { Column as ColumnType, Task, Project } from '../types'
import { isDoneColumn } from '../utils/columns'
import { Column } from './Column'
import { TaskCard } from './TaskCard'
import { useKanbanStore } from '../store/kanban'

// Shared reference for columns with no tasks, so an empty column always gets the
// same array identity across renders instead of a fresh `[]`.
const EMPTY_TASKS: Task[] = []

interface Props {
  project: Project
  tasks: Task[]
  onAddTask: (columnId: string) => void
  onEditTask: (task: Task) => void
  onDeleteTask: (task: Task) => void
  onViewTask: (task: Task) => void
  onCompleteTask: (task: Task) => void
  onEditColumn: (column: ColumnType) => void
  onDeleteColumn: (column: ColumnType) => void
  onAddColumn: () => void
}

export function Board({
  project,
  tasks,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onViewTask,
  onCompleteTask,
  onEditColumn,
  onDeleteColumn,
  onAddColumn
}: Props) {
  const moveTask = useKanbanStore((s) => s.moveTask)
  const reorderColumns = useKanbanStore((s) => s.reorderColumns)

  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [activeColumn, setActiveColumn] = useState<ColumnType | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const visibleColumns = useMemo(
    () => [...project.columns].sort((a, b) => a.order - b.order).filter((c) => !isDoneColumn(c)),
    [project.columns]
  )

  const hiddenColumns = useMemo(
    () => project.columns.filter(isDoneColumn),
    [project.columns]
  )

  const columnTasksMap = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (t.projectId !== project.id) continue
      const arr = map.get(t.columnId) ?? []
      arr.push(t)
      map.set(t.columnId, arr)
    }
    map.forEach((arr) => arr.sort((a, b) => a.order - b.order))
    return map
  }, [tasks, project.id])

  const handleDragStart = (event: DragStartEvent) => {
    const type = event.active.data.current?.type
    if (type === 'column') {
      setActiveColumn(visibleColumns.find((c) => c.id === event.active.id) ?? null)
    } else {
      setActiveTask(tasks.find((t) => t.id === event.active.id) ?? null)
    }
  }

  // Nothing mutates during the drag — not the store, not local state. The
  // DragOverlay follows the cursor for feedback, and dnd-kit animates same-column
  // shifting via transforms. Reordering state inside onDragOver is what froze the
  // board: each move shifts the layout under the cursor, which fires another
  // onDragOver, which moves again — an oscillation loop at column borders. So the
  // move is computed once, on drop, from what sits under the cursor.
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)
    setActiveColumn(null)
    if (!over || active.id === over.id) return

    if (active.data.current?.type === 'column') {
      const oldIndex = visibleColumns.findIndex((c) => c.id === active.id)
      const newIndex = visibleColumns.findIndex((c) => c.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      const reordered = arrayMove(visibleColumns, oldIndex, newIndex)
      reorderColumns(project.id, [...reordered, ...hiddenColumns].map((c) => c.id))
      return
    }

    const draggedTask = tasks.find((t) => t.id === active.id)
    if (!draggedTask) return

    // Resolve the drop target: either a task (drop at its slot) or a column
    // droppable (append to its end).
    const overTask = tasks.find((t) => t.id === over.id)
    const overColumn = visibleColumns.find((c) => c.id === over.id)
    let targetColumnId: string
    let newIndex: number
    if (overTask) {
      targetColumnId = overTask.columnId
      const columnTasks = columnTasksMap.get(targetColumnId) ?? EMPTY_TASKS
      newIndex = columnTasks.findIndex((t) => t.id === over.id)
      if (newIndex < 0) newIndex = columnTasks.length
    } else if (overColumn) {
      targetColumnId = overColumn.id
      newIndex = (columnTasksMap.get(targetColumnId) ?? EMPTY_TASKS).length
    } else {
      return
    }

    // Skip a redundant write (and its updatedAt churn) when nothing actually moved.
    const origColumn = columnTasksMap.get(draggedTask.columnId) ?? EMPTY_TASKS
    const origIndex = origColumn.findIndex((t) => t.id === active.id)
    if (draggedTask.columnId === targetColumnId && origIndex === newIndex) return

    moveTask(draggedTask.id, targetColumnId, newIndex)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 p-6 overflow-x-auto h-full items-start">
        <SortableContext items={visibleColumns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          {visibleColumns.map((col) => (
            <Column
              key={col.id}
              column={col}
              tasks={columnTasksMap.get(col.id) ?? EMPTY_TASKS}
              project={project}
              onAddTask={onAddTask}
              onEditTask={onEditTask}
              onDeleteTask={onDeleteTask}
              onViewTask={onViewTask}
              onCompleteTask={onCompleteTask}
              onEditColumn={onEditColumn}
              onDeleteColumn={onDeleteColumn}
            />
          ))}
        </SortableContext>

        {/* add column button */}
        <button
          onClick={onAddColumn}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-[#2a2d42] text-sm text-[#8892a4] hover:border-[#6366f1]/50 hover:text-[#6366f1] transition-colors shrink-0 mt-0"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Coluna
        </button>
      </div>

      <DragOverlay>
        {activeTask && (
          <TaskCard task={activeTask} overlay onEdit={() => {}} onDelete={() => {}} onView={() => {}} />
        )}
        {activeColumn && (
          <div className="flex flex-col w-72 shrink-0 opacity-90 rotate-2">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#181b28] border border-[#6366f1]/50 shadow-2xl">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: activeColumn.color || project.color }} />
              <span className="text-sm font-medium text-[#e2e8f0]">{activeColumn.name}</span>
              <span className="text-xs text-[#8892a4] bg-[#2a2d42] px-1.5 py-0.5 rounded-full">
                {(columnTasksMap.get(activeColumn.id) ?? EMPTY_TASKS).length}
              </span>
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
