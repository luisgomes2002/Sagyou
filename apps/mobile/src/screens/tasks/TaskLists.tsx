import { isDoneColumn } from '@sagyou/core/columns'
import { formatDateBR, todayLocalISO } from '@sagyou/core/dates'
import type { Column, Task } from '@sagyou/core/types'
import { ListChecks } from 'lucide-react-native'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SwipeToComplete } from '../../components/SwipeToComplete'
import { ACTION_ICONS } from '../../components/icons'
import { Badge, Button, Card, Chip, EmptyState, ListItem, Screen } from '../../components/ui'
import { useApp } from '../../store/app'
import { completeFromList } from '../../store/complete'
import {
  UPCOMING_SECTION_TITLES,
  projectProgress,
  todaySummary,
  todayText,
  upcomingSections
} from '../../store/tasks'
import { FONT, RADIUS, SPACE, useTheme } from '../../theme'

export const UPCOMING_TITLE = 'Próximas'

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
  return (
    <SwipeToComplete enabled={canComplete} onComplete={() => completeFromList(task.id)}>
      <ListItem
        title={task.title}
        a11yLabel={task.title}
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
    </SwipeToComplete>
  )
}

/** The "Hoje" card on top, then the non-archived projects in the desktop's order. */
export function ProjectList({
  onOpen,
  onUpcoming,
  today = todayLocalISO()
}: {
  onOpen: (projectId: string) => void
  onUpcoming: () => void
  today?: string
}): React.JSX.Element {
  const theme = useTheme()
  const state = useApp((s) => s.state)
  const active = state.projects
    .filter((p) => !p.archivedAt)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const summary = todayText(todaySummary(state.tasks, state.projects, today))
  const Chevron = ACTION_ICONS.chevron
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
        {active.length === 0 ? (
          <EmptyState icon={ListChecks} text="Nenhum projeto ainda. Crie um no Sagyou do PC." />
        ) : null}
        {active.map((p) => {
          const progress = projectProgress(state, p.id)
          return (
            <ListItem
              key={p.id}
              title={p.name}
              a11yLabel={p.name}
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

/** Columns in the desktop's order, with Done ones moved to the end. */
function boardColumns(columns: Column[]): Column[] {
  const sorted = [...columns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return [...sorted.filter((c) => !isDoneColumn(c)), ...sorted.filter((c) => isDoneColumn(c))]
}

/** One project: its columns as chips, the chosen column's tasks below. */
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
  const state = useApp((s) => s.state)
  const readOnly = useApp((s) => s.readOnly)
  const project = state.projects.find((p) => p.id === projectId)
  const columns = boardColumns(project?.columns ?? [])
  const [chosen, setChosen] = useState<string | undefined>(columns[0]?.id)
  const column = columns.find((c) => c.id === chosen) ?? columns[0]
  const tasksOf = (columnId: string): Task[] =>
    state.tasks
      .filter((t) => t.projectId === projectId && t.columnId === columnId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const tasks = column ? tasksOf(column.id) : []
  const done = isDoneColumn(column)
  return (
    <ScrollView contentContainerStyle={styles.bottomRoom}>
      <Screen>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {columns.map((c) => {
            const label = `${c.name} · ${tasksOf(c.id).length}`
            return (
              <Chip
                key={c.id}
                label={label}
                selected={c.id === column?.id}
                onPress={() => setChosen(c.id)}
              />
            )
          })}
        </ScrollView>
        {tasks.length === 0 ? (
          <EmptyState icon={ListChecks} text="Nenhuma tarefa nesta coluna." />
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
        <Button
          label="Nova tarefa nesta coluna"
          icon={ACTION_ICONS.add}
          onPress={() => onNewTask(column?.id)}
          disabled={readOnly || !column}
        />
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
  dot: { width: 12, height: 12, borderRadius: 6 },
  track: { width: 64, height: 6, borderRadius: RADIUS.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: RADIUS.pill },
  chips: { gap: SPACE.sm },
  section: { gap: SPACE.sm },
  sectionTitle: { fontSize: FONT.caption, fontWeight: '600', textTransform: 'uppercase' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm },
  meta: { fontSize: FONT.caption }
})
