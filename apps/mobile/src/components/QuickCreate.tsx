import type { Priority } from '@sagyou/core/types'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useApp } from '../store/app'
import { createNote } from '../store/notes'
import { PREF_QUICK_PROJECT, activeProjects, quickProject, quickTaskTarget } from '../store/quick'
import { PRIORITY_LABELS, createTask } from '../store/tasks'
import { FONT, SPACE, useTheme } from '../theme'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { Chip } from './Chip'
import { DateField } from './DateField'
import { Field } from './Field'
import { ListItem } from './ListItem'
import { Picker } from './Picker'
import { TransactionSheet } from './TransactionSheet'
import { closeOrConfirm } from './discard'
import { ACTION_ICONS } from './icons'

export const NO_PROJECT_TEXT = 'Nenhum projeto ainda. Crie um no Sagyou do PC.'

type Mode = 'menu' | 'task' | 'expense' | 'income' | 'note'

const OPTIONS: { mode: Exclude<Mode, 'menu'>; label: string; icon: keyof typeof ACTION_ICONS }[] = [
  { mode: 'task', label: 'Tarefa', icon: 'task' },
  { mode: 'expense', label: 'Gasto', icon: 'expense' },
  { mode: 'income', label: 'Receita', icon: 'income' },
  { mode: 'note', label: 'Nota', icon: 'note' }
]

/**
 * The (+): one sheet with Tarefa, Gasto, Receita, Nota, each opening a short
 * form whose happy path is just the title or the amount. Project and table
 * come from the last ones used.
 */
export function QuickCreate({
  visible,
  onClose,
  onMoreFields,
  today
}: {
  visible: boolean
  onClose: () => void
  /** "Mais campos": the full task form with what was typed. */
  onMoreFields?: (projectId: string, title: string) => void
  today?: Date
}): React.JSX.Element | null {
  const theme = useTheme()
  const [mode, setMode] = useState<Mode>('menu')
  const finish = (): void => {
    setMode('menu')
    onClose()
  }
  if (!visible) return null
  if (mode === 'task')
    return <TaskQuick onClose={finish} onMoreFields={onMoreFields} today={today} />
  if (mode === 'note') return <NoteQuick onClose={finish} />
  if (mode === 'expense' || mode === 'income')
    return <TransactionSheet visible type={mode} onClose={finish} today={today} />
  return (
    <BottomSheet visible onClose={finish} title="Criar">
      {OPTIONS.map((o) => {
        const Icon = ACTION_ICONS[o.icon]
        return (
          <ListItem
            key={o.mode}
            title={o.label}
            a11yLabel={o.label}
            left={<Icon size={22} color={theme.purple} />}
            onPress={() => setMode(o.mode)}
          />
        )
      })}
    </BottomSheet>
  )
}

function useQuickProject(): [string | undefined, (id: string) => void] {
  const state = useApp((s) => s.state)
  const services = useApp((s) => s.services)
  const [chosen, setChosen] = useState<string | undefined>(
    () => quickProject(state, services?.repo.readPref(PREF_QUICK_PROJECT) ?? null)?.id
  )
  return [chosen, setChosen]
}

function rememberProject(projectId: string): void {
  useApp.getState().services?.repo.writePref(PREF_QUICK_PROJECT, projectId)
}

function ProjectPicker({
  value,
  onChange
}: {
  value: string | undefined
  onChange: (id: string) => void
}): React.JSX.Element {
  const state = useApp((s) => s.state)
  return (
    <Picker
      label="Projeto"
      value={value}
      options={activeProjects(state).map((p) => ({ id: p.id, label: p.name }))}
      onChange={onChange}
    />
  )
}

function TaskQuick({
  onClose,
  onMoreFields,
  today
}: {
  onClose: () => void
  onMoreFields?: (projectId: string, title: string) => void
  today?: Date
}): React.JSX.Element {
  const theme = useTheme()
  const readOnly = useApp((s) => s.readOnly)
  const commit = useApp((s) => s.commit)
  const [projectId, setProjectId] = useQuickProject()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState<string | undefined>(undefined)
  const [priority, setPriority] = useState<Priority>('medium')
  const [error, setError] = useState<string | null>(null)
  const dirty = !!title.trim()
  const close = (): void => closeOrConfirm(dirty, onClose)

  if (!projectId)
    return (
      <BottomSheet visible onClose={onClose} title="Nova tarefa">
        <Text style={{ color: theme.muted, fontSize: FONT.body }}>{NO_PROJECT_TEXT}</Text>
      </BottomSheet>
    )

  const save = (): void => {
    const current = useApp.getState().state
    const target = quickTaskTarget(current, projectId)
    if (!target) return setError('Este projeto não tem colunas.')
    const next = createTask(
      current,
      { projectId, ...target, title, priority, dueDate: due },
      new Date()
    ).state
    if (!commit(next)) return
    rememberProject(projectId)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onClose()
  }

  return (
    <BottomSheet visible onClose={close} title="Nova tarefa">
      <ProjectPicker value={projectId} onChange={setProjectId} />
      <Field label="Título" value={title} onChangeText={setTitle} autoFocus error={error} />
      <DateField label="Prazo" value={due} onChange={setDue} clearable today={today} />
      <Text style={[styles.label, { color: theme.muted }]}>Prioridade</Text>
      <View style={styles.row}>
        {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
          <Chip
            key={p}
            label={PRIORITY_LABELS[p]}
            selected={priority === p}
            onPress={() => setPriority(p)}
          />
        ))}
      </View>
      <Button
        variant="primary"
        label="Salvar"
        onPress={save}
        disabled={readOnly || !title.trim()}
      />
      {onMoreFields ? (
        <Button
          variant="ghost"
          label="Mais campos"
          onPress={() => {
            onClose()
            onMoreFields(projectId, title)
          }}
        />
      ) : null}
    </BottomSheet>
  )
}

function NoteQuick({ onClose }: { onClose: () => void }): React.JSX.Element {
  const theme = useTheme()
  const readOnly = useApp((s) => s.readOnly)
  const commit = useApp((s) => s.commit)
  const [projectId, setProjectId] = useQuickProject()
  const [content, setContent] = useState('')
  const close = (): void => closeOrConfirm(!!content.trim(), onClose)

  if (!projectId)
    return (
      <BottomSheet visible onClose={onClose} title="Nova nota">
        <Text style={{ color: theme.muted, fontSize: FONT.body }}>{NO_PROJECT_TEXT}</Text>
      </BottomSheet>
    )

  const save = (): void => {
    const next = createNote(useApp.getState().state, projectId, content, new Date()).state
    if (!commit(next)) return
    rememberProject(projectId)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onClose()
  }

  return (
    <BottomSheet visible onClose={close} title="Nova nota">
      <ProjectPicker value={projectId} onChange={setProjectId} />
      <Field
        label="Nota"
        value={content}
        onChangeText={setContent}
        multiline
        autoFocus
        style={styles.note}
      />
      <Button
        variant="primary"
        label="Salvar"
        onPress={save}
        disabled={readOnly || !content.trim()}
      />
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: FONT.caption },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm },
  note: { minHeight: 140, textAlignVertical: 'top' }
})
