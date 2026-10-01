/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { safeExternalUrl } from '../external-links'

describe('external links', () => {
  it('opens ordinary browser links', () => {
    expect(safeExternalUrl('https://example.com/path')).toBe('https://example.com/path')
  })

  it('blocks local schemes, malformed URLs and embedded credentials', () => {
    expect(safeExternalUrl('file:///tmp/private')).toBeNull()
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('https://user:pass@example.com')).toBeNull()
    expect(safeExternalUrl('not a URL')).toBeNull()
  })
})
