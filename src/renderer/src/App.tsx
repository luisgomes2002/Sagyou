import { useEffect, useState, useCallback, useMemo } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useShallow } from 'zustand/react/shallow'
import { useKanbanStore } from './store/kanban'
import {
  ALL_FEATURE_IDS,
  type Task,
  type Column,
  type Project,
  type Priority,
  type TaskImage,
  type FeatureId
} from './types'
import { isDoneColumn, isTaskDone } from './utils/columns'
import { isGoalComplete } from './utils/goals'
import { TitleBar } from './components/layout/TitleBar'
import { Sidebar } from './components/layout/Sidebar'
import { Board } from './components/views/Board'
import { CanvasView } from './components/views/CanvasView'
import { DoneView } from './components/views/DoneView'
import { GoalView } from './components/views/GoalView'
import { HabitView } from './components/views/HabitView'
import { FinancialView } from './components/views/FinancialView'
import { UpcomingView } from './components/views/UpcomingView'
import { PlanView } from './components/views/PlanView'
import { ReportsView } from './components/views/ReportsView'
import { GraphView } from './components/views/GraphView'
import type { NavigateTarget } from './utils/graph-layout'
import { FilesView } from './components/views/FilesView'
import { MemoryView } from './components/ai/MemoryView'
import { FleetView } from './components/ai/FleetView'
import { ExcelExportModal } from './components/modals/ExcelExportModal'
import { ProjectLinksDropdown } from './components/ProjectLinksDropdown'
import { SearchModal } from './components/modals/SearchModal'
import { SprintBadge } from './components/SprintBadge'
import { TaskModal } from './components/modals/TaskModal'
import { ProjectModal } from './components/modals/ProjectModal'
import { ColumnModal } from './components/modals/ColumnModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { TaskViewModal } from './components/modals/TaskViewModal'
import { ToastContainer, type ToastMessage } from './components/layout/Toast'
import { HomeView } from './components/views/HomeView'
import { GuideView } from './components/views/GuideView'
import { SettingsView } from './components/views/SettingsView'
import { UnlockScreen } from './components/security/UnlockScreen'
import { ViewErrorBoundary } from './components/ViewErrorBoundary'
import { applyMcpAction, prepareMcpAction } from './services/mcpActions'
import type { GlobalSearchHit } from '../../main/modules/search/global-search-query'

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

function focusedEntityHit(
  type: 'goal' | 'habit',
  id: string,
  title: string,
  completed: boolean
): GlobalSearchHit {
  return {
    type,
    id,
    title,
    snippet: title,
    matchedField: 'title',
    projectId: null,
    profileId: null,
    tableId: null,
    projectArchived: false,
    memoryArchived: false,
    completed,
    state: null,
    date: null
  }
}

export default function App() {
  // Subscribe with useShallow to only the slices this root component actually
  // reads. Without a selector, useKanbanStore() subscribes to the whole state
  // object and re-renders App (and therefore the entire tree) on EVERY mutation
  // to any domain — financial lists, canvas notes, the running timer, files.
  // Actions are stable references, so listing them here costs no extra renders;
  // only the state fields drive re-renders. Note `goals`/`notes`/`lists` are
  // deliberately absent — they now belong to ExcelExportModal, which reads them
  // straight from the store, so mutating them never touches the kanban root.
  const {
    projects,
    tasks,
    sprints,
    activeProjectId,
    sprintFilter,
    isLoaded,
    habits,
    featurePreferences,
    uiPreferences,
    setFeaturePreferences,
    setUiPreferences,
    loadData,
    setActiveProject,
    setSprintFilter,
    createProject,
    updateProject,
    moveProject,
    deleteProject,
    archiveProject,
    unarchiveProject,
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
    exportBackup,
    importBackup,
    importAIJson
  } = useKanbanStore(
    useShallow((s) => ({
      projects: s.projects,
      tasks: s.tasks,
      sprints: s.sprints,
      activeProjectId: s.activeProjectId,
      sprintFilter: s.sprintFilter,
      isLoaded: s.isLoaded,
      habits: s.habits,
      featurePreferences: s.featurePreferences,
      uiPreferences: s.uiPreferences,
      setFeaturePreferences: s.setFeaturePreferences,
      setUiPreferences: s.setUiPreferences,
      loadData: s.loadData,
      setActiveProject: s.setActiveProject,
      setSprintFilter: s.setSprintFilter,
      createProject: s.createProject,
      updateProject: s.updateProject,
      moveProject: s.moveProject,
      deleteProject: s.deleteProject,
      archiveProject: s.archiveProject,
      unarchiveProject: s.unarchiveProject,
      createColumn: s.createColumn,
      updateColumn: s.updateColumn,
      deleteColumn: s.deleteColumn,
      createTask: s.createTask,
      updateTask: s.updateTask,
      deleteTask: s.deleteTask,
      moveTask: s.moveTask,
      updateNote: s.updateNote,
      createSprints: s.createSprints,
      updateSprint: s.updateSprint,
      closeSprint: s.closeSprint,
      reopenSprint: s.reopenSprint,
      deleteSprint: s.deleteSprint,
      exportBackup: s.exportBackup,
      importBackup: s.importBackup,
      importAIJson: s.importAIJson
    }))
  )

  useEffect(() => {
    if (!window.electronAPI.store.onReload) return
    return window.electronAPI.store.onReload(() => void loadData())
  }, [loadData])

  useEffect(() => {
    if (!window.electronAPI.store.onMcpCreateTask) return
    return window.electronAPI.store.onMcpCreateTask(async ({ requestId, task }) => {
      try {
        const id = createTask(task)
        await useKanbanStore.getState()._flushPersist()
        window.electronAPI.store.respondMcpCreateTask(requestId, { id })
      } catch (error) {
        window.electronAPI.store.respondMcpCreateTask(requestId, {
          error: error instanceof Error ? error.message : 'Não foi possível criar a task.'
        })
      }
    })
  }, [createTask])

  useEffect(() => {
    if (!window.electronAPI.store.onMcpAction) return
    return window.electronAPI.store.onMcpAction(async ({ requestId, request }) => {
      try {
        const result =
          request.phase === 'prepare'
            ? prepareMcpAction(request.name, request.args, request.scope)
            : applyMcpAction(request.name, request.args, request.scope)
        if (request.phase === 'apply' && result.ok) await useKanbanStore.getState()._flushPersist()
        window.electronAPI.store.respondMcpAction(requestId, result)
      } catch (error) {
        window.electronAPI.store.respondMcpAction(requestId, {
          ok: false,
          error: error instanceof Error ? error.message : 'Não foi possível alterar os dados.'
        })
      }
    })
  }, [])

  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [taskModal, setTaskModal] = useState<TaskModalState>({ open: false })
  const [viewTask, setViewTask] = useState<Task | null>(null)
  const [projectModal, setProjectModal] = useState<ProjectModalState>({ open: false })
  const [columnModal, setColumnModal] = useState<ColumnModalState>({ open: false })
  const [activeView, setActiveView] = useState<
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
    | 'planejamento'
    | 'graph'
    | 'guide'
    | 'settings'
  >('home')
  const [searchOpen, setSearchOpen] = useState(false)
  const [financialSearchTarget, setFinancialSearchTarget] = useState<GlobalSearchHit | null>(null)
  const [financialSearchSerial, setFinancialSearchSerial] = useState(0)
  const [searchTarget, setSearchTarget] = useState<GlobalSearchHit | null>(null)
  const [searchSerial, setSearchSerial] = useState(0)
  const [excelExportOpen, setExcelExportOpen] = useState(false)
  const [securityState, setSecurityState] = useState<'checking' | 'locked' | 'unlocked'>('checking')
  const [unlockUserName, setUnlockUserName] = useState<string | undefined>()
  const [passwordConfigCorrupt, setPasswordConfigCorrupt] = useState(false)
  const [backupExportProgress, setBackupExportProgress] = useState<{
    completed: number
    total: number
  } | null>(null)
  // session-only: maps projectId → active linkIds (not persisted — each machine picks its own)
  const [activeLinkIds, setActiveLinkIds] = useState<Record<string, string[]>>({})
  const [confirm, setConfirm] = useState<ConfirmState>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {}
  })
  // Count of live code-agent runs (supports N concurrent agents in different dirs).
  const [codeAgentRunCount, setCodeAgentRunCount] = useState(0)

  const enabledFeatures = featurePreferences ?? ALL_FEATURE_IDS
  const saveFeaturePreferences = (features: FeatureId[]) => {
    setFeaturePreferences(features)
  }

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = uiPreferences.theme
    root.dataset.fontSize = uiPreferences.fontSize
    root.dataset.reduceMotion = String(uiPreferences.reduceMotion)
    root.dataset.highContrast = String(uiPreferences.highContrast)
  }, [uiPreferences])

  useEffect(() => {
    if (!window.electronAPI.backup.onExportProgress) return
    return window.electronAPI.backup.onExportProgress(({ completed, total, done }) => {
      if (done) setBackupExportProgress(null)
      else setBackupExportProgress({ completed, total })
    })
  }, [])

  useEffect(() => {
    const viewFeatures: Partial<Record<typeof activeView, FeatureId>> = {
      board: 'kanban',
      upcoming: 'kanban',
      done: 'kanban',
      goals: 'goals',
      habits: 'habits',
      financial: 'financial',
      planejamento: 'planning',
      reports: 'reports',
      canvas: 'canvas',
      files: 'files',
      graph: 'graph',
      ai: 'ai',
      memory: 'ai'
    }
    const feature = viewFeatures[activeView]
    if (feature && !enabledFeatures.includes(feature)) setActiveView('home')
  }, [activeView, enabledFeatures])

  useEffect(() => {
    window.electronAPI.security.status().then((status) => {
      setUnlockUserName(status.userName)
      setPasswordConfigCorrupt(status.corrupt)
      setSecurityState(status.enabled ? 'locked' : 'unlocked')
    })
  }, [])

  useEffect(() => {
    if (securityState !== 'unlocked') return
    loadData()
  }, [loadData, securityState])

  useEffect(() => {
    if (!isLoaded) return
    // The main process keeps one snapshot per day; retry while the app is open
    // so a long-running session is covered without a manual export.
    void exportBackup(true)
    const timer = setInterval(() => void exportBackup(true), 60 * 60 * 1000)
    return () => clearInterval(timer)
  }, [isLoaded, exportBackup])

  // Track the code agent across all views (App never unmounts, unlike the views).
  useEffect(() => {
    window.electronAPI.ai.codeAgent.status().then((s) => setCodeAgentRunCount(s.runs.length))
    // onOutput now receives {runId, chunk} — any activity across any run lights the banner.
    const offOutput = window.electronAPI.ai.codeAgent.onOutput(() =>
      setCodeAgentRunCount((n) => (n > 0 ? n : 1))
    )
    const offStarted = window.electronAPI.ai.codeAgent.onStarted(() =>
      setCodeAgentRunCount((n) => (n > 0 ? n : 1))
    )
    // onExit now receives {runId, code} — a run ended, but others may still be active.
    const offExit = window.electronAPI.ai.codeAgent.onExit(() => {
      window.electronAPI.ai.codeAgent.status().then((s) => setCodeAgentRunCount(s.runs.length))
    })
    return () => {
      offOutput()
      offExit()
      offStarted()
    }
  }, [])

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

  const projectTasks = useMemo(
    () =>
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

  // Count tasks in a single column, on demand, for move-to-end positioning.
  // Computed at call time (complete/restore) rather than as a whole-map memo
  // that rebuilt on every task mutation only to be read on the occasional click.
  // Keyed on the globally-unique columnId, so it stays correct for any project's
  // task (restore is triggered from DoneView across every project).
  const countTasksInColumn = useCallback(
    (columnId: string) => tasks.reduce((n, t) => (t.columnId === columnId ? n + 1 : n), 0),
    [tasks]
  )

  // --- Project handlers ---
  const handleNewProject = () => setProjectModal({ open: true })
  const handleEditProject = (project: Project) => setProjectModal({ open: true, project })

  const handleSaveProject = (
    name: string,
    description: string,
    color: string,
    links: import('./types').ProjectLink[]
  ) => {
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
      message: `Isso vai deletar o projeto "${project.name}" e todas as suas tasks, sprints e notas do canvas permanentemente.`,
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

  const handleSearchSelect = (hit: GlobalSearchHit) => {
    setSearchTarget(hit)
    setSearchSerial((serial) => serial + 1)
    if (hit.projectId) setActiveProject(hit.projectId)
    switch (hit.type) {
      case 'project':
        setActiveProject(hit.id)
        setActiveView('board')
        setSprintFilter(null)
        break
      case 'task': {
        const task = tasks.find((item) => item.id === hit.id)
        if (task) handleSearchSelectTask(task)
        break
      }
      case 'note':
        if (hit.projectId) {
          setActiveProject(hit.projectId)
          setActiveView('canvas')
          setSprintFilter(null)
        }
        break
      case 'goal':
        setActiveView('goals')
        break
      case 'habit':
        setActiveView('habits')
        break
      case 'time_block':
      case 'routine':
        setActiveView('planejamento')
        break
      case 'file':
        setActiveProject(hit.projectId)
        setActiveView('files')
        setSprintFilter(null)
        break
      case 'financial_profile':
      case 'financial_table':
      case 'shopping_item':
      case 'transaction':
      case 'transaction_detail':
      case 'financial_goal':
      case 'yield_source':
        setFinancialSearchTarget(hit)
        setFinancialSearchSerial((serial) => serial + 1)
        setActiveView('financial')
        break
      case 'memory':
        setActiveView('memory')
        break
    }
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
      const newTaskId = createTask({
        ...rest,
        projectId: activeProjectId,
        sprintId: sprintId || undefined
      })
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
    if (!doneCol) {
      addToast('Coluna "Done" não encontrada', 'error')
      return
    }
    moveTask(task.id, doneCol.id, countTasksInColumn(doneCol.id))
    addToast('Task concluída')
  }

  const handleRestoreTask = (task: Task) => {
    const { firstCol } = projectColumnInfo.get(task.projectId) ?? {}
    if (!firstCol) return
    moveTask(task.id, firstCol.id, countTasksInColumn(firstCol.id))
    addToast('Task restaurada')
  }

  // --- Import/Export ---
  const handleExportBackup = async () => {
    setBackupExportProgress({ completed: 0, total: 0 })
    try {
      const ok = await exportBackup()
      if (ok) addToast('Backup exportado com sucesso')
    } finally {
      setBackupExportProgress(null)
    }
  }

  const handleOpenBackupFolder = async () => {
    const error = await window.electronAPI.backup.openFolder()
    if (error) addToast('Não foi possível abrir a pasta de backups', 'error')
  }

  const handleImportBackup = () => {
    setConfirm({
      open: true,
      title: 'Importar backup',
      message:
        'Isso vai substituir os dados atuais pelo backup. Um ponto de restauração será salvo antes da importação.',
      onConfirm: async () => {
        setConfirm((c) => ({ ...c, open: false }))
        try {
          const ok = await importBackup()
          if (ok) addToast('Backup importado com sucesso')
          else addToast('Importação cancelada ou sem ponto de restauração', 'info')
        } catch (error) {
          addToast(error instanceof Error ? error.message : 'Falha ao importar backup', 'error')
        }
      }
    })
  }

  const handleImportAI = async () => {
    if (!activeProjectId) {
      addToast('Selecione um projeto primeiro', 'error')
      return
    }
    const count = await importAIJson(activeProjectId)
    if (count > 0) {
      addToast(`${count} task${count > 1 ? 's' : ''} importada${count > 1 ? 's' : ''} com sucesso`)
    } else {
      addToast('Importação cancelada ou arquivo inválido', 'info')
    }
  }

  if (securityState === 'checking') {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0b0b0f]">
        <div className="w-6 h-6 rounded-full border-2 border-[#7c3aed] border-t-transparent animate-spin" />
      </div>
    )
  }

  if (securityState === 'locked') {
    return (
      <UnlockScreen
        userName={unlockUserName}
        corrupt={passwordConfigCorrupt}
        onUnlocked={() => setSecurityState('unlocked')}
      />
    )
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0b0b0f]">
        <div className="w-6 h-6 rounded-full border-2 border-[#7c3aed] border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0b0b0f]">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          projects={projects}
          activeProjectId={activeProjectId}
          activeView={activeView}
          onSelectProject={(id) => {
            setSearchTarget(null)
            setFinancialSearchTarget(null)
            setActiveProject(id)
            if (
              activeView !== 'board' &&
              activeView !== 'canvas' &&
              activeView !== 'files' &&
              activeView !== 'ai'
            )
              setActiveView('board')
            setSprintFilter(null)
          }}
          onChangeView={(view) => {
            setSearchTarget(null)
            setFinancialSearchTarget(null)
            setActiveView(view)
          }}
          onOpenSearch={() => setSearchOpen(true)}
          onNewProject={handleNewProject}
          onEditProject={handleEditProject}
          onMoveProject={moveProject}
          onDeleteProject={handleDeleteProject}
          onArchiveProject={archiveProject}
          onUnarchiveProject={unarchiveProject}
          onExportBackup={handleExportBackup}
          onOpenBackupFolder={handleOpenBackupFolder}
          onImportBackup={handleImportBackup}
          onImportAI={handleImportAI}
          onExportExcel={() => setExcelExportOpen(true)}
          enabledFeatures={enabledFeatures}
          codeAgentRunCount={codeAgentRunCount}
        />

        <main className="flex-1 flex flex-col overflow-hidden">
          <ViewErrorBoundary key={activeView} area={activeView}>
            {activeView === 'settings' ? (
              <SettingsView
                featurePreferences={featurePreferences}
                onSetFeaturePreferences={saveFeaturePreferences}
                uiPreferences={uiPreferences}
                onSetUiPreferences={setUiPreferences}
                onToast={addToast}
              />
            ) : activeView === 'home' ? (
              <HomeView
                projects={projects}
                onNavigate={(view) => {
                  setSearchTarget(null)
                  setFinancialSearchTarget(null)
                  setActiveView(view as typeof activeView)
                }}
              />
            ) : activeView === 'reports' ? (
              <ReportsView projects={projects} tasks={tasks} sprints={sprints} habits={habits} />
            ) : activeView === 'upcoming' ? (
              <UpcomingView projects={projects} tasks={tasks} onViewTask={handleViewTask} />
            ) : activeView === 'planejamento' ? (
              <PlanView key={searchSerial} searchTarget={searchTarget} />
            ) : activeView === 'financial' ? (
              <FinancialView key={financialSearchSerial} searchTarget={financialSearchTarget} />
            ) : activeView === 'guide' ? (
              <GuideView />
            ) : activeView === 'ai' ? (
              <FleetView projects={projects} retainThread />
            ) : activeView === 'memory' ? (
              <MemoryView
                key={searchSerial}
                searchTargetId={searchTarget?.type === 'memory' ? searchTarget.id : undefined}
              />
            ) : activeView === 'habits' ? (
              <HabitView
                key={searchSerial}
                searchTargetId={searchTarget?.type === 'habit' ? searchTarget.id : undefined}
              />
            ) : activeView === 'graph' ? (
              <GraphView
                onNavigate={(target: NavigateTarget) => {
                  setSearchTarget(null)
                  setFinancialSearchTarget(null)
                  switch (target.type) {
                    case 'project':
                      setActiveProject(target.id)
                      setActiveView('board')
                      setSprintFilter(null)
                      break
                    case 'task': {
                      setActiveProject(target.projectId)
                      setActiveView('board')
                      setSprintFilter(null)
                      const t = tasks.find((tk) => tk.id === target.id)
                      if (t) setViewTask(t)
                      break
                    }
                    case 'note':
                      setActiveProject(target.projectId)
                      setActiveView('canvas')
                      setSprintFilter(null)
                      break
                    case 'goal':
                      {
                        const goal = useKanbanStore
                          .getState()
                          .goals.find((item) => item.id === target.id)
                        setSearchTarget(
                          focusedEntityHit(
                            'goal',
                            target.id,
                            goal?.title ?? '',
                            !!goal && isGoalComplete(goal)
                          )
                        )
                        setSearchSerial((serial) => serial + 1)
                      }
                      setActiveView('goals')
                      break
                    case 'habit':
                      {
                        const habit = habits.find((item) => item.id === target.id)
                        setSearchTarget(
                          focusedEntityHit('habit', target.id, habit?.name ?? '', false)
                        )
                        setSearchSerial((serial) => serial + 1)
                      }
                      setActiveView('habits')
                      break
                    case 'file':
                      setActiveProject(target.projectId ?? null)
                      setActiveView('files')
                      setSprintFilter(null)
                      break
                  }
                }}
              />
            ) : activeView === 'goals' ? (
              <GoalView
                key={searchSerial}
                projects={projects}
                searchTargetId={searchTarget?.type === 'goal' ? searchTarget.id : undefined}
              />
            ) : activeView === 'done' ? (
              <>
                <div className="flex items-center gap-3 px-6 py-4 border-b border-[#2b2b31] shrink-0">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#20b858"
                    strokeWidth="2.5"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <h1 className="text-base font-semibold text-[#d4d4d4]">Concluídas</h1>
                  <span className="text-xs text-[#999999]">
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
            ) : activeView === 'files' && !activeProject ? (
              <FilesView
                key={searchSerial}
                activeProjectId={null}
                searchTargetId={searchTarget?.type === 'file' ? searchTarget.id : undefined}
              />
            ) : activeProject ? (
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <div className="flex items-center gap-3 px-6 py-4 border-b border-[#2b2b31] shrink-0">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: activeProject.color }}
                  />
                  <h1 className="text-base font-semibold text-[#d4d4d4]">{activeProject.name}</h1>
                  {activeProject.description && (
                    <span className="text-sm text-[#999999] truncate max-w-[200px]">
                      {activeProject.description}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    {(activeProject.links?.length ?? 0) > 0 && (
                      <ProjectLinksDropdown
                        links={activeProject.links ?? []}
                        activeLinkIds={activeLinkIds[activeProject.id] ?? []}
                        onSelect={(linkId) =>
                          setActiveLinkIds((prev) => {
                            const current = prev[activeProject.id] ?? []
                            const next = current.includes(linkId)
                              ? current.filter((id) => id !== linkId)
                              : [...current, linkId]
                            return { ...prev, [activeProject.id]: next }
                          })
                        }
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
                        <span className="text-xs text-[#999999]">
                          {
                            projectTasks.filter((t) => {
                              const col = activeProject.columns.find((c) => c.id === t.columnId)
                              return col && !isDoneColumn(col)
                            }).length
                          }{' '}
                          tasks
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden relative">
                  {activeView === 'canvas' ? (
                    <CanvasView
                      key={searchSerial}
                      project={activeProject}
                      tasks={projectTasks}
                      searchTargetId={searchTarget?.type === 'note' ? searchTarget.id : undefined}
                      onCreateTask={handleCreateTaskFromCanvas}
                    />
                  ) : activeView === 'files' ? (
                    <FilesView
                      key={searchSerial}
                      activeProjectId={activeProjectId}
                      searchTargetId={searchTarget?.type === 'file' ? searchTarget.id : undefined}
                    />
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
                <div className="w-16 h-16 rounded-2xl bg-[#16161a] border border-[#2b2b31] flex items-center justify-center">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#999999"
                    strokeWidth="1.5"
                  >
                    <rect x="3" y="3" width="7" height="18" rx="1" />
                    <rect x="14" y="3" width="7" height="11" rx="1" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-[#d4d4d4] font-medium mb-1">Nenhum projeto</p>
                  <p className="text-sm text-[#999999]">Crie um projeto para começar</p>
                </div>
                <button
                  onClick={handleNewProject}
                  className="px-4 py-2 rounded-lg bg-[#7c3aed] text-sm text-white font-medium hover:bg-[#6d28d9] transition-colors"
                >
                  Criar projeto
                </button>
              </div>
            )}
          </ViewErrorBoundary>
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
        onEdit={(task) => {
          setViewTask(null)
          handleEditTask(task)
        }}
        onSendToAI={(task) => {
          setActiveProject(task.projectId)
          setActiveView('ai')
        }}
        onClose={() => setViewTask(null)}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={handleSearchSelect}
      />

      {excelExportOpen && (
        <ExcelExportModal
          onClose={() => setExcelExportOpen(false)}
          onToast={(msg) => addToast(msg)}
        />
      )}

      {backupExportProgress && (
        <div className="fixed inset-x-0 bottom-5 z-50 mx-auto flex w-fit items-center gap-3 rounded-lg border border-[#2b2b31] bg-[#16161a] px-4 py-3 text-sm text-[#d4d4d4] shadow-xl">
          <div>
            Exportando backup…{' '}
            {backupExportProgress.total > 0
              ? `${backupExportProgress.completed}/${backupExportProgress.total}`
              : 'preparando arquivos'}
          </div>
          <button
            type="button"
            onClick={() => window.electronAPI.backup.cancelExport()}
            className="text-xs text-[#f0a060] hover:text-white"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Code agent indicator movido para o badge da sidebar (Agentes) */}
    </div>
  )
}
