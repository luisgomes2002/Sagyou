import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import type { Project, Task } from '../types'
import { NOTE_COLORS } from '../types'
import { useKanbanStore } from '../store/kanban'
import { StickyNoteCard } from './StickyNoteCard'
import { ConfirmDialog } from './ConfirmDialog'

const MIN_SCALE = 0.2
const MAX_SCALE = 3
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

interface Point {
  x: number
  y: number
}

// Point on the border of a rectangle (centered at c, size w×h) in the direction of `toward`
function borderPoint(c: Point, w: number, h: number, toward: Point): Point {
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return { x: c.x, y: c.y }
  const sx = dx !== 0 ? w / 2 / Math.abs(dx) : Infinity
  const sy = dy !== 0 ? h / 2 / Math.abs(dy) : Infinity
  const s = Math.min(sx, sy)
  return { x: c.x + dx * s, y: c.y + dy * s }
}

interface Props {
  project: Project
  tasks: Task[]
  onCreateTask: (title: string, noteId: string) => void
}

export function CanvasView({ project, tasks, onCreateTask }: Props) {
  const allNotes = useKanbanStore((s) => s.notes)
  const notes = useMemo(() => allNotes.filter((n) => n.projectId === project.id), [allNotes, project.id])
  const createNote = useKanbanStore((s) => s.createNote)
  const updateNote = useKanbanStore((s) => s.updateNote)
  const deleteNote = useKanbanStore((s) => s.deleteNote)
  const connectNotes = useKanbanStore((s) => s.connectNotes)
  const disconnectNotes = useKanbanStore((s) => s.disconnectNotes)

  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes])

  // Live positions during note drag — so connection lines follow smoothly
  const [livePositions, setLivePositions] = useState<Record<string, Point>>({})
  // Active connection being drawn from a note's anchor toward the cursor
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [connectCursor, setConnectCursor] = useState<Point | null>(null)
  const connectFromRef = useRef<string | null>(null)
  // Note pending deletion (shows confirmation popup)
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null)

  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const [selectedColor, setSelectedColor] = useState<string>(NOTE_COLORS[0])
  const [isPanning, setIsPanning] = useState(false)
  const [mode, setMode] = useState<'note' | 'text'>('note')

  const containerRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(scale)
  const offsetRef = useRef(offset)
  const panStartRef = useRef({ x: 0, y: 0 })
  const isPanningRef = useRef(false)

  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { offsetRef.current = offset }, [offset])

  // Non-passive wheel listener — required because React registers wheel as passive by default
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      const current = scaleRef.current
      const next = clamp(current * factor, MIN_SCALE, MAX_SCALE)
      const ratio = next / current
      setOffset((prev) => ({
        x: mouseX - ratio * (mouseX - prev.x),
        y: mouseY - ratio * (mouseY - prev.y)
      }))
      setScale(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Global pan move/up
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isPanningRef.current) return
      setOffset({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y
      })
    }
    const onUp = () => {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      setIsPanning(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // Track live positions while a note is dragged (for connection lines)
  const handleNoteDragMove = useCallback((id: string, x: number, y: number) => {
    setLivePositions((prev) => ({ ...prev, [id]: { x, y } }))
  }, [])
  const handleNoteDragEnd = useCallback((id: string) => {
    setLivePositions((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const startConnect = useCallback((id: string) => {
    connectFromRef.current = id
    setConnectFrom(id)
    setConnectCursor(null)
  }, [])

  // Drive the in-progress connection: follow cursor, resolve target on release
  useEffect(() => {
    if (!connectFrom) return
    const onMove = (e: MouseEvent) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setConnectCursor({
        x: (e.clientX - rect.left - offsetRef.current.x) / scaleRef.current,
        y: (e.clientY - rect.top - offsetRef.current.y) / scaleRef.current
      })
    }
    const onUp = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const targetEl = el?.closest('[data-note-id]') as HTMLElement | null
      const targetId = targetEl?.dataset.noteId
      const fromId = connectFromRef.current
      if (fromId && targetId && targetId !== fromId) connectNotes(fromId, targetId)
      connectFromRef.current = null
      setConnectFrom(null)
      setConnectCursor(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [connectFrom, connectNotes])

  const posOf = useCallback(
    (n: { id: string; x: number; y: number }): Point => livePositions[n.id] ?? { x: n.x, y: n.y },
    [livePositions]
  )

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-note]')) return
    isPanningRef.current = true
    setIsPanning(true)
    panStartRef.current = {
      x: e.clientX - offsetRef.current.x,
      y: e.clientY - offsetRef.current.y
    }
  }, [])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-note]')) return
    const rect = containerRef.current!.getBoundingClientRect()
    const x = (e.clientX - rect.left - offsetRef.current.x) / scaleRef.current - 100
    const y = (e.clientY - rect.top - offsetRef.current.y) / scaleRef.current - 30
    if (mode === 'text') {
      createNote(project.id, { type: 'text', color: 'transparent', x, y, width: 480, height: 60 })
    } else {
      createNote(project.id, { color: selectedColor, x, y: y - 45 })
    }
  }, [selectedColor, mode, createNote, project.id])

  const handleZoomIn = () => setScale((s) => clamp(s * 1.25, MIN_SCALE, MAX_SCALE))
  const handleZoomOut = () => setScale((s) => clamp(s / 1.25, MIN_SCALE, MAX_SCALE))
  const handleResetView = () => { setOffset({ x: 0, y: 0 }); setScale(1) }

  const dotSpacing = 24 * scale

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden select-none"
      style={{
        backgroundColor: '#0d0f18',
        backgroundImage: 'radial-gradient(circle, #2a2d42 1px, transparent 1px)',
        backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
        backgroundPosition: `${offset.x % dotSpacing}px ${offset.y % dotSpacing}px`,
        cursor: connectFrom ? 'crosshair' : isPanning ? 'grabbing' : 'default'
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* Transformed canvas layer */}
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
      >
        {/* Connection layer (behind notes) */}
        <svg
          className="absolute top-0 left-0"
          width={1}
          height={1}
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          <defs>
            <marker
              id="note-arrow"
              viewBox="0 0 10 10"
              refX={8}
              refY={5}
              markerWidth={6}
              markerHeight={6}
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#818cf8" />
            </marker>
          </defs>

          {notes.flatMap((from) =>
            (from.connections ?? []).map((toId) => {
              const to = noteById.get(toId)
              if (!to) return null
              const f = posOf(from)
              const t = posOf(to)
              const fc = { x: f.x + from.width / 2, y: f.y + from.height / 2 }
              const tc = { x: t.x + to.width / 2, y: t.y + to.height / 2 }
              const start = borderPoint(fc, from.width, from.height, tc)
              const end = borderPoint(tc, to.width, to.height, fc)
              return (
                <g key={`${from.id}->${toId}`} className="group/conn">
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    className="stroke-[#6366f1] group-hover/conn:stroke-[#818cf8]"
                    strokeWidth={2}
                    markerEnd="url(#note-arrow)"
                    style={{ pointerEvents: 'none' }}
                  />
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke="transparent"
                    strokeWidth={14}
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onClick={() => disconnectNotes(from.id, toId)}
                  >
                    <title>Clique para remover a conexão</title>
                  </line>
                </g>
              )
            })
          )}

          {/* In-progress connection line */}
          {connectFrom && connectCursor && (() => {
            const from = noteById.get(connectFrom)
            if (!from) return null
            const f = posOf(from)
            const fc = { x: f.x + from.width / 2, y: f.y + from.height / 2 }
            const start = borderPoint(fc, from.width, from.height, connectCursor)
            return (
              <line
                x1={start.x}
                y1={start.y}
                x2={connectCursor.x}
                y2={connectCursor.y}
                stroke="#818cf8"
                strokeWidth={2}
                strokeDasharray="6 4"
                markerEnd="url(#note-arrow)"
                style={{ pointerEvents: 'none' }}
              />
            )
          })()}
        </svg>

        {notes.map((note) => (
          <StickyNoteCard
            key={note.id}
            note={note}
            scale={scale}
            tasks={tasks}
            columns={project.columns}
            onUpdate={(updates) => updateNote(note.id, updates)}
            onDelete={() => setNoteToDelete(note.id)}
            onCreateTask={(title) => onCreateTask(title, note.id)}
            onStartConnect={() => startConnect(note.id)}
            onDragMove={handleNoteDragMove}
            onDragEnd={handleNoteDragEnd}
          />
        ))}
      </div>

      {/* Empty state */}
      {notes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4a5068" strokeWidth="1.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <p className="text-[#4a5068] text-sm">
            {mode === 'text' ? 'Duplo clique para inserir texto' : 'Duplo clique para criar uma nota'}
          </p>
        </div>
      )}

      {/* Floating toolbar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1a1d2e]/95 border border-[#2a2d42] shadow-2xl backdrop-blur-sm pointer-events-auto">

        {/* Mode: sticky note */}
        <button
          onClick={() => setMode('note')}
          className={`p-1.5 rounded-lg transition-colors ${mode === 'note' ? 'bg-[#6366f1]/20 text-[#818cf8]' : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#2a2d42]'}`}
          title="Modo nota (duplo clique)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </button>

        {/* Mode: text */}
        <button
          onClick={() => setMode('text')}
          className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-colors ${mode === 'text' ? 'bg-[#6366f1]/20 text-[#818cf8]' : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#2a2d42]'}`}
          title="Modo texto (duplo clique)"
        >
          Aa
        </button>

        {/* Color swatches — only in note mode */}
        {mode === 'note' && (
          <>
            <div className="w-px h-4 bg-[#2a2d42] mx-0.5 shrink-0" />
            <div className="grid grid-cols-6 gap-1">
              {NOTE_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className="w-4 h-4 rounded-full transition-transform hover:scale-110 shrink-0"
                  style={{
                    backgroundColor: color,
                    boxShadow: selectedColor === color
                      ? `0 0 0 2px #0d0f18, 0 0 0 3.5px ${color}`
                      : '0 0 0 1px rgba(255,255,255,0.1)'
                  }}
                  title={color}
                />
              ))}
            </div>
          </>
        )}

        <div className="w-px h-4 bg-[#2a2d42] mx-0.5 shrink-0" />

        {/* Zoom out */}
        <button
          onClick={handleZoomOut}
          className="p-1.5 rounded-lg text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#2a2d42] transition-colors"
          title="Diminuir zoom (scroll)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        <span className="text-[11px] text-[#8892a4] w-10 text-center tabular-nums font-mono shrink-0">
          {Math.round(scale * 100)}%
        </span>

        {/* Zoom in */}
        <button
          onClick={handleZoomIn}
          className="p-1.5 rounded-lg text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#2a2d42] transition-colors"
          title="Aumentar zoom (scroll)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>

        <div className="w-px h-4 bg-[#2a2d42] mx-0.5 shrink-0" />

        {/* Reset / center view */}
        <button
          onClick={handleResetView}
          className="p-1.5 rounded-lg text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#2a2d42] transition-colors"
          title="Centralizar (100%)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={noteToDelete !== null}
        title="Deletar nota"
        message="Tem certeza que deseja deletar esta nota? As conexões ligadas a ela também serão removidas."
        confirmLabel="Deletar"
        onConfirm={() => { if (noteToDelete) deleteNote(noteToDelete); setNoteToDelete(null) }}
        onCancel={() => setNoteToDelete(null)}
      />
    </div>
  )
}
