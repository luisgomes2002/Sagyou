import { formatDateBR, todayLocalISO } from '@sagyou/core/dates'
import type { Task } from '@sagyou/core/types'
import { ListChecks } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Skeleton } from '../../components/Skeleton'
import { ACTION_ICONS } from '../../components/icons'
import { Badge, Button, Card, EmptyState, ListItem, Screen } from '../../components/ui'
import { awaitingFirstSync, useApp } from '../../store/app'
import { completeFromList } from '../../store/complete'
import {
  ALL_FILTER,
  TASK_FILTER_TEXTS,
  allTaskSections,
  boardSections,
  defaultFilter,
  normalizeFilter,
  openCountText,
  readFilter,
  scopeTasks,
  writeFilter,
  type TaskFilter
} from '../../store/taskFilters'
import {
  UPCOMING_SECTION_TITLES,
  projectA11yLabel,
  taskA11yLabel,
  projectProgress,
  todaySummary,
  todayText,
  upcomingSections
} from '../../store/tasks'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../../theme'
import { FilterBar } from './FilterBar'

export const UPCOMING_TITLE = 'Próximas'
export const ALL_TASKS_TITLE = TASK_FILTER_TEXTS.allTitle

function DueText({ task, today }: { task: Task; today: string }): React.JSX.Element | null {
  const theme = useTheme()
  if (!task.dueDate) return null
  const overdue = task.dueDate < today
  const isToday = task.dueDate === today
  return (
    <Text
      testID={`due-${task.id}`}
      style={[
        styles.meta,
        { color: overdue ? theme.red : isToday ? theme.attention : theme.muted }
      ]}
    >
      {overdue
        ? `Atrasada · ${formatDateBR(task.dueDate)}`
        : isToday
          ? 'Vence hoje'
          : formatDateBR(task.dueDate)}
    </Text>
  )
}

function TaskRow({
  task,
  today,
  projectName,
  done,
  onOpen
}: {
  task: Task
  today: string
  projectName?: string
  done?: boolean
  onOpen: () => void
}): React.JSX.Element {
  const theme = useTheme()
  const readOnly = useApp((s) => s.readOnly)
  const canComplete = !done && !readOnly
  const Flag = ACTION_ICONS.priority
  const flagColor =
    task.priority === 'urgent' ? theme.red : task.priority === 'high' ? theme.attention : null
  const tags = task.tags ?? []
  // The box and the row are siblings, so a screen reader focuses each on its
  // own; no sideways gesture completes anything (spec 2026-11-10).
  return (
    <View style={styles.taskRow}>
      {done ? null : (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`Concluir ${task.title}`}
          accessibilityState={{ checked: false, disabled: readOnly }}
          disabled={readOnly}
          onPress={() => completeFromList(task.id)}
          style={styles.check}
        >
          <View style={[styles.box, { borderColor: readOnly ? theme.border : theme.muted }]} />
        </Pressable>
      )}
      <View style={styles.rowBody}>
        <ListItem
          title={task.title}
          a11yLabel={taskA11yLabel(task, today, projectName)}
          onPress={onOpen}
          a11yActions={canComplete ? [{ name: 'concluir', label: 'Concluir' }] : undefined}
          onA11yAction={(e) => {
            if (e.nativeEvent.actionName === 'concluir') completeFromList(task.id)
          }}
          left={flagColor ? <Flag size={18} color={flagColor} /> : undefined}
          subtitle={
            task.dueDate || projectName || tags.length ? (
              <View style={styles.metaRow}>
                <DueText task={task} today={today} />
                {projectName ? (
                  <Text style={[styles.meta, { color: theme.muted }]}>{projectName}</Text>
                ) : null}
                {tags.slice(0, 2).map((tag) => (
                  <Badge key={tag} text={tag} />
                ))}
                {tags.length > 2 ? <Badge text={`+${tags.length - 2}`} /> : null}
              </View>
            ) : undefined
          }
        />
      </View>
    </View>
  )
}

/** The "Hoje" card on top, then the non-archived projects in the desktop's order. */
export function ProjectList({
  onOpen,
  onUpcoming,
  onAll,
  today = todayLocalISO()
}: {
  onOpen: (projectId: string) => void
  onUpcoming: () => void
  onAll: () => void
  today?: string
}): React.JSX.Element {
  const theme = useTheme()
  const state = useApp((s) => s.state)
  const active = state.projects
    .filter((p) => !p.archivedAt)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const waiting = useApp((s) => awaitingFirstSync(s.status))
  const summary = todayText(todaySummary(state.tasks, state.projects, today))
  const Chevron = ACTION_ICONS.chevron
  const openCount = openCountText(scopeTasks(state, null).length)
  return (
    <ScrollView contentContainerStyle={styles.bottomRoom}>
      <Screen>
        <Card onPress={onUpcoming} a11yLabel={`Hoje: ${summary}`}>
          <View style={styles.cardRow}>
            <View style={{ flex: 1, gap: SPACE.xs }}>
              <Text style={[styles.caption, { color: theme.muted }]}>Hoje</Text>
              <Text style={[styles.summary, { color: theme.text }]}>{summary}</Text>
            </View>
            <Chevron size={20} color={theme.onSurfaceIcon} />
          </View>
        </Card>
        <Card onPress={onAll} a11yLabel={`${ALL_TASKS_TITLE}: ${openCount}`}>
          <View style={styles.cardRow}>
            <View style={{ flex: 1, gap: SPACE.xs }}>
              <Text style={[styles.caption, { color: theme.muted }]}>{ALL_TASKS_TITLE}</Text>
              <Text style={[styles.cardValue, { color: theme.text }]}>{openCount}</Text>
            </View>
            <Chevron size={20} color={theme.onSurfaceIcon} />
          </View>
        </Card>
        {active.length === 0 ? (
          waiting ? (
            <Skeleton />
          ) : (
            <EmptyState icon={ListChecks} text="Nenhum projeto ainda. Crie um no Sagyou do PC." />
          )
        ) : null}
        {active.map((p) => {
          const progress = projectProgress(state, p.id)
          return (
            <ListItem
              key={p.id}
              title={p.name}
              a11yLabel={projectA11yLabel(p.name, progress)}
              onPress={() => onOpen(p.id)}
              left={<View style={[styles.dot, { backgroundColor: p.color }]} />}
              subtitle={`${progress.open} ${progress.open === 1 ? 'aberta' : 'abertas'}`}
              right={
                <View
                  testID={`progress-${p.id}`}
                  accessibilityRole="progressbar"
                  accessibilityLabel={`${progress.done} de ${progress.total} concluídas`}
                  accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}
                  style={[styles.track, { backgroundColor: theme.selected }]}
                >
                  <View
                    style={[
                      styles.fill,
                      {
                        backgroundColor: theme.purple,
                        width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`
                      }
                    ]}
                  />
                </View>
              }
            />
          )
        })}
      </Screen>
    </ScrollView>
  )
}

/** A section header that opens and closes its list: "<name> (<n>)". */
function SectionHeader({
  label,
  expanded,
  onToggle
}: {
  label: string
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  const theme = useTheme()
  const Chevron = ACTION_ICONS.chevron
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={styles.sectionHeader}
    >
      <Text style={[styles.sectionTitle, { color: theme.muted }]}>{label}</Text>
      <View style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}>
        <Chevron size={18} color={theme.onSurfaceIcon} />
      </View>
    </Pressable>
  )
}

/**
 * One project: the filter chips, then every column as a section (Done last,
 * closed). The filter is remembered per project on this phone.
 */
export function ProjectBoard({
  projectId,
  onOpenTask,
  onNewTask,
  today = todayLocalISO()
}: {
  projectId: string
  onOpenTask: (taskId: string) => void
  onNewTask: (columnId?: string) => void
  today?: string
}): React.JSX.Element {
  const theme = useTheme()
  const state = useApp((s) => s.state)
  const readOnly = useApp((s) => s.readOnly)
  const repo = useApp((s) => s.services?.repo)
  const [chosen, setFilterState] = useState<TaskFilter>(() =>
    repo ? readFilter(repo, state, projectId) : defaultFilter(state, projectId)
  )
  // What arrives by sync while the board is open may retire the chosen sprint or tag.
  const filter = normalizeFilter(state, projectId, chosen)
  const setFilter = (next: TaskFilter): void => {
    setFilterState(next)
    if (repo) writeFilter(repo, projectId, next)
  }
  // Open/closed is not remembered: Done starts closed, the rest open.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const sections = boardSections(state, projectId, filter)
  const scope = { projectId, tasks: state.tasks.filter((t) => t.projectId === projectId) }
  const nothing = scope.tasks.length > 0 && sections.every((section) => section.tasks.length === 0)
  return (
    <ScrollView contentContainerStyle={styles.bottomRoom}>
      <Screen>
        <FilterBar
          filter={filter}
          onChange={setFilter}
          kinds={['sprint', 'priority', 'tag']}
          scope={scope}
        />
        {sections.length === 0 ? (
          <EmptyState icon={ListChecks} text="Nenhuma tarefa nesta coluna." />
        ) : null}
        {nothing ? (
          <View style={styles.section}>
            <Text style={[styles.meta, { color: theme.muted }]}>{TASK_FILTER_TEXTS.noMatch}</Text>
            <Button
              variant="secondary"
              label={TASK_FILTER_TEXTS.clear}
              onPress={() => setFilter(ALL_FILTER)}
            />
          </View>
        ) : null}
        {sections.map(({ column, tasks, done }) => {
          const expanded = toggled[column.id] ?? !done
          return (
            <View key={column.id} style={styles.section}>
              <SectionHeader
                label={`${column.name} (${tasks.length})`}
                expanded={expanded}
                onToggle={() => setToggled((t) => ({ ...t, [column.id]: !expanded }))}
              />
              {expanded ? (
                <>
                  {tasks.length === 0 ? (
                    <Text style={[styles.meta, { color: theme.muted }]}>
                      {TASK_FILTER_TEXTS.noneHere}
                    </Text>
                  ) : null}
                  {tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      today={today}
                      done={done}
                      onOpen={() => onOpenTask(task.id)}
                    />
                  ))}
                  {done ? null : (
                    <Button
                      variant="ghost"
                      label={TASK_FILTER_TEXTS.newIn(column.name)}
                      icon={ACTION_ICONS.add}
                      onPress={() => onNewTask(column.id)}
                      disabled={readOnly}
                    />
                  )}
                </>
              ) : null}
            </View>
          )
        })}
      </Screen>
    </ScrollView>
  )
}

/** Open tasks of every active project, grouped by project, with Prioridade and Tag. */
export function AllTasksList({
  onOpenTask,
  today = todayLocalISO()
}: {
  onOpenTask: (projectId: string, taskId: string) => void
  today?: string
}): React.JSX.Element {
  const theme = useTheme()
  const state = useApp((s) => s.state)
  const repo = useApp((s) => s.services?.repo)
  const [chosen, setFilterState] = useState<TaskFilter>(() =>
    repo ? readFilter(repo, state, null) : ALL_FILTER
  )
  const filter = normalizeFilter(state, null, chosen)
  const setFilter = (next: TaskFilter): void => {
    setFilterState(next)
    if (repo) writeFilter(repo, null, next)
  }
  const open = scopeTasks(state, null)
  const sections = allTaskSections(state, filter)
  return (
    <ScrollView contentContainerStyle={styles.bottomRoom}>
      <Screen>
        {open.length === 0 ? (
          <EmptyState icon={ListChecks} text={TASK_FILTER_TEXTS.noOpen} />
        ) : (
          <FilterBar
            filter={filter}
            onChange={setFilter}
            kinds={['priority', 'tag']}
            scope={{ projectId: null, tasks: open }}
          />
        )}
        {open.length > 0 && sections.length === 0 ? (
          <View style={styles.section}>
            <Text style={[styles.meta, { color: theme.muted }]}>{TASK_FILTER_TEXTS.noMatch}</Text>
            <Button
              variant="secondary"
              label={TASK_FILTER_TEXTS.clear}
              onPress={() => setFilter(ALL_FILTER)}
            />
          </View>
        ) : null}
        {sections.map(({ project, tasks }) => (
          <View key={project.id} style={styles.section}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.muted }]}>
              {`${project.name} (${tasks.length})`}
            </Text>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                onOpen={() => onOpenTask(task.projectId, task.id)}
              />
            ))}
          </View>
        ))}
      </Screen>
    </ScrollView>
  )
}

/** Every unfinished task with a due date, in sections: Atrasadas, Hoje, Amanhã… */
export function UpcomingList({
  onOpenTask,
  today = todayLocalISO()
}: {
  onOpenTask: (projectId: string, taskId: string) => void
  today?: string
}): React.JSX.Element {
  const theme = useTheme()
  const state = useApp((s) => s.state)
  const sections = upcomingSections(state.tasks, state.projects, today)
  const projectName = (id: string): string => state.projects.find((p) => p.id === id)?.name ?? ''
  return (
    <ScrollView contentContainerStyle={styles.bottomRoom}>
      <Screen>
        {sections.length === 0 ? (
          <EmptyState icon={ListChecks} text="Nenhuma tarefa com prazo." />
        ) : null}
        {sections.map((section) => (
          <View key={section.key} style={styles.section}>
            <Text
              accessibilityRole="header"
              style={[
                styles.sectionTitle,
                { color: section.key === 'overdue' ? theme.red : theme.muted }
              ]}
            >
              {UPCOMING_SECTION_TITLES[section.key]}
            </Text>
            {section.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                projectName={projectName(task.projectId)}
                onOpen={() => onOpenTask(task.projectId, task.id)}
              />
            ))}
          </View>
        ))}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  // Room under the last row for the (+) and the notice.
  bottomRoom: { paddingBottom: 96 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
  caption: { fontSize: FONT.caption },
  summary: { fontSize: FONT.title, fontWeight: '600' },
  cardValue: { fontSize: FONT.bodyLg, fontWeight: '600' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  track: { width: 64, height: 6, borderRadius: RADIUS.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: RADIUS.pill },
  chips: { gap: SPACE.sm },
  section: { gap: SPACE.sm },
  sectionHeader: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  sectionTitle: { fontSize: FONT.caption, fontWeight: '600', textTransform: 'uppercase' },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs },
  check: { width: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  box: { width: 22, height: 22, borderRadius: RADIUS.control / 2, borderWidth: 2 },
  rowBody: { flex: 1, minWidth: 0 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm },
  meta: { fontSize: FONT.caption }
})
