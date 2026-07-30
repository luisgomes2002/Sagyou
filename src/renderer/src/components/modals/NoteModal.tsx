import { useState, useMemo, useEffect } from 'react'
import { useKanbanStore } from '../../store/kanban'
import { NOTE_COLORS, PRIORITY_CONFIG, type StickyNote, type Task } from '../../types'

interface Props {
  note: StickyNote
  onSave: (updates: {
    content: string
    color: string
    taskIds: string[]
    connections: string[]
    goalIds: string[]
    completedAt?: string
  }) => void
  onClose: () => void
}

export function NoteModal({ note, onSave, onClose }: Props) {
  const projects = useKanbanStore((s) => s.projects)
  const allTasks = useKanbanStore((s) => s.tasks)
  const allNotes = useKanbanStore((s) => s.notes)
  const allGoals = useKanbanStore((s) => s.goals)

  const [content, setContent] = useState(note.content)
  const [color, setColor] = useState(note.color)
  const [taskIds, setTaskIds] = useState<string[]>(note.taskIds ?? (note.taskId ? [note.taskId] : []))
  const [connections, setConnections] = useState<string[]>(note.connections ?? [])
  const [goalIds, setGoalIds] = useState<string[]>(note.goalIds ?? [])
  const [completed, setCompleted] = useState(!!note.completedAt)

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [openDropdown, setOpenDropdown] = useState<'task' | 'note' | 'goal' | null>(null)
  const [ddSearch, setDdSearch] = useState('')

  const activeProjects = useMemo(() => projects.filter((p) => !p.archivedAt), [projects])

  const linkedTasks = taskIds.map((tid) => allTasks.find((t) => t.id === tid)).filter(Boolean) as Task[]
  const connectedNotes = allNotes.filter((n) => connections.includes(n.id))
  const connectedGoals = allGoals.filter((g) => goalIds.includes(g.id))

  const ddSearchL = ddSearch.toLowerCase()
  const availTasks = useMemo(() => {
    return allTasks.filter((t) => {
      if (taskIds.includes(t.id)) return false
      const proj = activeProjects.find((p) => p.id === t.projectId)
      if (!proj) return false
      const doneCol = proj.columns.find((c) => c.name.toLowerCase() === 'done')
      if (doneCol && doneCol.id === t.columnId) return false
      if (ddSearchL && !t.title.toLowerCase().includes(ddSearchL)) return false
      return true
    }).slice(0, 25)
  }, [allTasks, taskIds, activeProjects, ddSearchL])

  const availNotes = useMemo(() => {
    return allNotes.filter((n) => {
      if (n.id === note.id || n.completedAt || connections.includes(n.id)) return false
      if (ddSearchL) {
        const txt = n.content.replace(/<[^>]+>/g, '').toLowerCase()
        if (!txt.includes(ddSearchL)) return false
      }
      return true
    }).slice(0, 25)
  }, [allNotes, note.id, connections, ddSearchL])

  const availGoals = useMemo(() => {
    return allGoals.filter((g) => {
      if (goalIds.includes(g.id)) return false
      if (ddSearchL && !g.title.toLowerCase().includes(ddSearchL)) return false
      return true
    }).slice(0, 25)
  }, [allGoals, goalIds, ddSearchL])

  // Close dropdown on Escape
  useEffect(() => {
    if (!openDropdown) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenDropdown(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [openDropdown])

  const doSave = () => {
    onSave({
      content,
      color,
      taskIds,
      connections,
      goalIds,
      completedAt: completed ? note.completedAt || new Date().toISOString() : undefined
    })
  }

  const doClose = () => {
    doSave()
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-9 z-50 flex bg-[#0d0d0d] text-[#d4d4d4]">
      {/* Main editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#232323] bg-[#0d0d0d] shrink-0">
          <button
            type="button"
            onClick={doSave}
            className="px-3 py-1 rounded-md bg-[#7c3aed] text-[11px] font-medium hover:bg-[#6d28d9]"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={doClose}
            className="px-3 py-1 rounded-md border border-[#333] text-[11px] text-[#888] hover:text-white hover:bg-white/5"
          >
            Salvar e fechar
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-2 rounded text-[#888] hover:text-white hover:bg-white/10"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-full min-h-[300px] bg-transparent outline-none text-[15px] leading-relaxed text-[#d4d4d4] resize-none"
            placeholder="Escreva o conteúdo da nota..."
            style={{
              textDecoration: completed ? 'line-through' : undefined,
              opacity: completed ? 0.55 : 1
            }}
          />
        </div>

        {/* Bottom bar */}
        <div className="flex items-center gap-3 px-3 py-2 border-t border-[#232323] shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={completed} onChange={(e) => setCompleted(e.target.checked)} className="w-3.5 h-3.5 rounded accent-[#7c3aed]" />
            <span className="text-[10px] text-[#888]">Concluída</span>
          </label>
          <div className="w-px h-4 bg-[#2a2a2a]" />
          <span className="text-[10px] text-[#555]">Cor:</span>
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="w-5 h-5 rounded-full transition-transform hover:scale-110"
              style={{
                backgroundColor: c,
                boxShadow: color === c ? `0 0 0 2px #0d0d0d, 0 0 0 3px ${c}` : 'none'
              }}
            />
          ))}
        </div>
      </div>

      {/* Sidebar toggle */}
      <button
        type="button"
        onClick={() => setSidebarOpen((v) => !v)}
        className="shrink-0 w-6 bg-[#1a1a1a] border-x border-[#2a2a2a] text-[#666] hover:text-[#999] flex items-center justify-center"
        style={{ opacity: sidebarOpen ? 0 : undefined }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
      </button>

      {/* Sidebar */}
      {sidebarOpen && (
        <div className="w-72 shrink-0 border-l border-[#232323] bg-[#0d0d0d] flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-[#232323] flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#555]">Conexões</span>
            <button type="button" onClick={() => setSidebarOpen(false)} className="p-0.5 rounded text-[#555] hover:text-[#999] hover:bg-white/5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
            {/* Tasks */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#555]">Tasks ({taskIds.length})</span>
              </div>
              {linkedTasks.map((t) => {
                const proj = projects.find((p) => p.id === t.projectId)
                return (
                  <div key={t.id} className="flex items-center gap-1.5 px-2 py-1 mb-1 rounded-md bg-[#141414] border border-[#232323]">
                    <span className="shrink-0 text-[9px]" style={{ color: PRIORITY_CONFIG[t.priority].color }}>⬤</span>
                    <span className="text-[11px] text-[#ccc] truncate flex-1">{t.title}</span>
                    {proj && <span className="text-[9px] text-[#555] shrink-0">{proj.name}</span>}
                    <button
                      type="button"
                      onClick={() => setTaskIds((prev) => prev.filter((id) => id !== t.id))}
                      className="p-0.5 rounded hover:bg-red-500/20 hover:text-red-400"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                )
              })}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { setOpenDropdown(openDropdown === 'task' ? null : 'task'); setDdSearch('') }}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md border border-[#232323] text-[11px] text-[#666] hover:text-[#999] hover:bg-white/[0.02]"
                >
                  Vincular task... <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {openDropdown === 'task' && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-[#2a2a2a] bg-[#141414] shadow-xl z-30 max-h-52 flex flex-col">
                    <div className="p-1.5 border-b border-[#1a1a1a]">
                      <input
                        type="text" value={ddSearch} onChange={(e) => setDdSearch(e.target.value)}
                        placeholder="Filtrar..." autoFocus
                        className="w-full px-2 py-1 rounded text-[11px] outline-none bg-[#0d0d0d] border border-[#232323] text-[#ccc] placeholder-[#555]"
                      />
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {availTasks.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-[#555]">Nenhum resultado</p>
                      ) : availTasks.map((t) => {
                        const proj = activeProjects.find((p) => p.id === t.projectId)
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => { setTaskIds((prev) => [...prev, t.id]); setOpenDropdown(null) }}
                            className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 hover:bg-white/5"
                          >
                            <span className="text-[9px]" style={{ color: PRIORITY_CONFIG[t.priority].color }}>⬤</span>
                            <span className="text-[11px] text-[#ccc] truncate flex-1">{t.title}</span>
                            {proj && <span className="text-[9px] text-[#555] shrink-0">{proj.name}</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="border-t border-[#1a1a1a] pt-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#555]">Notas ({connections.length})</span>
              {connectedNotes.map((cn) => (
                <div key={cn.id} className="flex items-center gap-1.5 px-2 py-1 mt-1 rounded-md bg-[#141414] border border-[#232323]">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cn.color }} />
                  <span className="text-[11px] text-[#ccc] truncate flex-1">{cn.content.replace(/<[^>]+>/g, '').slice(0, 25) || 'Nota'}</span>
                  <button type="button" onClick={() => setConnections((prev) => prev.filter((id) => id !== cn.id))} className="p-0.5 rounded hover:bg-red-500/20 hover:text-red-400">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}
              <div className="relative mt-1">
                <button type="button" onClick={() => { setOpenDropdown(openDropdown === 'note' ? null : 'note'); setDdSearch('') }} className="w-full flex items-center justify-between px-2 py-1.5 rounded-md border border-[#232323] text-[11px] text-[#666] hover:text-[#999] hover:bg-white/[0.02]">
                  Conectar nota... <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {openDropdown === 'note' && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-[#2a2a2a] bg-[#141414] shadow-xl z-30 max-h-52 flex flex-col">
                    <div className="p-1.5 border-b border-[#1a1a1a]">
                      <input type="text" value={ddSearch} onChange={(e) => setDdSearch(e.target.value)} placeholder="Filtrar..." autoFocus className="w-full px-2 py-1 rounded text-[11px] outline-none bg-[#0d0d0d] border border-[#232323] text-[#ccc] placeholder-[#555]" />
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {availNotes.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-[#555]">Nenhum resultado</p>
                      ) : availNotes.map((fn) => (
                        <button key={fn.id} type="button" onClick={() => { setConnections((prev) => [...prev, fn.id]); setOpenDropdown(null) }} className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 hover:bg-white/5">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: fn.color }} />
                          <span className="text-[11px] text-[#ccc] truncate">{fn.content.replace(/<[^>]+>/g, '').slice(0, 30) || 'Nota'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Goals */}
            <div className="border-t border-[#1a1a1a] pt-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#555]">Metas ({goalIds.length})</span>
              {connectedGoals.map((cg) => (
                <div key={cg.id} className="flex items-center gap-1.5 px-2 py-1 mt-1 rounded-md bg-[#141414] border border-[#232323]">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cg.color }} />
                  <span className="text-[11px] text-[#ccc] truncate flex-1">{cg.title}</span>
                  <span className="text-[9px] text-[#555]">{cg.target} {cg.unit}</span>
                  <button type="button" onClick={() => setGoalIds((prev) => prev.filter((id) => id !== cg.id))} className="p-0.5 rounded hover:bg-red-500/20 hover:text-red-400">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}
              <div className="relative mt-1">
                <button type="button" onClick={() => { setOpenDropdown(openDropdown === 'goal' ? null : 'goal'); setDdSearch('') }} className="w-full flex items-center justify-between px-2 py-1.5 rounded-md border border-[#232323] text-[11px] text-[#666] hover:text-[#999] hover:bg-white/[0.02]">
                  Vincular meta... <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {openDropdown === 'goal' && (
                  <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-[#2a2a2a] bg-[#141414] shadow-xl z-30 max-h-52 flex flex-col">
                    <div className="p-1.5 border-b border-[#1a1a1a]">
                      <input type="text" value={ddSearch} onChange={(e) => setDdSearch(e.target.value)} placeholder="Filtrar..." autoFocus className="w-full px-2 py-1 rounded text-[11px] outline-none bg-[#0d0d0d] border border-[#232323] text-[#ccc] placeholder-[#555]" />
                    </div>
                    <div className="overflow-y-auto flex-1">
                      {availGoals.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] text-[#555]">Nenhum resultado</p>
                      ) : availGoals.map((g) => (
                        <button key={g.id} type="button" onClick={() => { setGoalIds((prev) => [...prev, g.id]); setOpenDropdown(null) }} className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 hover:bg-white/5">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                          <span className="text-[11px] text-[#ccc]">{g.title}</span>
                          <span className="text-[9px] text-[#555]">{g.target} {g.unit}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
