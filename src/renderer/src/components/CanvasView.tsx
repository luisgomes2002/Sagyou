import { useRef, useState, useCallback, useEffect } from 'react'
import type { Project, Task } from '../types'
import { NOTE_COLORS } from '../types'
import { useKanbanStore } from '../store/kanban'
import { StickyNoteCard } from './StickyNoteCard'

const MIN_SCALE = 0.2
const MAX_SCALE = 3
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

interface Props {
  project: Project
  tasks: Task[]
  onCreateTask: (title: string) => void
}

export function CanvasView({ project, tasks, onCreateTask }: Props) {
  const notes = useKanbanStore((s) => s.notes.filter((n) => n.projectId === project.id))
  const createNote = useKanbanStore((s) => s.createNote)
  const updateNote = useKanbanStore((s) => s.updateNote)
  const deleteNote = useKanbanStore((s) => s.deleteNote)

  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const [selectedColor, setSelectedColor] = useState<string>(NOTE_COLORS[0])
  const [isPanning, setIsPanning] = useState(false)

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
    const y = (e.clientY - rect.top - offsetRef.current.y) / scaleRef.current - 75
    createNote(project.id, { color: selectedColor, x, y })
  }, [selectedColor, createNote, project.id])

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
        cursor: isPanning ? 'grabbing' : 'default'
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* Transformed canvas layer */}
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
      >
        {notes.map((note) => (
          <StickyNoteCard
            key={note.id}
            note={note}
            scale={scale}
            tasks={tasks}
            columns={project.columns}
            onUpdate={(updates) => updateNote(note.id, updates)}
            onDelete={() => deleteNote(note.id)}
            onCreateTask={onCreateTask}
          />
        ))}
      </div>

      {/* Empty state */}
      {notes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4a5068" strokeWidth="1.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <p className="text-[#4a5068] text-sm">Duplo clique para criar uma nota</p>
        </div>
      )}

      {/* Floating toolbar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1a1d2e]/95 border border-[#2a2d42] shadow-2xl backdrop-blur-sm pointer-events-auto">
        {/* Color swatches */}
        {NOTE_COLORS.map((color) => (
          <button
            key={color}
            onClick={() => setSelectedColor(color)}
            className="w-5 h-5 rounded-full transition-transform hover:scale-110 shrink-0"
            style={{
              backgroundColor: color,
              boxShadow: selectedColor === color
                ? `0 0 0 2px #0d0f18, 0 0 0 3.5px ${color}`
                : '0 0 0 1px rgba(255,255,255,0.1)'
            }}
            title={color}
          />
        ))}

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
    </div>
  )
}
