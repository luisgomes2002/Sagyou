import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { SyncConflictView } from '@sagyou/core/sync/engine'
import { SyncConflictCard } from '../../components/settings/SyncConflictCard'

const OLD = '000001794300000-0000-aaaa'
const NEW = '000001794400000-0000-bbbb'
const LONG_A = `${'palavra '.repeat(12)}primeira versão`
const LONG_B = `${'palavra '.repeat(12)}segunda versão`

function conflict(over: Partial<SyncConflictView> = {}, localNewer = false): SyncConflictView {
  const base = { id: 't1', projectId: 'p1', title: 'Coletor — Remotive', updatedAt: 'x' }
  return {
    id: 'c1',
    type: 'lww',
    kind: 'task',
    recordId: 't1',
    createdAt: 0,
    current: 'remote',
    local: {
      hlc: localNewer ? NEW : OLD,
      at: 1,
      deviceName: 'Este PC',
      deleted: false,
      payload: { ...base, description: LONG_A, timeSpent: 7200, order: 1 }
    },
    remote: {
      hlc: localNewer ? OLD : NEW,
      at: 2,
      deviceName: 'Dell',
      deleted: false,
      payload: { ...base, description: LONG_B, timeSpent: 6000, order: 3 }
    },
    ...over
  }
}

function open(c: SyncConflictView, onResolve = vi.fn()): ReturnType<typeof vi.fn> {
  render(<SyncConflictCard conflict={c} names={() => null} busy={false} onResolve={onResolve} />)
  fireEvent.click(screen.getByRole('button', { name: /: Coletor/ }))
  return onResolve
}

describe('SyncConflictCard', () => {
  it('fechado mostra o item e o resumo; aberto mostra só as diferenças em português', () => {
    render(
      <SyncConflictCard conflict={conflict()} names={() => null} busy={false} onResolve={vi.fn()} />
    )
    const toggle = screen.getByRole('button', { name: /Task: Coletor — Remotive/ })
    expect(toggle).toHaveTextContent('3 campos diferentes · mais recente: Dell')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Salvar escolha')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // Focus moves into the comparison, so Tab goes on to its radios.
    expect(document.activeElement).toBe(
      document.getElementById(toggle.getAttribute('aria-controls')!)
    )
    expect(
      screen.getByText(
        'O mesmo item mudou em dois aparelhos antes de um receber a mudança do outro. Escolha o que fica; a escolha vai para todos os aparelhos.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Descrição' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Tempo gasto' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Lugar' })).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Título' })).not.toBeInTheDocument()
    expect(screen.getByText('Mais recente')).toBeInTheDocument()
    // The whole description, with what differs marked.
    expect(screen.getAllByText(/Trecho diferente destacado/).length).toBeGreaterThan(0)
    const marks = document.querySelectorAll('mark')
    expect([...marks].map((m) => m.textContent?.trim())).toEqual(['primeira', 'segunda'])
  })

  it('"Igual nos dois" fica recolhido e abre com clique', () => {
    open(conflict())
    const equal = screen.getByRole('button', { name: /Igual nos dois \(\d+\)/ })
    expect(equal).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Coletor — Remotive', { selector: 'dd' })).not.toBeInTheDocument()
    fireEvent.click(equal)
    expect(screen.getByText('Coletor — Remotive', { selector: 'dd' })).toBeInTheDocument()
  })

  it('pré-seleção: a mais recente, mas o maior tempo, com o aviso', () => {
    open(conflict())
    const description = screen.getByRole('radiogroup', { name: 'Descrição' })
    expect(within(description).getByRole('radio', { name: /Dell/ })).toBeChecked()
    const time = screen.getByRole('radiogroup', { name: 'Tempo gasto' })
    expect(within(time).getByRole('radio', { name: /Este aparelho/ })).toBeChecked()
    expect(
      screen.getByText('Marcamos o maior tempo para não perder tempo do cronômetro.')
    ).toBeInTheDocument()
  })

  it('"Salvar escolha" envia os campos marcados com o HLC atual', () => {
    const onResolve = open(conflict())
    const description = screen.getByRole('radiogroup', { name: 'Descrição' })
    fireEvent.click(within(description).getByRole('radio', { name: /Este aparelho/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar escolha' }))
    expect(onResolve).toHaveBeenCalledWith({
      fields: { description: 'local', timeSpent: 'local', place: 'remote' },
      expectedHlc: NEW
    })
  })

  it('atalhos: a mais recente e o outro lado', () => {
    const onResolve = open(conflict())
    fireEvent.click(screen.getByRole('button', { name: 'Ficar com a mais recente' }))
    expect(onResolve).toHaveBeenLastCalledWith({
      fields: { description: 'remote', timeSpent: 'remote', place: 'remote' },
      expectedHlc: NEW
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ficar com a deste aparelho' }))
    expect(onResolve).toHaveBeenLastCalledWith({
      fields: { description: 'local', timeSpent: 'local', place: 'local' },
      expectedHlc: NEW
    })
  })

  it('com este aparelho mais recente, o segundo atalho é o do outro', () => {
    open(conflict({}, true))
    expect(screen.getByRole('button', { name: 'Ficar com a de Dell' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Ficar com a deste aparelho' })
    ).not.toBeInTheDocument()
  })

  it('dívida: sem rádios, só a versão inteira', () => {
    const debt = (amount: string): Record<string, unknown> => ({
      id: 'd1',
      name: 'Coletor — Remotive',
      remainingAmount: amount
    })
    const onResolve = open(
      conflict({
        kind: 'financial_debt',
        type: 'pending_choice',
        local: { hlc: OLD, at: 1, deviceName: 'Este PC', deleted: false, payload: debt('90') },
        remote: { hlc: NEW, at: 2, deviceName: 'Dell', deleted: false, payload: debt('70') }
      })
    )
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByText('90')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Usar a de Dell' }))
    expect(onResolve).toHaveBeenLastCalledWith('remote')
    fireEvent.click(screen.getByRole('button', { name: 'Usar a deste aparelho' }))
    expect(onResolve).toHaveBeenLastCalledWith('local')
  })

  it('um lado apagado mostra "Apagado"', () => {
    open(
      conflict({ remote: { hlc: NEW, at: 2, deviceName: 'Dell', deleted: true, payload: null } })
    )
    expect(screen.getAllByText('Apagado').length).toBeGreaterThan(0)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Usar a de Dell' })).toBeInTheDocument()
  })

  it('órfão: o texto de hoje e "Dispensar"', () => {
    const onResolve = vi.fn()
    render(
      <SyncConflictCard
        conflict={conflict({ type: 'orphan' })}
        names={() => null}
        busy={false}
        onResolve={onResolve}
      />
    )
    expect(
      screen.getByText('Removido: o item de origem foi apagado em outro aparelho')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
    expect(onResolve).toHaveBeenCalledWith('local')
  })
})
