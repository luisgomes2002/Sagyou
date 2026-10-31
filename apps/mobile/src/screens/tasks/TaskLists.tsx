import { isDoneColumn } from '@sagyou/core/columns'
import { formatDateBR, todayLocalISO } from '@sagyou/core/dates'
import { upcomingTasks } from '@sagyou/core/dueDates'
import type { Task } from '@sagyou/core/types'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Screen } from '../../components/ui'
import { useApp } from '../../store/app'
import { completeTask } from '../../store/tasks'
import { useTheme } from '../../theme'

export const UPCOMING_TITLE = 'Próximas'

function TaskRow({
  task,
  subtitle,
  overdue,
  onOpen,
  onComplete
}: {
  task: Task
  subtitle?: string
  overdue?: boolean
  onOpen: () => void
  onComplete?: () => void
}): React.JSX.Element {
  const theme = useTheme()
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={task.title} onPress={onOpen}>
        <Text style={{ color: theme.text, fontSize: 15 }}>{task.title}</Text>
        {subtitle ? (
          <Text style={{ color: overdue ? theme.red : theme.muted, fontSize: 12 }}>{subtitle}</Text>
        ) : null}
      </Pressable>
      {onComplete ? <Button label="Concluir" onPress={onComplete} /> : null}
    </Card>
  )
}

/** Non-archived projects, in the desktop's order. */
export function ProjectList({
  onOpen,
  onUpcoming
}: {
  onOpen: (projectId: string) => void
  onUpcoming: () => void
}): React.JSX.Element {
  const theme = useTheme()
  const projects = useApp((s) => s.state.projects)
  const active = projects
    .filter((p) => !p.archivedAt)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return (
    <ScrollView>
      <Screen>
        <Button label={UPCOMING_TITLE} onPress={onUpcoming} />
        {active.length === 0 ? (
          <Text style={{ color: theme.muted }}>Nenhum projeto ainda. Crie um no Sagyou do PC.</Text>
        ) : null}
        {active.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={p.name}
            onPress={() => onOpen(p.id)}
            style={[styles.project, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <View style={[styles.dot, { backgroundColor: p.color }]} />
            <Text style={{ color: theme.text, fontSize: 15 }}>{p.name}</Text>
          </Pressable>
        ))}
      </Screen>
    </ScrollView>
  )
}

/** One project's tasks, grouped by column. */
export function ProjectBoard({
  projectId,
  onOpenTask,
  onNewTask
}: {
  projectId: string
  onOpenTask: (taskId: string) => void
  onNewTask: (columnId?: string) => void
}): React.JSX.Element {
  const theme = useTheme()
  const state = useApp((s) => s.state)
  const readOnly = useApp((s) => s.readOnly)
  const commit = useApp((s) => s.commit)
  const project = state.projects.find((p) => p.id === projectId)
  const columns = [...(project?.columns ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return (
    <ScrollView>
      <Screen>
        <Button primary label="Nova tarefa" onPress={() => onNewTask()} disabled={readOnly} />
        {columns.map((column) => {
          const tasks = state.tasks
            .filter((t) => t.projectId === projectId && t.columnId === column.id)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          const done = isDoneColumn(column)
          return (
            <View key={column.id} style={styles.column}>
              <Text accessibilityRole="header" style={{ color: theme.muted, fontSize: 12 }}>
                {column.name} · {tasks.length}
              </Text>
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  subtitle={task.dueDate ? formatDateBR(task.dueDate) : undefined}
                  onOpen={() => onOpenTask(task.id)}
                  onComplete={
                    done || readOnly
                      ? undefined
                      : () => commit(completeTask(useApp.getState().state, task.id, new Date()))
                  }
                />
              ))}
            </View>
          )
        })}
      </Screen>
    </ScrollView>
  )
}

/** Every unfinished task with a due date, overdue first. */
export function UpcomingList({
  onOpenTask,
  today = todayLocalISO()
}: {
  onOpenTask: (projectId: string, taskId: string) => void
  today?: string
}): React.JSX.Element {
  const theme = useTheme()
  const state = useApp((s) => s.state)
  const tasks = upcomingTasks(state.tasks, state.projects)
  const projectName = (id: string): string => state.projects.find((p) => p.id === id)?.name ?? ''
  return (
    <ScrollView>
      <Screen>
        {tasks.length === 0 ? (
          <Text style={{ color: theme.muted }}>Nenhuma tarefa com prazo.</Text>
        ) : null}
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            overdue={task.dueDate! < today}
            subtitle={`${formatDateBR(task.dueDate!)} · ${projectName(task.projectId)}`}
            onOpen={() => onOpenTask(task.projectId, task.id)}
          />
        ))}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  project: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  column: { gap: 8 }
})
