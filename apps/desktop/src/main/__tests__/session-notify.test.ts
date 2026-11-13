// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { shouldNotifySessionDone } from '../modules/remote/session-notify'

describe('shouldNotifySessionDone', () => {
  it('avisa quando a sessão termina sozinha', () => {
    expect(shouldNotifySessionDone({ abort: false })).toBe(true)
  })

  it('não avisa quando o usuário encerrou a sessão no PC', () => {
    expect(shouldNotifySessionDone({ abort: true })).toBe(false)
  })
})
