import { fireEvent, render, screen } from '@testing-library/react-native'
import { Alert } from 'react-native'
import { T, project, seedApp, table } from '../../__tests__/seed'
import { useApp } from '../../store/app'
import { INVALID_AMOUNT_TEXT, lastTablePref } from '../../store/finance'
import { PREF_QUICK_PROJECT } from '../../store/quick'
import { QuickCreate } from '../QuickCreate'

const TODAY = new Date(2026, 10, 1, 12)

function seed(options: Parameters<typeof seedApp>[1] = {}): ReturnType<typeof seedApp> {
  return seedApp(
    {
      projects: [project('p1', 'Sagyou'), project('p2', 'Casa', undefined, { order: 1 })],
      sprints: [{ id: 's1', projectId: 'p1', name: 'Sprint 1', createdAt: T }],
      lists: [table('conta', 'Conta')]
    },
    options
  )
}

async function open(option: string): Promise<void> {
  await render(<QuickCreate visible onClose={jest.fn()} today={TODAY} />)
  await fireEvent.press(screen.getByRole('button', { name: option }))
}

describe('criar rápido', () => {
  afterEach(() => jest.restoreAllMocks())

  it('oferece Tarefa, Gasto, Receita e Nota', async () => {
    seed()
    await render(<QuickCreate visible onClose={jest.fn()} today={TODAY} />)
    for (const option of ['Tarefa', 'Gasto', 'Receita', 'Nota'])
      expect(screen.getByRole('button', { name: option })).toBeTruthy()
  })

  it('Tarefa: sem título não salva; com título cria no destino padrão', async () => {
    const { writePref } = seed()
    await open('Tarefa')
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
    await fireEvent.changeText(screen.getByLabelText('Título'), 'Comprar pão')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(useApp.getState().state.tasks).toEqual([
      expect.objectContaining({
        title: 'Comprar pão',
        projectId: 'p1',
        columnId: 'p1-todo',
        sprintId: 's1'
      })
    ])
    expect(writePref).toHaveBeenCalledWith(PREF_QUICK_PROJECT, 'p1')
  })

  it('Tarefa: o chip Amanhã vira o prazo', async () => {
    seed()
    await open('Tarefa')
    await fireEvent.changeText(screen.getByLabelText('Título'), 'Pagar boleto')
    await fireEvent.press(screen.getByRole('button', { name: 'Amanhã' }))
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(useApp.getState().state.tasks[0].dueDate).toBe('2026-11-02')
  })

  it('Gasto: valor inválido avisa e não grava', async () => {
    const { save } = seed()
    await open('Gasto')
    await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), 'abc')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText(INVALID_AMOUNT_TEXT)).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })

  it('Gasto: grava na moeda da tabela, com a data de hoje', async () => {
    const { writePref } = seed()
    await open('Gasto')
    await fireEvent.changeText(screen.getByLabelText('Valor (BRL)'), '12,50')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(useApp.getState().state.lists[0].transactions).toEqual([
      expect.objectContaining({ amount: '12.5', type: 'expense', date: '2026-11-01' })
    ])
    expect(writePref).toHaveBeenCalledWith(lastTablePref('personal'), 'conta')
  })

  it('Nota: usa o último projeto e grava o pref', async () => {
    const { writePref } = seed({ prefs: { [PREF_QUICK_PROJECT]: 'p2' } })
    await open('Nota')
    expect(screen.getByText('Projeto ▸ Casa')).toBeTruthy()
    await fireEvent.changeText(screen.getByLabelText('Nota'), 'Ideia')
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }))
    expect(useApp.getState().state.notes).toEqual([
      expect.objectContaining({ projectId: 'p2', content: 'Ideia' })
    ])
    expect(writePref).toHaveBeenCalledWith(PREF_QUICK_PROJECT, 'p2')
  })

  it('fechar com algo digitado pergunta antes de descartar', async () => {
    seed()
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
    await open('Tarefa')
    await fireEvent.press(screen.getByRole('button', { name: 'Fechar' }))
    expect(alert).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByRole('button', { name: 'Tarefa' }))
    await fireEvent.changeText(screen.getByLabelText('Título'), 'meio escrito')
    await fireEvent.press(screen.getByRole('button', { name: 'Fechar' }))
    expect(alert).toHaveBeenCalledWith('Descartar?', expect.any(String), expect.any(Array))
  })

  it('somente leitura: nada salva', async () => {
    seed({ readOnly: true })
    for (const option of ['Tarefa', 'Gasto', 'Nota']) {
      await open(option)
      expect([
        option,
        screen.getByRole('button', { name: 'Salvar' }).props.accessibilityState.disabled
      ]).toEqual([option, true])
    }
  })

  it('sem projetos, Tarefa explica o que fazer', async () => {
    seedApp({ projects: [] })
    await open('Tarefa')
    expect(screen.getByText('Nenhum projeto ainda. Crie um no Sagyou do PC.')).toBeTruthy()
    expect(screen.queryByLabelText('Título')).toBeNull()
  })
})
