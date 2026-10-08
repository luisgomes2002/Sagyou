// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createPasswordConfig, passwordError, verifyPassword } from '../security'

describe('password security', () => {
  it('stores a salted derived key and verifies only the matching password', () => {
    const config = createPasswordConfig('senha segura')
    expect('error' in config).toBe(false)
    if ('error' in config) return

    expect(config.hash).not.toContain('senha segura')
    expect(verifyPassword(config, 'senha segura')).toBe(true)
    expect(verifyPassword(config, 'outra senha')).toBe(false)
  })

  it('requires a minimally usable password', () => {
    expect(passwordError('123')).toMatch('ao menos')
    expect(passwordError('1234')).toBeNull()
  })
})
