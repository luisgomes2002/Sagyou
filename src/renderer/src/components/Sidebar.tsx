import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Project } from '../types'

interface Props {
  projects: Project[]
  activeProjectId: string | null
  activeView: 'board' | 'done'
  onSelectProject: (id: string) => void
  onChangeView: (view: 'board' | 'done') => void
  onNewProject: () => void
  onEditProject: (project: Project) => void
  onDeleteProject: (project: Project) => void
  onExportBackup: () => void
  onImportBackup: () => void
  onImportAI: () => void
}

export function Sidebar({
  projects,
  activeProjectId,
  activeView,
  onSelectProject,
  onChangeView,
  onNewProject,
  onEditProject,
  onDeleteProject,
  onExportBackup,
  onImportBackup,
  onImportAI
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null)
  const [projectMenuPos, setProjectMenuPos] = useState({ top: 0, right: 0 })
  const [showJsonExample, setShowJsonExample] = useState(false)
  const [jsonExamplePos, setJsonExamplePos] = useState({ top: 0, left: 0 })
  const jsonInfoRef = useRef<HTMLButtonElement>(null)

  const handleToggleJsonExample = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!showJsonExample && jsonInfoRef.current) {
      const rect = jsonInfoRef.current.getBoundingClientRect()
      setJsonExamplePos({ top: rect.top, left: rect.right + 8 })
    }
    setShowJsonExample((v) => !v)
  }

  const handleOpenProjectMenu = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    if (projectMenuId === projectId) {
      setProjectMenuId(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setProjectMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setProjectMenuId(projectId)
  }

  return (
    <aside className="flex flex-col w-56 shrink-0 h-full bg-[#13151f] border-r border-[#2a2d42]">
      {/* logo */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-[#2a2d42]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#6366f1] flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="18" rx="1" />
              <rect x="14" y="3" width="7" height="11" rx="1" />
              <rect x="14" y="18" width="7" height="3" rx="1" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-[#e2e8f0]">Sagyou</span>
        </div>

        {/* import/export menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
            title="Opções"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="1" fill="currentColor" />
              <circle cx="19" cy="12" r="1" fill="currentColor" />
              <circle cx="5" cy="12" r="1" fill="currentColor" />
            </svg>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 top-8 z-20 w-44 rounded-lg border border-[#2a2d42] bg-[#0d0f18] shadow-xl py-1">
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">
                  Backup
                </p>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2235] transition-colors flex items-center gap-2"
                  onClick={() => { setMenuOpen(false); onExportBackup() }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Exportar backup
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2235] transition-colors flex items-center gap-2"
                  onClick={() => { setMenuOpen(false); onImportBackup() }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 5 17 10" />
                    <line x1="12" y1="5" x2="12" y2="17" />
                  </svg>
                  Importar backup
                </button>
                <div className="border-t border-[#2a2d42] my-1" />
                <div className="flex items-center justify-between px-3 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">
                    JSON
                  </p>
                  <button
                    ref={jsonInfoRef}
                    className={`transition-colors ${showJsonExample ? 'text-[#6366f1]' : 'text-[#8892a4] hover:text-[#6366f1]'}`}
                    title="Ver exemplo de JSON"
                    onClick={handleToggleJsonExample}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </button>
                </div>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2235] transition-colors flex items-center gap-2"
                  onClick={() => { setMenuOpen(false); setShowJsonExample(false); onImportAI() }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Importar JSON
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* view nav */}
      <div className="flex gap-1 px-3 py-2 border-b border-[#2a2d42]">
        <button
          onClick={() => onChangeView('board')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeView === 'board'
              ? 'bg-[#6366f1]/15 text-[#a5b4fc]'
              : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="18" rx="1" />
            <rect x="14" y="3" width="7" height="11" rx="1" />
          </svg>
          Board
        </button>
        <button
          onClick={() => onChangeView('done')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeView === 'done'
              ? 'bg-[#22c55e]/15 text-[#4ade80]'
              : 'text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235]'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Concluídas
        </button>
      </div>

      {/* project list */}
      <div className="flex-1 overflow-y-auto py-2">
        <p className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">
          Projetos
        </p>
        {projects.length === 0 && (
          <p className="px-4 text-xs text-[#8892a4] italic">Nenhum projeto ainda</p>
        )}
        {projects.map((project) => (
          <div key={project.id} className="relative group">
            <button
              onClick={() => onSelectProject(project.id)}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors text-left ${
                activeProjectId === project.id
                  ? 'bg-[#6366f1]/15 text-[#e2e8f0]'
                  : 'text-[#8892a4] hover:bg-[#1e2235] hover:text-[#e2e8f0]'
              }`}
            >
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: project.color }}
              />
              <span className="truncate flex-1">{project.name}</span>
            </button>

            <div className={`absolute right-2 top-1/2 -translate-y-1/2 transition-opacity ${projectMenuId === project.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              <button
                onClick={(e) => handleOpenProjectMenu(e, project.id)}
                className="p-1 rounded text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#2a2d42] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="5" r="1" fill="currentColor" />
                  <circle cx="12" cy="12" r="1" fill="currentColor" />
                  <circle cx="12" cy="19" r="1" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* JSON example portal */}
      {showJsonExample && createPortal(
        <>
          <div className="fixed inset-0 z-50" onClick={() => setShowJsonExample(false)} />
          <div
            className="fixed z-50 w-96 rounded-xl border border-[#2a2d42] bg-[#0d0f18] shadow-2xl"
            style={{ top: jsonExamplePos.top, left: jsonExamplePos.left }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2d42]">
              <span className="text-xs font-semibold text-[#6366f1] uppercase tracking-wider">Formato esperado — JSON</span>
              <button
                onClick={() => setShowJsonExample(false)}
                className="text-[#8892a4] hover:text-[#e2e8f0] transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <pre className="text-[11px] text-[#a5b4fc] leading-relaxed font-mono bg-[#13151f] rounded-lg p-3 border border-[#2a2d42] overflow-x-auto">{`{
  "tasks": [
    {
      "title": "Implementar login",
      "description": "Tela de autenticação com JWT.",
      "priority": "high",
      "dueDate": "2026-07-15",
      "tags": ["auth", "frontend"],
      "column": "In Progress",
      "sprint": "Sprint 1"
    },
    {
      "title": "Criar testes unitários",
      "priority": "medium",
      "tags": ["testes"],
      "column": "Backlog"
    }
  ]
}`}</pre>
              <div className="mt-3 space-y-1.5">
                <p className="text-[10px] text-[#8892a4]">
                  <span className="text-[#e2e8f0]">priority</span> — <span className="text-[#a5b4fc]">low</span> · <span className="text-[#a5b4fc]">medium</span> · <span className="text-[#a5b4fc]">high</span> · <span className="text-[#a5b4fc]">urgent</span>
                </p>
                <p className="text-[10px] text-[#8892a4]">
                  <span className="text-[#e2e8f0]">column</span> — nome exato da coluna no projeto (ex: <span className="text-[#a5b4fc]">"In Progress"</span>)
                </p>
                <p className="text-[10px] text-[#8892a4]">
                  <span className="text-[#e2e8f0]">sprint</span> — nome exato da sprint (ex: <span className="text-[#a5b4fc]">"Sprint 1"</span>). Opcional.
                </p>
                <p className="text-[10px] text-[#8892a4]">
                  <span className="text-[#e2e8f0]">dueDate</span> — formato <span className="text-[#a5b4fc]">YYYY-MM-DD</span>. Opcional.
                </p>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* project context menu portal */}
      {projectMenuId && createPortal(
        <>
          <div className="fixed inset-0 z-50" onClick={() => setProjectMenuId(null)} />
          <div
            className="fixed z-50 w-36 rounded-lg border border-[#2a2d42] bg-[#13151f] shadow-xl py-1"
            style={{ top: projectMenuPos.top, right: projectMenuPos.right }}
          >
            {projects.filter((p) => p.id === projectMenuId).map((project) => (
              <div key={project.id}>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
                  onClick={() => { setProjectMenuId(null); onEditProject(project) }}
                >
                  Editar
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 transition-colors"
                  onClick={() => { setProjectMenuId(null); onDeleteProject(project) }}
                >
                  Deletar
                </button>
              </div>
            ))}
          </div>
        </>,
        document.body
      )}

      {/* new project button */}
      <div className="p-3 border-t border-[#2a2d42]">
        <button
          onClick={onNewProject}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm text-[#6366f1] border border-[#6366f1]/30 hover:bg-[#6366f1]/10 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Novo projeto
        </button>
      </div>
    </aside>
  )
}
