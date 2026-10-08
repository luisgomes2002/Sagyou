import { useRef, useState, useEffect, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import type { StickyNote, Task } from '../types'
import { PRIORITY_CONFIG } from '../types'
import { cardTextColor } from '../utils/cardColor'

interface Props {
  note: StickyNote
  highlighted?: boolean
  scale: number
  tasks: Task[]
  onUpdate: (
    updates: Partial<
      Pick<
        StickyNote,
        | 'content'
        | 'color'
        | 'x'
        | 'y'
        | 'width'
        | 'height'
        | 'taskId'
        | 'taskIds'
        | 'fontSize'
        | 'completedAt'
      >
    >
  ) => void
  onDelete: () => void
  onStartConnect: () => void
  onDragMove: (id: string, x: number, y: number) => void
  onDragEnd: (id: string) => void
  onOpenModal?: () => void
}

export function StickyNoteCard({
  note,
  highlighted,
  scale,
  tasks,
  onUpdate,
  onDelete,
  onStartConnect,
  onDragMove,
  onDragEnd,
  onOpenModal
}: Props) {
  const [localPos, setLocalPos] = useState({ x: note.x, y: note.y })

  const isDraggingRef = useRef(false)
  const isResizingRef = useRef(false)
  const currentPosRef = useRef({ x: note.x, y: note.y })
  const scaleRef = useRef(scale)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const fontInputRef = useRef<HTMLInputElement>(null)
  const [localWidth, setLocalWidth] = useState(note.width)
  const [localContent, setLocalContent] = useState(note.content)
  const [fontSizeDraft, setFontSizeDraft] = useState(String(note.fontSize ?? 24))

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalPos({ x: note.x, y: note.y })
      currentPosRef.current = { x: note.x, y: note.y }
    }
  }, [note.x, note.y])

  useEffect(() => {
    if (!isResizingRef.current) setLocalWidth(note.width)
  }, [note.width])

  useEffect(() => {
    if (document.activeElement !== textAreaRef.current) setLocalContent(note.content)
  }, [note.content])

  useEffect(() => {
    if (document.activeElement !== fontInputRef.current) {
      setFontSizeDraft(String(note.fontSize ?? 24))
    }
  }, [note.fontSize])

  useEffect(() => {
    if (note.type !== 'text' || localContent === note.content) return
    const timer = window.setTimeout(() => onUpdate({ content: localContent }), 350)
    return () => window.clearTimeout(timer)
  }, [localContent, note.content, note.type, onUpdate])

  useEffect(() => {
    const field = textAreaRef.current
    if (!field) return
    field.style.height = '0px'
    field.style.height = `${field.scrollHeight}px`
  }, [localContent, localWidth, fontSizeDraft, note.fontSize])

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
  const isTextNote = note.type === 'text' || accent === 'transparent'
  const foreground = isTextNote ? '#d4d4d4' : cardTextColor(accent)
  const draftSize = Number(fontSizeDraft)
  const previewFontSize =
    fontSizeDraft.trim() && Number.isFinite(draftSize) && draftSize >= 12 && draftSize <= 72
      ? draftSize
      : (note.fontSize ?? 24)

  const commitFontSize = (): void => {
    const size = fontSizeDraft.trim() ? Number(fontSizeDraft) : NaN
    const next = Number.isFinite(size)
      ? Math.min(72, Math.max(12, Math.round(size)))
      : (note.fontSize ?? 24)
    setFontSizeDraft(String(next))
    if (next !== (note.fontSize ?? 24)) onUpdate({ fontSize: next })
  }

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
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
    },
    [onUpdate, onDragMove, onDragEnd, note.id]
  )

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      isResizingRef.current = true
      const startX = e.clientX
      const startWidth = localWidth
      let nextWidth = startWidth
      const onMove = (ev: MouseEvent) => {
        nextWidth = Math.min(
          1200,
          Math.max(120, startWidth + (ev.clientX - startX) / scaleRef.current)
        )
        setLocalWidth(nextWidth)
      }
      const onUp = () => {
        isResizingRef.current = false
        onUpdate({ width: nextWidth })
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [localWidth, onUpdate]
  )

  if (isTextNote) {
    return (
      <div
        data-note="true"
        data-note-id={note.id}
        className={`group absolute select-none ${highlighted ? 'z-20 ring-4 ring-[#a080f0] rounded-lg' : ''}`}
        style={{ left: localPos.x, top: localPos.y, width: localWidth }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div className="relative rounded-md border border-transparent bg-transparent hover:border-[#555555] focus-within:border-[#a080f0]">
          <div className="absolute -top-6 left-0 z-10 flex items-center gap-2 rounded-md border border-[#3b3b3b] bg-[#2a2a2a] px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <button
              type="button"
              title="Arraste para mover o texto"
              aria-label="Mover texto"
              className="cursor-grab text-[#999999] active:cursor-grabbing"
              onMouseDown={handleDragStart}
            >
              ⠿
            </button>
            <label className="flex items-center gap-1 text-[10px] text-[#999999]">
              Fonte
              <input
                ref={fontInputRef}
                type="number"
                min={12}
                max={72}
                value={fontSizeDraft}
                aria-label="Tamanho da fonte"
                onChange={(e) => setFontSizeDraft(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={commitFontSize}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                className="w-12 rounded border border-[#4a4a4a] bg-[#1b1b1b] px-1 text-center text-[#d4d4d4] outline-none focus:border-[#a080f0]"
              />
            </label>
            <button
              type="button"
              title="Excluir texto"
              aria-label="Excluir texto"
              onClick={onDelete}
              className="text-[#999999] hover:text-[#ec6a6a]"
            >
              ×
            </button>
          </div>
          <textarea
            ref={textAreaRef}
            value={localContent}
            spellCheck={false}
            autoFocus={!note.content}
            onChange={(e) => setLocalContent(e.target.value)}
            onBlur={() => {
              if (localContent !== note.content) onUpdate({ content: localContent })
            }}
            placeholder="Escreva aqui..."
            aria-label="Texto do canvas"
            className="block w-full resize-none overflow-hidden bg-transparent px-2 py-1 text-[#d4d4d4] placeholder:text-[#777777] outline-none"
            style={{ fontSize: previewFontSize, lineHeight: 1.25 }}
          />
          <button
            type="button"
            aria-label="Arraste para ajustar a largura"
            title="Arraste para ajustar a largura"
            className="absolute -right-1 top-0 h-full w-2 cursor-ew-resize rounded bg-[#555555] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            onMouseDown={handleResizeStart}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      data-note="true"
      data-note-id={note.id}
      className={`group absolute select-none ${highlighted ? 'z-20 ring-4 ring-[#a080f0] rounded-lg' : ''}`}
      style={{ left: localPos.x, top: localPos.y, width: note.width }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        className="rounded-lg overflow-hidden"
        style={{
          backgroundColor: isTextNote ? 'transparent' : accent,
          border: isTextNote
            ? '1px solid transparent'
            : `2px ${note.borderStyle ?? 'solid'} ${foreground}`,
          boxShadow: isTextNote ? 'none' : '0 2px 12px rgba(0,0,0,0.4)',
          opacity: isCompleted ? 0.65 : 1
        }}
      >
        {/* Drag bar */}
        <div
          className="flex items-center justify-between px-2 py-1 cursor-grab active:cursor-grabbing"
          style={{ backgroundColor: isTextNote ? 'transparent' : accent, color: foreground }}
          onMouseDown={handleDragStart}
        >
          <svg width="12" height="8" viewBox="0 0 12 8" fill="currentColor" opacity="0.6">
            <circle cx="1.5" cy="1.5" r="1.5" />
            <circle cx="6" cy="1.5" r="1.5" />
            <circle cx="10.5" cy="1.5" r="1.5" />
            <circle cx="1.5" cy="6.5" r="1.5" />
            <circle cx="6" cy="6.5" r="1.5" />
            <circle cx="10.5" cy="6.5" r="1.5" />
          </svg>

          <div
            className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {!isTextNote && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onUpdate({ completedAt: isCompleted ? undefined : new Date().toISOString() })
                }}
                className="p-0.5 rounded hover:bg-white/10"
                title={isCompleted ? 'Reabrir nota' : 'Concluir nota'}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={isCompleted ? '#20b858' : '#888'}
                  strokeWidth="2.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="p-0.5 rounded hover:bg-white/10"
              title="Deletar"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#888"
                strokeWidth="2.5"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div
          className="px-3 py-2 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            onOpenModal?.()
          }}
          style={{ minHeight: note.height - 32 }}
        >
          {plainContent ? (
            <div
              className="leading-relaxed whitespace-pre-wrap"
              style={{
                fontSize: isTextNote ? (note.fontSize ?? 24) : 13,
                color: foreground,
                textDecoration: isCompleted ? 'line-through' : undefined,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: isTextNote ? undefined : 5,
                WebkitBoxOrient: 'vertical',
                wordBreak: 'break-word'
              }}
            >
              {plainContent}
            </div>
          ) : (
            <span className="text-[12px] opacity-60" style={{ color: foreground }}>
              Clique para editar...
            </span>
          )}
        </div>

        {/* Footer */}
        {!isTextNote && (isCompleted || linkedTasks.length > 0 || totalLinks > 0) && (
          <div className="border-t px-2.5 py-1.5" style={{ borderColor: foreground }}>
            {isCompleted && (
              <div className="flex items-center gap-1 mb-1">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#20b858"
                  strokeWidth="2.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span className="text-[9px] text-[#20b858]">
                  {format(parseISO(note.completedAt!), 'dd/MM')}
                </span>
              </div>
            )}
            {linkedTasks.slice(0, 2).map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-1 text-[10px] opacity-75"
                style={{ color: foreground }}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_CONFIG[t.priority].bg}`}
                  style={{ backgroundColor: 'currentColor', opacity: 0.5 }}
                />
                <span className="truncate">{t.title}</span>
              </div>
            ))}
            {linkedTasks.length > 2 && (
              <div className="text-[9px] opacity-75" style={{ color: foreground }}>
                +{linkedTasks.length - 2} tasks
              </div>
            )}
            {connectionCount > 0 && (
              <div className="text-[9px] opacity-75 mt-0.5" style={{ color: foreground }}>
                {connectionCount} conexões
              </div>
            )}
          </div>
        )}
      </div>

      {/* Connection anchor */}
      {!isTextNote && (
        <button
          data-connect-anchor="true"
          onMouseDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onStartConnect()
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="absolute left-1/2 -translate-x-1/2 -bottom-3 w-5 h-5 rounded-full border-2 border-[#1a1a1a] shadow-md opacity-0 group-hover:opacity-100 transition-all hover:scale-125 cursor-crosshair z-10"
          style={{ backgroundColor: accent }}
          title="Arraste até outra nota para conectar"
        >
          <span className="block w-1.5 h-1.5 rounded-full bg-white mx-auto" />
        </button>
      )}
    </div>
  )
}
