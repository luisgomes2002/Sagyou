import { isDoneColumn } from '@sagyou/core/columns'
import { latestOpenSprint } from '@sagyou/core/sprints'
import { DEFAULT_TAGS, type Priority } from '@sagyou/core/types'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { Button, Chip, Field, Row, Screen } from '../../components/ui'
import { useApp } from '../../store/app'
import { DATE_FORMAT_ERROR, parseBRDate, toBRDate } from '../../store/dates'
import { PRIORITY_LABELS, createSprint, createTask, updateTask } from '../../store/tasks'
import { useTheme } from '../../theme'

export const NEW_SPRINT = 'Nova sprint…'

export interface TaskFormProps {
  projectId: string
  taskId?: string
  columnId?: string
  onDone: () => void
}

/** New or existing task: title, description, priority, due date, tags, column and sprint. */
export function TaskForm({
  projectId,
  taskId,
  columnId,
  onDone
}: TaskFormProps): React.JSX.Element {
  const theme = useTheme()
  const app = useApp((s) => s.state)
  const readOnly = useApp((s) => s.readOnly)
  const commit = useApp((s) => s.commit)
  const project = app.projects.find((p) => p.id === projectId)
  const existing = taskId ? app.tasks.find((t) => t.id === taskId) : undefined
  const columns = [...(project?.columns ?? [])].sort((a, b) => a.order - b.order)
  const openSprints = app.sprints.filter((s) => s.projectId === projectId && !s.closedAt)

  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [priority, setPriority] = useState<Priority>(existing?.priority ?? 'medium')
  const [dueDate, setDueDate] = useState(toBRDate(existing?.dueDate))
  const [tags, setTags] = useState<string[]>(existing?.tags ?? [])
  const [column, setColumn] = useState(
    existing?.columnId ?? columnId ?? columns.find((c) => !isDoneColumn(c))?.id ?? columns[0]?.id
  )
  const [sprintId, setSprintId] = useState<string | undefined>(
    existing ? existing.sprintId : latestOpenSprint(app.sprints, projectId)?.id
  )
  const [newSprint, setNewSprint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const allTags = [...new Set([...DEFAULT_TAGS.flatMap((g) => g.tags), ...(existing?.tags ?? [])])]

  const addSprint = (): void => {
    const result = createSprint(useApp.getState().state, projectId, newSprint ?? '', new Date())
    if ('error' in result) {
      setError(result.error)
      return
    }
    if (commit(result.state)) {
      setSprintId(result.sprintId)
      setNewSprint(null)
      setError(null)
    }
  }

  const save = (): void => {
    if (!title.trim()) return setError('Dê um título à tarefa.')
    const due = dueDate.trim() ? parseBRDate(dueDate) : null
    if (dueDate.trim() && !due) return setError(DATE_FORMAT_ERROR)
    if (!column) return setError('Este projeto não tem colunas.')
    const current = useApp.getState().state
    const now = new Date()
    const fields = {
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      dueDate: due ?? undefined,
      tags,
      sprintId
    }
    const next = existing
      ? updateTask(current, existing.id, { ...fields, columnId: column }, now)
      : createTask(current, { projectId, columnId: column, ...fields }, now).state
    if (commit(next)) onDone()
  }

  return (
    <ScrollView>
      <Screen>
        <Field label="Título" value={title} onChangeText={setTitle} />
        <Field label="Descrição" value={description} onChangeText={setDescription} multiline />
        <Text style={[styles.label, { color: theme.muted }]}>Prioridade</Text>
        <Row>
          {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
            <Chip
              key={p}
              label={PRIORITY_LABELS[p]}
              selected={priority === p}
              onPress={() => setPriority(p)}
            />
          ))}
        </Row>
        <Field
          label="Prazo (DD/MM/AAAA)"
          value={dueDate}
          onChangeText={setDueDate}
          keyboardType="numbers-and-punctuation"
        />
        <Text style={[styles.label, { color: theme.muted }]}>Coluna</Text>
        <Row>
          {columns.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              selected={column === c.id}
              onPress={() => setColumn(c.id)}
            />
          ))}
        </Row>
        <Text style={[styles.label, { color: theme.muted }]}>Sprint</Text>
        <Row>
          {openSprints.map((s) => (
            <Chip
              key={s.id}
              label={s.name}
              selected={sprintId === s.id}
              onPress={() => setSprintId(s.id)}
            />
          ))}
          <Chip label={NEW_SPRINT} selected={newSprint !== null} onPress={() => setNewSprint('')} />
        </Row>
        {newSprint !== null ? (
          <>
            <Field label="Nome da sprint" value={newSprint} onChangeText={setNewSprint} />
            <Button label="Criar sprint" onPress={addSprint} disabled={readOnly} />
          </>
        ) : null}
        <Text style={[styles.label, { color: theme.muted }]}>Tags</Text>
        <Row>
          {allTags.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              selected={tags.includes(tag)}
              onPress={() =>
                setTags((list) =>
                  list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]
                )
              }
            />
          ))}
        </Row>
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.red }}>
            {error}
          </Text>
        ) : null}
        <Button primary label="Salvar" onPress={save} disabled={readOnly} />
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({ label: { fontSize: 12 } })
