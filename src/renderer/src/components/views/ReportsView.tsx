import { useMemo } from 'react'
import {
  startOfWeek,
  subWeeks,
  addDays,
  parseISO,
  differenceInCalendarWeeks,
  format
} from 'date-fns'
import type { Project, Task, Sprint, Habit } from '../../types'
import { PRIORITY_CONFIG } from '../../types'
import { computeSprintVelocity } from '../../utils/reports'
import { isDoneColumn } from '../../utils/columns'
import { HEATMAP_COLORS, heatColor, buildCountMap, buildHeatmapGrid } from '../../utils/heatmap'
import { computeHabitSummary } from '../../utils/habits'
import { computeDueDateData } from '../../utils/dueDates'
import { computeTagData } from '../../utils/tags'

const MONTH_ABBR = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez'
]

function ActivityHeatmap({ doneTasks }: { doneTasks: Task[] }) {
  const CELL = 11
  const GAP = 3
  const DAY_LABEL_W = 22

  const today = useMemo(() => new Date(), [])

  const countMap = useMemo(() => buildCountMap(doneTasks), [doneTasks])

  const { weeks, monthLabels, total } = useMemo(() => {
    const { weeks, startStr, todayStr } = buildHeatmapGrid(today)

    const monthLabels: Array<{ col: number; label: string }> = []
    let lastMonth = -1
    weeks.forEach((_week, col) => {
      const m = weeks[col][0].date.getMonth()
      if (m !== lastMonth) {
        monthLabels.push({ col, label: MONTH_ABBR[m] })
        lastMonth = m
      }
    })

    let total = 0
    countMap.forEach((v, k) => {
      if (k >= startStr && k <= todayStr) total += v
    })

    return { weeks, monthLabels, total }
  }, [today, countMap])

  const dayLabels = ['', 'Seg', '', 'Qua', '', 'Sex', '']

  return (
    <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999]">
          Atividade: últimos 12 meses
        </p>
        <span className="text-[11px] text-[#999999]">{total} concluídas</span>
      </div>

      <div className="overflow-x-auto">
        <div style={{ display: 'inline-block' }}>
          <div style={{ display: 'flex', gap: GAP, paddingLeft: DAY_LABEL_W + 4, marginBottom: 4 }}>
            {weeks.map((_week, wi) => {
              const label = monthLabels.find((m) => m.col === wi)
              return (
                <div
                  key={wi}
                  style={{
                    width: CELL,
                    fontSize: 9,
                    color: '#999999',
                    whiteSpace: 'nowrap',
                    overflow: 'visible',
                    lineHeight: 1
                  }}
                >
                  {label?.label ?? ''}
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: GAP }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: GAP,
                width: DAY_LABEL_W,
                alignItems: 'flex-end',
                paddingRight: 4
              }}
            >
              {dayLabels.map((label, i) => (
                <div
                  key={i}
                  style={{
                    height: CELL,
                    fontSize: 9,
                    color: '#666666',
                    lineHeight: `${CELL}px`,
                    whiteSpace: 'nowrap'
                  }}
                >
                  {label}
                </div>
              ))}
            </div>

            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
                {week.map(({ iso, future }, di) => {
                  const count = future ? 0 : (countMap.get(iso) ?? 0)
                  return (
                    <div
                      key={di}
                      title={
                        future
                          ? undefined
                          : `${iso}: ${count} task${count !== 1 ? 's' : ''} concluída${count !== 1 ? 's' : ''}`
                      }
                      style={{
                        width: CELL,
                        height: CELL,
                        borderRadius: 2,
                        backgroundColor: future ? 'transparent' : heatColor(count),
                        cursor: count > 0 ? 'default' : undefined
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 10,
          justifyContent: 'flex-end'
        }}
      >
        <span style={{ fontSize: 9, color: '#666666' }}>Menos</span>
        {HEATMAP_COLORS.map((c, i) => (
          <div key={i} style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: c }} />
        ))}
        <span style={{ fontSize: 9, color: '#666666' }}>Mais</span>
      </div>
    </div>
  )
}

// ── SVG chart helpers ──────────────────────────────────────────────────────────

const VW = 400
const VH = 90
const ML = 30 // left margin (Y labels)
const MR = 10 // right margin
const MT = 8 // top margin
const MB = 22 // bottom margin (X labels)
const CW = VW - ML - MR
const CH = VH - MT - MB

function f(n: number): string {
  return n.toFixed(1)
}

function buildSmoothPath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return ''
  let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`
  for (let i = 1; i < pts.length; i++) {
    const cpx = f((pts[i - 1].x + pts[i].x) / 2)
    d += ` C ${cpx} ${f(pts[i - 1].y)} ${cpx} ${f(pts[i].y)} ${f(pts[i].x)} ${f(pts[i].y)}`
  }
  return d
}

function WeeklyAreaChart({ data, max }: { data: { label: string; count: number }[]; max: number }) {
  const safeMax = Math.max(max, 1)
  const bottom = MT + CH
  const pts = data.map((d, i) => ({
    x: ML + (data.length > 1 ? (i / (data.length - 1)) * CW : CW / 2),
    y: MT + (1 - d.count / safeMax) * CH,
    label: d.label,
    count: d.count
  }))

  const linePath = buildSmoothPath(pts)
  const areaPath =
    pts.length > 0
      ? `${linePath} L ${f(pts[pts.length - 1].x)} ${f(bottom)} L ${f(pts[0].x)} ${f(bottom)} Z`
      : ''

  const gridVals = Array.from(new Set([0, Math.round(safeMax / 2), safeMax]))

  return (
    <svg width="100%" viewBox={`0 0 ${VW} ${VH}`}>
      <defs>
        <linearGradient id="weekly-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.4} />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.02} />
        </linearGradient>
      </defs>

      {/* Grid lines + Y labels */}
      {gridVals.map((v) => {
        const y = MT + (1 - v / safeMax) * CH
        return (
          <g key={v}>
            <line x1={ML} y1={y} x2={ML + CW} y2={y} stroke="#3b3b3b" strokeWidth={0.5} />
            <text
              x={ML - 4}
              y={y}
              textAnchor="end"
              fontSize={3}
              fill="#999999"
              dominantBaseline="middle"
            >
              {v}
            </text>
          </g>
        )
      })}

      {/* Area fill */}
      <path d={areaPath} fill="url(#weekly-grad)" />

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke="#7c3aed"
        strokeWidth={0.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Baseline */}
      <line x1={ML} y1={bottom} x2={ML + CW} y2={bottom} stroke="#3b3b3b" strokeWidth={0.5} />

      {/* Data points + X labels */}
      {pts.map((pt, i) => (
        <g key={i}>
          <circle cx={pt.x} cy={pt.y} r={1.2} fill="#7c3aed" stroke="#2a2a2a" strokeWidth={0.5} />
          <text x={pt.x} y={VH - 5} textAnchor="middle" fontSize={3} fill="#999999">
            {pt.label}
          </text>
          <circle cx={pt.x} cy={pt.y} r={8} fill="transparent">
            <title>{`${pt.label}: ${pt.count} task${pt.count !== 1 ? 's' : ''} concluída${pt.count !== 1 ? 's' : ''}`}</title>
          </circle>
        </g>
      ))}
    </svg>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  projects: Project[]
  tasks: Task[]
  sprints: Sprint[]
  habits: Habit[]
}

const PRIORITY_COLORS = {
  urgent: '#ec6a6a',
  high: '#f08a34',
  medium: '#f0c210',
  low: '#34b4ec'
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h >= 10) return `${h}h`
  if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ''}`
  if (m === 0) return `<1m`
  return `${m}m`
}

function StatCard({
  label,
  value,
  sub,
  color,
  delta
}: {
  label: string
  value: string
  sub?: string
  color: string
  delta?: number
}) {
  return (
    <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
      <p className="text-[11px] text-[#999999] mb-1.5">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>
        {value}
      </p>
      {delta !== undefined && delta !== 0 && (
        <p
          className="text-[10px] mt-0.5 tabular-nums"
          style={{ color: delta > 0 ? '#46d478' : '#ec6a6a' }}
        >
          {delta > 0 ? '↑' : '↓'} {Math.abs(delta)} vs sem. ant.
        </p>
      )}
      {sub && <p className="text-[10px] text-[#666666] mt-0.5">{sub}</p>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#999999] mb-3">
      {children}
    </p>
  )
}

export function ReportsView({ projects, tasks, sprints, habits }: Props) {
  const archivedIds = useMemo(() => new Set(projects.filter((p) => p.archivedAt).map((p) => p.id)), [projects])
  const activeProjects = useMemo(() => projects.filter((p) => !p.archivedAt), [projects])
  const projectMap = useMemo(() => new Map(activeProjects.map((p) => [p.id, p])), [activeProjects])

  const columnMap = useMemo(
    () => new Map(activeProjects.flatMap((p) => p.columns.map((c) => [c.id, c]))),
    [activeProjects]
  )

  const activeTasksMemo = useMemo(
    () => tasks.filter((t) => !archivedIds.has(t.projectId)),
    [tasks, archivedIds]
  )

  const doneTasks = useMemo(
    () => activeTasksMemo.filter((t) => isDoneColumn(columnMap.get(t.columnId))),
    [activeTasksMemo, columnMap]
  )
  const activeTasks = useMemo(
    () => activeTasksMemo.filter((t) => !isDoneColumn(columnMap.get(t.columnId))),
    [activeTasksMemo, columnMap]
  )

  const totalTime = useMemo(() => activeTasksMemo.reduce((s, t) => s + (t.timeSpent ?? 0), 0), [activeTasksMemo])
  const completionRate = activeTasksMemo.length > 0 ? Math.round((doneTasks.length / activeTasksMemo.length) * 100) : 0

  // Tasks completed per week — last 8 weeks. Single pass: bucket each done task
  // into its week by calendar-week distance from the earliest week's Monday,
  // instead of re-scanning (and re-parsing) the whole list once per week.
  const weeklyData = useMemo(() => {
    const now = new Date()
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const start = startOfWeek(subWeeks(now, 7 - i), { weekStartsOn: 1 })
      return { start, label: format(start, 'dd/MM'), count: 0 }
    })
    const firstWeekStart = weeks[0].start
    for (const t of doneTasks) {
      const d = parseISO(t.updatedAt)
      if (isNaN(d.getTime())) continue
      const idx = differenceInCalendarWeeks(d, firstWeekStart, { weekStartsOn: 1 })
      if (idx >= 0 && idx < 8) weeks[idx].count++
    }
    return weeks.map(({ label, count }) => ({ label, count }))
  }, [doneTasks])

  const maxWeekly = Math.max(...weeklyData.map((w) => w.count), 1)
  const avgPerWeek = (weeklyData.reduce((s, w) => s + w.count, 0) / 8).toFixed(1)

  // Delta: current week vs previous week
  const weeklyDelta = weeklyData[7].count - weeklyData[6].count

  // Sprint velocity — last 8 sprints ordered by createdAt
  const sprintVelocity = useMemo(
    () => computeSprintVelocity(sprints, doneTasks),
    [sprints, doneTasks]
  )

  const maxVelocity = Math.max(...sprintVelocity.map((s) => s.count), 1)
  const avgVelocity =
    sprintVelocity.length > 0
      ? (sprintVelocity.reduce((s, x) => s + x.count, 0) / sprintVelocity.length).toFixed(1)
      : '0'

  // Overdue and upcoming tasks
  const dueDateData = useMemo(
    () => computeDueDateData(activeTasks, projectMap, new Date()),
    [activeTasks, projectMap]
  )

  // Habit summary — streak + current month rate
  const habitSummary = useMemo(
    () => computeHabitSummary(habits, new Date()),
    [habits]
  )

  // Last 30 days for habit mini-calendar
  const last30 = useMemo(() => {
    const today = new Date()
    return Array.from({ length: 30 }, (_, i) => format(addDays(today, -(29 - i)), 'yyyy-MM-dd'))
  }, [])

  // Priority breakdown
  const priorityCounts = useMemo(() => {
    const c = { urgent: 0, high: 0, medium: 0, low: 0 }
    for (const t of activeTasks) c[t.priority]++
    return c
  }, [activeTasks])

  // Top 10 tags by active task count
  const tagData = useMemo(() => computeTagData(activeTasks), [activeTasks])

  const maxTag = Math.max(...tagData.map((t) => t.count), 1)
  const totalTagCount = tagData.reduce((s, t) => s + t.count, 0)

  // Combined project view: active tasks + time tracked. One pass over tasks
  // builds both maps (time from every task, load from non-done ones) rather
  // than scanning `tasks` and `activeTasks` separately.
  const projectCombined = useMemo(() => {
    const timeMap = new Map<string, number>()
    const loadMap = new Map<string, number>()
    for (const t of tasks) {
      if (t.timeSpent) timeMap.set(t.projectId, (timeMap.get(t.projectId) ?? 0) + t.timeSpent)
      if (!isDoneColumn(columnMap.get(t.columnId))) {
        loadMap.set(t.projectId, (loadMap.get(t.projectId) ?? 0) + 1)
      }
    }

    const allIds = new Set([...timeMap.keys(), ...loadMap.keys()])
    return Array.from(allIds)
      .map((id) => ({
        project: projectMap.get(id),
        time: timeMap.get(id) ?? 0,
        load: loadMap.get(id) ?? 0
      }))
      .filter((x): x is { project: Project; time: number; load: number } => !!x.project)
      .sort((a, b) => b.load - a.load || b.time - a.time)
      .slice(0, 6)
  }, [tasks, columnMap, projectMap])

  const maxLoad = Math.max(...projectCombined.map((p) => p.load), 1)
  const maxTime = Math.max(...projectCombined.map((p) => p.time), 1)
  const maxPriority = Math.max(...Object.values(priorityCounts), 1)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#3b3b3b] shrink-0">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#a080f0"
          strokeWidth="2"
        >
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
        <h1 className="text-base font-semibold text-[#d4d4d4]">Relatórios</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Stat cards with delta */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Tasks ativas" value={activeTasks.length.toString()} color="#a080f0" />
          <StatCard
            label="Concluídas"
            value={doneTasks.length.toString()}
            color="#46d478"
            delta={weeklyDelta}
          />
          <StatCard
            label="Taxa de conclusão"
            value={`${completionRate}%`}
            sub={`${tasks.length} total`}
            color="#f08a34"
          />
          <StatCard
            label="Tempo registrado"
            value={totalTime > 0 ? formatTime(totalTime) : '-'}
            sub={
              totalTime > 0
                ? `em ${tasks.filter((t) => t.timeSpent).length} tasks`
                : 'inicie timers nas tasks'
            }
            color="#e890ac"
          />
        </div>

        {/* Due date alerts */}
        {(dueDateData.overdue.length > 0 || dueDateData.upcoming.length > 0) && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-[#2a2a2a] border border-[#e04040]/30 p-4">
                <p className="text-[11px] text-[#999999] mb-1.5">Vencidas</p>
                <p className="text-2xl font-bold text-[#e04040]">{dueDateData.overdue.length}</p>
                <p className="text-[10px] text-[#666666] mt-0.5">tasks atrasadas</p>
              </div>
              <div className="rounded-lg bg-[#2a2a2a] border border-[#f0c210]/30 p-4">
                <p className="text-[11px] text-[#999999] mb-1.5">Vencem em 7 dias</p>
                <p className="text-2xl font-bold text-[#f0c210]">{dueDateData.upcoming.length}</p>
                <p className="text-[10px] text-[#666666] mt-0.5">tasks próximas</p>
              </div>
            </div>
            <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] divide-y divide-[#3b3b3b] overflow-hidden">
              {dueDateData.list.map(({ task, project }) => {
                const isOverdue = task.dueDate! < dueDateData.todayStr
                return (
                  <div key={task.id} className="cv-row flex items-center gap-3 px-4 py-2.5">
                    <div
                      className="w-1 self-stretch rounded-full shrink-0"
                      style={{ backgroundColor: isOverdue ? '#ec6a6a' : '#f0c210' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[#d4d4d4] truncate">{task.title}</p>
                      {project && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: project.color }}
                          />
                          <p className="text-[10px] text-[#666666] truncate">{project.name}</p>
                        </div>
                      )}
                    </div>
                    <span
                      className="text-[11px] font-mono tabular-nums shrink-0"
                      style={{ color: isOverdue ? '#ec6a6a' : '#f0c210' }}
                    >
                      {format(parseISO(task.dueDate!), 'dd/MM')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Activity heatmap — unchanged */}
        <ActivityHeatmap doneTasks={doneTasks} />

        {/* Area chart — Concluídas por semana */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
          <div className="flex items-baseline justify-between mb-2">
            <SectionTitle>Concluídas por semana</SectionTitle>
            <span className="text-[11px] text-[#999999]">média {avgPerWeek}/sem</span>
          </div>
          <WeeklyAreaChart data={weeklyData} max={maxWeekly} />
        </div>

        {/* Bar chart — Velocidade por sprint */}
        {sprintVelocity.length > 0 && (
          <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
            <div className="flex items-baseline justify-between mb-4">
              <SectionTitle>Velocidade por sprint</SectionTitle>
              <span className="text-[11px] text-[#999999]">média {avgVelocity}/sprint</span>
            </div>
            <div className="flex items-end gap-1.5 h-28">
              {sprintVelocity.map(({ sprint, count, active }) => {
                const project = projectMap.get(sprint.projectId)
                return (
                  <div
                    key={sprint.id}
                    className="flex-1 flex flex-col items-center gap-1 min-w-0"
                    title={project ? `${sprint.name} · ${project.name}` : sprint.name}
                  >
                    {count > 0 && (
                      <span className="text-[9px] text-[#999999] tabular-nums">{count}</span>
                    )}
                    <div className="w-full flex items-end" style={{ height: 80 }}>
                      <div
                        className="w-full rounded-t-sm transition-all"
                        style={{
                          height: `${Math.max((count / maxVelocity) * 80, count > 0 ? 6 : 3)}px`,
                          backgroundColor: active
                            ? '#a080f0'
                            : count > 0
                              ? '#7c3aed'
                              : 'transparent',
                          border: active
                            ? '1.5px dashed #7c3aed'
                            : count === 0
                              ? '1px solid #3b3b3b'
                              : 'none',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                    <span
                      className="text-[9px] truncate w-full text-center"
                      style={{ color: active ? '#a080f0' : '#666666' }}
                    >
                      {sprint.name}
                    </span>
                    {project && (
                      <div
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: project.color }}
                      />
                    )}
                    {active && (
                      <span className="text-[8px] text-[#7c3aed] font-semibold leading-none">
                        ●
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-3 mt-3 justify-end">
              <span className="flex items-center gap-1 text-[9px] text-[#666666]">
                <span className="inline-block w-3 h-2 rounded-sm bg-[#7c3aed]" />
                encerrada
              </span>
              <span className="flex items-center gap-1 text-[9px] text-[#666666]">
                <span
                  className="inline-block w-3 h-2 rounded-sm"
                  style={{
                    background: '#a080f0',
                    border: '1.5px dashed #7c3aed',
                    boxSizing: 'border-box'
                  }}
                />
                em andamento
              </span>
            </div>
          </div>
        )}

        {/* Priority — horizontal bars */}
        <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
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
                  <div className="flex-1 h-2 bg-[#1b1b1b] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: PRIORITY_COLORS[p] }}
                    />
                  </div>
                  <span className="text-xs text-[#999999] w-4 text-right shrink-0 tabular-nums">
                    {count}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Tags with percentage */}
        {tagData.length > 0 && (
          <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
            <SectionTitle>Tasks ativas por tag</SectionTitle>
            <div className="space-y-2.5">
              {tagData.map(({ tag, count }) => (
                <div key={tag} className="flex items-center gap-3">
                  <span className="text-[10px] text-[#999999] w-24 truncate shrink-0">{tag}</span>
                  <div className="flex-1 h-1.5 bg-[#1b1b1b] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${(count / maxTag) * 100}%`, backgroundColor: '#7c3aed' }}
                    />
                  </div>
                  <span className="text-[10px] text-[#999999] w-5 text-right shrink-0 tabular-nums">
                    {count}
                  </span>
                  <span className="text-[10px] text-[#999999] w-7 text-right shrink-0 tabular-nums">
                    {totalTagCount > 0 ? `${Math.round((count / totalTagCount) * 100)}%` : '-'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Combined projects: tasks abertas + tempo */}
        {projectCombined.length > 0 && (
          <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
            <SectionTitle>Projetos</SectionTitle>
            {/* Column headers */}
            <div className="flex items-center gap-2 mb-2 pl-[calc(8px+80px+8px)]">
              <span className="flex-1 text-center text-[12px] text-[#999999] uppercase tracking-wider">
                Tasks abertas
              </span>
              <span className="w-5" />
              <span className="flex-1 text-center text-[12px] text-[#666666] uppercase tracking-wider">
                Tempo
              </span>
              <span className="w-10" />
            </div>
            <div className="space-y-2.5">
              {projectCombined.map(({ project, time, load }) => (
                <div key={project.id} className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="text-[10px] text-[#a0a0a0] w-20 truncate shrink-0">
                    {project.name}
                  </span>
                  <div className="flex-1 h-1.5 bg-[#1b1b1b] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(load / maxLoad) * 100}%`,
                        backgroundColor: project.color,
                        opacity: 0.7
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-[#999999] w-5 text-right shrink-0 tabular-nums">
                    {load > 0 ? load : '-'}
                  </span>
                  <div className="flex-1 h-1.5 bg-[#1b1b1b] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(time / maxTime) * 100}%`,
                        backgroundColor: project.color
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-[#999999] w-10 text-right shrink-0 tabular-nums font-mono">
                    {time > 0 ? formatTime(time) : '-'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Habits with mini 14-day calendar */}
        {habitSummary.length > 0 && (
          <div className="rounded-lg bg-[#2a2a2a] border border-[#3b3b3b] p-4">
            <SectionTitle>Hábitos — mês atual</SectionTitle>
            <div className="space-y-4">
              {habitSummary.map(({ habit, streak, rate, monthDone }) => (
                <div key={habit.id} className="cv-row">
                  <div className="flex items-center gap-3 mb-1.5">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: habit.color }}
                    />
                    <span className="text-xs text-[#999999] w-28 truncate shrink-0">
                      {habit.name}
                    </span>
                    <div className="flex-1 h-2 bg-[#1b1b1b] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${rate}%`, backgroundColor: habit.color }}
                      />
                    </div>
                    <span className="text-[10px] text-[#999999] w-8 text-right shrink-0 tabular-nums">
                      {rate}%
                    </span>
                    <div
                      className="flex items-center gap-1 shrink-0 w-12 justify-end"
                      title={`${monthDone} dias este mês`}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        strokeWidth="2"
                        stroke={streak > 0 ? habit.color : '#666666'}
                      >
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                      </svg>
                      <span
                        className="text-[10px] font-semibold tabular-nums"
                        style={{ color: streak > 0 ? habit.color : '#666666' }}
                      >
                        {streak}d
                      </span>
                    </div>
                  </div>
                  {/* Mini 30-day dot calendar */}
                  <div className="flex flex-wrap gap-1 pl-[calc(8px+112px+12px)]">
                    {last30.map((d) => (
                      <div
                        key={d}
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: habit.completions.includes(d) ? habit.color : '#2a2a2a',
                          border: habit.completions.includes(d) ? 'none' : '1px solid #3b3b3b'
                        }}
                        title={d}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
