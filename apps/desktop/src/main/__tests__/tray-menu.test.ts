// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildTrayMenu } from '../modules/desktop/tray-menu'

describe('tray menu', () => {
  it('has no lock item when the app cannot lock', () => {
    expect(buildTrayMenu({ canLock: false })).toEqual([
      { id: 'open', label: 'Abrir Sagyou' },
      { id: 'sep' },
      { id: 'quit', label: 'Sair' }
    ])
  })

  it('offers "Bloquear agora" when it can', () => {
    expect(buildTrayMenu({ canLock: true }).map((item) => item.id)).toEqual([
      'open',
      'lock',
      'sep',
      'quit'
    ])
    expect(buildTrayMenu({ canLock: true })[1]).toEqual({ id: 'lock', label: 'Bloquear agora' })
  })
})
