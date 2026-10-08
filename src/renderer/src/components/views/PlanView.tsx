import { useState, useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useKanbanStore } from '../../store/kanban'
import type { TimeBlock, TimeBlockBorderStyle, Routine } from '../../types'
import { TIME_BLOCK_COLORS } from '../../types'
import {
  addDays,
  addMonths,
  durationInMinutes,
  formatDay,
  formatShortDay,
  formatWeekStart,
  getVisibleDays,
  HOUR_HEIGHT,
  HOURS,
  layoutOverlappingBlocks,
  minutesToPixels,
  MODE_LABELS,
  timeBlockHeight,
  todayString,
  WEEKDAY_SHORT,
  type PlannerViewMode
} from '../../utils/planner'
import { ModalBase } from '../ModalBase'
import { CancelButton } from '../CancelButton'
import { ConfirmDialog } from '../ConfirmDialog'
import type { GlobalSearchHit } from '../../../../main/global-search-query'

const TYPE_LABELS: Record<TimeBlock['type'], string> = {
  task: 'Task',
  routine: 'Rotina',
  buffer: 'Buffer',
  custom: ''
}

function blockBorderStyle(block: TimeBlock): TimeBlockBorderStyle {
  return block.borderStyle ?? (block.type === 'buffer' ? 'dashed' : 'solid')
}

function plannerColor(color: string | undefined): string | undefined {
  return color || undefined
}

function blockAppearance(block: TimeBlock): CSSProperties {
  return {
    backgroundColor: '#2a2a2a',
    color: '#d4d4d4',
    border: `1px ${blockBorderStyle(block)} #777777`
  }
}

export function PlanView({ searchTarget }: { searchTarget?: GlobalSearchHit | null }) {
  const timeBlocks = useKanbanStore((s) => s.timeBlocks)
  const routines = useKanbanStore((s) => s.routines)
  const createTimeBlock = useKanbanStore((s) => s.createTimeBlock)
  const updateTimeBlock = useKanbanStore((s) => s.updateTimeBlock)
  const deleteTimeBlock = useKanbanStore((s) => s.deleteTimeBlock)
  const createRoutine = useKanbanStore((s) => s.createRoutine)
  const updateRoutine = useKanbanStore((s) => s.updateRoutine)
  const deleteRoutine = useKanbanStore((s) => s.deleteRoutine)

  const [viewMode, setViewMode] = useState<PlannerViewMode>('day')
  const [currentDate, setCurrentDate] = useState(
    searchTarget?.type === 'time_block' ? (searchTarget.date ?? todayString()) : todayString()
  )
  const [showRoutines, setShowRoutines] = useState(searchTarget?.type === 'routine')

  const [editingBlock, setEditingBlock] = useState<TimeBlock | null>(() =>
    searchTarget?.type === 'time_block'
      ? (timeBlocks.find((block) => block.id === searchTarget.id) ?? null)
      : null
  )
  const [creatingBlock, setCreatingBlock] = useState<{ date: string; hour: number } | null>(null)
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(() =>
    searchTarget?.type === 'routine'
      ? (routines.find((routine) => routine.id === searchTarget.id) ?? null)
      : null
  )
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null)
  const [deletingRoutineId, setDeletingRoutineId] = useState<string | null>(null)

  const navigate = (dir: number) => {
    if (viewMode === 'day') setCurrentDate(addDays(currentDate, dir))
    else if (viewMode === 'week') setCurrentDate(addDays(currentDate, dir * 7))
    else setCurrentDate(addMonths(currentDate, dir))
  }

  const goToday = () => setCurrentDate(todayString())

  const weekStart = formatWeekStart(currentDate)

  const visibleDays = useMemo(() => getVisibleDays(viewMode, currentDate), [viewMode, currentDate])

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
    setCreatingBlock({ date, hour: startHour })
  }

  const deletingBlock = deletingBlockId
    ? (timeBlocks.find((tb) => tb.id === deletingBlockId) ?? null)
    : null
  const deletingRoutine = deletingRoutineId
    ? (routines.find((r) => r.id === deletingRoutineId) ?? null)
    : null

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
              ? formatDay(currentDate)
              : viewMode === 'week'
                ? `${formatShortDay(weekStart)} – ${formatShortDay(addDays(weekStart, 6))}`
                : new Date(currentDate + 'T00:00:00').toLocaleDateString('pt-BR', {
                    month: 'long',
                    year: 'numeric'
                  })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(['day', 'week', 'month'] as PlannerViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 text-xs rounded-md border transition ${
                viewMode === mode
                  ? 'bg-[#3b3b3b] border-[#3b3b3b] text-[#a080f0]'
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
                ? 'bg-[#3b3b3b] border-[#3b3b3b] text-[#46d478]'
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
            onEditBlock={setEditingBlock}
            onDeleteRequest={setDeletingBlockId}
          />
        ) : viewMode === 'week' ? (
          <WeekView
            days={visibleDays}
            blocksByDay={blocksByDay}
            onEditBlock={setEditingBlock}
            onDeleteRequest={setDeletingBlockId}
          />
        ) : (
          <MonthView days={visibleDays} blocksByDay={blocksByDay} onEditBlock={setEditingBlock} />
        )}
      </div>

      {/* Routines panel */}
      {showRoutines && (
        <RoutinesPanel
          routines={routines}
          onCreate={createRoutine}
          onEditRoutine={setEditingRoutine}
          onDeleteRequest={setDeletingRoutineId}
          onToggle={(id, active) => updateRoutine(id, { active })}
        />
      )}

      {/* Edit TimeBlock modal */}
      {creatingBlock && (
        <EditTimeBlockModal
          date={creatingBlock.date}
          hour={creatingBlock.hour}
          routines={routines}
          onSave={({ title, startTime, endTime, color, borderStyle, type }) => {
            const existing = useKanbanStore
              .getState()
              .timeBlocks.filter((tb) => tb.date === creatingBlock.date)
            const order = existing.reduce((max, tb) => Math.max(max, tb.order), -1) + 1
            createTimeBlock({
              date: creatingBlock.date,
              title,
              startTime,
              endTime,
              color,
              borderStyle,
              type,
              order
            })
            setCreatingBlock(null)
          }}
          onClose={() => setCreatingBlock(null)}
        />
      )}
      {editingBlock && (
        <EditTimeBlockModal
          block={editingBlock}
          onSave={({ title, startTime, endTime, color, borderStyle }) => {
            updateTimeBlock(editingBlock.id, { title, startTime, endTime, color, borderStyle })
            setEditingBlock(null)
          }}
          onClose={() => setEditingBlock(null)}
        />
      )}

      {/* Edit Routine modal */}
      {editingRoutine && (
        <EditRoutineModal
          routine={editingRoutine}
          onSave={(updates) => {
            updateRoutine(editingRoutine.id, updates)
            setEditingRoutine(null)
          }}
          onClose={() => setEditingRoutine(null)}
        />
      )}

      {/* Delete TimeBlock confirmation */}
      <ConfirmDialog
        open={deletingBlockId !== null}
        title="Remover bloco"
        message={`Remover "${deletingBlock?.title ?? ''}"?\nEsta ação nao pode ser desfeita.`}
        confirmLabel="Remover"
        onConfirm={() => {
          if (deletingBlockId) deleteTimeBlock(deletingBlockId)
          setDeletingBlockId(null)
        }}
        onCancel={() => setDeletingBlockId(null)}
      />

      {/* Delete Routine confirmation */}
      <ConfirmDialog
        open={deletingRoutineId !== null}
        title="Remover rotina"
        message={`Remover "${deletingRoutine?.title ?? ''}"?\nEsta ação nao pode ser desfeita.`}
        confirmLabel="Remover"
        onConfirm={() => {
          if (deletingRoutineId) deleteRoutine(deletingRoutineId)
          setDeletingRoutineId(null)
        }}
        onCancel={() => setDeletingRoutineId(null)}
      />
    </div>
  )
}

function DayView({
  date,
  blocks,
  onAdd,
  onEditBlock,
  onDeleteRequest
}: {
  date: string
  blocks: TimeBlock[]
  onAdd: (date: string, hour: number) => void
  onEditBlock: (block: TimeBlock) => void
  onDeleteRequest: (id: string) => void
}) {
  const laidOut = useMemo(() => layoutOverlappingBlocks(blocks), [blocks])
  const offsetLeft = 56

  return (
    <div className="relative" style={{ height: HOURS.length * HOUR_HEIGHT + 32 }}>
      {/* Hour lines */}
      {HOURS.map((h) => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-white/5 flex items-start"
          style={{ top: minutesToPixels(`${String(h).padStart(2, '0')}:00`) }}
        >
          <span className="text-[10px] text-[#999999] w-12 text-right pr-2 leading-none pt-0.5 tabular-nums">
            {String(h).padStart(2, '0')}:00
          </span>
          <button
            type="button"
            aria-label={`Adicionar bloco às ${String(h).padStart(2, '0')}:00`}
            className="flex-1 h-10 cursor-pointer hover:bg-[#2a2a2a]"
            onClick={() => onAdd(date, h)}
          />
        </div>
      ))}

      {/* Blocks */}
      {laidOut.map((lb) => {
        const { block, col, cols } = lb
        const top = minutesToPixels(block.startTime)
        const dur = durationInMinutes(block.startTime, block.endTime)
        const height = timeBlockHeight(block.startTime, block.endTime)
        const isShort = dur < 45
        const gapX = 4
        const availWidth = `calc(100% - ${offsetLeft + 8}px)`
        const colWidth = `calc((${availWidth} - ${(cols - 1) * gapX}px) / ${cols})`
        const left = `calc(${offsetLeft + 4}px + ${col} * (${colWidth} + ${gapX}px))`
        return (
          <div
            key={block.id}
            className="absolute rounded-md px-2 cursor-pointer group z-10 hover:brightness-110 overflow-hidden"
            style={{
              top,
              height,
              left,
              width: colWidth,
              ...blockAppearance(block)
            }}
            onClick={() => onEditBlock(block)}
            title={`${block.title} (${block.startTime}–${block.endTime})`}
          >
            <div className="flex items-start justify-between gap-1 h-full">
              <div className="min-w-0 flex-1 flex flex-col justify-center h-full">
                {isShort ? (
                  <span className="text-xs block truncate leading-tight">
                    <span
                      className="text-[10px] mr-1.5 tabular-nums font-semibold"
                      style={{ color: plannerColor(block.color) ?? '#a080f0' }}
                    >
                      {block.startTime}–{block.endTime}
                    </span>
                    {block.title}
                  </span>
                ) : (
                  <>
                    <span className="text-xs block truncate leading-tight">{block.title}</span>
                    <span
                      className="text-[10px] leading-tight mt-0.5 font-medium"
                      style={{ color: plannerColor(block.color) ?? '#a080f0' }}
                    >
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
                  onDeleteRequest(block.id)
                }}
                className="opacity-0 group-hover:opacity-100 text-xs leading-none shrink-0 self-start mt-0.5"
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
  onEditBlock,
  onDeleteRequest
}: {
  days: string[]
  blocksByDay: Map<string, TimeBlock[]>
  onEditBlock: (block: TimeBlock) => void
  onDeleteRequest: (id: string) => void
}) {
  const isToday = (d: string) => d === todayString()

  return (
    <div className="flex h-full">
      {/* Hour labels */}
      <div className="w-10 shrink-0 pt-8">
        {HOURS.map((h) => (
          <div
            key={h}
            className="text-[9px] text-[#666666] text-right pr-1"
            style={{ height: HOUR_HEIGHT }}
          >
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
                isToday(day) ? 'text-[#a080f0] bg-[#2a2a2a]' : 'text-[#999999]'
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
                  style={{ height: HOUR_HEIGHT }}
                />
              ))}
              {(() => {
                const laidOut = layoutOverlappingBlocks(blocks)
                return laidOut.map(({ block, col, cols }) => {
                  const top = minutesToPixels(block.startTime)
                  const dur = durationInMinutes(block.startTime, block.endTime)
                  const height = timeBlockHeight(block.startTime, block.endTime)
                  const pctLeft = cols > 1 ? (col / cols) * 100 : 0
                  const pctWidth = cols > 1 ? 100 / cols - 1 : 100
                  return (
                    <div
                      key={block.id}
                      className="absolute rounded px-0.5 py-0.5 text-[9px] leading-tight overflow-hidden cursor-pointer group z-10 hover:brightness-110"
                      style={{
                        top,
                        height,
                        left: `${pctLeft}%`,
                        width: `${pctWidth}%`,
                        zIndex: col + 1,
                        ...blockAppearance(block)
                      }}
                      title={`${block.title} (${block.startTime}–${block.endTime})`}
                      onClick={() => onEditBlock(block)}
                    >
                      <span className="block truncate">{block.title}</span>
                      {dur > 20 && (
                        <span style={{ color: plannerColor(block.color) ?? '#a080f0' }}>
                          {block.startTime}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteRequest(block.id)
                        }}
                        className="absolute top-0 right-0 px-0.5 opacity-0 group-hover:opacity-100 leading-none"
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
  blocksByDay,
  onEditBlock
}: {
  days: string[]
  blocksByDay: Map<string, TimeBlock[]>
  onEditBlock?: (block: TimeBlock) => void
}) {
  const firstDayWeekday = new Date(days[0] + 'T00:00:00').getDay()
  const isToday = (d: string) => d === todayString()

  return (
    <div className="p-3">
      <div className="grid grid-cols-7 gap-px bg-[#2a2a2a] rounded-lg overflow-hidden">
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
                  className={`text-[8px] leading-tight truncate rounded px-0.5 mb-0.5 ${
                    onEditBlock ? 'cursor-pointer hover:brightness-125' : ''
                  }`}
                  style={{
                    ...blockAppearance(block)
                  }}
                  title={`${block.startTime} ${block.title}`}
                  onClick={() => onEditBlock?.(block)}
                >
                  <span style={{ color: plannerColor(block.color) ?? '#a080f0' }}>
                    {block.startTime}
                  </span>{' '}
                  {block.title}
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

function EditTimeBlockModal({
  block,
  date,
  hour,
  routines = [],
  onSave,
  onClose
}: {
  block?: TimeBlock
  date?: string
  hour?: number
  routines?: Routine[]
  onSave: (updates: {
    title: string
    startTime: string
    endTime: string
    color?: string
    borderStyle: TimeBlockBorderStyle
    type: TimeBlock['type']
  }) => void
  onClose: () => void
}) {
  const defaultStartTime = `${String(hour ?? 8).padStart(2, '0')}:00`
  const defaultEndTime = hour === 23 ? '23:59' : `${String((hour ?? 8) + 1).padStart(2, '0')}:00`
  const [selectedRoutineId, setSelectedRoutineId] = useState('')
  const [title, setTitle] = useState(block?.title ?? '')
  const [startTime, setStartTime] = useState(block?.startTime ?? defaultStartTime)
  const [endTime, setEndTime] = useState(block?.endTime ?? defaultEndTime)
  const [color, setColor] = useState(block?.color ?? TIME_BLOCK_COLORS[0])
  const [borderStyle, setBorderStyle] = useState<TimeBlockBorderStyle>(
    block ? blockBorderStyle(block) : 'solid'
  )
  const selectedWeekday = date ? new Date(`${date}T00:00:00`).getDay() : -1

  const selectRoutine = (id: string): void => {
    setSelectedRoutineId(id)
    const routine = routines.find((item) => item.id === id)
    if (routine) {
      setTitle(routine.title)
      setStartTime(routine.startTime)
      setEndTime(routine.endTime)
      setColor(routine.color ?? TIME_BLOCK_COLORS[0])
      setBorderStyle(routine.borderStyle ?? 'solid')
    } else {
      setTitle('')
      setStartTime(defaultStartTime)
      setEndTime(defaultEndTime)
      setColor(TIME_BLOCK_COLORS[0])
      setBorderStyle('solid')
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !startTime || !endTime || endTime <= startTime) return
    onSave({
      title: title.trim(),
      startTime,
      endTime,
      color,
      borderStyle,
      type: selectedRoutineId ? 'routine' : (block?.type ?? 'custom')
    })
  }

  return (
    <ModalBase open={true} onClose={onClose}>
      <div className="relative z-10 w-full max-w-xs mx-4 rounded-xl border border-[#3b3b3b] bg-[#232323] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3b3b3b]">
          <h2 className="text-sm font-semibold text-[#d4d4d4]">
            {block ? 'Editar bloco' : `Novo bloco · ${date?.split('-').reverse().join('/')}`}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
          >
            <svg
              width="14"
              height="14"
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {!block && (
            <div>
              <label
                htmlFor="block-routine"
                className="block text-xs font-medium text-[#999999] mb-1.5"
              >
                Criar a partir de
              </label>
              <select
                id="block-routine"
                value={selectedRoutineId}
                onChange={(e) => selectRoutine(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed]"
              >
                <option value="">Bloco novo</option>
                {routines
                  .filter(
                    (routine) => routine.active && routine.daysOfWeek.includes(selectedWeekday)
                  )
                  .map((routine) => (
                    <option key={routine.id} value={routine.id}>
                      {routine.title} · {routine.startTime}–{routine.endTime}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-[#999999] mb-1.5">Título *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nome do bloco"
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-[#999999] mb-1.5">Início</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors [color-scheme:dark]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-[#999999] mb-1.5">Fim</label>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors [color-scheme:dark]"
              />
            </div>
          </div>
          {startTime && endTime && endTime <= startTime && (
            <p className="text-xs text-[#ec6a6a]">O fim precisa ser depois do início.</p>
          )}

          <div>
            <label className="block text-xs font-medium text-[#999999] mb-2">Cor</label>
            <div className="flex gap-2 flex-wrap">
              {TIME_BLOCK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: plannerColor(c),
                    boxShadow: color === c ? '0 0 0 2px #232323, 0 0 0 4px #d4d4d4' : 'none'
                  }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#999999] mb-2">Borda</label>
            <div className="grid grid-cols-2 gap-2">
              {(['solid', 'dashed'] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => setBorderStyle(style)}
                  className={`px-3 py-2 rounded-lg border text-xs transition-colors ${
                    borderStyle === style
                      ? 'border-[#7c3aed] bg-[#3b3b3b] text-[#d4d4d4]'
                      : 'border-[#3b3b3b] bg-[#1b1b1b] text-[#999999] hover:border-[#555555]'
                  }`}
                >
                  <span
                    className={`block border-t-2 ${style === 'dashed' ? 'border-dashed' : 'border-solid'}`}
                    style={{ borderColor: color }}
                  />
                  <span className="block mt-1">{style === 'solid' ? 'Reta' : 'Pontilhada'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <CancelButton onClick={onClose}>Cancelar</CancelButton>
            <button
              type="submit"
              disabled={!title.trim() || !startTime || !endTime || endTime <= startTime}
              className="px-4 py-2 text-sm rounded-lg bg-[#7c3aed] text-white font-medium hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {block ? 'Salvar' : 'Criar bloco'}
            </button>
          </div>
        </form>
      </div>
    </ModalBase>
  )
}

function EditRoutineModal({
  routine,
  onSave,
  onClose
}: {
  routine: Routine
  onSave: (updates: {
    title: string
    startTime: string
    endTime: string
    daysOfWeek: number[]
    color?: string
    borderStyle: TimeBlockBorderStyle
  }) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(routine.title)
  const [startTime, setStartTime] = useState(routine.startTime)
  const [endTime, setEndTime] = useState(routine.endTime)
  const [selectedDays, setSelectedDays] = useState<number[]>([...routine.daysOfWeek])
  const [color, setColor] = useState(routine.color ?? TIME_BLOCK_COLORS[0])
  const [borderStyle, setBorderStyle] = useState<TimeBlockBorderStyle>(
    routine.borderStyle ?? 'solid'
  )

  const toggleDay = (d: number) => {
    setSelectedDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || selectedDays.length === 0) return
    onSave({
      title: title.trim(),
      startTime,
      endTime,
      daysOfWeek: selectedDays,
      color,
      borderStyle
    })
  }

  return (
    <ModalBase open={true} onClose={onClose}>
      <div className="relative z-10 w-full max-w-xs mx-4 rounded-xl border border-[#3b3b3b] bg-[#232323] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3b3b3b]">
          <h2 className="text-sm font-semibold text-[#d4d4d4]">Editar rotina</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
          >
            <svg
              width="14"
              height="14"
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#999999] mb-1.5">Titulo *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nome da rotina"
              autoFocus
              className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] placeholder-[#999999] focus:outline-none focus:border-[#7c3aed] transition-colors"
            />
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs font-medium text-[#999999] mb-1.5">Inicio</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors [color-scheme:dark]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-[#999999] mb-1.5">Fim</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] text-sm text-[#d4d4d4] focus:outline-none focus:border-[#7c3aed] transition-colors [color-scheme:dark]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#999999] mb-1.5">Dias *</label>
            <div className="flex gap-1">
              {WEEKDAY_SHORT.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`flex-1 text-[10px] py-1 rounded border transition ${
                    selectedDays.includes(i)
                      ? 'bg-[#3b3b3b] border-[#3b3b3b] text-[#a080f0]'
                      : 'border-white/10 text-[#999999] hover:text-[#d4d4d4]'
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#999999] mb-2">Cor</label>
            <div className="flex gap-2 flex-wrap">
              {TIME_BLOCK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: plannerColor(c),
                    boxShadow: color === c ? '0 0 0 2px #232323, 0 0 0 4px #d4d4d4' : 'none'
                  }}
                />
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-[#999999] mb-2">Borda</span>
            <div className="grid grid-cols-2 gap-2">
              {(['solid', 'dashed'] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  aria-pressed={borderStyle === style}
                  onClick={() => setBorderStyle(style)}
                  className={`rounded-lg border px-3 py-2 text-xs ${borderStyle === style ? 'border-[#a080f0] bg-[#3b3b3b] text-[#d4d4d4]' : 'border-[#3b3b3b] bg-[#1b1b1b] text-[#999999]'}`}
                >
                  <span
                    className={`block border-t-2 ${style === 'dashed' ? 'border-dashed' : 'border-solid'}`}
                    style={{ borderColor: style === 'dashed' ? '#b0b0b0' : '#777777' }}
                  />
                  <span className="block mt-1">{style === 'solid' ? 'Reta' : 'Pontilhada'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <CancelButton onClick={onClose}>Cancelar</CancelButton>
            <button
              type="submit"
              disabled={!title.trim() || selectedDays.length === 0}
              className="px-4 py-2 text-sm rounded-lg bg-[#7c3aed] text-white font-medium hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Salvar
            </button>
          </div>
        </form>
      </div>
    </ModalBase>
  )
}

function RoutinesPanel({
  routines,
  onCreate,
  onEditRoutine,
  onDeleteRequest,
  onToggle
}: {
  routines: Routine[]
  onCreate: (data: Omit<Routine, 'id' | 'createdAt' | 'updatedAt'>) => string
  onEditRoutine: (routine: Routine) => void
  onDeleteRequest: (id: string) => void
  onToggle: (id: string, active: boolean) => void
}) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('09:00')
  const [selectedDays, setSelectedDays] = useState<number[]>([])
  const [borderStyle, setBorderStyle] = useState<TimeBlockBorderStyle>('solid')

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
      borderStyle,
      active: true
    })
    setTitle('')
    setStartTime('08:00')
    setEndTime('09:00')
    setSelectedDays([])
    setBorderStyle('solid')
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
        <div className="mb-3 p-2 rounded bg-[#2a2a2a] border border-[#3b3b3b] space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nome da rotina (ex: Academia)"
            className="w-full bg-[#1b1b1b] border border-white/10 rounded px-2 py-1 text-xs text-[#d4d4d4] placeholder:text-[#666666] outline-none focus:border-[#a080f0]"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[9px] text-[#999999] block mb-0.5">Inicio</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-[#1b1b1b] border border-white/10 rounded px-2 py-1 text-xs text-[#d4d4d4] outline-none focus:border-[#a080f0] [color-scheme:dark]"
              />
            </div>
            <div className="flex-1">
              <label className="text-[9px] text-[#999999] block mb-0.5">Fim</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-[#1b1b1b] border border-white/10 rounded px-2 py-1 text-xs text-[#d4d4d4] outline-none focus:border-[#a080f0] [color-scheme:dark]"
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
                      ? 'bg-[#3b3b3b] border-[#3b3b3b] text-[#a080f0]'
                      : 'border-white/10 text-[#999999] hover:text-[#d4d4d4]'
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-[9px] text-[#999999] block mb-1">Borda</span>
            <div className="flex gap-2">
              {(['solid', 'dashed'] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  aria-pressed={borderStyle === style}
                  onClick={() => setBorderStyle(style)}
                  className={`flex-1 rounded border px-2 py-1 text-[10px] ${borderStyle === style ? 'border-[#a080f0] bg-[#3b3b3b] text-[#d4d4d4]' : 'border-[#555555] text-[#999999]'}`}
                >
                  {style === 'solid' ? 'Reta' : 'Pontilhada'}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || selectedDays.length === 0}
            className="w-full py-1.5 rounded bg-[#3b3b3b] border border-[#3b3b3b] text-xs text-[#a080f0] hover:bg-[#4a4a4a] disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            Criar rotina
          </button>
        </div>
      )}

      {routines.length === 0 && !adding ? (
        <p className="text-xs text-[#666666]">
          Nenhuma rotina. Clique "+ Nova" ou peca ao Assistente.
        </p>
      ) : (
        <div className="space-y-1.5">
          {routines.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 text-xs group cursor-pointer hover:bg-[#2a2a2a] rounded px-0.5 py-0.5 -mx-0.5"
              onClick={() => onEditRoutine(r)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(r.id, !r.active)
                }}
                className={`w-4 h-4 rounded border transition shrink-0 ${
                  r.active ? 'bg-[#46d478] border-[#46d478]' : 'border-[#555555]'
                }`}
              />
              <div
                className="w-3 h-3 rounded shrink-0"
                style={{ backgroundColor: plannerColor(r.color) ?? '#2a2a2a' }}
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
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteRequest(r.id)
                }}
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
