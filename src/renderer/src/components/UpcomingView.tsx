import { useMemo } from 'react'
import type { Project, Task } from '../types'
import { PRIORITY_CONFIG } from '../types'
import { isDoneColumn } from '../utils/columns'

interface Props {
  projects: Project[]
  tasks: Task[]
  onViewTask: (task: Task) => void
}

type Group = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later'

const GROUP_CONFIG: Record<Group, { label: string; color: string; dotColor: string }> = {
  overdue:  { label: 'Atrasadas',    color: '#ec6a6a', dotColor: 'bg-[#e04040]' },
  today:    { label: 'Hoje',         color: '#46d478', dotColor: 'bg-[#46d478]' },
  tomorrow: { label: 'Amanhã',       color: '#a080f0', dotColor: 'bg-[#a080f0]' },
  week:     { label: 'Esta semana',  color: '#f08a34', dotColor: 'bg-[#f08a34]' },
  later:    { label: 'Mais tarde',   color: '#999999', dotColor: 'bg-[#999999]' },
}

const GROUP_ORDER: Group[] = ['overdue', 'today', 'tomorrow', 'week', 'later']

function getGroup(dueDate: string): Group {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate + 'T00:00:00')
  const diff = Math.floor((due.getTime() - today.getTime()) / 86_400_000)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff <= 7) return 'week'
  return 'later'
}

function formatDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export function UpcomingView({ projects, tasks, onViewTask }: Props) {
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const columnMap = useMemo(
    () => new Map(projects.flatMap((p) => p.columns.map((c) => [c.id, c]))),
    [projects]
  )

  const grouped = useMemo(() => {
    const result: Record<Group, Task[]> = { overdue: [], today: [], tomorrow: [], week: [], later: [] }
    for (const task of tasks) {
      if (!task.dueDate || isDoneColumn(columnMap.get(task.columnId))) continue
      result[getGroup(task.dueDate)].push(task)
    }
    return result
  }, [tasks, columnMap])

  const total = GROUP_ORDER.reduce((s, g) => s + grouped[g].length, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#3b3b3b] shrink-0">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a080f0" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <h1 className="text-base font-semibold text-[#d4d4d4]">Próximas</h1>
        <span className="text-xs text-[#999999]">{total} {total === 1 ? 'task' : 'tasks'}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#3b3b3b" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <polyline points="9 14 11 16 15 12" stroke="#3b3b3b" strokeWidth="1.5" />
            </svg>
            <p className="text-sm text-[#999999]">Nenhuma task com prazo próximo</p>
            <p className="text-xs text-[#666666]">Adicione prazos nas tasks do board</p>
          </div>
        ) : (
          <div className="space-y-6">
            {GROUP_ORDER.map((group) => {
              const groupTasks = grouped[group]
              if (groupTasks.length === 0) return null
              const cfg = GROUP_CONFIG[group]
              return (
                <div key={group}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full ${cfg.dotColor}`} />
                    <span className="text-xs font-semibold" style={{ color: cfg.color }}>
                      {cfg.label}
                    </span>
                    <span className="text-xs text-[#999999]">{groupTasks.length}</span>
                  </div>
                  <div className="space-y-1.5 pl-4">
                    {groupTasks
                      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
                      .map((task) => {
                        const project = projectMap.get(task.projectId)
                        const col = columnMap.get(task.columnId)
                        const pcfg = PRIORITY_CONFIG[task.priority]
                        return (
                          <button
                            key={task.id}
                            onClick={() => onViewTask(task)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#2a2a2a] hover:bg-[#333333] transition-colors text-left"
                          >
                            {project && (
                              <div
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: project.color }}
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-[#d4d4d4] truncate">{task.title}</p>
                              <p className="text-[11px] text-[#999999] truncate mt-0.5">
                                {project?.name}
                                {col ? ` · ${col.name}` : ''}
                              </p>
                            </div>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${pcfg.bg} ${pcfg.color}`}>
                              {pcfg.label[0]}
                            </span>
                            {task.dueDate && (
                              <span className="text-[11px] shrink-0 tabular-nums" style={{ color: cfg.color }}>
                                {formatDate(task.dueDate)}
                              </span>
                            )}
                          </button>
                        )
                      })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
