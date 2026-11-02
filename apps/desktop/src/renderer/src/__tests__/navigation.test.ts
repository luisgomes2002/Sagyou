import { describe, expect, it } from 'vitest'
import { VIEW_FEATURE, isViewEnabled } from '../navigation'

describe('isViewEnabled', () => {
  it('hides a view whose feature is turned off', () => {
    expect(isViewEnabled('financial', ['kanban'])).toBe(false)
  })

  it('shows a view whose feature is on', () => {
    expect(isViewEnabled('financial', ['financial'])).toBe(true)
  })

  it('always shows settings and the guide, even with every feature off', () => {
    expect(isViewEnabled('settings', [])).toBe(true)
    expect(isViewEnabled('guide', [])).toBe(true)
  })

  it('ties memory to the ai feature', () => {
    expect(isViewEnabled('memory', ['ai'])).toBe(true)
    expect(isViewEnabled('memory', [])).toBe(false)
  })

  it('keeps the board under kanban', () => {
    expect(VIEW_FEATURE.board).toBe('kanban')
  })
})
