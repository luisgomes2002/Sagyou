import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MCP_APPROVAL_TIMEOUT_MS,
  parkMcpApproval,
  resolveMcpApproval,
  type PendingMcpApproval
} from '../modules/agent/mcp-approval'

type Request = { id: string; resumo: string; expiresAt?: string }

describe('parkMcpApproval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-26T12:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('waits five minutes, not thirty seconds', () => {
    expect(MCP_APPROVAL_TIMEOUT_MS).toBe(5 * 60_000)
  })

  it('sends the card with its deadline and keeps it answerable after 30 s', async () => {
    const pending = new Map<string, PendingMcpApproval<Request>>()
    const send = vi.fn()
    const decision = parkMcpApproval(pending, { id: 'a1', resumo: 'Criar task' }, send)

    expect(send).toHaveBeenCalledWith({
      id: 'a1',
      resumo: 'Criar task',
      expiresAt: '2026-10-26T12:05:00.000Z'
    })
    vi.advanceTimersByTime(30_000)
    expect(pending.has('a1')).toBe(true)

    pending.get('a1')!.resolve(true)
    await expect(decision).resolves.toBe(true)
  })

  it('denies and forgets the card once the deadline passes', async () => {
    const pending = new Map<string, PendingMcpApproval<Request>>()
    const decision = parkMcpApproval(pending, { id: 'a1', resumo: 'Criar task' }, vi.fn())

    vi.advanceTimersByTime(MCP_APPROVAL_TIMEOUT_MS)
    await expect(decision).resolves.toBe(false)
    expect(pending.has('a1')).toBe(false)
  })

  it('an answer clears the deadline timer', async () => {
    const pending = new Map<string, PendingMcpApproval<Request>>()
    const decision = parkMcpApproval(pending, { id: 'a1', resumo: 'X' }, vi.fn())
    pending.get('a1')!.resolve(false)
    await expect(decision).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('resolveMcpApproval', () => {
  it('só a primeira resposta a um id pendente resolve', async () => {
    const a = new Map<string, PendingMcpApproval<Request>>()
    const b = new Map<string, PendingMcpApproval<Request>>()
    const resolve = vi.fn()
    b.set('c1', { resolve, request: { id: 'c1', resumo: 'x' } })
    expect(resolveMcpApproval([a, b], 'c1', true)).toBe(true)
    expect(resolve).toHaveBeenCalledWith(true)
    expect(b.has('c1')).toBe(false)
    expect(resolveMcpApproval([a, b], 'c1', false)).toBe(false)
    expect(resolveMcpApproval([a, b], 'inventado', true)).toBe(false)
    expect(resolve).toHaveBeenCalledTimes(1)
  })
})
