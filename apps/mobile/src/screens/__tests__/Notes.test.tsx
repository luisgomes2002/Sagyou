import { fireEvent, render, screen } from '@testing-library/react-native'
import { emptyState, type MobileState } from '../../data/state'
import { type AppServices, useApp } from '../../store/app'
import { createNote, updateNoteContent } from '../../store/notes'
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

  it('blocos de texto do canvas não aparecem na lista', async () => {
    useApp.setState({
      state: state(),
      readOnly: false,
      services: {
        repo: { save: jest.fn() },
        runtime: { engine: { notifySaved: jest.fn() } }
      } as unknown as AppServices
    })
    await render(<NotesScreen />)
    expect(screen.getByRole('button', { name: 'Ideia do PC' })).toBeTruthy()
    expect(screen.queryByText('Título do canvas')).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: 'Nova nota' }))
    await fireEvent.changeText(screen.getByLabelText('Nota'), 'Lembrar do pão')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(useApp.getState().state.notes.map((n) => n.content)).toContain('Lembrar do pão')
  })
})
