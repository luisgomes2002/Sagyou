import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import type { Project, Task, Sprint } from '../types'
import { PRIORITY_CONFIG } from '../types'
import { isDoneColumn } from '../utils/columns'

interface Props {
  projects: Project[]
  tasks: Task[]
  sprints: Sprint[]
  sprintFilter: string | null
  onViewTask: (task: Task) => void
  onRestoreTask: (task: Task) => void
  onDeleteTask: (task: Task) => void
}

export function DoneView({ projects, tasks, sprints, sprintFilter, onViewTask, onRestoreTask, onDeleteTask }: Props) {
  const projectsWithDone = useMemo(() =>
    projects
      .filter((p) => !p.archivedAt)
      .map((project) => {
        const doneColIds = new Set(
          project.columns.filter(isDoneColumn).map((c) => c.id)
        )
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

  if (projectsWithDone.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-[#2a2a2a] border border-[#3b3b3b] flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#999999" strokeWidth="1.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-[#d4d4d4] font-medium mb-1">Nenhuma task concluída</p>
          <p className="text-sm text-[#999999]">Tasks movidas para "Done" aparecem aqui</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8">
      {projectsWithDone.map(({ project, doneTasks }) => {
        const projectSprints = sprints.filter((s) => s.projectId === project.id)

        // Group tasks by sprint
        const sprintGroups: { sprint: Sprint | null; tasks: Task[] }[] = []
        const tasksWithSprint = doneTasks.filter((t) => t.sprintId)
        const tasksWithoutSprint = doneTasks.filter((t) => !t.sprintId)

        projectSprints.forEach((sprint) => {
          const sprintTasks = tasksWithSprint.filter((t) => t.sprintId === sprint.id)
          if (sprintTasks.length > 0) {
            sprintGroups.push({ sprint, tasks: sprintTasks })
          }
        })

        if (tasksWithoutSprint.length > 0) {
          sprintGroups.push({ sprint: null, tasks: tasksWithoutSprint })
        }

        return (
          <div key={project.id}>
            {/* Project header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
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
                      <div className={`w-1.5 h-1.5 rounded-full ${sprint.closedAt ? 'bg-[#999999]' : 'bg-[#7c3aed]'}`} />
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
        )
      })}
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
}) {
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
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${priority.bg} ${priority.color}`}>
          {priority.label}
        </span>
        {task.completedAt && (
          <span className="text-[10px] text-[#20b858]/70" title="Concluída em">
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
          onClick={(e) => { e.stopPropagation(); onRestore() }}
          className="p-1 rounded text-[#999999] hover:text-[#7c3aed] hover:bg-[#7c3aed]/10 transition-colors"
          title="Restaurar task"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="p-1 rounded text-[#999999] hover:text-[#e04040] hover:bg-[#e04040]/10 transition-colors"
          title="Deletar"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
