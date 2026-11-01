import { StickyNote } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Picker } from '../components/Picker'
import { Skeleton } from '../components/Skeleton'
import { closeOrConfirm } from '../components/discard'
import { Button, EmptyState, Field, Screen } from '../components/ui'
import { awaitingFirstSync, useApp } from '../store/app'
import { editedText, projectNotes, updateNoteContent } from '../store/notes'
import { PREF_QUICK_PROJECT, activeProjects, quickProject } from '../store/quick'
import { FONT, MIN_TOUCH, RADIUS, SPACE, useTheme } from '../theme'

type Editing = { id: string; original: string; content: string } | null

/** Notes of one project at a time, as readable cards; tap to edit the text full screen. */
export function NotesScreen({ now: nowProp }: { now?: Date }): React.JSX.Element {
  const theme = useTheme()
  const state = useApp((s) => s.state)
  const services = useApp((s) => s.services)
  const readOnly = useApp((s) => s.readOnly)
  const commit = useApp((s) => s.commit)
  const waiting = useApp((s) => awaitingFirstSync(s.status))
  const projects = activeProjects(state)
  const [chosen, setChosen] = useState<string | null>(
    () => services?.repo.readPref(PREF_QUICK_PROJECT) ?? null
  )
  const [editing, setEditing] = useState<Editing>(null)
  const project = quickProject(state, chosen)
  const now = nowProp ?? new Date()

  if (!project)
    return (
      <Screen>
        {waiting ? (
          <Skeleton />
        ) : (
          <EmptyState icon={StickyNote} text="Nenhum projeto ainda. Crie um no Sagyou do PC." />
        )}
      </Screen>
    )

  if (editing) {
    const save = (): void => {
      const next = updateNoteContent(
        useApp.getState().state,
        editing.id,
        editing.content,
        new Date()
      )
      if (commit(next)) setEditing(null)
    }
    return (
      <View style={[styles.editor, { backgroundColor: theme.bg }]}>
        <ScrollView contentContainerStyle={styles.editorBody} keyboardShouldPersistTaps="handled">
          <Field
            label="Nota"
            value={editing.content}
            onChangeText={(content) => setEditing({ ...editing, content })}
            multiline
            autoFocus
            style={styles.noteInput}
          />
        </ScrollView>
        <View
          style={[styles.footer, { borderColor: theme.border, backgroundColor: theme.surface }]}
        >
          <View style={{ flex: 1 }}>
            <Button
              variant="ghost"
              label="Cancelar"
              onPress={() =>
                closeOrConfirm(editing.content !== editing.original, () => setEditing(null))
              }
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              variant="primary"
              label="Salvar"
              onPress={save}
              disabled={readOnly || !editing.content.trim()}
            />
          </View>
        </View>
      </View>
    )
  }

  const notes = projectNotes(state, project.id)
  return (
    <ScrollView contentContainerStyle={styles.bottomRoom}>
      <Screen>
        <Picker
          label="Projeto"
          value={project.id}
          options={projects.map((p) => ({ id: p.id, label: p.name }))}
          onChange={(id) => {
            setChosen(id)
            services?.repo.writePref(PREF_QUICK_PROJECT, id)
          }}
        />
        {notes.length === 0 ? (
          <EmptyState icon={StickyNote} text="Nenhuma nota neste projeto." />
        ) : null}
        {notes.map((note) => (
          <Pressable
            key={note.id}
            accessibilityRole="button"
            accessibilityLabel={note.content.split('\n')[0] || 'Nota vazia'}
            onPress={() =>
              setEditing({ id: note.id, original: note.content, content: note.content })
            }
            style={({ pressed }) => [
              styles.note,
              {
                backgroundColor: pressed ? theme.selected : theme.surface,
                borderColor: theme.border
              }
            ]}
          >
            <Text style={[styles.text, { color: theme.text }]} numberOfLines={6}>
              {note.content || '—'}
            </Text>
            <Text style={[styles.meta, { color: theme.muted }]}>
              {editedText(note.updatedAt, now)}
            </Text>
          </Pressable>
        ))}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  bottomRoom: { paddingBottom: 96 },
  note: {
    borderWidth: 1,
    borderRadius: RADIUS.card,
    padding: SPACE.lg,
    gap: SPACE.sm,
    minHeight: MIN_TOUCH
  },
  text: { fontSize: FONT.bodyLg, lineHeight: 22 },
  meta: { fontSize: FONT.caption },
  editor: { flex: 1 },
  editorBody: { padding: SPACE.lg, flexGrow: 1 },
  noteInput: { minHeight: 280, textAlignVertical: 'top' },
  footer: {
    flexDirection: 'row',
    gap: SPACE.md,
    padding: SPACE.lg,
    borderTopWidth: 1
  }
})
