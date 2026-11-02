import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SyncDiagram } from '../../components/guide/SyncDiagram'

describe('SyncDiagram', () => {
  it('is an image described for screen readers', () => {
    render(<SyncDiagram />)
    expect(
      screen.getByRole('img', { name: 'Tudo trafega cifrado; o servidor não tem a chave.' })
    ).toBeInTheDocument()
  })

  it('shows the three parties', () => {
    render(<SyncDiagram />)
    expect(screen.getByText('Este PC')).toBeInTheDocument()
    expect(screen.getByText('Seu Worker')).toBeInTheDocument()
    expect(screen.getByText('Celular / outro PC')).toBeInTheDocument()
  })
})
