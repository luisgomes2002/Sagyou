import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const KEY_LENGTH = 64
const MIN_PASSWORD_LENGTH = 4

export interface PasswordConfig {
  version: 1
  salt: string
  hash: string
}

export function passwordError(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH)
    return `A senha deve ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`
  return null
}

function derive(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH)
}

export function createPasswordConfig(password: unknown): PasswordConfig | { error: string } {
  const error = passwordError(password)
  if (error) return { error }
  if (typeof password !== 'string') return { error: 'Senha inválida.' }
  const salt = randomBytes(16)
  return {
    version: 1,
    salt: salt.toString('base64'),
    hash: derive(password, salt).toString('base64')
  }
}

export function isPasswordConfig(value: unknown): value is PasswordConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as Partial<PasswordConfig>
  return config.version === 1 && typeof config.salt === 'string' && typeof config.hash === 'string'
}

export function verifyPassword(config: PasswordConfig, password: unknown): boolean {
  if (typeof password !== 'string') return false
  try {
    const expected = Buffer.from(config.hash, 'base64')
    const actual = derive(password, Buffer.from(config.salt, 'base64'))
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
