import { useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { format, parseISO } from 'date-fns'
import type { Project, Task, Sprint } from '../../types'
import { PRIORITY_CONFIG } from '../../types'
import { isDoneColumn } from '../../utils/columns'
import { EmptyState } from '../EmptyState'

interface Props {
  projects: Project[]
  tasks: Task[]
  sprints: Sprint[]
  sprintFilter: string | null
  onViewTask: (task: Task) => void
  onRestoreTask: (task: Task) => void
  onDeleteTask: (task: Task) => void
}

const TASKS_PER_PAGE = 25

export function DoneView({
  projects,
  tasks,
  sprints,
  sprintFilter,
  onViewTask,
  onRestoreTask,
  onDeleteTask
}: Props): ReactElement {
  const [pageSelection, setPageSelection] = useState({ page: 1, sprintFilter })
  const scrollRef = useRef<HTMLDivElement>(null)
  const projectsWithDone = useMemo(
    () =>
      projects
        .filter((p) => !p.archivedAt)
        .map((project) => {
          const doneColIds = new Set(project.columns.filter(isDoneColumn).map((c) => c.id))
          let doneTasks = tasks.filter(
            (t) => t.projectId === project.id && doneColIds.has(t.columnId)
          )
          if (sprintFilter !== null) {
            doneTasks = doneTasks.filter((t) => t.sprintId === sprintFilter)
          }
          return { project, doneTasks }
        })
        .filter(({ doneTasks }) => doneTasks.length > 0),
    [projects, tasks, sprintFilter]
  )

  const groupedProjects = useMemo(
    () =>
      projectsWithDone.map(({ project, doneTasks }) => {
        const sprintGroups: { sprint: Sprint | null; tasks: Task[] }[] = []
        const projectSprints = sprints.filter((s) => s.projectId === project.id)
        const sprintIds = new Set(projectSprints.map((s) => s.id))
        for (const sprint of projectSprints) {
          const sprintTasks = doneTasks.filter((t) => t.sprintId === sprint.id)
          if (sprintTasks.length > 0) sprintGroups.push({ sprint, tasks: sprintTasks })
        }
        const tasksWithoutSprint = doneTasks.filter(
          (t) => !t.sprintId || !sprintIds.has(t.sprintId)
        )
        if (tasksWithoutSprint.length > 0) {
          sprintGroups.push({ sprint: null, tasks: tasksWithoutSprint })
        }
        return { project, doneTasks, sprintGroups }
      }),
    [projectsWithDone, sprints]
  )
  const totalTasks = groupedProjects.reduce((total, group) => total + group.doneTasks.length, 0)
  const totalPages = Math.max(1, Math.ceil(totalTasks / TASKS_PER_PAGE))
  const page =
    pageSelection.sprintFilter === sprintFilter ? Math.min(pageSelection.page, totalPages) : 1

  const visibleProjects = useMemo(() => {
    const first = (page - 1) * TASKS_PER_PAGE
    const last = first + TASKS_PER_PAGE
    const visible: typeof groupedProjects = []
    let offset = 0
    for (const { project, doneTasks, sprintGroups } of groupedProjects) {
      const selectedGroups: typeof sprintGroups = []
      for (const group of sprintGroups) {
        const start = offset
        offset += group.tasks.length
        if (start >= last || offset <= first) continue
        const selectedTasks = group.tasks.slice(
          Math.max(0, first - start),
          Math.min(group.tasks.length, last - start)
        )
        if (selectedTasks.length)
          selectedGroups.push({ sprint: group.sprint, tasks: selectedTasks })
      }
      if (selectedGroups.length) visible.push({ project, doneTasks, sprintGroups: selectedGroups })
    }
    return visible
  }, [groupedProjects, page])

  const changePage = (nextPage: number): void => {
    setPageSelection({ page: nextPage, sprintFilter })
    scrollRef.current?.scrollTo?.({ top: 0 })
  }

  const pagination = totalPages > 1 && (
    <nav
      aria-label="Paginação das tarefas concluídas"
      className="flex items-center justify-between gap-3 text-xs text-[#999999]"
    >
      <span>
        Exibindo {(page - 1) * TASKS_PER_PAGE + 1}–{Math.min(page * TASKS_PER_PAGE, totalTasks)} de{' '}
        {totalTasks}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => changePage(page - 1)}
          disabled={page === 1}
          className="rounded border border-[#3b3b3b] bg-[#2a2a2a] px-2.5 py-1.5 text-[#d4d4d4] hover:bg-[#3b3b3b] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Anterior
        </button>
        <span aria-live="polite" className="whitespace-nowrap">
          Página {page} de {totalPages}
        </span>
        <button
          type="button"
          onClick={() => changePage(page + 1)}
          disabled={page === totalPages}
          className="rounded border border-[#3b3b3b] bg-[#2a2a2a] px-2.5 py-1.5 text-[#d4d4d4] hover:bg-[#3b3b3b] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Próxima
        </button>
      </div>
    </nav>
  )

  if (projectsWithDone.length === 0) {
    return (
      <EmptyState
        icon={
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#999999"
            strokeWidth="1.5"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        }
        title="Nenhuma task concluída"
        description={'Tasks movidas para "Done" aparecem aqui'}
      />
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-8">
      {pagination}
      {visibleProjects.map(({ project, doneTasks, sprintGroups }) => (
        <div key={project.id}>
          {/* Project header */}
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: project.color }}
            />
            <h2 className="text-base font-semibold text-[#d4d4d4]">{project.name}</h2>
            <span className="text-xs text-[#999999] bg-[#2a2a2a] px-2 py-0.5 rounded-full">
              {doneTasks.length} concluída{doneTasks.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="space-y-4">
            {sprintGroups.map(({ sprint, tasks: groupTasks }) => (
              <div key={sprint?.id ?? 'no-sprint'}>
                {/* Sprint sub-header — only for named sprints */}
                {sprint && (
                  <div className="flex items-center gap-2 mb-2 ml-0.5">
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${sprint.closedAt ? 'bg-[#999999]' : 'bg-[#7c3aed]'}`}
                    />
                    <span className="text-xs font-medium text-[#999999]">
                      {sprint.name}
                      {sprint.closedAt && (
                        <span className="ml-1.5 text-[10px] opacity-60">encerrada</span>
                      )}
                    </span>
                  </div>
                )}

                <div className="space-y-1.5">
                  {groupTasks.map((task) => (
                    <DoneTaskRow
                      key={task.id}
                      task={task}
                      onView={() => onViewTask(task)}
                      onRestore={() => onRestoreTask(task)}
                      onDelete={() => onDeleteTask(task)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {pagination}
    </div>
  )
}

function DoneTaskRow({
  task,
  onView,
  onRestore,
  onDelete
}: {
  task: Task
  onView: () => void
  onRestore: () => void
  onDelete: () => void
}): ReactElement {
  const priority = PRIORITY_CONFIG[task.priority]

  return (
    <div
      className="cv-row group flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[#232323] border border-[#3b3b3b] hover:border-[#555555] transition-colors cursor-pointer"
      onClick={onView}
    >
      {/* done check */}
      <div className="w-4 h-4 rounded-full border-2 border-[#20b858] flex items-center justify-center shrink-0">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#20b858" strokeWidth="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <p className="flex-1 text-sm text-[#999999] line-through truncate">{task.title}</p>

      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${priority.bg} ${priority.color}`}
        >
          {priority.label}
        </span>
        {task.completedAt && (
          <span className="text-[10px] text-[#20b858]" title="Concluída em">
            {format(parseISO(task.completedAt), 'dd/MM/yy')}
          </span>
        )}
        {task.dueDate && (
          <span className="text-[10px] text-[#999999]">
            {format(parseISO(task.dueDate), 'dd/MM')}
          </span>
        )}
        {task.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[#3b3b3b] text-[#999999]">
            {tag}
          </span>
        ))}
      </div>

      {/* actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRestore()
          }}
          className="p-1 rounded text-[#999999] hover:text-[#7c3aed] hover:bg-[#2a2a2a] transition-colors"
          title="Restaurar task"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="p-1 rounded text-[#999999] hover:text-[#e04040] hover:bg-[#2a2a2a] transition-colors"
          title="Deletar"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
