import { useRef, useState, useEffect, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import type { StickyNote, Task, Column } from '../types'
import { PRIORITY_CONFIG, NOTE_COLORS } from '../types'

function toHtml(raw: string): string {
  if (!raw) return ''
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

function toPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32]
const DEFAULT_FONT_SIZE = 14

interface Props {
  note: StickyNote
  scale: number
  tasks: Task[]
  columns: Column[]
  onUpdate: (updates: Partial<Pick<StickyNote, 'content' | 'color' | 'x' | 'y' | 'width' | 'height' | 'taskId' | 'fontSize' | 'completedAt'>>) => void
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
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showLinkDropdown, setShowLinkDropdown] = useState(false)
  const [linkSearch, setLinkSearch] = useState('')

  const isTextElement = note.type === 'text'
  const fontSize = note.fontSize ?? DEFAULT_FONT_SIZE
  const TEXT = isTextElement ? '#e2e8f0' : '#1e293b'

  const isDraggingRef = useRef(false)
  const currentPosRef = useRef({ x: note.x, y: note.y })
  const scaleRef = useRef(scale)
  const editorRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { scaleRef.current = scale }, [scale])

  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalPos({ x: note.x, y: note.y })
      currentPosRef.current = { x: note.x, y: note.y }
    }
  }, [note.x, note.y])

  useEffect(() => {
    if (!isEditing || !editorRef.current) return
    editorRef.current.innerHTML = toHtml(content)
    editorRef.current.focus()
    const range = document.createRange()
    range.selectNodeContents(editorRef.current)
    range.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
  }, [isEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showLinkDropdown) {
      setLinkSearch('')
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }, [showLinkDropdown])

  useEffect(() => {
    if (!showLinkDropdown && !showColorPicker) return
    const handle = (e: MouseEvent) => {
      if (showLinkDropdown && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowLinkDropdown(false)
      }
      if (showColorPicker && colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showLinkDropdown, showColorPicker])

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
    const html = editorRef.current?.innerHTML ?? ''
    setContent(html)
    setIsEditing(false)
    onUpdate({ content: html })
  }, [onUpdate])

  const handleEditorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (editorRef.current) editorRef.current.innerHTML = toHtml(note.content)
      setIsEditing(false)
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSaveContent()
    }
  }

  const execFormat = (cmd: string) => {
    document.execCommand(cmd, false)
    editorRef.current?.focus()
  }

  const changeFontSize = (delta: number) => {
    const idx = FONT_SIZES.indexOf(fontSize)
    const nextIdx = Math.max(0, Math.min(FONT_SIZES.length - 1, idx + delta))
    onUpdate({ fontSize: FONT_SIZES[nextIdx] })
  }

  const linkedTask = note.taskId ? (tasks.find((t) => t.id === note.taskId) ?? null) : null
  const taskNotFound = !!note.taskId && !linkedTask
  const linkedColumn = linkedTask ? columns.find((c) => c.id === linkedTask.columnId) : null
  const filteredTasks = tasks.filter((t) => t.title.toLowerCase().includes(linkSearch.toLowerCase()))
  const tasksByColumn = columns
    .filter((c) => c.name.toLowerCase() !== 'done')
    .sort((a, b) => a.order - b.order)
    .map((col) => ({
      column: col,
      tasks: filteredTasks.filter((t) => t.columnId === col.id).sort((a, b) => a.order - b.order)
    }))
    .filter((g) => g.tasks.length > 0)

  const hasLinkedContent = linkedTask || taskNotFound
  const isCompleted = !!note.completedAt
  const displayHtml = toHtml(content)

  // ── Text element (minimal, transparent) ──────────────────────────────────────
  if (isTextElement) {
    return (
      <div
        data-note="true"
        data-note-id={note.id}
        className="group absolute"
        style={{ left: localPos.x, top: localPos.y, width: note.width, minWidth: 80 }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {/* Invisible drag handle */}
        <div
          className="h-4 flex items-center px-1 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity rounded-t"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
          onMouseDown={handleDragStart}
        >
          <svg width="10" height="6" viewBox="0 0 12 8" fill="#e2e8f0" opacity={0.3}>
            <circle cx="1.5" cy="1.5" r="1.5" /><circle cx="6" cy="1.5" r="1.5" /><circle cx="10.5" cy="1.5" r="1.5" />
            <circle cx="1.5" cy="6.5" r="1.5" /><circle cx="6" cy="6.5" r="1.5" /><circle cx="10.5" cy="6.5" r="1.5" />
          </svg>
          {/* Actions */}
          <div className="flex items-center gap-0.5 ml-auto" onMouseDown={(e) => e.stopPropagation()}>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="p-0.5 rounded hover:bg-white/10"
              title="Deletar"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" strokeWidth="2.5" opacity={0.4}>
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Formatting toolbar — while editing */}
        {isEditing && (
          <div
            className="flex items-center gap-px px-1.5 py-1 rounded border mb-0.5"
            style={{ backgroundColor: '#1e2235', borderColor: '#2a2d42' }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button onClick={() => execFormat('bold')} className="w-6 h-6 rounded flex items-center justify-center text-[11px] font-bold text-[#e2e8f0] hover:bg-white/10" style={{ fontFamily: 'Georgia, serif' }} title="Negrito">B</button>
            <button onClick={() => execFormat('italic')} className="w-6 h-6 rounded flex items-center justify-center text-[11px] italic text-[#e2e8f0] hover:bg-white/10" style={{ fontFamily: 'Georgia, serif' }} title="Itálico">I</button>
            <button onClick={() => execFormat('underline')} className="w-6 h-6 rounded flex items-center justify-center text-[11px] underline text-[#e2e8f0] hover:bg-white/10" title="Sublinhado">U</button>
            <button onClick={() => execFormat('strikeThrough')} className="w-6 h-6 rounded flex items-center justify-center text-[11px] line-through text-[#e2e8f0] hover:bg-white/10" title="Riscado">S</button>
            <div className="w-px h-3.5 mx-1 bg-white/15 shrink-0" />
            <button onClick={() => changeFontSize(-1)} disabled={fontSize <= FONT_SIZES[0]} className="w-5 h-6 rounded text-[11px] font-bold text-[#e2e8f0] hover:bg-white/10 disabled:opacity-30">−</button>
            <span className="text-[10px] text-[#8892a4] w-7 text-center tabular-nums">{fontSize}</span>
            <button onClick={() => changeFontSize(1)} disabled={fontSize >= FONT_SIZES[FONT_SIZES.length - 1]} className="w-5 h-6 rounded text-[11px] font-bold text-[#e2e8f0] hover:bg-white/10 disabled:opacity-30">+</button>
            <div className="flex-1" />
            <button onClick={handleSaveContent} className="px-2 h-6 rounded text-[10px] text-[#8892a4] hover:bg-white/10" title="Salvar (Ctrl+Enter)">OK</button>
          </div>
        )}

        {/* Text content */}
        <div
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true) }}
        >
          {isEditing ? (
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onKeyDown={handleEditorKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              className="outline-none leading-tight break-words"
              style={{ color: '#e2e8f0', fontSize, caretColor: '#e2e8f0', minWidth: 80, wordBreak: 'break-word' }}
            />
          ) : (
            <div
              className="leading-tight break-words select-none"
              style={{
                color: isCompleted ? '#8892a4' : '#e2e8f0',
                fontSize,
                wordBreak: 'break-word',
                textDecoration: isCompleted ? 'line-through' : undefined,
                opacity: isCompleted ? 0.6 : 1
              }}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{
                __html: displayHtml || `<span style="opacity:0.3;font-size:12px">Duplo clique para editar...</span>`
              }}
            />
          )}
        </div>

        {/* Connection anchor */}
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
      </div>
    )
  }

  // ── Sticky note ───────────────────────────────────────────────────────────────
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
      <div
        className="rounded-lg flex flex-col"
        style={{
          backgroundColor: note.color,
          border: `1px solid ${note.color}99`,
          boxShadow: '2px 4px 12px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.2)',
          opacity: isCompleted ? 0.75 : 1
        }}
      >
        {/* Drag bar */}
        <div
          className="flex items-center justify-between px-2 py-1.5 cursor-grab active:cursor-grabbing shrink-0"
          style={{ backgroundColor: `${note.color}aa` }}
          onMouseDown={handleDragStart}
        >
          <svg width="12" height="8" viewBox="0 0 12 8" fill={TEXT} opacity={0.35}>
            <circle cx="1.5" cy="1.5" r="1.5" /><circle cx="6" cy="1.5" r="1.5" /><circle cx="10.5" cy="1.5" r="1.5" />
            <circle cx="1.5" cy="6.5" r="1.5" /><circle cx="6" cy="6.5" r="1.5" /><circle cx="10.5" cy="6.5" r="1.5" />
          </svg>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onMouseDown={(e) => e.stopPropagation()}>
            {/* Complete / reopen */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onUpdate({ completedAt: isCompleted ? undefined : new Date().toISOString() })
              }}
              className="p-0.5 rounded hover:bg-black/15"
              title={isCompleted ? 'Reabrir nota' : 'Marcar como concluída'}
            >
              {isCompleted ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2" opacity={0.55}>
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              )}
            </button>

            {/* Color picker — floating popup */}
            <div className="relative" ref={colorPickerRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowColorPicker((v) => !v) }}
                className="p-0.5 rounded hover:bg-black/15"
                title="Trocar cor"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2" opacity={0.55}>
                  <circle cx="13.5" cy="6.5" r=".5" fill={TEXT} />
                  <circle cx="17.5" cy="10.5" r=".5" fill={TEXT} />
                  <circle cx="8.5" cy="7.5" r=".5" fill={TEXT} />
                  <circle cx="6.5" cy="12.5" r=".5" fill={TEXT} />
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
                </svg>
              </button>
              {showColorPicker && (
                <div
                  className="absolute right-0 top-full mt-1 z-30 p-3 rounded-xl grid grid-cols-4 gap-3"
                  style={{ backgroundColor: '#1a1d2e', border: '1px solid #2a2d42', boxShadow: '0 6px 20px rgba(0,0,0,0.55)' }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {NOTE_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={(e) => { e.stopPropagation(); onUpdate({ color: c }); setShowColorPicker(false) }}
                      className="w-9 h-9 rounded-full transition-transform hover:scale-110"
                      style={{
                        backgroundColor: c,
                        boxShadow: note.color === c ? `0 0 0 2px #1a1d2e, 0 0 0 4px ${c}` : '0 0 0 1px rgba(0,0,0,0.2)'
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="p-0.5 rounded hover:bg-black/15"
              title="Deletar nota"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2.5" opacity={0.55}>
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Rich text formatting toolbar — while editing */}
        {isEditing && (
          <div
            className="flex items-center gap-px px-1.5 py-1 border-b shrink-0"
            style={{ borderColor: `${TEXT}18`, backgroundColor: `${TEXT}08` }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button onClick={() => execFormat('bold')} className="w-6 h-6 rounded flex items-center justify-center text-[11px] font-bold hover:bg-black/10" style={{ color: TEXT, fontFamily: 'Georgia, serif' }} title="Negrito">B</button>
            <button onClick={() => execFormat('italic')} className="w-6 h-6 rounded flex items-center justify-center text-[11px] italic hover:bg-black/10" style={{ color: TEXT, fontFamily: 'Georgia, serif' }} title="Itálico">I</button>
            <button onClick={() => execFormat('underline')} className="w-6 h-6 rounded flex items-center justify-center text-[11px] underline hover:bg-black/10" style={{ color: TEXT }} title="Sublinhado">U</button>
            <button onClick={() => execFormat('strikeThrough')} className="w-6 h-6 rounded flex items-center justify-center text-[11px] line-through hover:bg-black/10" style={{ color: TEXT }} title="Riscado">S</button>
            <div className="w-px h-3.5 mx-1 shrink-0" style={{ backgroundColor: `${TEXT}25` }} />
            <button onClick={() => changeFontSize(-1)} disabled={fontSize <= FONT_SIZES[0]} className="w-5 h-6 rounded text-[11px] font-bold hover:bg-black/10 disabled:opacity-30" style={{ color: TEXT }}>−</button>
            <span className="text-[10px] tabular-nums w-7 text-center" style={{ color: TEXT, opacity: 0.6 }}>{fontSize}</span>
            <button onClick={() => changeFontSize(1)} disabled={fontSize >= FONT_SIZES[FONT_SIZES.length - 1]} className="w-5 h-6 rounded text-[11px] font-bold hover:bg-black/10 disabled:opacity-30" style={{ color: TEXT }}>+</button>
            <div className="flex-1" />
            <button onClick={handleSaveContent} className="px-2 h-6 rounded text-[10px] font-medium hover:bg-black/15" style={{ color: TEXT, opacity: 0.6 }} title="Salvar (Ctrl+Enter)">OK</button>
          </div>
        )}

        {/* Content area */}
        <div
          className="px-3 py-2.5"
          style={{ minHeight: note.height - 32 }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => { e.stopPropagation(); if (!isCompleted) setIsEditing(true) }}
        >
          {isEditing ? (
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onKeyDown={handleEditorKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full outline-none leading-relaxed break-words"
              style={{ color: TEXT, minHeight: note.height - 52, fontSize, caretColor: TEXT, wordBreak: 'break-word' }}
            />
          ) : (
            <div
              className="leading-relaxed break-words select-none"
              style={{
                color: displayHtml ? TEXT : `${TEXT}55`,
                minHeight: note.height - 52,
                fontSize,
                wordBreak: 'break-word',
                textDecoration: isCompleted ? 'line-through' : undefined
              }}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{
                __html: displayHtml || `<span style="opacity:0.4">Duplo clique para editar...</span>`
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div
          className="border-t"
          style={{ borderColor: `${TEXT}12` }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Completion banner */}
          {isCompleted && (
            <div className="flex items-center justify-between px-2.5 py-1.5" style={{ backgroundColor: 'rgba(34,197,94,0.12)', borderBottom: hasLinkedContent ? `1px solid ${TEXT}12` : undefined }}>
              <div className="flex items-center gap-1.5">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="9" /><polyline points="9 12 11 14 15 10" />
                </svg>
                <span className="text-[10px]" style={{ color: '#22c55e' }}>
                  Concluída em {format(parseISO(note.completedAt!), 'dd/MM/yyyy HH:mm')}
                </span>
              </div>
              <button
                onClick={() => onUpdate({ completedAt: undefined })}
                className="text-[9px] px-1.5 py-0.5 rounded hover:bg-black/10 transition-colors"
                style={{ color: `${TEXT}60` }}
              >
                Reabrir
              </button>
            </div>
          )}

          {/* Linked task */}
          {hasLinkedContent && (
            <div className="px-2.5 py-2" style={{ backgroundColor: `${note.color}55` }}>
              {taskNotFound ? (
                <div className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: `${TEXT}60` }}>Task removida</span>
                  <button onClick={() => onUpdate({ taskId: undefined })} className="text-[9px] px-1.5 py-0.5 rounded hover:bg-black/10" style={{ color: `${TEXT}70` }}>Desvincular</button>
                </div>
              ) : linkedTask && (
                <div className="flex items-start justify-between gap-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2.5" opacity={0.45} className="shrink-0">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                      <span className="text-[11px] font-medium leading-tight truncate" style={{ color: TEXT }}>{linkedTask.title}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] font-medium px-1.5 py-px rounded ${PRIORITY_CONFIG[linkedTask.priority].bg} ${PRIORITY_CONFIG[linkedTask.priority].color}`}>
                        {PRIORITY_CONFIG[linkedTask.priority].label}
                      </span>
                      {linkedColumn && <span className="text-[9px] truncate" style={{ color: `${TEXT}65` }}>{linkedColumn.name}</span>}
                    </div>
                  </div>
                  <button onClick={() => onUpdate({ taskId: undefined })} className="shrink-0 p-0.5 rounded hover:bg-black/15" title="Desvincular">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={TEXT} strokeWidth="2.5" opacity={0.4}>
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Action buttons — only when not completed and not linked */}
          {!isCompleted && !hasLinkedContent && (
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
                onClick={() => onCreateTask(toPlain(content))}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-medium transition-colors hover:bg-black/8 rounded-br-lg"
                style={{ color: `${TEXT}70` }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Criar task
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Connection anchor */}
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

      {/* Link dropdown */}
      {showLinkDropdown && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 rounded-lg border overflow-hidden"
          style={{ top: 'calc(100% + 4px)', backgroundColor: '#13151f', borderColor: '#2a2d42', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 10 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="p-2 border-b" style={{ borderColor: '#2a2d42' }}>
            <input
              ref={searchInputRef}
              type="text"
              value={linkSearch}
              onChange={(e) => setLinkSearch(e.target.value)}
              placeholder="Buscar task..."
              onKeyDown={(e) => { if (e.key === 'Escape') setShowLinkDropdown(false) }}
              className="w-full px-2 py-1 rounded text-[11px] outline-none placeholder-[#8892a4]"
              style={{ backgroundColor: '#0d0f18', border: '1px solid #2a2d42', color: '#e2e8f0' }}
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 180 }}>
            {tasksByColumn.length === 0 ? (
              <p className="px-3 py-3 text-center text-[11px]" style={{ color: '#8892a4' }}>
                {linkSearch ? 'Nenhum resultado' : 'Nenhuma task no projeto'}
              </p>
            ) : tasksByColumn.map(({ column, tasks: colTasks }) => (
              <div key={column.id}>
                <div className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider sticky top-0" style={{ color: '#8892a4', backgroundColor: '#0d0f18cc' }}>
                  {column.name}
                </div>
                {colTasks.map((task) => (
                  <button
                    key={task.id}
                    className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 transition-colors hover:bg-white/5"
                    onClick={() => { onUpdate({ taskId: task.id }); setShowLinkDropdown(false) }}
                  >
                    <span className={`shrink-0 text-[8px] font-bold px-1 py-px rounded ${PRIORITY_CONFIG[task.priority].bg} ${PRIORITY_CONFIG[task.priority].color}`}>
                      {PRIORITY_CONFIG[task.priority].label[0]}
                    </span>
                    <span className="text-[11px] text-[#e2e8f0] truncate">{task.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
