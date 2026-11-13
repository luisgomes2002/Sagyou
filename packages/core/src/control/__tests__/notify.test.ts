import { describe, expect, it } from 'vitest'
import type { NotifyCode as FromClient } from '../client'
import {
  NOTIFICATION_FALLBACK,
  NOTIFICATION_TEXT,
  NOTIFY_CATEGORY,
  NOTIFY_CATEGORY_LABEL,
  NOTIFY_CODES,
  isNotifyCode,
  notifyTarget,
  type NotifyCode
} from '../notify'

const EXPECTED: Record<NotifyCode, [string, string]> = {
  ready: ['pc', 'PC pronto.'],
  'shutdown-failed': ['pc', 'O PC não foi desligado.'],
  'server-ready': ['pc', 'Servidor de Remote Control ligado.'],
  'server-failed': ['pc', 'O servidor de Remote Control não subiu ou caiu.'],
  'pc-silent': ['pc', 'O PC parou de responder.'],
  approval: ['sessions', 'Aprovação pendente no Sagyou.'],
  'session-done': ['sessions', 'Uma sessão de código terminou.'],
  suspended: ['security', 'Controle remoto suspenso por tentativas recusadas.'],
  'access-cut': ['security', 'Acesso remoto cortado.'],
  'device-paired': ['security', 'Um aparelho foi pareado ao seu sync.'],
  'device-revoked': ['security', 'Um aparelho do seu sync foi revogado.']
}

describe('notify codes', () => {
  it('has exactly the 11 codes, each with its category and fixed text', () => {
    expect([...NOTIFY_CODES].sort()).toEqual(Object.keys(EXPECTED).sort())
    for (const code of NOTIFY_CODES) {
      expect(NOTIFY_CATEGORY[code]).toBe(EXPECTED[code][0])
      expect(NOTIFICATION_TEXT[code]).toBe(EXPECTED[code][1])
    }
  })

  it('names the three categories', () => {
    expect(NOTIFY_CATEGORY_LABEL).toEqual({
      pc: 'PC e servidores',
      sessions: 'Sessões de código',
      security: 'Segurança'
    })
    expect(NOTIFICATION_FALLBACK).toBe('Notificação do Sagyou')
  })

  it('recognizes only known codes', () => {
    expect(isNotifyCode('approval')).toBe(true)
    expect(isNotifyCode('session-waiting')).toBe(false)
    expect(isNotifyCode('x')).toBe(false)
    expect(isNotifyCode(undefined)).toBe(false)
    expect(isNotifyCode(3)).toBe(false)
  })

  it('opens the notifications screen for an approval and the PC tab for the rest', () => {
    expect(notifyTarget('approval')).toBe('notifications')
    expect(notifyTarget(null)).toBe('pc')
    for (const code of NOTIFY_CODES) {
      if (code !== 'approval') expect(notifyTarget(code)).toBe('pc')
    }
  })

  it('is still exported as NotifyCode from the client', () => {
    const code: FromClient = 'server-ready'
    expect(isNotifyCode(code)).toBe(true)
  })
})
