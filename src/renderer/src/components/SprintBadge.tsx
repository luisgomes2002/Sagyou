import { useState, useRef, useEffect } from 'react'
import type { Sprint } from '../types'

interface Props {
  projectId: string
  sprints: Sprint[]
  sprintFilter: string | null
  onSetFilter: (sprintId: string | null) => void
  onCreateSprints: (projectId: string, names: string[]) => void
  onRenameSprint: (sprintId: string, name: string) => boolean
  onCloseSprint: (sprintId: string) => void
  onReopenSprint: (sprintId: string) => void
  onDeleteSprint: (sprintId: string) => void
}

export function SprintBadge({
  projectId,
  sprints,
  sprintFilter,
  onSetFilter,
  onCreateSprints,
  onRenameSprint,
  onCloseSprint,
  onReopenSprint,
  onDeleteSprint
}: Props) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const projectSprints = sprints.filter((s) => s.projectId === projectId)
  const activeSprints = projectSprints.filter((s) => !s.closedAt)
  const closedSprints = projectSprints.filter((s) => s.closedAt)
  const selectedSprint = projectSprints.find((s) => s.id === sprintFilter)

  useEffect(() => {
    if (creating && textareaRef.current) textareaRef.current.focus()
  }, [creating])

  useEffect(() => {
    if (renamingId && renameInputRef.current) renameInputRef.current.focus()
  }, [renamingId])

  const handleCreateBatch = () => {
    const names = batchText.split('\n').map((n) => n.trim()).filter(Boolean)
    if (names.length === 0) return
    onCreateSprints(projectId, names)
    setBatchText('')
    setCreating(false)
  }

  const startRename = (sprint: Sprint) => {
    setRenameValue(sprint.name)
    setRenamingId(sprint.id)
    setRenameError(false)
  }

  const commitRename = () => {
    if (!renamingId) return
    if (!renameValue.trim()) { cancelRename(); return }
    const ok = onRenameSprint(renamingId, renameValue)
    if (!ok) { setRenameError(true); return }
    setRenamingId(null)
    setRenameError(false)
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
    setRenameError(false)
  }

  const existingNames = new Set(projectSprints.map((s) => s.name.toLowerCase()))
  const batchLines = batchText.split('\n').map((n) => n.trim()).filter(Boolean)
  const batchCount = batchLines.length
  const newCount = batchLines.filter((n) => !existingNames.has(n.toLowerCase())).length
  const dupCount = batchCount - newCount

  const buttonLabel = selectedSprint
    ? selectedSprint.name
    : projectSprints.length > 0
    ? 'Todas'
    : 'Sprints'

  const isFiltered = sprintFilter !== null && selectedSprint !== undefined

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
          isFiltered
            ? 'bg-[#6366f1]/15 text-[#a5b4fc] border-[#6366f1]/30 hover:bg-[#6366f1]/25'
            : 'bg-[#1e2235] text-[#8892a4] border-[#2a2d42] hover:border-[#3a3e58] hover:text-[#e2e8f0]'
        }`}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
        {buttonLabel}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setCreating(false); setBatchText(''); cancelRename() }} />
          <div className="absolute right-0 top-9 z-20 w-64 rounded-lg border border-[#2a2d42] bg-[#0d0f18] shadow-xl py-1">

            {/* ── Filtro ── */}
            {projectSprints.length > 0 && (
              <>
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">
                  Filtrar por sprint
                </p>
                <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => { onSetFilter(null); setOpen(false) }}
                    className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
                      sprintFilter === null
                        ? 'bg-[#6366f1]/20 text-[#a5b4fc] border-[#6366f1]/40'
                        : 'bg-[#1e2235] text-[#8892a4] border-[#2a2d42] hover:text-[#e2e8f0]'
                    }`}
                  >
                    Todas
                  </button>
                  {projectSprints.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { onSetFilter(s.id); setOpen(false) }}
                      className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors flex items-center gap-1 ${
                        sprintFilter === s.id
                          ? 'bg-[#6366f1]/20 text-[#a5b4fc] border-[#6366f1]/40'
                          : 'bg-[#1e2235] text-[#8892a4] border-[#2a2d42] hover:text-[#e2e8f0]'
                      }`}
                    >
                      <span className={`w-1 h-1 rounded-full ${s.closedAt ? 'bg-[#8892a4]' : 'bg-[#6366f1]'}`} />
                      {s.name}
                    </button>
                  ))}
                </div>
                <div className="border-t border-[#2a2d42] my-1" />
              </>
            )}

            {/* ── Criar sprints ── */}
            {!creating ? (
              <button
                onClick={() => setCreating(true)}
                className="w-full text-left px-3 py-2 text-sm text-[#6366f1] hover:bg-[#1e2235] transition-colors flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Criar sprints
              </button>
            ) : (
              <div className="px-3 py-2">
                <p className="text-[10px] text-[#8892a4] mb-1.5">Um nome por linha:</p>
                <textarea
                  ref={textareaRef}
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setCreating(false); setBatchText('') }
                  }}
                  placeholder={'Sprint 1\nSprint 2\nv1.0'}
                  rows={4}
                  className="w-full px-2 py-1.5 rounded-md border border-[#2a2d42] bg-[#13151f] text-xs text-[#e2e8f0] placeholder-[#8892a4]/50 focus:outline-none focus:border-[#6366f1] transition-colors resize-none font-mono"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleCreateBatch}
                    disabled={newCount === 0}
                    className="flex-1 py-1.5 rounded-md bg-[#6366f1] text-xs text-white disabled:opacity-40 hover:bg-[#5254c5] transition-colors"
                  >
                    {newCount > 0 ? `Criar ${newCount} sprint${newCount > 1 ? 's' : ''}` : 'Criar'}
                  </button>
                  <button
                    onClick={() => { setCreating(false); setBatchText('') }}
                    className="px-3 py-1.5 rounded-md border border-[#2a2d42] text-xs text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
                  >
                    ✕
                  </button>
                </div>
                {dupCount > 0 && (
                  <p className="text-[10px] text-[#f97316] mt-1.5">
                    {dupCount} nome{dupCount > 1 ? 's' : ''} já existe{dupCount === 1 ? '' : 'm'} neste projeto e {dupCount > 1 ? 'serão ignorados' : 'será ignorado'}.
                  </p>
                )}
              </div>
            )}

            {/* ── Gerenciar ── */}
            {(activeSprints.length > 0 || closedSprints.length > 0) && (
              <>
                <div className="border-t border-[#2a2d42] my-1" />
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">
                  Gerenciar
                </p>

                {activeSprints.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-3 py-1.5 group/row">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#6366f1] shrink-0" />
                      {renamingId === s.id ? (
                        <div className="flex-1 min-w-0">
                          <input
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={(e) => { setRenameValue(e.target.value); setRenameError(false) }}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename()
                              if (e.key === 'Escape') cancelRename()
                            }}
                            className={`w-full bg-[#13151f] text-xs text-[#e2e8f0] rounded px-1.5 py-0.5 focus:outline-none border ${
                              renameError ? 'border-red-500' : 'border-[#6366f1]'
                            }`}
                          />
                          {renameError && (
                            <p className="text-[9px] text-red-400 mt-0.5">Nome já existe</p>
                          )}
                        </div>
                      ) : (
                        <>
                          <span className="text-xs text-[#e2e8f0] truncate">{s.name}</span>
                          <span className="text-[9px] text-[#6366f1] shrink-0">ativa</span>
                          <button
                            onClick={() => startRename(s)}
                            className="opacity-0 group-hover/row:opacity-100 transition-opacity p-0.5 rounded hover:bg-[#1e2235] text-[#8892a4] hover:text-[#e2e8f0] shrink-0"
                            title="Renomear sprint"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                    {renamingId !== s.id && (
                      <button
                        onClick={() => { onCloseSprint(s.id); setOpen(false) }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[#2a2d42] text-[#8892a4] hover:text-[#e2e8f0] transition-colors shrink-0 ml-2"
                      >
                        Encerrar
                      </button>
                    )}
                  </div>
                ))}

                {closedSprints.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-3 py-1.5 group/row">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#2a2d42] shrink-0" />
                      {renamingId === s.id ? (
                        <div className="flex-1 min-w-0">
                          <input
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={(e) => { setRenameValue(e.target.value); setRenameError(false) }}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename()
                              if (e.key === 'Escape') cancelRename()
                            }}
                            className={`w-full bg-[#13151f] text-xs text-[#e2e8f0] rounded px-1.5 py-0.5 focus:outline-none border ${
                              renameError ? 'border-red-500' : 'border-[#6366f1]'
                            }`}
                          />
                          {renameError && (
                            <p className="text-[9px] text-red-400 mt-0.5">Nome já existe</p>
                          )}
                        </div>
                      ) : (
                        <>
                          <span className="text-xs text-[#8892a4] truncate">{s.name}</span>
                          <button
                            onClick={() => startRename(s)}
                            className="opacity-0 group-hover/row:opacity-100 transition-opacity p-0.5 rounded hover:bg-[#1e2235] text-[#8892a4] hover:text-[#e2e8f0] shrink-0"
                            title="Renomear sprint"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                    {renamingId !== s.id && (
                      <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-all shrink-0 ml-2">
                        <button
                          onClick={() => onReopenSprint(s.id)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-[#2a2d42] text-[#8892a4] hover:text-[#6366f1] hover:bg-[#6366f1]/10 transition-colors"
                          title="Reabrir sprint"
                        >
                          Reabrir
                        </button>
                        <button
                          onClick={() => onDeleteSprint(s.id)}
                          className="text-[#8892a4] hover:text-red-400 transition-colors p-0.5"
                          title="Deletar sprint"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
