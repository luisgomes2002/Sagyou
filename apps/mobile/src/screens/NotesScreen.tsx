import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { Button, Chip, Field, Row, Screen } from '../components/ui'
import { useApp } from '../store/app'
import { createNote, projectNotes, updateNoteContent } from '../store/notes'
import { useTheme } from '../theme'

type Editing = { id?: string; content: string } | null

/** Notes of one project at a time: read, create and edit the text. */
export function NotesScreen(): React.JSX.Element {
  const theme = useTheme()
  const state = useApp((s) => s.state)
  const readOnly = useApp((s) => s.readOnly)
  const commit = useApp((s) => s.commit)
  const projects = state.projects
    .filter((p) => !p.archivedAt)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const [chosen, setChosen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const project = projects.find((p) => p.id === chosen) ?? projects[0]

  if (!project)
    return (
      <Screen>
        <Text style={{ color: theme.muted }}>Nenhum projeto ainda. Crie um no Sagyou do PC.</Text>
      </Screen>
    )

  if (editing) {
    const save = (): void => {
      const current = useApp.getState().state
      const now = new Date()
      const next = editing.id
        ? updateNoteContent(current, editing.id, editing.content, now)
        : createNote(current, project.id, editing.content, now).state
      if (commit(next)) setEditing(null)
    }
    return (
      <ScrollView>
        <Screen>
          <Field
            label="Nota"
            value={editing.content}
            onChangeText={(content) => setEditing({ ...editing, content })}
            multiline
            style={{ minHeight: 160, textAlignVertical: 'top' }}
          />
          <Button
            primary
            label="Salvar"
            onPress={save}
            disabled={readOnly || !editing.content.trim()}
          />
          <Button label="Cancelar" onPress={() => setEditing(null)} />
        </Screen>
      </ScrollView>
    )
  }

  const notes = projectNotes(state, project.id)
  return (
    <ScrollView>
      <Screen>
        <Row>
          {projects.map((p) => (
            <Chip
              key={p.id}
              label={p.name}
              selected={p.id === project.id}
              onPress={() => setChosen(p.id)}
            />
          ))}
        </Row>
        <Button
          primary
          label="Nova nota"
          onPress={() => setEditing({ content: '' })}
          disabled={readOnly}
        />
        {notes.length === 0 ? (
          <Text style={{ color: theme.muted }}>Nenhuma nota neste projeto.</Text>
        ) : null}
        {notes.map((note) => (
          <Pressable
            key={note.id}
            accessibilityRole="button"
            accessibilityLabel={note.content.split('\n')[0] || 'Nota vazia'}
            onPress={() => setEditing({ id: note.id, content: note.content })}
            style={[styles.note, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Text style={{ color: theme.text }} numberOfLines={6}>
              {note.content || '—'}
            </Text>
          </Pressable>
        ))}
      </Screen>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  note: { borderWidth: 1, borderRadius: 8, padding: 12 }
})
