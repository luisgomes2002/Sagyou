import { useState } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
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
import { Column } from './Column'
import { TaskCard } from './TaskCard'
import { useKanbanStore } from '../store/kanban'

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

  const visibleColumns = [...project.columns]
    .sort((a, b) => a.order - b.order)
    .filter((c) => c.name.toLowerCase() !== 'done')

  const hiddenColumns = project.columns.filter((c) => c.name.toLowerCase() === 'done')

  const handleDragStart = (event: DragStartEvent) => {
    const type = event.active.data.current?.type
    if (type === 'column') {
      setActiveColumn(visibleColumns.find((c) => c.id === event.active.id) ?? null)
    } else {
      setActiveTask(tasks.find((t) => t.id === event.active.id) ?? null)
    }
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    if (active.data.current?.type === 'column') return

    const draggedTask = tasks.find((t) => t.id === active.id)
    if (!draggedTask) return

    const overTask = tasks.find((t) => t.id === over.id)
    if (overTask && overTask.columnId !== draggedTask.columnId) {
      const columnTasks = tasks
        .filter((t) => t.columnId === overTask.columnId && t.projectId === project.id)
        .sort((a, b) => a.order - b.order)
      const newIndex = columnTasks.findIndex((t) => t.id === overTask.id)
      moveTask(draggedTask.id, overTask.columnId, newIndex >= 0 ? newIndex : 0)
    }

    const overColumn = visibleColumns.find((c) => c.id === over.id)
    if (overColumn && draggedTask.columnId !== overColumn.id) {
      const columnTasks = tasks.filter(
        (t) => t.columnId === overColumn.id && t.projectId === project.id
      )
      moveTask(draggedTask.id, overColumn.id, columnTasks.length)
    }
  }

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

    const overTask = tasks.find((t) => t.id === over.id)
    if (overTask && overTask.columnId === draggedTask.columnId) {
      const columnTasks = tasks
        .filter((t) => t.columnId === draggedTask.columnId && t.projectId === project.id)
        .sort((a, b) => a.order - b.order)
      const newIndex = columnTasks.findIndex((t) => t.id === over.id)
      if (newIndex >= 0) {
        moveTask(draggedTask.id, draggedTask.columnId, newIndex)
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 p-6 overflow-x-auto h-full items-start">
        <SortableContext items={visibleColumns.map((c) => c.id)} strategy={horizontalListSortingStrategy}>
          {visibleColumns.map((col) => (
            <Column
              key={col.id}
              column={col}
              tasks={tasks.filter((t) => t.columnId === col.id)}
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
                {tasks.filter((t) => t.columnId === activeColumn.id).length}
              </span>
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
