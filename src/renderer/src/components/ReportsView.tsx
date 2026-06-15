import { useMemo } from 'react'
import { startOfWeek, endOfWeek, subWeeks, addDays, parseISO, isWithinInterval, format } from 'date-fns'
import type { Project, Task } from '../types'
import { PRIORITY_CONFIG } from '../types'

const MONTH_ABBR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const HEATMAP_COLORS = ['#161b2c', '#312e81', '#4338ca', '#6366f1', '#a5b4fc']

function heatColor(count: number): string {
  if (count === 0) return HEATMAP_COLORS[0]
  if (count === 1) return HEATMAP_COLORS[1]
  if (count <= 3) return HEATMAP_COLORS[2]
  if (count <= 6) return HEATMAP_COLORS[3]
  return HEATMAP_COLORS[4]
}

function ActivityHeatmap({ doneTasks }: { doneTasks: Task[] }) {
  const CELL = 11
  const GAP = 3
  const DAY_LABEL_W = 22

  const today = useMemo(() => new Date(), [])

  const countMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of doneTasks) {
      const d = (t.completedAt ?? t.updatedAt)?.slice(0, 10)
      if (d) map.set(d, (map.get(d) ?? 0) + 1)
    }
    return map
  }, [doneTasks])

  const { weeks, monthLabels, total } = useMemo(() => {
    const startDate = startOfWeek(subWeeks(today, 51), { weekStartsOn: 0 })
    const todayStr = format(today, 'yyyy-MM-dd')
    const weeks: Array<Array<{ date: Date; iso: string; future: boolean }>> = []
    let cur = new Date(startDate)

    while (cur <= today || weeks.length === 0 || weeks[weeks.length - 1].length < 7) {
      if (weeks.length === 0 || weeks[weeks.length - 1].length === 7) weeks.push([])
      const iso = format(cur, 'yyyy-MM-dd')
      weeks[weeks.length - 1].push({ date: new Date(cur), iso, future: iso > todayStr })
      cur = addDays(cur, 1)
      if (weeks.length > 53) break
    }

    // Pad last week to 7 days
    while (weeks[weeks.length - 1].length < 7) {
      const last = weeks[weeks.length - 1][weeks[weeks.length - 1].length - 1]
      const next = addDays(last.date, 1)
      const iso = format(next, 'yyyy-MM-dd')
      weeks[weeks.length - 1].push({ date: next, iso, future: true })
    }

    // Month labels: first week of each month
    const monthLabels: Array<{ col: number; label: string }> = []
    let lastMonth = -1
    weeks.forEach((_week, col) => {
      const m = weeks[col][0].date.getMonth()
      if (m !== lastMonth) {
        monthLabels.push({ col, label: MONTH_ABBR[m] })
        lastMonth = m
      }
    })

    const startStr = format(startDate, 'yyyy-MM-dd')
    let total = 0
    countMap.forEach((v, k) => { if (k >= startStr && k <= todayStr) total += v })

    return { weeks, monthLabels, total }
  }, [today, countMap])

  const dayLabels = ['', 'Seg', '', 'Qua', '', 'Sex', '']

  return (
    <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4]">
          Atividade — últimos 12 meses
        </p>
        <span className="text-[11px] text-[#8892a4]">{total} concluídas</span>
      </div>

      <div className="overflow-x-auto">
        <div style={{ display: 'inline-block' }}>
          {/* Month labels */}
          <div style={{ display: 'flex', gap: GAP, paddingLeft: DAY_LABEL_W + 4, marginBottom: 4 }}>
            {weeks.map((_week, wi) => {
              const label = monthLabels.find((m) => m.col === wi)
              return (
                <div
                  key={wi}
                  style={{
                    width: CELL,
                    fontSize: 9,
                    color: '#8892a4',
                    whiteSpace: 'nowrap',
                    overflow: 'visible',
                    lineHeight: 1,
                  }}
                >
                  {label?.label ?? ''}
                </div>
              )
            })}
          </div>

          {/* Grid */}
          <div style={{ display: 'flex', gap: GAP }}>
            {/* Day labels */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, width: DAY_LABEL_W, alignItems: 'flex-end', paddingRight: 4 }}>
              {dayLabels.map((label, i) => (
                <div
                  key={i}
                  style={{ height: CELL, fontSize: 9, color: '#4a5068', lineHeight: `${CELL}px`, whiteSpace: 'nowrap' }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Week columns */}
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
                {week.map(({ iso, future }, di) => {
                  const count = future ? 0 : (countMap.get(iso) ?? 0)
                  return (
                    <div
                      key={di}
                      title={future ? undefined : `${iso}: ${count} task${count !== 1 ? 's' : ''} concluída${count !== 1 ? 's' : ''}`}
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: 2,
                        backgroundColor: future ? 'transparent' : heatColor(count),
                        cursor: count > 0 ? 'default' : undefined,
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 9, color: '#4a5068' }}>Menos</span>
        {HEATMAP_COLORS.map((c, i) => (
          <div key={i} style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: c }} />
        ))}
        <span style={{ fontSize: 9, color: '#4a5068' }}>Mais</span>
      </div>
    </div>
  )
}

interface Props {
  projects: Project[]
  tasks: Task[]
}

const PRIORITY_COLORS = {
  urgent: '#f87171',
  high: '#fb923c',
  medium: '#facc15',
  low: '#38bdf8',
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h >= 10) return `${h}h`
  if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ''}`
  if (m === 0) return `<1m`
  return `${m}m`
}

function isDoneCol(task: Task, projects: Project[]): boolean {
  const p = projects.find((pr) => pr.id === task.projectId)
  return p?.columns.find((c) => c.id === task.columnId)?.name.toLowerCase() === 'done'
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-4">
      <p className="text-[11px] text-[#8892a4] mb-1.5">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-[#4a5068] mt-0.5">{sub}</p>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8892a4] mb-3">{children}</p>
  )
}

export function ReportsView({ projects, tasks }: Props) {
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const doneTasks = useMemo(() => tasks.filter((t) => isDoneCol(t, projects)), [tasks, projects])
  const activeTasks = useMemo(() => tasks.filter((t) => !isDoneCol(t, projects)), [tasks, projects])

  const totalTime = useMemo(() => tasks.reduce((s, t) => s + (t.timeSpent ?? 0), 0), [tasks])
  const completionRate = tasks.length > 0 ? Math.round((doneTasks.length / tasks.length) * 100) : 0

  // Tasks completed per week — last 8 weeks
  const weeklyData = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 8 }, (_, i) => {
      const weekAnchor = subWeeks(now, 7 - i)
      const start = startOfWeek(weekAnchor, { weekStartsOn: 1 })
      const end = endOfWeek(weekAnchor, { weekStartsOn: 1 })
      const count = doneTasks.filter((t) => {
        try { return isWithinInterval(parseISO(t.updatedAt), { start, end }) }
        catch { return false }
      }).length
      return { label: format(start, 'dd/MM'), count }
    })
  }, [doneTasks])

  const maxWeekly = Math.max(...weeklyData.map((w) => w.count), 1)
  const totalWeeklyDone = weeklyData.reduce((s, w) => s + w.count, 0)
  const avgPerWeek = (totalWeeklyDone / 8).toFixed(1)

  // Time per project — top 6
  const projectTime = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tasks) {
      if (!t.timeSpent) continue
      map.set(t.projectId, (map.get(t.projectId) ?? 0) + t.timeSpent)
    }
    return Array.from(map.entries())
      .map(([id, secs]) => ({ project: projectMap.get(id), secs }))
      .filter((x): x is { project: Project; secs: number } => !!x.project)
      .sort((a, b) => b.secs - a.secs)
      .slice(0, 6)
  }, [tasks, projectMap])

  const maxTime = Math.max(...projectTime.map((p) => p.secs), 1)

  // Active tasks per project — for workload view
  const projectLoad = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of activeTasks) map.set(t.projectId, (map.get(t.projectId) ?? 0) + 1)
    return Array.from(map.entries())
      .map(([id, count]) => ({ project: projectMap.get(id), count }))
      .filter((x): x is { project: Project; count: number } => !!x.project)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
  }, [activeTasks, projectMap])

  const maxLoad = Math.max(...projectLoad.map((p) => p.count), 1)

  // Priority breakdown of active tasks
  const priorityCounts = useMemo(() => {
    const c = { urgent: 0, high: 0, medium: 0, low: 0 }
    for (const t of activeTasks) c[t.priority]++
    return c
  }, [activeTasks])

  const maxPriority = Math.max(...Object.values(priorityCounts), 1)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#2a2d42] shrink-0">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
        <h1 className="text-base font-semibold text-[#e2e8f0]">Relatórios</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Tasks ativas" value={activeTasks.length.toString()} color="#a5b4fc" />
          <StatCard label="Concluídas" value={doneTasks.length.toString()} color="#4ade80" />
          <StatCard
            label="Taxa de conclusão"
            value={`${completionRate}%`}
            sub={`${tasks.length} total`}
            color="#fb923c"
          />
          <StatCard
            label="Tempo registrado"
            value={totalTime > 0 ? formatTime(totalTime) : '—'}
            sub={totalTime > 0 ? `em ${tasks.filter((t) => t.timeSpent).length} tasks` : 'inicie timers nas tasks'}
            color="#f472b6"
          />
        </div>

        {/* Activity heatmap */}
        <ActivityHeatmap doneTasks={doneTasks} />

        {/* Weekly bar chart */}
        <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-4">
          <div className="flex items-baseline justify-between mb-4">
            <SectionTitle>Concluídas por semana</SectionTitle>
            <span className="text-[11px] text-[#8892a4]">média {avgPerWeek}/sem</span>
          </div>
          <div className="flex items-end gap-1.5 h-28">
            {weeklyData.map((w, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                {w.count > 0 && (
                  <span className="text-[9px] text-[#8892a4] tabular-nums">{w.count}</span>
                )}
                <div className="w-full flex items-end" style={{ height: 80 }}>
                  <div
                    className="w-full rounded-t-sm transition-all"
                    style={{
                      height: `${Math.max((w.count / maxWeekly) * 80, w.count > 0 ? 6 : 3)}px`,
                      backgroundColor: w.count > 0 ? '#6366f1' : '#1e2235',
                      border: w.count === 0 ? '1px solid #2a2d42' : 'none',
                    }}
                  />
                </div>
                <span className="text-[9px] text-[#4a5068] truncate w-full text-center">{w.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Priority breakdown */}
        <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-4">
          <SectionTitle>Tasks ativas por prioridade</SectionTitle>
          <div className="space-y-3">
            {(['urgent', 'high', 'medium', 'low'] as const).map((p) => {
              const count = priorityCounts[p]
              const cfg = PRIORITY_CONFIG[p]
              const pct = (count / maxPriority) * 100
              return (
                <div key={p} className="flex items-center gap-3">
                  <span className={`text-[10px] font-semibold w-14 shrink-0 ${cfg.color}`}>
                    {cfg.label}
                  </span>
                  <div className="flex-1 h-2 bg-[#0d0f18] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: PRIORITY_COLORS[p] }}
                    />
                  </div>
                  <span className="text-xs text-[#8892a4] w-4 text-right shrink-0 tabular-nums">
                    {count}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Time per project */}
        {projectTime.length > 0 && (
          <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-4">
            <SectionTitle>Tempo registrado por projeto</SectionTitle>
            <div className="space-y-3">
              {projectTime.map(({ project, secs }) => (
                <div key={project.id} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
                  <span className="text-xs text-[#8892a4] w-24 truncate shrink-0">{project.name}</span>
                  <div className="flex-1 h-2 bg-[#0d0f18] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(secs / maxTime) * 100}%`,
                        backgroundColor: project.color,
                      }}
                    />
                  </div>
                  <span className="text-xs text-[#8892a4] w-10 text-right shrink-0 tabular-nums font-mono">
                    {formatTime(secs)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Workload per project */}
        {projectLoad.length > 0 && (
          <div className="rounded-lg bg-[#1e2235] border border-[#2a2d42] p-4">
            <SectionTitle>Tasks abertas por projeto</SectionTitle>
            <div className="space-y-3">
              {projectLoad.map(({ project, count }) => (
                <div key={project.id} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
                  <span className="text-xs text-[#8892a4] w-24 truncate shrink-0">{project.name}</span>
                  <div className="flex-1 h-2 bg-[#0d0f18] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(count / maxLoad) * 100}%`,
                        backgroundColor: project.color,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                  <span className="text-xs text-[#8892a4] w-4 text-right shrink-0 tabular-nums">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
