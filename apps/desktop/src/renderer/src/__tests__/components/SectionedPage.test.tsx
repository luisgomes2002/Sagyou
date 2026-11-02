import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SectionedPage, type SectionedPageItem } from '../../components/layout/SectionedPage'

type Id = 'a' | 'b' | 'c'
const items: SectionedPageItem<Id>[] = [
  { id: 'a', label: 'Alfa', group: 'Primeiro' },
  { id: 'b', label: 'Beta', group: 'Primeiro' },
  { id: 'c', label: 'Gama', group: 'Segundo' }
]

function renderPage(activeId: Id = 'a', onSelect = vi.fn()) {
  const utils = render(
    <SectionedPage
      title="Configurações"
      items={items}
      activeId={activeId}
      onSelect={onSelect}
      heading={`Seção ${activeId}`}
    >
      <p>conteúdo</p>
    </SectionedPage>
  )
  return { ...utils, onSelect }
}

const navButtons = () =>
  Array.from(screen.getByRole('navigation', { name: 'Configurações' }).querySelectorAll('button'))

describe('SectionedPage', () => {
  it('lists the items in order and marks the active one', () => {
    renderPage('b')
    expect(navButtons().map((b) => b.textContent)).toEqual(['Alfa', 'Beta', 'Gama'])
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Alfa' })).not.toHaveAttribute('aria-current')
  })

  it('shows each group label once', () => {
    renderPage()
    expect(screen.getAllByText('Primeiro')).toHaveLength(1)
    expect(screen.getAllByText('Segundo')).toHaveLength(1)
  })

  it('moves focus with the arrow keys, wrapping around', () => {
    renderPage()
    const [alfa, beta, gama] = navButtons()
    alfa.focus()
    fireEvent.keyDown(alfa, { key: 'ArrowDown' })
    expect(beta).toHaveFocus()
    fireEvent.keyDown(beta, { key: 'ArrowDown' })
    fireEvent.keyDown(gama, { key: 'ArrowDown' })
    expect(alfa).toHaveFocus()
    fireEvent.keyDown(alfa, { key: 'ArrowUp' })
    expect(gama).toHaveFocus()
  })

  it('selects a section on click (Enter and Space activate native buttons)', () => {
    const { onSelect } = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Gama' }))
    expect(onSelect).toHaveBeenCalledWith('c')
  })

  it('focuses the heading when the active section changes, not on first render', () => {
    const { rerender } = renderPage('a')
    expect(screen.getByRole('heading', { name: 'Seção a' })).not.toHaveFocus()
    rerender(
      <SectionedPage
        title="Configurações"
        items={items}
        activeId="c"
        onSelect={vi.fn()}
        heading="Seção c"
      >
        <p>conteúdo</p>
      </SectionedPage>
    )
    expect(screen.getByRole('heading', { name: 'Seção c' })).toHaveFocus()
  })
})
