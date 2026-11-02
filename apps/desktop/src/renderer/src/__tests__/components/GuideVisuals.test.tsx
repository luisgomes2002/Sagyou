import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GUIDE_VISUAL_IDS, GuideVisual } from '../../components/guide/GuideVisuals'

describe('GuideVisual', () => {
  it('has the nine visuals ported from the old guide', () => {
    expect(GUIDE_VISUAL_IDS).toEqual([
      'board',
      'planejamento',
      'meta-habito',
      'perfis',
      'compras',
      'saldo',
      'vinculos',
      'leitura',
      'sessoes'
    ])
  })

  it.each(GUIDE_VISUAL_IDS)('renders %s as a labelled image without mentioning the chat', (id) => {
    const { container } = render(<GuideVisual id={id} />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBeTruthy()
    expect(container.textContent ?? '').not.toMatch(/\bchat\b/i)
    expect(img.getAttribute('aria-label') ?? '').not.toMatch(/\bchat\b/i)
  })
})
