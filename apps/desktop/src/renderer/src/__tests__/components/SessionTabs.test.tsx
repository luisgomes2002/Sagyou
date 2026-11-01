import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SessionTabs, type SessionItem } from '../../components/ai/fleet/SessionTabs'

const items: SessionItem[] = [
  {
    key: 'run:first',
    kind: 'run',
    title: 'Primeira',
    subtitle: 'Projeto · Codex',
    status: 'running'
  },
  { key: 'run:last', kind: 'run', title: 'Última', subtitle: 'Projeto · Codex', status: 'running' }
]

describe('SessionTabs', () => {
  it('brings a programmatically selected tab into view', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })
    const props = {
      items,
      onSelect: vi.fn(),
      onNew: vi.fn(),
      starting: false
    }
    const { rerender } = render(<SessionTabs {...props} selectedKey="run:first" />)
    scrollIntoView.mockClear()

    rerender(<SessionTabs {...props} selectedKey="run:last" />)

    expect(screen.getByRole('button', { name: /^Última/ })).toHaveAttribute('aria-current', 'true')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })
})
