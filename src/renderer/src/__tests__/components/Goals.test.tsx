import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoalCard } from '../../components/GoalCard'
import { GoalModal } from '../../components/modals/GoalModal'
import type { Goal } from '../../types'

const baseGoal: Goal = {
  id: 'goal',
  title: 'Ler DDD',
  entries: [],
  kind: 'completion',
  target: 1,
  unit: '',
  color: '#7c3aed',
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z'
}

afterEach(() => {
  vi.useRealTimers()
})

describe('GoalModal', () => {
  it('cria uma meta de conclusão sem pedir quantidade', () => {
    const onSave = vi.fn()
    render(<GoalModal projects={[]} onSave={onSave} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Concluir uma vez/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.queryByText('Quantidade desejada *')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Ex.: Ler DDD'), {
      target: { value: 'Ler Domain-Driven Design' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar meta' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Ler Domain-Driven Design',
        kind: 'completion',
        target: 1,
        unit: ''
      })
    )
  })

  it('permite converter uma meta antiga de quantidade única', () => {
    const onSave = vi.fn()
    const legacyGoal: Goal = { ...baseGoal, kind: undefined, unit: 'livro' }
    render(<GoalModal goal={legacyGoal} projects={[]} onSave={onSave} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: /Acompanhar quantidade/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: /Concluir uma vez/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'completion', target: 1, unit: '' })
    )
  })
})

describe('GoalCard', () => {
  it('conclui um objetivo único com data e observação, sem campo numérico', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T15:00:00-03:00'))
    const onAddEntry = vi.fn()
    render(
      <GoalCard
        goal={baseGoal}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAddEntry={onAddEntry}
        onDeleteEntry={vi.fn()}
      />
    )

    expect(screen.getByText('Em andamento')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))

    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Data da conclusão')).toHaveValue('2026-10-21')
    fireEvent.change(screen.getByPlaceholderText('Como foi concluir esta meta?'), {
      target: { value: 'Leitura finalizada' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Concluir meta' }))

    expect(onAddEntry).toHaveBeenCalledWith({
      date: '2026-10-21',
      label: 'Leitura finalizada',
      value: 1
    })
  })

  it('não permite adicionar histórico depois que a meta simples foi concluída', () => {
    const completedGoal: Goal = {
      ...baseGoal,
      entries: [
        {
          id: 'completion',
          date: '2026-10-20',
          value: 1,
          label: 'Concluída',
          createdAt: '2026-10-20T12:00:00.000Z'
        }
      ]
    }
    render(
      <GoalCard
        goal={completedGoal}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAddEntry={vi.fn()}
        onDeleteEntry={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'Registrar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Concluir' })).not.toBeInTheDocument()
  })

  it('não permite adicionar histórico depois que uma meta quantitativa atingiu o alvo', () => {
    const completedGoal: Goal = {
      ...baseGoal,
      kind: 'quantity',
      target: 1,
      unit: 'livro',
      entries: [
        {
          id: 'entry',
          date: '2026-10-21',
          value: 1,
          createdAt: '2026-10-21T12:00:00.000Z'
        }
      ]
    }
    render(
      <GoalCard
        goal={completedGoal}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onAddEntry={vi.fn()}
        onDeleteEntry={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'Registrar' })).not.toBeInTheDocument()
  })
})
