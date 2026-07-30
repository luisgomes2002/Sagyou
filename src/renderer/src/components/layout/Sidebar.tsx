import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Project } from '../../types'
import { useAiRunStore } from '../../store/aiRun'

type ActiveView =
  | 'home'
  | 'board'
  | 'canvas'
  | 'done'
  | 'goals'
  | 'habits'
  | 'financial'
  | 'upcoming'
  | 'reports'
  | 'files'
  | 'ai'
  | 'memory'
  | 'agents'
  | 'planejamento'
  | 'graph'

interface Props {
  projects: Project[]
  activeProjectId: string | null
  activeView: ActiveView
  onSelectProject: (id: string) => void
  onChangeView: (view: ActiveView) => void
  onOpenSearch: () => void
  onNewProject: () => void
  onEditProject: (project: Project) => void
  onMoveProject: (id: string, direction: 'up' | 'down') => void
  onDeleteProject: (project: Project) => void
  onArchiveProject: (id: string) => void
  onUnarchiveProject: (id: string) => void
  onExportBackup: () => void
  onImportBackup: () => void
  onImportAI: () => void
  onExportExcel: () => void
  codeAgentRunCount?: number
}

interface NavItem {
  view: ActiveView
  label: string
  icon: React.ReactNode
  accent?: 'purple' | 'green'
}

export function Sidebar({
  projects,
  activeProjectId,
  activeView,
  onSelectProject,
  onChangeView,
  onOpenSearch,
  onNewProject,
  onEditProject,
  onMoveProject,
  onDeleteProject,
  onArchiveProject,
  onUnarchiveProject,
  onExportBackup,
  onImportBackup,
  onImportAI,
  onExportExcel,
  codeAgentRunCount = 0
}: Props) {
  const runningCount = useAiRunStore((s) => s.running.size)
  const [menuOpen, setMenuOpen] = useState(false)
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null)
  const [projectMenuPos, setProjectMenuPos] = useState<{
    right: number
    top?: number
    bottom?: number
  }>({ top: 0, right: 0 })
  const jsonInfoRef = useRef<HTMLButtonElement>(null)
  const [showJsonExample, setShowJsonExample] = useState(false)
  const [jsonExamplePos, setJsonExamplePos] = useState({ top: 0, left: 0 })
  const [jsonCopied, setJsonCopied] = useState(false)

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [showArchived, setShowArchived] = useState(false)

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const isCollapsed = (key: string) => collapsedSections[key] ?? false

  const sortedProjects = [...projects].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const activeProjects = sortedProjects.filter((p) => !p.archivedAt)
  const archivedProjects = sortedProjects.filter((p) => p.archivedAt)

  const JSON_EXAMPLE = `{
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
}`

  const handleToggleJsonExample = () => {
    if (showJsonExample) { setShowJsonExample(false); return }
    const rect = jsonInfoRef.current?.getBoundingClientRect()
    if (rect) setJsonExamplePos({ top: rect.bottom + 8, left: Math.max(8, rect.left - 200) })
    setShowJsonExample(true)
  }
  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON_EXAMPLE)
    setJsonCopied(true)
    setTimeout(() => setJsonCopied(false), 2000)
  }
  const handleOpenProjectMenu = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation()
    if (projectMenuId === projectId) {
      setProjectMenuId(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const project = projects.find((p) => p.id === projectId)
    const itemCount = project?.archivedAt ? 3 : 5
    const estimatedHeight = itemCount * 36 + 10
    const spaceBelow = window.innerHeight - rect.bottom - 4
    const pos: { right: number; top?: number; bottom?: number } = {
      right: window.innerWidth - rect.right
    }
    if (spaceBelow >= estimatedHeight) {
      pos.top = rect.bottom + 4
    } else {
      pos.bottom = window.innerHeight - rect.top + 4
    }
    setProjectMenuPos(pos)
    setProjectMenuId(projectId)
  }

  const isActive = (view: ActiveView) => activeView === view

  const SectionHeader = ({ label, sectionKey }: { label: string; sectionKey: string }) => {
    const collapsed = isCollapsed(sectionKey)
    return (
      <button
        onClick={() => toggleSection(sectionKey)}
        className="flex items-center gap-1 w-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#666666] hover:text-[#999999] transition-colors text-left"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`transition-transform shrink-0 ${collapsed ? '' : 'rotate-90'}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {label}
      </button>
    )
  }

  const navigationItems: NavItem[] = [
    {
      view: 'home',
      label: 'Início',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      )
    },
    {
      view: 'board',
      label: 'Board',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="3" width="7" height="18" rx="1" />
          <rect x="14" y="3" width="7" height="11" rx="1" />
          <rect x="14" y="18" width="7" height="3" rx="1" />
        </svg>
      )
    },
    {
      view: 'upcoming',
      label: 'Próximas',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )
    },
    {
      view: 'done',
      label: 'Concluídas',
      accent: 'green',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )
    }
  ]

  const toolItems: NavItem[] = [
    {
      view: 'goals',
      label: 'Metas',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      )
    },
    {
      view: 'habits',
      label: 'Hábitos',
      accent: 'green',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      )
    },
    {
      view: 'financial',
      label: 'Financeiro',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      )
    },
    {
      view: 'planejamento',
      label: 'Planejamento',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <line x1="8" y1="14" x2="8" y2="18" strokeWidth="2.5" />
          <line x1="12" y1="14" x2="12" y2="18" strokeWidth="2.5" />
          <line x1="16" y1="14" x2="16" y2="18" strokeWidth="2.5" />
        </svg>
      )
    },
    {
      view: 'reports',
      label: 'Relatórios',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      )
    },
    {
      view: 'canvas',
      label: 'Canvas',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      )
    },
    {
      view: 'files',
      label: 'Arquivos',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      )
    },
    {
      view: 'graph',
      label: 'Grafo',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="3" />
          <circle cx="4" cy="7" r="2" />
          <circle cx="20" cy="7" r="2" />
          <circle cx="4" cy="17" r="2" />
          <circle cx="20" cy="17" r="2" />
          <line x1="7" y1="7" x2="9" y2="12" />
          <line x1="17" y1="7" x2="15" y2="12" />
          <line x1="7" y1="17" x2="9" y2="12" />
          <line x1="17" y1="17" x2="15" y2="12" />
        </svg>
      )
    }
  ]

  const aiItems: NavItem[] = [
    {
      view: 'ai',
      label: 'Chat',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )
    },
    {
      view: 'memory',
      label: 'Memória',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 2a5 5 0 0 0-5 5v1a4 4 0 0 0-2 7 4 4 0 0 0 4 5 3 3 0 0 0 3-3V7a5 5 0 0 0 0 0Z" />
          <path d="M12 2a5 5 0 0 1 5 5v1a4 4 0 0 1 2 7 4 4 0 0 1-4 5 3 3 0 0 1-3-3" />
        </svg>
      )
    },
    {
      view: 'agents',
      label: 'Agentes',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
        </svg>
      )
    }
  ]

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.view)
    const accentBg = item.accent === 'green' ? '#20b858/12' : '#7c3aed/12'
    const accentText = item.accent === 'green' ? '#46d478' : '#a080f0'
    return (
      <button
        key={item.view}
        onClick={() => onChangeView(item.view)}
        className={`flex items-center gap-2.5 w-full px-3 py-[5px] rounded text-[13px] font-normal transition-colors text-left ${
          active
            ? `bg-[${accentBg}] text-[${accentText}]`
            : 'text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a]'
        }`}
      >
        {item.icon}
        <span className="flex-1 truncate">{item.label}</span>
        {item.view === 'agents' && (runningCount + codeAgentRunCount) > 0 && (
          <span className="min-w-[18px] h-[18px] px-1.5 inline-flex items-center justify-center rounded-full bg-[#7c3aed] text-[10px] font-semibold text-white tabular-nums">
            {runningCount + codeAgentRunCount}
          </span>
        )}
      </button>
    )
  }

  return (
    <aside className="flex flex-col w-56 shrink-0 h-full bg-[#232323] border-r border-[#3b3b3b]">
      {/* logo */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#3b3b3b]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-[#7c3aed] flex items-center justify-center">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
            >
              <rect x="3" y="3" width="7" height="18" rx="1" />
              <rect x="14" y="3" width="7" height="11" rx="1" />
              <rect x="14" y="18" width="7" height="3" rx="1" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-[#d4d4d4]">Sagyou</span>
        </div>

        {/* import/export menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
            title="Opções"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="1" fill="currentColor" />
              <circle cx="19" cy="12" r="1" fill="currentColor" />
              <circle cx="5" cy="12" r="1" fill="currentColor" />
            </svg>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 top-8 z-20 w-44 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] shadow-xl py-1">
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                  Backup
                </p>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors flex items-center gap-2"
                  onClick={() => {
                    setMenuOpen(false)
                    onExportBackup()
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Exportar backup
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#46d478] hover:bg-[#2a2a2a] transition-colors flex items-center gap-2"
                  onClick={() => {
                    setMenuOpen(false)
                    onExportExcel()
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  Exportar Excel
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors flex items-center gap-2"
                  onClick={() => {
                    setMenuOpen(false)
                    onImportBackup()
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 5 17 10" />
                    <line x1="12" y1="5" x2="12" y2="17" />
                  </svg>
                  Importar backup
                </button>
                <div className="border-t border-[#3b3b3b] my-1" />
                <div className="flex items-center justify-between px-3 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
                    JSON
                  </p>
                  <button
                    ref={jsonInfoRef}
                    className={`transition-colors ${showJsonExample ? 'text-[#7c3aed]' : 'text-[#999999] hover:text-[#7c3aed]'}`}
                    title="Ver exemplo de JSON"
                    onClick={handleToggleJsonExample}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </button>
                </div>
                <button
                  className="w-full text-left px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors flex items-center gap-2"
                  onClick={() => {
                    setMenuOpen(false)
                    setShowJsonExample(false)
                    onImportAI()
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Importar JSON
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Search */}
      <button
        onClick={onOpenSearch}
        className="flex items-center gap-2 mx-3 my-2 px-3 py-1.5 rounded-md bg-[#1b1b1b] border border-[#3b3b3b] text-[#999999] text-xs hover:border-[#7c3aed]/40 hover:text-[#d4d4d4] transition-colors w-[calc(100%-1.5rem)]"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <span className="flex-1 text-left">Buscar...</span>
        <kbd className="text-[9px] px-1 py-0.5 rounded bg-[#2a2a2a] border border-[#3b3b3b] font-sans">
          Ctrl K
        </kbd>
      </button>

      {/* Navigation sections */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Navegação */}
        <SectionHeader label="Navegação" sectionKey="nav" />
        {!isCollapsed('nav') && (
          <div className="px-2 pb-1 space-y-0.5">
            {navigationItems.map(renderNavItem)}
          </div>
        )}

        {/* Ferramentas */}
        <SectionHeader label="Ferramentas" sectionKey="tools" />
        {!isCollapsed('tools') && (
          <div className="px-2 pb-1 space-y-0.5">
            {toolItems.map(renderNavItem)}
          </div>
        )}

        {/* IA */}
        <SectionHeader label="IA" sectionKey="ai" />
        {!isCollapsed('ai') && (
          <div className="px-2 pb-1 space-y-0.5">
            {aiItems.map(renderNavItem)}
          </div>
        )}

        {/* project list */}
        <div className="mt-1">
          <SectionHeader label="Projetos" sectionKey="projects" />
          {!isCollapsed('projects') && (
            <div className="px-2 pb-1">
              {activeProjects.length === 0 && archivedProjects.length === 0 && (
                <p className="px-3 py-1 text-xs text-[#999999] italic">Nenhum projeto ainda</p>
              )}
              {activeProjects.map((project) => (
                <div key={project.id} className="relative group">
                  <button
                    onClick={() => onSelectProject(project.id)}
                    className={`flex items-center gap-2.5 w-full px-3 py-[5px] rounded text-[13px] transition-colors text-left ${
                      activeProjectId === project.id
                        ? 'bg-[#7c3aed]/12 text-[#a080f0]'
                        : 'text-[#999999] hover:bg-[#2a2a2a] hover:text-[#d4d4d4]'
                    }`}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="truncate flex-1">{project.name}</span>
                  </button>

                  <div
                    className={`absolute right-2 top-1/2 -translate-y-1/2 transition-opacity ${projectMenuId === project.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                  >
                    <button
                      onClick={(e) => handleOpenProjectMenu(e, project.id)}
                      className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#3b3b3b] transition-colors"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="5" r="1" fill="currentColor" />
                        <circle cx="12" cy="12" r="1" fill="currentColor" />
                        <circle cx="12" cy="19" r="1" fill="currentColor" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}

              {archivedProjects.length > 0 && (
                <>
                  <button
                    onClick={() => setShowArchived((v) => !v)}
                    className="flex items-center gap-2 w-full px-3 py-[5px] rounded text-xs text-[#666666] hover:text-[#999999] hover:bg-[#2a2a2a] transition-colors mt-1"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`transition-transform ${showArchived ? 'rotate-90' : ''}`}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span>
                      {showArchived ? 'Ocultar arquivados' : `Ver arquivados (${archivedProjects.length})`}
                    </span>
                  </button>
                  {showArchived &&
                    archivedProjects.map((project) => (
                      <div key={project.id} className="relative group">
                        <button
                          onClick={() => onSelectProject(project.id)}
                          className={`flex items-center gap-2.5 w-full px-3 py-[5px] rounded text-[13px] transition-colors text-left opacity-60 hover:opacity-90 ${
                            activeProjectId === project.id
                              ? 'bg-[#7c3aed]/12 text-[#a080f0]'
                              : 'text-[#999999] hover:bg-[#2a2a2a] hover:text-[#d4d4d4]'
                          }`}
                        >
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0 opacity-50"
                            style={{ backgroundColor: project.color }}
                          />
                          <span className="truncate flex-1">{project.name}</span>
                        </button>

                        <div
                          className={`absolute right-2 top-1/2 -translate-y-1/2 transition-opacity ${projectMenuId === project.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                        >
                          <button
                            onClick={(e) => handleOpenProjectMenu(e, project.id)}
                            className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#3b3b3b] transition-colors"
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <circle cx="12" cy="5" r="1" fill="currentColor" />
                              <circle cx="12" cy="12" r="1" fill="currentColor" />
                              <circle cx="12" cy="19" r="1" fill="currentColor" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* JSON example portal */}
      {showJsonExample &&
        createPortal(
          <>
            <div className="fixed inset-0 z-50" onClick={() => setShowJsonExample(false)} />
            <div
              className="fixed z-50 w-96 rounded-xl border border-[#3b3b3b] bg-[#1b1b1b] shadow-2xl"
              style={{ top: jsonExamplePos.top, left: jsonExamplePos.left }}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#3b3b3b]">
                <span className="text-xs font-semibold text-[#7c3aed] uppercase tracking-wider">
                  Formato esperado: JSON
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyJson}
                    className="flex items-center gap-1 text-[10px] text-[#999999] hover:text-[#d4d4d4] transition-colors"
                    title="Copiar tudo"
                  >
                    {jsonCopied ? (
                      <>
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span className="text-[#7c3aed]">Copiado</span>
                      </>
                    ) : (
                      <>
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        <span>Copiar tudo</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setShowJsonExample(false)}
                    className="text-[#999999] hover:text-[#d4d4d4] transition-colors"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-4">
                <pre className="text-[11px] text-[#a080f0] leading-relaxed font-mono bg-[#232323] rounded-lg p-3 border border-[#3b3b3b] overflow-x-auto">{`{
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
                  <p className="text-[10px] text-[#999999]">
                    <span className="text-[#d4d4d4]">priority</span>:{' '}
                    <span className="text-[#a080f0]">low</span> ·{' '}
                    <span className="text-[#a080f0]">medium</span> ·{' '}
                    <span className="text-[#a080f0]">high</span> ·{' '}
                    <span className="text-[#a080f0]">urgent</span>
                  </p>
                  <p className="text-[10px] text-[#999999]">
                    <span className="text-[#d4d4d4]">column</span>: nome exato da coluna no projeto
                    (ex: <span className="text-[#a080f0]">"In Progress"</span>)
                  </p>
                  <p className="text-[10px] text-[#999999]">
                    <span className="text-[#d4d4d4]">sprint</span>: nome exato da sprint (ex:{' '}
                    <span className="text-[#a080f0]">"Sprint 1"</span>). Opcional.
                  </p>
                  <p className="text-[10px] text-[#999999]">
                    <span className="text-[#d4d4d4]">dueDate</span>: formato{' '}
                    <span className="text-[#a080f0]">YYYY-MM-DD</span>. Opcional.
                  </p>
                  <p className="text-[10px] text-[#999999]">
                    <span className="text-[#d4d4d4]">tags</span>: incluídas no "Copiar tudo" por
                    área (Dev, Estudo, Trabalho, Saúde, Casa & Vida, Finanças, Pessoal)
                  </p>
                </div>
              </div>
            </div>
          </>,
          document.body
        )}

      {/* project context menu portal */}
      {projectMenuId &&
        createPortal(
          <>
            <div className="fixed inset-0 z-50" onClick={() => setProjectMenuId(null)} />
            <div
              className="fixed z-50 w-36 rounded-lg border border-[#3b3b3b] bg-[#232323] shadow-xl py-1"
              style={{
                top: projectMenuPos.top,
                bottom: projectMenuPos.bottom,
                right: projectMenuPos.right
              }}
            >
              {(() => {
                const project = projects.find((p) => p.id === projectMenuId)
                if (!project) return null
                const isArchived = !!project.archivedAt
                const idx = sortedProjects.findIndex((p) => p.id === projectMenuId)
                return (
                  <div>
                    <button
                      className="w-full text-left px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
                      onClick={() => {
                        setProjectMenuId(null)
                        onEditProject(project)
                      }}
                    >
                      Editar
                    </button>
                    {!isArchived && (
                      <>
                        <button
                          disabled={idx === 0}
                          className="w-full text-left px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          onClick={() => {
                            onMoveProject(project.id, 'up')
                            setProjectMenuId(null)
                          }}
                        >
                          Mover para cima
                        </button>
                        <button
                          disabled={idx === sortedProjects.length - 1}
                          className="w-full text-left px-3 py-2 text-sm text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          onClick={() => {
                            onMoveProject(project.id, 'down')
                            setProjectMenuId(null)
                          }}
                        >
                          Mover para baixo
                        </button>
                      </>
                    )}
                    {!isArchived ? (
                      <button
                        className="w-full text-left px-3 py-2 text-sm text-[#e0a040] hover:bg-[#e0a040]/10 transition-colors"
                        onClick={() => {
                          setProjectMenuId(null)
                          onArchiveProject(project.id)
                        }}
                      >
                        Arquivar
                      </button>
                    ) : (
                      <button
                        className="w-full text-left px-3 py-2 text-sm text-[#46d478] hover:bg-[#46d478]/10 transition-colors"
                        onClick={() => {
                          setProjectMenuId(null)
                          onUnarchiveProject(project.id)
                        }}
                      >
                        Desarquivar
                      </button>
                    )}
                    <button
                      className="w-full text-left px-3 py-2 text-sm text-[#e04040] hover:bg-[#e04040]/10 transition-colors"
                      onClick={() => {
                        setProjectMenuId(null)
                        onDeleteProject(project)
                      }}
                    >
                      Deletar
                    </button>
                  </div>
                )
              })()}
            </div>
          </>,
          document.body
        )}

      {/* new project button */}
      <div className="p-3 border-t border-[#3b3b3b]">
        <button
          onClick={onNewProject}
          className="w-full flex items-center justify-center gap-2 py-2 rounded text-[13px] text-[#7c3aed] border border-[#7c3aed]/25 hover:bg-[#7c3aed]/8 transition-colors font-normal"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Novo projeto
        </button>
      </div>
    </aside>
  )
}
