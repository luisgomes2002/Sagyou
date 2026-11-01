import { fireEvent, render, screen } from '@testing-library/react-native'
import { emptyState, type MobileState } from '../../data/state'
import { project, seedApp } from '../../__tests__/seed'
import { useApp } from '../../store/app'
import { createNote, editedText, updateNoteContent } from '../../store/notes'
import { PREF_QUICK_PROJECT } from '../../store/quick'
import { NotesScreen } from '../NotesScreen'

const T = '2026-10-01T00:00:00.000Z'
const NOW = new Date('2026-10-31T12:00:00.000Z')

const note = (
  id: string,
  extra: Partial<MobileState['notes'][number]>
): MobileState['notes'][number] => ({
  id,
  projectId: 'p1',
  content: id,
  color: '#a0c868',
  x: 300,
  y: 100,
  width: 250,
  height: 150,
  createdAt: T,
  updatedAt: T,
  ...extra
})

function state(): MobileState {
  const s = emptyState()
  s.projects = [
    {
      id: 'p1',
      name: 'Sagyou',
      color: '#000',
      order: 0,
      createdAt: T,
      updatedAt: T,
      columns: []
    } as unknown as MobileState['projects'][number]
  ]
  s.notes = [
    note('Ideia do PC', { connections: ['outra'], taskIds: ['t1'] }),
    note('Título do canvas', { type: 'text', y: 900 })
  ]
  return s
}

describe('notas no celular', () => {
  it('cria a nota abaixo da mais baixa, com os padrões do desktop', () => {
    const { state: next, id } = createNote(state(), 'p1', 'Do celular', NOW)
    expect(next.notes.find((n) => n.id === id)).toMatchObject({
      content: 'Do celular',
      x: 300,
      y: 274,
      width: 200,
      height: 150,
      color: '#fef08a'
    })
  })

  it('editar o texto preserva posição, tamanho, cor e ligações', () => {
    const next = updateNoteContent(state(), 'Ideia do PC', 'Ideia revisada', NOW)
    expect(next.notes[0]).toMatchObject({
      content: 'Ideia revisada',
      x: 300,
      y: 100,
      width: 250,
      color: '#a0c868',
      connections: ['outra'],
      taskIds: ['t1'],
      updatedAt: NOW.toISOString()
    })
  })

  it('blocos de texto do canvas não aparecem; criar vem do (+)', async () => {
    seedApp(state())
    await render(<NotesScreen now={NOW} />)
    expect(screen.getByRole('button', { name: 'Ideia do PC' })).toBeTruthy()
    expect(screen.queryByText('Título do canvas')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nova nota' })).toBeNull()
  })

  it('o cartão diz quando a nota foi editada', async () => {
    const s = state()
    s.notes[0] = { ...s.notes[0], updatedAt: '2026-10-31T10:00:00.000Z' }
    seedApp(s)
    await render(<NotesScreen now={NOW} />)
    expect(screen.getByText('editada há 2 horas')).toBeTruthy()
    expect(editedText('2026-10-31T11:59:40.000Z', NOW)).toBe('editada agora')
  })

  it('o seletor começa no último projeto e trocar grava o pref', async () => {
    const s = state()
    s.projects = [...s.projects, project('p2', 'Casa', [], { order: 1 })]
    s.notes = [...s.notes, note('Da casa', { projectId: 'p2' })]
    const { writePref } = seedApp(s, { prefs: { [PREF_QUICK_PROJECT]: 'p2' } })
    await render(<NotesScreen now={NOW} />)
    expect(screen.getByRole('button', { name: 'Projeto ▸ Casa' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Da casa' })).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: 'Projeto ▸ Casa' }))
    await fireEvent.press(screen.getByRole('radio', { name: 'Sagyou' }))
    expect(writePref).toHaveBeenCalledWith(PREF_QUICK_PROJECT, 'p1')
    expect(screen.getByRole('button', { name: 'Ideia do PC' })).toBeTruthy()
  })

  it('tocar abre a edição em tela cheia e salvar grava o texto', async () => {
    seedApp(state())
    await render(<NotesScreen now={NOW} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Ideia do PC' }))
    await fireEvent.changeText(screen.getByLabelText('Nota'), 'Lembrar do pão')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(useApp.getState().state.notes[0].content).toBe('Lembrar do pão')
  })
})
