import { useEffect, useState, useCallback, useMemo } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useKanbanStore } from './store/kanban'
import type { Task, Column, Project, Priority, TaskImage } from './types'
import { isDoneColumn, isTaskDone } from './utils/columns'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Board } from './components/Board'
import { CanvasView } from './components/CanvasView'
import { DoneView } from './components/DoneView'
import { GoalView } from './components/GoalView'
import { HabitView } from './components/HabitView'
import { FinancialView } from './components/FinancialView'
import { UpcomingView } from './components/UpcomingView'
import { ReportsView } from './components/ReportsView'
import { FilesView } from './components/FilesView'
import { ExcelExportModal } from './components/ExcelExportModal'
import { ProjectLinksDropdown } from './components/ProjectLinksDropdown'
import { SearchModal } from './components/SearchModal'
import { SprintBadge } from './components/SprintBadge'
import { TaskModal } from './components/TaskModal'
import { ProjectModal } from './components/ProjectModal'
import { ColumnModal } from './components/ColumnModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { TaskViewModal } from './components/TaskViewModal'
import { ToastContainer, type ToastMessage } from './components/Toast'

interface TaskModalState {
  open: boolean
  task?: Task
  columnId?: string
  defaultTitle?: string
  linkNoteId?: string
}

interface ProjectModalState {
  open: boolean
  project?: Project
}

interface ColumnModalState {
  open: boolean
  column?: Column
}

interface ConfirmState {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
}

export default function App() {
  const {
    projects,
    tasks,
    sprints,
    activeProjectId,
    sprintFilter,
    isLoaded,
    loadData,
    setActiveProject,
    setSprintFilter,
    createProject,
    updateProject,
    moveProject,
    deleteProject,
    createColumn,
    updateColumn,
    deleteColumn,
    createTask,
    updateTask,
    deleteTask,
    moveTask,
    updateNote,
    createSprints,
    updateSprint,
    closeSprint,
    reopenSprint,
    deleteSprint,
    habits,
    goals,
    notes,
    lists,
    exportBackup,
    importBackup,
    importAIJson
  } = useKanbanStore()

  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [taskModal, setTaskModal] = useState<TaskModalState>({ open: false })
  const [viewTask, setViewTask] = useState<Task | null>(null)
  const [projectModal, setProjectModal] = useState<ProjectModalState>({ open: false })
  const [columnModal, setColumnModal] = useState<ColumnModalState>({ open: false })
  const [activeView, setActiveView] = useState<'board' | 'canvas' | 'done' | 'goals' | 'habits' | 'financial' | 'upcoming' | 'reports' | 'files'>('board')
  const [searchOpen, setSearchOpen] = useState(false)
  const [excelExportOpen, setExcelExportOpen] = useState(false)
  // session-only: maps projectId → active linkIds (not persisted — each machine picks its own)
  const [activeLinkIds, setActiveLinkIds] = useState<Record<string, string[]>>({})
  const [confirm, setConfirm] = useState<ConfirmState>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {}
  })

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const addToast = useCallback((message: string, type: ToastMessage['type'] = 'success') => {
    setToasts((prev) => [...prev, { id: uuidv4(), message, type }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  )

  const activeProjectSprints = useMemo(
    () => sprints.filter((s) => s.projectId === activeProjectId),
    [sprints, activeProjectId]
  )

  const projectTasks = useMemo(() =>
    tasks.filter((t) => {
      if (t.projectId !== activeProjectId) return false
      if (sprintFilter !== null) return t.sprintId === sprintFilter
      return true
    }),
    [tasks, activeProjectId, sprintFilter]
  )

  // Per-project: done column + first active column (pre-sorted), shared by complete/restore handlers
  const projectColumnInfo = useMemo(() => {
    const map = new Map<string, { doneCol: Column | undefined; firstCol: Column | undefined }>()
    for (const p of projects) {
      const sorted = [...p.columns].sort((a, b) => a.order - b.order)
      map.set(p.id, {
        doneCol: sorted.find(isDoneColumn),
        firstCol: sorted.find((c) => !isDoneColumn(c))
      })
    }
    return map
  }, [projects])

  // Task count per column — O(1) lookup for move-to-end positioning
  const columnTaskCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tasks) map.set(t.columnId, (map.get(t.columnId) ?? 0) + 1)
    return map
  }, [tasks])

  // --- Project handlers ---
  const handleNewProject = () => setProjectModal({ open: true })
  const handleEditProject = (project: Project) => setProjectModal({ open: true, project })

  const handleSaveProject = (name: string, description: string, color: string, links: import('./types').ProjectLink[]) => {
    if (projectModal.project) {
      updateProject(projectModal.project.id, { name, description, color, links })
      addToast('Projeto atualizado')
    } else {
      createProject(name, description, color)
      addToast('Projeto criado')
    }
    setProjectModal({ open: false })
  }

  const handleDeleteProject = (project: Project) => {
    setConfirm({
      open: true,
      title: 'Deletar projeto',
      message: `Isso vai deletar o projeto "${project.name}" e todas as suas tasks permanentemente.`,
      onConfirm: () => {
        deleteProject(project.id)
        setConfirm((c) => ({ ...c, open: false }))
        addToast('Projeto deletado', 'info')
      }
    })
  }

  // --- Column handlers ---
  const handleAddColumn = () => setColumnModal({ open: true })
  const handleEditColumn = (column: Column) => setColumnModal({ open: true, column })

  const handleSaveColumn = (name: string, color: string | undefined) => {
    if (!activeProjectId) return
    if (columnModal.column) {
      updateColumn(activeProjectId, columnModal.column.id, { name, color })
      addToast('Coluna renomeada')
    } else {
      createColumn(activeProjectId, name, color)
      addToast('Coluna criada')
    }
    setColumnModal({ open: false })
  }

  const handleDeleteColumn = (column: Column) => {
    setConfirm({
      open: true,
      title: 'Deletar coluna',
      message: `Isso vai deletar a coluna "${column.name}" e todas as tasks dentro dela.`,
      onConfirm: () => {
        if (!activeProjectId) return
        deleteColumn(activeProjectId, column.id)
        setConfirm((c) => ({ ...c, open: false }))
        addToast('Coluna deletada', 'info')
      }
    })
  }

  // --- Task handlers ---
  const handleViewTask = (task: Task) => setViewTask(task)

  const handleSearchSelectTask = (task: Task) => {
    setActiveProject(task.projectId)
    setActiveView('board')
    setSprintFilter(null)
    setViewTask(task)
  }

  const handleSearchSelectNote = (note: { projectId: string }) => {
    setActiveProject(note.projectId)
    setActiveView('canvas')
    setSprintFilter(null)
  }
  const handleAddTask = (columnId: string) => setTaskModal({ open: true, columnId })
  const handleEditTask = (task: Task) => setTaskModal({ open: true, task })
  const handleCreateTaskFromCanvas = (title: string, noteId: string) => {
    const firstCol = activeProject?.columns
      .slice()
      .sort((a, b) => a.order - b.order)
      .find((c) => !isDoneColumn(c))
    setTaskModal({ open: true, columnId: firstCol?.id, defaultTitle: title, linkNoteId: noteId })
  }

  const handleSaveTask = (data: {
    title: string
    description: string
    priority: Priority
    dueDate: string
    tags: string[]
    columnId: string
    sprintId: string
    images: TaskImage[]
  }) => {
    const { sprintId, ...rest } = data
    if (taskModal.task) {
      updateTask(taskModal.task.id, { ...rest, sprintId: sprintId || undefined })
      addToast('Task atualizada')
    } else if (activeProjectId) {
      const newTaskId = createTask({ ...rest, projectId: activeProjectId, sprintId: sprintId || undefined })
      if (taskModal.linkNoteId) updateNote(taskModal.linkNoteId, { taskId: newTaskId })
      addToast('Task criada')
    }
    setTaskModal({ open: false })
  }

  const handleDeleteTask = (task: Task) => {
    setConfirm({
      open: true,
      title: 'Deletar task',
      message: `Deletar "${task.title}"?`,
      onConfirm: () => {
        deleteTask(task.id)
        setConfirm((c) => ({ ...c, open: false }))
        addToast('Task deletada', 'info')
      }
    })
  }

  const handleCompleteTask = (task: Task) => {
    const { doneCol } = projectColumnInfo.get(task.projectId) ?? {}
    if (!doneCol) { addToast('Coluna "Done" não encontrada', 'error'); return }
    moveTask(task.id, doneCol.id, columnTaskCount.get(doneCol.id) ?? 0)
    addToast('Task concluída')
  }

  const handleRestoreTask = (task: Task) => {
    const { firstCol } = projectColumnInfo.get(task.projectId) ?? {}
    if (!firstCol) return
    moveTask(task.id, firstCol.id, columnTaskCount.get(firstCol.id) ?? 0)
    addToast('Task restaurada')
  }

  // --- Import/Export ---
  const handleExportBackup = async () => {
    const ok = await exportBackup()
    if (ok) addToast('Backup exportado com sucesso')
  }

  const handleImportBackup = () => {
    setConfirm({
      open: true,
      title: 'Importar backup',
      message: 'Isso vai substituir TODOS os dados atuais pelo backup. Esta ação não pode ser desfeita.',
      onConfirm: async () => {
        setConfirm((c) => ({ ...c, open: false }))
        const ok = await importBackup()
        if (ok) addToast('Backup importado com sucesso')
        else addToast('Importação cancelada', 'info')
      }
    })
  }

  const handleImportAI = async () => {
    if (!activeProjectId) { addToast('Selecione um projeto primeiro', 'error'); return }
    const count = await importAIJson(activeProjectId)
    if (count > 0) {
      addToast(`${count} task${count > 1 ? 's' : ''} importada${count > 1 ? 's' : ''} com sucesso`)
    } else {
      addToast('Importação cancelada ou arquivo inválido', 'info')
    }
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0d0f18]">
        <div className="w-6 h-6 rounded-full border-2 border-[#6366f1] border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0d0f18]">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          projects={projects}
          activeProjectId={activeProjectId}
          activeView={activeView}
          onSelectProject={(id) => { setActiveProject(id); if (activeView !== 'board' && activeView !== 'canvas' && activeView !== 'files') setActiveView('board'); setSprintFilter(null) }}
          onChangeView={setActiveView}
          onOpenSearch={() => setSearchOpen(true)}
          onNewProject={handleNewProject}
          onEditProject={handleEditProject}
          onMoveProject={moveProject}
          onDeleteProject={handleDeleteProject}
          onExportBackup={handleExportBackup}
          onImportBackup={handleImportBackup}
          onImportAI={handleImportAI}
          onExportExcel={() => setExcelExportOpen(true)}
        />

        <main className="flex-1 flex flex-col overflow-hidden">
          {activeView === 'reports' ? (
            <ReportsView projects={projects} tasks={tasks} sprints={sprints} habits={habits} />
          ) : activeView === 'upcoming' ? (
            <UpcomingView
              projects={projects}
              tasks={tasks}
              onViewTask={handleViewTask}
            />
          ) : activeView === 'financial' ? (
            <FinancialView />
          ) : activeView === 'habits' ? (
            <HabitView />
          ) : activeView === 'goals' ? (
            <GoalView projects={projects} />
          ) : activeView === 'done' ? (
            <>
              <div className="flex items-center gap-3 px-6 py-4 border-b border-[#2a2d42] shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <h1 className="text-base font-semibold text-[#e2e8f0]">Concluídas</h1>
                <span className="text-xs text-[#8892a4]">
                  {tasks.filter((t) => isTaskDone(t, projects)).length} tasks
                </span>
              </div>
              <DoneView
                projects={projects}
                tasks={tasks}
                sprints={sprints}
                sprintFilter={sprintFilter}
                onViewTask={handleViewTask}
                onRestoreTask={handleRestoreTask}
                onDeleteTask={handleDeleteTask}
              />
            </>
          ) : activeProject ? (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex items-center gap-3 px-6 py-4 border-b border-[#2a2d42] shrink-0">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: activeProject.color }} />
                <h1 className="text-base font-semibold text-[#e2e8f0]">{activeProject.name}</h1>
                {activeProject.description && (
                  <span className="text-sm text-[#8892a4] truncate max-w-[200px]">{activeProject.description}</span>
                )}
                <div className="flex items-center gap-1 ml-4 p-0.5 rounded-lg bg-[#1e2235] border border-[#2a2d42]">
                  <button
                    onClick={() => setActiveView('board')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      activeView === 'board'
                        ? 'bg-[#2a2d42] text-[#e2e8f0]'
                        : 'text-[#8892a4] hover:text-[#e2e8f0]'
                    }`}
                  >
                    Board
                  </button>
                  <button
                    onClick={() => setActiveView('canvas')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      activeView === 'canvas'
                        ? 'bg-[#2a2d42] text-[#e2e8f0]'
                        : 'text-[#8892a4] hover:text-[#e2e8f0]'
                    }`}
                  >
                    Canvas
                  </button>
                  <button
                    onClick={() => setActiveView('files')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      activeView === 'files'
                        ? 'bg-[#2a2d42] text-[#e2e8f0]'
                        : 'text-[#8892a4] hover:text-[#e2e8f0]'
                    }`}
                  >
                    Arquivos
                  </button>
                </div>
                <div className="ml-auto flex items-center gap-3">
                  {(activeProject.links?.length ?? 0) > 0 && (
                    <ProjectLinksDropdown
                      links={activeProject.links ?? []}
                      activeLinkIds={activeLinkIds[activeProject.id] ?? []}
                      onSelect={(linkId) => setActiveLinkIds((prev) => {
                        const current = prev[activeProject.id] ?? []
                        const next = current.includes(linkId)
                          ? current.filter((id) => id !== linkId)
                          : [...current, linkId]
                        return { ...prev, [activeProject.id]: next }
                      })}
                    />
                  )}
                  {activeView === 'board' && (
                    <>
                      <SprintBadge
                        projectId={activeProject.id}
                        sprints={activeProjectSprints}
                        sprintFilter={sprintFilter}
                        onSetFilter={setSprintFilter}
                        onCreateSprints={createSprints}
                        onRenameSprint={updateSprint}
                        onCloseSprint={closeSprint}
                        onReopenSprint={reopenSprint}
                        onDeleteSprint={deleteSprint}
                      />
                      <span className="text-xs text-[#8892a4]">
                        {projectTasks.filter((t) => {
                          const col = activeProject.columns.find((c) => c.id === t.columnId)
                          return col && !isDoneColumn(col)
                        }).length} tasks
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden relative">
                {activeView === 'canvas' ? (
                  <CanvasView
                    project={activeProject}
                    tasks={projectTasks}
                    onCreateTask={handleCreateTaskFromCanvas}
                  />
                ) : activeView === 'files' ? (
                  <FilesView activeProjectId={activeProjectId} />
                ) : (
                  <Board
                    project={activeProject}
                    tasks={projectTasks}
                    onAddTask={handleAddTask}
                    onEditTask={handleEditTask}
                    onDeleteTask={handleDeleteTask}
                    onViewTask={handleViewTask}
                    onCompleteTask={handleCompleteTask}
                    onEditColumn={handleEditColumn}
                    onDeleteColumn={handleDeleteColumn}
                    onAddColumn={handleAddColumn}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 gap-4">
              <div className="w-16 h-16 rounded-2xl bg-[#1e2235] border border-[#2a2d42] flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8892a4" strokeWidth="1.5">
                  <rect x="3" y="3" width="7" height="18" rx="1" />
                  <rect x="14" y="3" width="7" height="11" rx="1" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-[#e2e8f0] font-medium mb-1">Nenhum projeto</p>
                <p className="text-sm text-[#8892a4]">Crie um projeto para começar</p>
              </div>
              <button
                onClick={handleNewProject}
                className="px-4 py-2 rounded-lg bg-[#6366f1] text-sm text-white font-medium hover:bg-[#5254c5] transition-colors"
              >
                Criar projeto
              </button>
            </div>
          )}
        </main>
      </div>

      <TaskModal
        open={taskModal.open}
        task={taskModal.task}
        columns={(activeProject?.columns ?? []).filter((c) => !isDoneColumn(c))}
        sprints={activeProjectSprints}
        defaultColumnId={taskModal.columnId}
        defaultTitle={taskModal.defaultTitle}
        onSave={handleSaveTask}
        onClose={() => setTaskModal({ open: false })}
      />

      <ProjectModal
        open={projectModal.open}
        project={projectModal.project}
        onSave={handleSaveProject}
        onClose={() => setProjectModal({ open: false })}
      />

      <ColumnModal
        open={columnModal.open}
        column={columnModal.column}
        onSave={handleSaveColumn}
        onClose={() => setColumnModal({ open: false })}
      />

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel="Confirmar"
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm((c) => ({ ...c, open: false }))}
      />

      <TaskViewModal
        open={viewTask !== null}
        task={viewTask}
        columns={viewTask ? (projects.find((p) => p.id === viewTask.projectId)?.columns ?? []) : []}
        onEdit={(task) => { setViewTask(null); handleEditTask(task) }}
        onClose={() => setViewTask(null)}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectTask={handleSearchSelectTask}
        onSelectNote={handleSearchSelectNote}
      />

      {excelExportOpen && (
        <ExcelExportModal
          projects={projects}
          tasks={tasks}
          sprints={sprints}
          habits={habits}
          goals={goals}
          notes={notes}
          lists={lists}
          onClose={() => setExcelExportOpen(false)}
          onToast={(msg) => addToast(msg)}
        />
      )}
    </div>
  )
}
