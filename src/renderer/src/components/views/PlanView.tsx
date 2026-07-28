import { useState, useMemo } from 'react'
import { useKanbanStore } from '../../store/kanban'
import type { TimeBlock, Routine } from '../../types'
import { TIME_BLOCK_COLORS } from '../../types'

type ViewMode = 'day' | 'week' | 'month'

const MODE_LABELS: Record<ViewMode, string> = { day: 'Dia', week: 'Semana', month: 'Mês' }

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6) // 6h–23h
const HOUR_HEIGHT = 80

const TYPE_LABELS: Record<TimeBlock['type'], string> = {
  task: 'Task',
  routine: 'Rotina',
  buffer: 'Buffer',
  custom: ''
}

const TYPE_STYLES: Record<TimeBlock['type'], string> = {
  task: 'border-l-[#a080f0]',
  routine: 'border-l-[#46d478]',
  buffer: 'border-l-[#f0b820] border-dashed',
  custom: 'border-l-[#999999]'
}

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function fmtDayShort(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function formatWeekStart(date: string): string {
  const d = new Date(date + 'T00:00:00')
  const day = d.getDay()
  const diff = d.getDate() - day
  const monday = new Date(d.setDate(diff))
  return monday.toISOString().slice(0, 10)
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function minToPx(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return ((h - 6) * 60 + m) * (HOUR_HEIGHT / 60)
}

function durationMin(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export function PlanView() {
  const timeBlocks = useKanbanStore((s) => s.timeBlocks)
  const routines = useKanbanStore((s) => s.routines)
  const createTimeBlock = useKanbanStore((s) => s.createTimeBlock)
  const deleteTimeBlock = useKanbanStore((s) => s.deleteTimeBlock)
  const createRoutine = useKanbanStore((s) => s.createRoutine)
  const updateRoutine = useKanbanStore((s) => s.updateRoutine)
  const deleteRoutine = useKanbanStore((s) => s.deleteRoutine)

  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [currentDate, setCurrentDate] = useState(todayStr())

  const navigate = (dir: number) => {
    const d = new Date(currentDate + 'T00:00:00')
    if (viewMode === 'day') d.setDate(d.getDate() + dir)
    else if (viewMode === 'week') d.setDate(d.getDate() + dir * 7)
    else d.setMonth(d.getMonth() + dir)
    setCurrentDate(d.toISOString().slice(0, 10))
  }

  const goToday = () => setCurrentDate(todayStr())

  const weekStart = formatWeekStart(currentDate)

  const visibleDays: string[] = useMemo(() => {
    if (viewMode === 'day') return [currentDate]
    if (viewMode === 'week') return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    // month
    const [y, m] = currentDate.split('-')
    const daysInMonth = new Date(parseInt(y), parseInt(m), 0).getDate()
    return Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1
      return `${y}-${m}-${String(d).padStart(2, '0')}`
    })
  }, [viewMode, currentDate, weekStart])

  const blocksByDay = useMemo(() => {
    const map = new Map<string, TimeBlock[]>()
    for (const day of visibleDays) map.set(day, [])
    for (const tb of timeBlocks) {
      const list = map.get(tb.date)
      if (list) list.push(tb)
    }
    for (const [, list] of map) list.sort((a, b) => a.startTime.localeCompare(b.startTime))
    return map
  }, [timeBlocks, visibleDays])

  const addBlock = (date: string, startHour: number) => {
    const h = String(startHour).padStart(2, '0')
    const endH = String(startHour + 1).padStart(2, '0')
    const existing = blocksByDay.get(date) ?? []
    const maxOrder = existing.reduce((m, tb) => Math.max(m, tb.order), -1)
    // pick a color distinct from the last block
    const lastColor = existing[existing.length - 1]?.color
    const color = TIME_BLOCK_COLORS.find((c) => !lastColor || c !== lastColor) ?? TIME_BLOCK_COLORS[0]
    createTimeBlock({
      date,
      startTime: `${h}:00`,
      endTime: `${endH}:00`,
      title: 'Novo bloco',
      type: 'custom',
      color,
      order: maxOrder + 1
    })
  }

  const [showRoutines, setShowRoutines] = useState(false)

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#1b1b1b]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-[#999999] hover:text-white text-lg px-1"
          >
            ‹
          </button>
          <button
            onClick={goToday}
            className="text-sm text-[#999999] hover:text-white underline underline-offset-4"
          >
            Hoje
          </button>
          <button
            onClick={() => navigate(1)}
            className="text-[#999999] hover:text-white text-lg px-1"
          >
            ›
          </button>
          <span className="text-white font-medium ml-2">
            {viewMode === 'day'
              ? fmtDay(currentDate)
              : viewMode === 'week'
                ? `${fmtDayShort(weekStart)} – ${fmtDayShort(addDays(weekStart, 6))}`
                : new Date(currentDate + 'T00:00:00').toLocaleDateString('pt-BR', {
                    month: 'long',
                    year: 'numeric'
                  })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 text-xs rounded-md border transition ${
                viewMode === mode
                  ? 'bg-[#a080f0]/20 border-[#a080f0]/40 text-[#a080f0]'
                  : 'border-white/10 text-[#999999] hover:text-white'
              }`}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
          <button
            onClick={() => setShowRoutines(!showRoutines)}
            className={`px-3 py-1 text-xs rounded-md border transition ${
              showRoutines
                ? 'bg-[#46d478]/20 border-[#46d478]/40 text-[#46d478]'
                : 'border-white/10 text-[#999999] hover:text-white'
            }`}
          >
            Rotinas
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'day' ? (
          <DayView
            date={currentDate}
            blocks={blocksByDay.get(currentDate) ?? []}
            onAdd={addBlock}
            onDelete={deleteTimeBlock}
          />
        ) : viewMode === 'week' ? (
          <WeekView days={visibleDays} blocksByDay={blocksByDay} onDelete={deleteTimeBlock} />
        ) : (
          <MonthView days={visibleDays} blocksByDay={blocksByDay} />
        )}
      </div>

      {/* Routines panel */}
      {showRoutines && (
        <RoutinesPanel
          routines={routines}
          onCreate={createRoutine}
          onDelete={deleteRoutine}
          onToggle={(id, active) => updateRoutine(id, { active })}
        />
      )}
    </div>
  )
}

function layoutOverlappingBlocks(blocks: TimeBlock[]): { block: TimeBlock; col: number; cols: number }[] {
  if (!blocks.length) return []

  const sorted = [...blocks].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const groups: TimeBlock[][] = []

  for (const block of sorted) {
    let found = false
    for (const group of groups) {
      if (group.some((g) => block.startTime < g.endTime && block.endTime > g.startTime)) {
        group.push(block)
        found = true
        break
      }
    }
    if (!found) groups.push([block])
  }

  const result: { block: TimeBlock; col: number; cols: number }[] = []

  for (const group of groups) {
    const sortedGroup = [...group].sort((a, b) => {
      const cmp = a.startTime.localeCompare(b.startTime)
      if (cmp !== 0) return cmp
      return durationMin(b.startTime, b.endTime) - durationMin(a.startTime, a.endTime)
    })

    const columns: TimeBlock[][] = []
    for (const block of sortedGroup) {
      let placed = false
      for (const col of columns) {
        const lastInCol = col[col.length - 1]
        if (block.startTime >= lastInCol.endTime) {
          col.push(block)
          placed = true
          break
        }
      }
      if (!placed) columns.push([block])
    }

    for (let ci = 0; ci < columns.length; ci++) {
      for (const block of columns[ci]) {
        result.push({ block, col: ci, cols: columns.length })
      }
    }
  }

  return result
}

function DayView({
  date,
  blocks,
  onAdd,
  onDelete
}: {
  date: string
  blocks: TimeBlock[]
  onAdd: (date: string, hour: number) => void
  onDelete: (id: string) => void
}) {
  const laidOut = useMemo(() => layoutOverlappingBlocks(blocks), [blocks])
  const offsetLeft = 56 // 14 in tailwind (3.5rem)

  return (
    <div className="relative" style={{ height: HOURS.length * HOUR_HEIGHT + 32 }}>
      {/* Hour lines */}
      {HOURS.map((h) => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-white/5 flex items-start"
          style={{ top: minToPx(`${String(h).padStart(2, '0')}:00`) }}
        >
          <span className="text-[10px] text-[#999999] w-12 text-right pr-2 leading-none pt-0.5 tabular-nums">
            {String(h).padStart(2, '0')}:00
          </span>
          <div
            className="flex-1 h-10 cursor-pointer hover:bg-white/[0.02]"
            onClick={() => onAdd(date, h)}
          />
        </div>
      ))}

      {/* Blocks */}
      {laidOut.map((lb) => {
        const { block, col, cols } = lb
        const top = minToPx(block.startTime)
        const dur = durationMin(block.startTime, block.endTime)
        const height = Math.max(dur * (HOUR_HEIGHT / 60), 36)
        const isShort = dur < 45
        const gapX = 4
        const availWidth = `calc(100% - ${offsetLeft + 8}px)`
        const colWidth = `calc((${availWidth} - ${(cols - 1) * gapX}px) / ${cols})`
        const left = `calc(${offsetLeft + 4}px + ${col} * (${colWidth} + ${gapX}px))`
        return (
          <div
            key={block.id}
            className={`absolute rounded-md px-2 border-l-2 cursor-pointer group
              bg-white/[0.06] border-white/10 hover:bg-white/[0.10]
              ${TYPE_STYLES[block.type as TimeBlock['type']] ?? ''}`}
            style={{
              top,
              height,
              left,
              width: colWidth,
              ...(block.color ? { backgroundColor: `${block.color}15` } : {})
            }}
          >
            <div className="flex items-start justify-between gap-1 h-full">
              <div className="min-w-0 flex-1 flex flex-col justify-center h-full">
                {isShort ? (
                  <span className="text-xs text-[#d4d4d4] block truncate leading-tight">
                    <span className="text-[10px] text-[#999999] mr-1.5 tabular-nums">{block.startTime}–{block.endTime}</span>
                    {block.title}
                  </span>
                ) : (
                  <>
                    <span className="text-xs text-[#d4d4d4] block truncate leading-tight">{block.title}</span>
                    <span className="text-[10px] text-[#999999] leading-tight mt-0.5">
                      {block.startTime}–{block.endTime}
                      {block.type !== 'custom' && (
                        <span className="ml-1.5 text-[9px] uppercase tracking-wider opacity-60">
                          {TYPE_LABELS[block.type as TimeBlock['type']]}
                        </span>
                      )}
                    </span>
                  </>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(block.id)
                }}
                className="text-[#666666] hover:text-[#e04040] opacity-0 group-hover:opacity-100 text-xs leading-none shrink-0 self-start mt-0.5"
                title="Remover"
              >
                ×
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WeekView({
  days,
  blocksByDay,
  onDelete
}: {
  days: string[]
  blocksByDay: Map<string, TimeBlock[]>
  onDelete: (id: string) => void
}) {
  const isToday = (d: string) => d === todayStr()

  return (
    <div className="flex h-full">
      {/* Hour labels */}
      <div className="w-10 shrink-0 pt-8">
        {HOURS.map((h) => (
          <div key={h} className="text-[9px] text-[#666666] text-right pr-1" style={{ height: HOUR_HEIGHT }}>
            {String(h).padStart(2, '0')}h
          </div>
        ))}
      </div>

      {days.map((day) => {
        const blocks = blocksByDay.get(day) ?? []
        const d = new Date(day + 'T00:00:00')
        return (
          <div key={day} className="flex-1 min-w-0 border-l border-white/5">
            <div
              className={`text-center py-1.5 text-xs font-medium border-b border-white/5 ${
                isToday(day) ? 'text-[#a080f0] bg-[#a080f0]/10' : 'text-[#999999]'
              }`}
            >
              <div className="text-[10px] text-[#999999]">{WEEKDAY_SHORT[d.getDay()]}</div>
              <div>{d.getDate()}</div>
            </div>
            <div className="relative">
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="border-b border-white/[0.02]"
                  style={{ height: HOUR_HEIGHT / 2 }}
                />
              ))}
              {(() => {
                const laidOut = layoutOverlappingBlocks(blocks)
                return laidOut.map(({ block, col, cols }) => {
                  const top = minToPx(block.startTime)
                  const dur = durationMin(block.startTime, block.endTime)
                  const height = Math.max(dur * (HOUR_HEIGHT / 60), 4)
                  const pctLeft = cols > 1 ? (col / cols) * 100 : 0
                  const pctWidth = cols > 1 ? 100 / cols - 1 : 100
                  return (
                    <div
                      key={block.id}
                      className={`absolute rounded px-0.5 py-0.5 text-[9px] leading-tight overflow-hidden cursor-pointer group
                        ${TYPE_STYLES[block.type as TimeBlock['type']] ?? ''}`}
                      style={{
                        top,
                        height,
                        left: `${pctLeft}%`,
                        width: `${pctWidth}%`,
                        zIndex: col + 1,
                        ...(block.color
                          ? { backgroundColor: `${block.color}25`, borderLeftColor: block.color }
                          : { backgroundColor: '#ffffff15' })
                      }}
                      title={`${block.title} (${block.startTime}–${block.endTime})`}
                    >
                      <span className="block truncate text-[#d4d4d4]">{block.title}</span>
                      <span className="text-[#666666]">{block.startTime}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(block.id)
                        }}
                        className="absolute top-0 right-0 px-0.5 text-[#666666] hover:text-[#e04040] opacity-0 group-hover:opacity-100 leading-none"
                      >
                        ×
                      </button>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MonthView({
  days,
  blocksByDay
}: {
  days: string[]
  blocksByDay: Map<string, TimeBlock[]>
}) {
  const firstDayWeekday = new Date(days[0] + 'T00:00:00').getDay()
  const isToday = (d: string) => d === todayStr()

  return (
    <div className="p-3">
      <div className="grid grid-cols-7 gap-px bg-white/5 rounded-lg overflow-hidden">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="text-center py-1.5 text-[10px] text-[#999999] bg-[#1b1b1b]">
            {w}
          </div>
        ))}
        {/* Empty cells before first day */}
        {Array.from({ length: firstDayWeekday }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-[#1b1b1b]" />
        ))}
        {days.map((day) => {
          const blocks = blocksByDay.get(day) ?? []
          const d = new Date(day + 'T00:00:00')
          return (
            <div
              key={day}
              className={`min-h-[60px] p-1 bg-[#1b1b1b] border border-white/[0.03] ${
                isToday(day) ? 'ring-1 ring-[#a080f0]/30' : ''
              }`}
            >
              <div
                className={`text-xs mb-0.5 ${
                  isToday(day) ? 'text-[#a080f0] font-bold' : 'text-[#999999]'
                }`}
              >
                {d.getDate()}
              </div>
              {blocks.slice(0, 3).map((block) => (
                <div
                  key={block.id}
                  className="text-[8px] leading-tight truncate rounded px-0.5 mb-0.5"
                  style={{
                    background: block.color ? `${block.color}30` : '#ffffff10',
                    borderLeft: block.color ? `2px solid ${block.color}` : undefined
                  }}
                  title={`${block.startTime} ${block.title}`}
                >
                  {block.startTime} {block.title}
                </div>
              ))}
              {blocks.length > 3 && (
                <div className="text-[8px] text-[#666666]">+{blocks.length - 3}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RoutinesPanel({
  routines,
  onCreate,
  onDelete,
  onToggle
}: {
  routines: Routine[]
  onCreate: (data: Omit<Routine, 'id' | 'createdAt' | 'updatedAt'>) => string
  onDelete: (id: string) => void
  onToggle: (id: string, active: boolean) => void
}) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('09:00')
  const [selectedDays, setSelectedDays] = useState<number[]>([])

  const toggleDay = (d: number) => {
    setSelectedDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    )
  }

  const handleCreate = () => {
    const t = title.trim()
    if (!t || selectedDays.length === 0) return
    onCreate({
      title: t,
      startTime,
      endTime,
      daysOfWeek: selectedDays,
      color: TIME_BLOCK_COLORS[routines.length % TIME_BLOCK_COLORS.length],
      active: true
    })
    setTitle('')
    setStartTime('08:00')
    setEndTime('09:00')
    setSelectedDays([])
    setAdding(false)
  }

  return (
    <div className="border-t border-white/5 bg-[#1b1b1b] p-4 max-h-64 overflow-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-[#999999] uppercase tracking-wider">Rotinas</h3>
        <button
          onClick={() => setAdding(!adding)}
          className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-[#999999] hover:text-white hover:border-white/20 transition"
        >
          {adding ? 'Cancelar' : '+ Nova'}
        </button>
      </div>

      {adding && (
        <div className="mb-3 p-2 rounded bg-white/[0.04] border border-white/5 space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nome da rotina (ex: Academia)"
            className="w-full bg-[#1b1b1b] border border-white/10 rounded px-2 py-1 text-xs text-[#d4d4d4] placeholder:text-[#666666] outline-none focus:border-[#a080f0]/50"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[9px] text-[#999999] block mb-0.5">Início</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-[#1b1b1b] border border-white/10 rounded px-2 py-1 text-xs text-[#d4d4d4] outline-none focus:border-[#a080f0]/50"
              />
            </div>
            <div className="flex-1">
              <label className="text-[9px] text-[#999999] block mb-0.5">Fim</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-[#1b1b1b] border border-white/10 rounded px-2 py-1 text-xs text-[#d4d4d4] outline-none focus:border-[#a080f0]/50"
              />
            </div>
          </div>
          <div>
            <label className="text-[9px] text-[#999999] block mb-1">Dias</label>
            <div className="flex gap-1">
              {WEEKDAY_SHORT.map((name, i) => (
                <button
                  key={name}
                  onClick={() => toggleDay(i)}
                  className={`flex-1 text-[10px] py-1 rounded border transition ${
                    selectedDays.includes(i)
                      ? 'bg-[#a080f0]/20 border-[#a080f0]/40 text-[#a080f0]'
                      : 'border-white/10 text-[#999999] hover:text-[#d4d4d4]'
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || selectedDays.length === 0}
            className="w-full py-1.5 rounded bg-[#a080f0]/20 border border-[#a080f0]/30 text-xs text-[#a080f0] hover:bg-[#a080f0]/30 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            Criar rotina
          </button>
        </div>
      )}

      {routines.length === 0 && !adding ? (
        <p className="text-xs text-[#666666]">Nenhuma rotina. Clique "+ Nova" ou peça ao Assistente.</p>
      ) : (
        <div className="space-y-1.5">
          {routines.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 text-xs group"
            >
              <button
                onClick={() => onToggle(r.id, !r.active)}
                className={`w-4 h-4 rounded border transition shrink-0 ${
                  r.active ? 'bg-[#46d478] border-[#46d478]' : 'border-[#555555]'
                }`}
              />
              <div
                className="w-3 h-3 rounded shrink-0"
                style={{ background: r.color ?? '#7c3aed' }}
              />
              <span className={`flex-1 truncate ${r.active ? 'text-[#d4d4d4]' : 'text-[#999999]'}`}>
                {r.title}
              </span>
              <span className="text-[#999999] shrink-0">
                {r.startTime}–{r.endTime}
              </span>
              <span className="text-[#666666] shrink-0 hidden sm:inline">
                {r.daysOfWeek.map((d) => WEEKDAY_SHORT[d].slice(0, 3)).join(', ')}
              </span>
              <button
                onClick={() => onDelete(r.id)}
                className="text-[#666666] hover:text-[#e04040] opacity-0 group-hover:opacity-100 transition shrink-0"
                title="Remover rotina"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
