import { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { format, isPast, parseISO } from 'date-fns'
import type { Task } from '../types'
import { PRIORITY_CONFIG } from '../types'
import { useKanbanStore } from '../store/kanban'
import { formatDuration } from '../utils/time'

interface Props {
  task: Task
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
  onView?: (task: Task) => void
  onComplete?: (task: Task) => void
  overlay?: boolean
}

export function TaskCard({ task, onEdit, onDelete, onView, onComplete, overlay = false }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: overlay,
    data: { type: 'task' }
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1
  }

  const activeTimer = useKanbanStore((s) => s.activeTimer)
  const startTimer = useKanbanStore((s) => s.startTimer)
  const stopTimer = useKanbanStore((s) => s.stopTimer)
  const isLinkedToCanvas = useKanbanStore((s) => s.notes.some((n) => n.taskId === task.id))

  const isRunning = activeTimer?.taskId === task.id
  const [, setTick] = useState(0)

  // Re-render every second while this task's timer is running
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  const sessionSeconds = isRunning ? Math.floor((Date.now() - activeTimer!.startedAt) / 1000) : 0
  const totalSeconds = (task.timeSpent ?? 0) + sessionSeconds
  const showTime = totalSeconds > 0

  const priority = PRIORITY_CONFIG[task.priority]
  const isOverdue = task.dueDate && isPast(parseISO(task.dueDate))

  const handleTimerToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isRunning) stopTimer()
    else startTimer(task.id)
  }

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={overlay ? undefined : style}
      onClick={() => !overlay && onView?.(task)}
      className={`group rounded-lg border border-[#2a2d42] bg-[#1e2235] p-3 select-none transition-colors hover:bg-[#242840] hover:border-[#3a3e58] ${overlay ? 'drag-overlay' : 'cursor-pointer cv-card'}`}
    >
      {/* drag handle + actions */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div
          {...(overlay ? {} : { ...attributes, ...listeners })}
          className="mt-0.5 cursor-grab active:cursor-grabbing text-[#3a3e58] hover:text-[#6366f1] transition-colors shrink-0"
        >
          <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
            <circle cx="3" cy="3" r="1.5" />
            <circle cx="9" cy="3" r="1.5" />
            <circle cx="3" cy="8" r="1.5" />
            <circle cx="9" cy="8" r="1.5" />
            <circle cx="3" cy="13" r="1.5" />
            <circle cx="9" cy="13" r="1.5" />
          </svg>
        </div>

        <div
          className={`flex items-center gap-1 transition-opacity shrink-0 ${isRunning ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          {/* Timer toggle */}
          {!overlay && (
            <button
              onClick={handleTimerToggle}
              className={`p-1 rounded transition-colors ${
                isRunning
                  ? 'text-[#22c55e] bg-[#22c55e]/10 hover:bg-[#22c55e]/20'
                  : 'text-[#8892a4] hover:text-[#22c55e] hover:bg-[#22c55e]/10'
              }`}
              title={isRunning ? 'Pausar timer' : 'Iniciar timer'}
            >
              {isRunning ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              )}
            </button>
          )}

          {onComplete && (
            <button
              onClick={(e) => { e.stopPropagation(); onComplete(task) }}
              className="p-1 rounded text-[#8892a4] hover:text-[#22c55e] hover:bg-[#22c55e]/10 transition-colors"
              title="Concluir task"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(task) }}
            className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#2a2d42] transition-colors"
            title="Editar"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(task) }}
            className="p-1 rounded text-[#8892a4] hover:text-red-400 hover:bg-red-400/10 transition-colors"
            title="Deletar"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* title */}
      <p className="text-sm text-[#e2e8f0] leading-snug mb-2 break-words">{task.title}</p>

      {/* description preview */}
      {task.description && (
        <p className="text-xs text-[#8892a4] mb-2 line-clamp-2 leading-relaxed">{task.description}</p>
      )}

      {/* tags */}
      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {task.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[#2a2d42] text-[#8892a4]">
              {tag}
            </span>
          ))}
          {task.tags.length > 4 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2a2d42] text-[#8892a4]">
              +{task.tags.length - 4}
            </span>
          )}
        </div>
      )}

      {/* footer: priority + canvas + time + images + date */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${priority.bg} ${priority.color}`}>
            {priority.label}
          </span>
          {isLinkedToCanvas && (
            <span className="flex items-center text-[#6366f1]/70" title="Vinculada ao Canvas">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {showTime && (
            <span
              className={`flex items-center gap-0.5 text-[10px] tabular-nums font-mono ${isRunning ? 'text-[#22c55e]' : 'text-[#8892a4]'}`}
              title={isRunning ? 'Cronômetro em andamento' : 'Cronômetro pausado'}
            >
              {isRunning ? (
                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse shrink-0" />
              ) : (
                <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 opacity-60">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              )}
              {formatDuration(totalSeconds)}
            </span>
          )}
          {task.images && task.images.length > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-[#8892a4]">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              {task.images.length}
            </span>
          )}
          {task.dueDate && (
            <span className={`text-[10px] ${isOverdue ? 'text-red-400' : 'text-[#8892a4]'}`}>
              {format(parseISO(task.dueDate), 'dd/MM')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
