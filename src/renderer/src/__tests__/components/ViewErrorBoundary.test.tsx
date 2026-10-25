import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ViewErrorBoundary } from '../../components/ViewErrorBoundary'

function Broken({ shouldThrow }: { shouldThrow: boolean }): React.JSX.Element {
  if (shouldThrow) throw new Error('falha de teste')
  return <p>Área recuperada</p>
}

describe('ViewErrorBoundary', () => {
  it('isolates a failed view and retries rendering without taking down the app shell', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true
    const view = render(
      <ViewErrorBoundary area="finanças">
        <Broken shouldThrow={shouldThrow} />
      </ViewErrorBoundary>
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível abrir esta área')
    shouldThrow = false
    view.rerender(
      <ViewErrorBoundary area="finanças">
        <Broken shouldThrow={shouldThrow} />
      </ViewErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(screen.getByText('Área recuperada')).toBeInTheDocument()
  })
})
