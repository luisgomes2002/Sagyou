/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { hasBundledMarkItDown, markitdownBinaryPath } from '../markitdown'

describe('MarkItDown runtime path', () => {
  it('resolves the executable bundled for the current platform', () => {
    const path = markitdownBinaryPath('/app/resources', 'linux', 'x64')
    expect(path).toBe('/app/resources/markitdown/linux-x64/sagyou-markitdown')
  })

  it('uses the executable extension on Windows', () => {
    const path = markitdownBinaryPath('C:\\Sagyou\\resources', 'win32', 'x64')
    expect(path).toContain('sagyou-markitdown.exe')
  })

  it('does not report an absent development runtime as bundled', () => {
    expect(hasBundledMarkItDown('/tmp/no-markitdown-runtime', 'linux', 'x64')).toBe(false)
  })
})
