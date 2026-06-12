import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useKanbanStore } from '../store/kanban'
import type { Task, StickyNote } from '../types'
import { PRIORITY_CONFIG } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onSelectTask: (task: Task) => void
  onSelectNote: (note: StickyNote) => void
}

export function SearchModal({ open, onClose, onSelectTask, onSelectNote }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const projects = useKanbanStore((s) => s.projects)
  const tasks = useKanbanStore((s) => s.tasks)
  const notes = useKanbanStore((s) => s.notes)

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  useEffect(() => {
    if (open) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const q = query.toLowerCase().trim()

  const matchedTasks = useMemo(() => {
    if (!q) return []
    return tasks
      .filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      )
      .slice(0, 10)
  }, [tasks, q])

  const matchedNotes = useMemo(() => {
    if (!q) return []
    return notes.filter((n) => n.content.toLowerCase().includes(q)).slice(0, 5)
  }, [notes, q])

  const hasResults = matchedTasks.length > 0 || matchedNotes.length > 0

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-xl border border-[#2a2d42] bg-[#13151f] shadow-2xl overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2d42]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8892a4" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
            placeholder="Buscar tasks e notas..."
            className="flex-1 bg-transparent text-sm text-[#e2e8f0] placeholder-[#8892a4] outline-none"
          />
          <kbd className="text-[10px] text-[#8892a4] px-1.5 py-0.5 rounded bg-[#0d0f18] border border-[#2a2d42] shrink-0">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[420px] overflow-y-auto">
          {!q && (
            <p className="px-4 py-8 text-center text-sm text-[#8892a4]">
              Digite para buscar tasks e notas...
            </p>
          )}
          {q && !hasResults && (
            <p className="px-4 py-8 text-center text-sm text-[#8892a4]">
              Nenhum resultado para &ldquo;{query}&rdquo;
            </p>
          )}

          {matchedTasks.length > 0 && (
            <div>
              <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">
                Tasks
              </p>
              {matchedTasks.map((task) => {
                const project = projectMap.get(task.projectId)
                const col = project?.columns.find((c) => c.id === task.columnId)
                const isDone = col?.name.toLowerCase() === 'done'
                return (
                  <button
                    key={task.id}
                    onClick={() => { onSelectTask(task); onClose() }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#1e2235] transition-colors text-left"
                  >
                    {project && (
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: project.color, opacity: isDone ? 0.4 : 1 }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${isDone ? 'text-[#8892a4] line-through' : 'text-[#e2e8f0]'}`}>
                        {task.title}
                      </p>
                      <p className="text-[11px] text-[#8892a4] truncate mt-0.5">
                        {project?.name} · {col?.name}
                      </p>
                    </div>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${PRIORITY_CONFIG[task.priority].bg} ${PRIORITY_CONFIG[task.priority].color}`}
                    >
                      {PRIORITY_CONFIG[task.priority].label[0]}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {matchedNotes.length > 0 && (
            <div>
              <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">
                Notas do Canvas
              </p>
              {matchedNotes.map((note) => {
                const project = projectMap.get(note.projectId)
                return (
                  <button
                    key={note.id}
                    onClick={() => { onSelectNote(note); onClose() }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#1e2235] transition-colors text-left"
                  >
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: note.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#e2e8f0] truncate">
                        {note.content || '(sem conteúdo)'}
                      </p>
                      <p className="text-[11px] text-[#8892a4]">{project?.name} · Canvas</p>
                    </div>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8892a4" strokeWidth="2" className="shrink-0">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </button>
                )
              })}
            </div>
          )}

          {hasResults && (
            <p className="px-4 py-2 text-[10px] text-[#8892a4] border-t border-[#2a2d42]">
              ↵ para abrir · Esc para fechar
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
