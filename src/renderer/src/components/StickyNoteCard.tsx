import { useRef, useState, useEffect, useCallback } from 'react'
import type { StickyNote, Task, Column } from '../types'
import { PRIORITY_CONFIG } from '../types'

interface Props {
  note: StickyNote
  scale: number
  tasks: Task[]
  columns: Column[]
  onUpdate: (updates: Partial<Pick<StickyNote, 'content' | 'color' | 'x' | 'y' | 'width' | 'height' | 'taskId'>>) => void
  onDelete: () => void
  onCreateTask: (title: string) => void
  onStartConnect: () => void
  onDragMove: (id: string, x: number, y: number) => void
  onDragEnd: (id: string) => void
}

export function StickyNoteCard({ note, scale, tasks, columns, onUpdate, onDelete, onCreateTask, onStartConnect, onDragMove, onDragEnd }: Props) {
  const [localPos, setLocalPos] = useState({ x: note.x, y: note.y })
  const [content, setContent] = useState(note.content)
  const [isEditing, setIsEditing] = useState(note.content === '')
  const [showLinkDropdown, setShowLinkDropdown] = useState(false)
  const [linkSearch, setLinkSearch] = useState('')

  const isDraggingRef = useRef(false)
  const currentPosRef = useRef({ x: note.x, y: note.y })
  const scaleRef = useRef(scale)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => { scaleRef.current = scale }, [scale])

  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalPos({ x: note.x, y: note.y })
      currentPosRef.current = { x: note.x, y: note.y }
    }
  }, [note.x, note.y])

  useEffect(() => {
    if (isEditing) textareaRef.current?.focus()
  }, [isEditing])

  useEffect(() => {
    if (showLinkDropdown) {
      setLinkSearch('')
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }, [showLinkDropdown])

  // Close dropdown on outside click
  useEffect(() => {
    if (!showLinkDropdown) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowLinkDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showLinkDropdown])

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

  const handleSaveContent = useCallback(() => {
    setIsEditing(false)
    onUpdate({ content })
  }, [content, onUpdate])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setContent(note.content)
      setIsEditing(false)
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSaveContent()
    }
  }

  const linkedTask = note.taskId ? (tasks.find((t) => t.id === note.taskId) ?? null) : null
  const taskNotFound = !!note.taskId && !linkedTask
  const linkedColumn = linkedTask ? columns.find((c) => c.id === linkedTask.columnId) : null

  const filteredTasks = tasks.filter((t) =>
    t.title.toLowerCase().includes(linkSearch.toLowerCase())
  )
  const tasksByColumn = columns
    .filter((c) => c.name.toLowerCase() !== 'done')
    .sort((a, b) => a.order - b.order)
    .map((col) => ({
      column: col,
      tasks: filteredTasks.filter((t) => t.columnId === col.id).sort((a, b) => a.order - b.order)
    }))
    .filter((g) => g.tasks.length > 0)

  const TEXT = '#1e293b'
  const hasLinkedContent = linkedTask || taskNotFound

  return (
    <div
      data-note="true"
      data-note-id={note.id}
      className="group absolute"
      style={{
        left: localPos.x,
        top: localPos.y,
        width: note.width,
        zIndex: showLinkDropdown ? 50 : undefined
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Card */}
      <div
        className="rounded-lg flex flex-col"
        style={{
          backgroundColor: note.color,
          border: `1px solid ${note.color}99`,
          boxShadow: '2px 4px 12px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.2)'
        }}
      >
        {/* Drag handle bar */}
        <div
          className="flex items-center justify-between px-2 py-1.5 cursor-grab active:cursor-grabbing shrink-0"
          style={{ backgroundColor: `${note.color}aa` }}
          onMouseDown={handleDragStart}
        >
          <svg width="12" height="8" viewBox="0 0 12 8" fill={TEXT} opacity={0.35}>
            <circle cx="1.5" cy="1.5" r="1.5" />
            <circle cx="6" cy="1.5" r="1.5" />
            <circle cx="10.5" cy="1.5" r="1.5" />
            <circle cx="1.5" cy="6.5" r="1.5" />
            <circle cx="6" cy="6.5" r="1.5" />
            <circle cx="10.5" cy="6.5" r="1.5" />
          </svg>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-black/15"
            title="Deletar nota"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2.5" opacity={0.55}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content area */}
        <div
          className="px-3 py-2.5"
          style={{ minHeight: note.height - 32 }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true) }}
        >
          {isEditing ? (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onBlur={handleSaveContent}
              onKeyDown={handleKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full resize-none bg-transparent outline-none text-sm leading-relaxed"
              style={{
                color: TEXT,
                minHeight: note.height - 52,
                fontFamily: 'inherit',
                caretColor: TEXT
              }}
              placeholder="Digite sua nota..."
            />
          ) : (
            <p
              className="text-sm leading-relaxed break-words whitespace-pre-wrap select-none"
              style={{
                color: content ? TEXT : `${TEXT}55`,
                minHeight: note.height - 52
              }}
            >
              {content || 'Duplo clique para editar...'}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          className="border-t"
          style={{ borderColor: `${TEXT}12` }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Linked task display */}
          {hasLinkedContent && (
            <div className="px-2.5 py-2" style={{ backgroundColor: `${note.color}55` }}>
              {taskNotFound ? (
                <div className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: `${TEXT}60` }}>Task removida</span>
                  <button
                    onClick={() => onUpdate({ taskId: undefined })}
                    className="text-[9px] px-1.5 py-0.5 rounded hover:bg-black/10 transition-colors"
                    style={{ color: `${TEXT}70` }}
                  >
                    Desvincular
                  </button>
                </div>
              ) : linkedTask && (
                <div className="flex items-start justify-between gap-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2.5" opacity={0.45} className="shrink-0">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                      <span className="text-[11px] font-medium leading-tight truncate" style={{ color: TEXT }}>
                        {linkedTask.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] font-medium px-1.5 py-px rounded ${PRIORITY_CONFIG[linkedTask.priority].bg} ${PRIORITY_CONFIG[linkedTask.priority].color}`}>
                        {PRIORITY_CONFIG[linkedTask.priority].label}
                      </span>
                      {linkedColumn && (
                        <span className="text-[9px] truncate" style={{ color: `${TEXT}65` }}>
                          {linkedColumn.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => onUpdate({ taskId: undefined })}
                    className="shrink-0 p-0.5 rounded hover:bg-black/15 transition-colors"
                    title="Desvincular"
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2.5" opacity={0.4}>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Action buttons — visible on hover when not linked */}
          {!hasLinkedContent && (
            <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setShowLinkDropdown(true)}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium transition-colors hover:bg-black/8 rounded-bl-lg"
                style={{ color: `${TEXT}70` }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                Vincular task
              </button>
              <div className="w-px" style={{ backgroundColor: `${TEXT}12` }} />
              <button
                onClick={() => onCreateTask(content)}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium transition-colors hover:bg-black/8 rounded-br-lg"
                style={{ color: `${TEXT}70` }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Criar task
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Connection anchor — drag to another note to create a step link */}
      <button
        data-connect-anchor="true"
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onStartConnect() }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="absolute left-1/2 -translate-x-1/2 -bottom-3 w-5 h-5 rounded-full bg-[#6366f1] border-2 border-[#0d0f18] shadow-md opacity-0 group-hover:opacity-100 transition-all hover:scale-125 cursor-crosshair z-10"
        title="Arraste até outra nota para conectar"
      >
        <span className="block w-1.5 h-1.5 rounded-full bg-white mx-auto" />
      </button>

      {/* Link dropdown — outside card, inside note container (avoids overflow clipping) */}
      {showLinkDropdown && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 rounded-lg border overflow-hidden"
          style={{
            top: 'calc(100% + 4px)',
            backgroundColor: '#13151f',
            borderColor: '#2a2d42',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            zIndex: 10
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Search */}
          <div className="p-2 border-b" style={{ borderColor: '#2a2d42' }}>
            <input
              ref={searchInputRef}
              type="text"
              value={linkSearch}
              onChange={(e) => setLinkSearch(e.target.value)}
              placeholder="Buscar task..."
              onKeyDown={(e) => { if (e.key === 'Escape') setShowLinkDropdown(false) }}
              className="w-full px-2 py-1 rounded text-[11px] outline-none placeholder-[#8892a4]"
              style={{
                backgroundColor: '#0d0f18',
                border: '1px solid #2a2d42',
                color: '#e2e8f0'
              }}
            />
          </div>

          {/* Task list */}
          <div className="overflow-y-auto" style={{ maxHeight: 180 }}>
            {tasksByColumn.length === 0 ? (
              <p className="px-3 py-3 text-center text-[11px]" style={{ color: '#8892a4' }}>
                {linkSearch ? 'Nenhum resultado' : 'Nenhuma task no projeto'}
              </p>
            ) : (
              tasksByColumn.map(({ column, tasks: colTasks }) => (
                <div key={column.id}>
                  <div
                    className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider sticky top-0"
                    style={{ color: '#8892a4', backgroundColor: '#0d0f18cc' }}
                  >
                    {column.name}
                  </div>
                  {colTasks.map((task) => (
                    <button
                      key={task.id}
                      className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 transition-colors hover:bg-white/5"
                      onClick={() => {
                        onUpdate({ taskId: task.id })
                        setShowLinkDropdown(false)
                      }}
                    >
                      <span
                        className={`shrink-0 text-[8px] font-bold px-1 py-px rounded ${PRIORITY_CONFIG[task.priority].bg} ${PRIORITY_CONFIG[task.priority].color}`}
                      >
                        {PRIORITY_CONFIG[task.priority].label[0]}
                      </span>
                      <span className="text-[11px] text-[#e2e8f0] truncate">{task.title}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
