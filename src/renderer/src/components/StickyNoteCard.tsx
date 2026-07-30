import { useRef, useState, useEffect, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import type { StickyNote, Task } from '../types'
import { PRIORITY_CONFIG } from '../types'

interface Props {
  note: StickyNote
  scale: number
  tasks: Task[]
  onUpdate: (updates: Partial<Pick<StickyNote, 'content' | 'color' | 'x' | 'y' | 'width' | 'height' | 'taskId' | 'taskIds' | 'fontSize' | 'completedAt'>>) => void
  onDelete: () => void
  onStartConnect: () => void
  onDragMove: (id: string, x: number, y: number) => void
  onDragEnd: (id: string) => void
  onOpenModal?: () => void
}

export function StickyNoteCard({ note, scale, tasks, onUpdate, onDelete, onStartConnect, onDragMove, onDragEnd, onOpenModal }: Props) {
  const [localPos, setLocalPos] = useState({ x: note.x, y: note.y })

  const isDraggingRef = useRef(false)
  const currentPosRef = useRef({ x: note.x, y: note.y })
  const scaleRef = useRef(scale)

  useEffect(() => { scaleRef.current = scale }, [scale])

  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalPos({ x: note.x, y: note.y })
      currentPosRef.current = { x: note.x, y: note.y }
    }
  }, [note.x, note.y])

  const allTaskIds = note.taskIds ?? (note.taskId ? [note.taskId] : [])
  const linkedTasks = allTaskIds
    .map((tid) => tasks.find((t) => t.id === tid) ?? null)
    .filter((t): t is Task => t !== null)

  const plainContent = note.content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()

  const connectionCount = (note.connections?.length ?? 0) + (note.goalIds?.length ?? 0)
  const totalLinks = linkedTasks.length + connectionCount

  const isCompleted = !!note.completedAt
  const accent = note.color

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    isDraggingRef.current = true
    const startX = e.clientX
    const startY = e.clientY
    const startNoteX = currentPosRef.current.x
    const startNoteY = currentPosRef.current.y
    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / scaleRef.current
      const dy = (ev.clientY - startY) / scaleRef.current
      const newPos = { x: startNoteX + dx, y: startNoteY + dy }
      currentPosRef.current = newPos
      setLocalPos(newPos)
      onDragMove(note.id, newPos.x, newPos.y)
    }
    const onUp = () => {
      isDraggingRef.current = false
      onUpdate(currentPosRef.current)
      onDragEnd(note.id)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [onUpdate, onDragMove, onDragEnd, note.id])

  return (
    <div
      data-note="true"
      data-note-id={note.id}
      className="group absolute select-none"
      style={{ left: localPos.x, top: localPos.y, width: note.width }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        className="rounded-lg overflow-hidden"
        style={{
          backgroundColor: '#1a1a1a',
          border: '1px solid #2a2a2a',
          borderLeft: `3px solid ${accent}`,
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
          opacity: isCompleted ? 0.65 : 1
        }}
      >
        {/* Drag bar */}
        <div
          className="flex items-center justify-between px-2 py-1 cursor-grab active:cursor-grabbing"
          style={{ backgroundColor: '#232323' }}
          onMouseDown={handleDragStart}
        >
          <svg width="12" height="8" viewBox="0 0 12 8" fill="#666">
            <circle cx="1.5" cy="1.5" r="1.5" />
            <circle cx="6" cy="1.5" r="1.5" />
            <circle cx="10.5" cy="1.5" r="1.5" />
            <circle cx="1.5" cy="6.5" r="1.5" />
            <circle cx="6" cy="6.5" r="1.5" />
            <circle cx="10.5" cy="6.5" r="1.5" />
          </svg>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onMouseDown={(e) => e.stopPropagation()}>
            <button
              onClick={(e) => { e.stopPropagation(); onUpdate({ completedAt: isCompleted ? undefined : new Date().toISOString() }) }}
              className="p-0.5 rounded hover:bg-white/10"
              title={isCompleted ? 'Reabrir nota' : 'Concluir nota'}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={isCompleted ? '#20b858' : '#888'} strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="p-0.5 rounded hover:bg-white/10" title="Deletar">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          className="px-3 py-2 cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onOpenModal?.() }}
          style={{ minHeight: note.height - 32 }}
        >
          {plainContent ? (
            <div
              className="text-[13px] leading-relaxed"
              style={{
                color: isCompleted ? '#666' : '#d4d4d4',
                textDecoration: isCompleted ? 'line-through' : undefined,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 5,
                WebkitBoxOrient: 'vertical',
                wordBreak: 'break-word'
              }}
            >
              {plainContent}
            </div>
          ) : (
            <span className="text-[12px] text-[#555]">Clique para editar...</span>
          )}
        </div>

        {/* Footer */}
        {(isCompleted || linkedTasks.length > 0 || totalLinks > 0) && (
          <div className="border-t border-[#2a2a2a] px-2.5 py-1.5">
            {isCompleted && (
              <div className="flex items-center gap-1 mb-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#20b858" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span className="text-[9px] text-[#20b858]">
                  {format(parseISO(note.completedAt!), 'dd/MM')}
                </span>
              </div>
            )}
            {linkedTasks.slice(0, 2).map((t) => (
              <div key={t.id} className="flex items-center gap-1 text-[10px] text-[#888]">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_CONFIG[t.priority].bg}`} style={{ backgroundColor: 'currentColor', opacity: 0.5 }} />
                <span className="truncate">{t.title}</span>
              </div>
            ))}
            {linkedTasks.length > 2 && (
              <div className="text-[9px] text-[#555]">+{linkedTasks.length - 2} tasks</div>
            )}
            {connectionCount > 0 && (
              <div className="text-[9px] text-[#555] mt-0.5">{connectionCount} conexões</div>
            )}
          </div>
        )}
      </div>

      {/* Connection anchor */}
      <button
        data-connect-anchor="true"
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onStartConnect() }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="absolute left-1/2 -translate-x-1/2 -bottom-3 w-5 h-5 rounded-full border-2 border-[#1a1a1a] shadow-md opacity-0 group-hover:opacity-100 transition-all hover:scale-125 cursor-crosshair z-10"
        style={{ backgroundColor: accent }}
        title="Arraste até outra nota para conectar"
      >
        <span className="block w-1.5 h-1.5 rounded-full bg-white mx-auto" />
      </button>
    </div>
  )
}
