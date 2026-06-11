import { useState } from 'react'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Column as ColumnType, Task, Project } from '../types'
import { TaskCard } from './TaskCard'

interface Props {
  column: ColumnType
  tasks: Task[]
  project: Project
  onAddTask: (columnId: string) => void
  onEditTask: (task: Task) => void
  onDeleteTask: (task: Task) => void
  onViewTask: (task: Task) => void
  onCompleteTask: (task: Task) => void
  onEditColumn: (column: ColumnType) => void
  onDeleteColumn: (column: ColumnType) => void
}

export function Column({
  column,
  tasks,
  project,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onViewTask,
  onCompleteTask,
  onEditColumn,
  onDeleteColumn
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    isOver
  } = useSortable({
    id: column.id,
    data: { type: 'column' }
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1
  }

  const sorted = [...tasks].sort((a, b) => a.order - b.order)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="flex flex-col w-72 shrink-0"
    >
      {/* header */}
      <div className="flex items-center justify-between px-3 py-2.5 mb-2 rounded-lg bg-[#181b28] border border-[#2a2d42]">
        <div className="flex items-center gap-2">
          {/* drag handle */}
          <div
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-[#3a3e58] hover:text-[#6366f1] transition-colors shrink-0"
            title="Arrastar coluna"
          >
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
              <circle cx="2.5" cy="2" r="1.5" />
              <circle cx="7.5" cy="2" r="1.5" />
              <circle cx="2.5" cy="8" r="1.5" />
              <circle cx="7.5" cy="8" r="1.5" />
              <circle cx="2.5" cy="14" r="1.5" />
              <circle cx="7.5" cy="14" r="1.5" />
            </svg>
          </div>

          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: column.color || project.color }}
          />
          <span className="text-sm font-medium text-[#e2e8f0] truncate max-w-[130px]">{column.name}</span>
          <span className="text-xs text-[#8892a4] bg-[#2a2d42] px-1.5 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onAddTask(column.id)}
            className="p-1 rounded text-[#8892a4] hover:text-[#6366f1] hover:bg-[#6366f1]/10 transition-colors"
            title="Adicionar task"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#2a2d42] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="5" r="1" fill="currentColor" />
                <circle cx="12" cy="12" r="1" fill="currentColor" />
                <circle cx="12" cy="19" r="1" fill="currentColor" />
              </svg>
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-7 z-20 w-36 rounded-lg border border-[#2a2d42] bg-[#13151f] shadow-xl py-1">
                  <button
                    className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
                    onClick={() => { setMenuOpen(false); onEditColumn(column) }}
                  >
                    Renomear
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 transition-colors"
                    onClick={() => { setMenuOpen(false); onDeleteColumn(column) }}
                  >
                    Deletar coluna
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* tasks area */}
      <div
        className={`flex flex-col gap-2 flex-1 min-h-24 rounded-lg p-1.5 transition-colors ${isOver ? 'bg-[#6366f1]/5 border border-[#6366f1]/30' : 'border border-transparent'}`}
      >
        <SortableContext items={sorted.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {sorted.map((task) => (
            <TaskCard key={task.id} task={task} onEdit={onEditTask} onDelete={onDeleteTask} onView={onViewTask} onComplete={onCompleteTask} />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <button
            onClick={() => onAddTask(column.id)}
            className="text-xs text-[#8892a4] border border-dashed border-[#2a2d42] rounded-lg py-4 hover:border-[#6366f1]/50 hover:text-[#6366f1] transition-colors"
          >
            + Add task
          </button>
        )}
      </div>
    </div>
  )
}
