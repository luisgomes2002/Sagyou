// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createRemoteCards } from '../handlers/remote'
import { createExternalCards } from '../modules/agent/mcp-external-cards'
import { MCP_APPROVAL_TIMEOUT_MS } from '../modules/agent/mcp-approval'
import type { RemoteService } from '../modules/remote/remote-service'

// Spec docs/specs/2026-11-07-endurecer-acesso-remoto.md, item 1: the external
// token's risky writes park a card on the PC and on the authorized phone.

interface Setup {
  service: {
    sendCard: Mock<(card: unknown) => Promise<void>>
    closeCard: Mock<(id: string) => Promise<void>>
  }
  toWindow: Mock<(channel: string, payload: unknown) => void>
  remoteCards: ReturnType<typeof createRemoteCards>
  cards: ReturnType<typeof createExternalCards>
}

function setup(): Setup {
  const service = {
    sendCard: vi.fn<(card: unknown) => Promise<void>>(async () => {}),
    closeCard: vi.fn<(id: string) => Promise<void>>(async () => {})
  }
  const toWindow = vi.fn<(channel: string, payload: unknown) => void>()
  const external = { current: null as ReturnType<typeof createExternalCards> | null }
  const remoteCards = createRemoteCards({
    maps: () => (external.current ? [external.current.pending] : []),
    service: () => service as unknown as RemoteService,
    send: toWindow
  })
  const cards = createExternalCards({
    park: remoteCards.park,
    send: (channel, payload) => toWindow(channel, payload)
  })
  external.current = cards
  return { service, toWindow, remoteCards, cards }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('cartões do token externo', () => {
  it('manda o cartão ao celular com a sessão "Acesso externo" e ao PC', () => {
    const { service, toWindow, cards } = setup()
    void cards.request('delete_task', { id: 't1' }, 'Excluir tarefa "Teste"')
    expect(cards.count()).toBe(1)
    expect(service.sendCard).toHaveBeenCalledWith(
      expect.objectContaining({
        session: 'Acesso externo',
        tool: 'delete_task',
        resumo: 'Excluir tarefa "Teste"'
      })
    )
    expect(toWindow).toHaveBeenCalledWith(
      'mcp-external:approve-request',
      expect.objectContaining({ name: 'mcp:delete_task', resumo: 'Excluir tarefa "Teste"' })
    )
  })

  it('a resposta do celular (ou do PC) resolve o cartão e fecha nos dois lados', async () => {
    const { service, toWindow, remoteCards, cards } = setup()
    const decision = cards.request('delete_task', { id: 't1' }, 'Excluir')
    const [card] = [...cards.pending.values()].map((p) => p.request)
    expect(remoteCards.answer(card.id, true)).toBe(true)
    await expect(decision).resolves.toBe(true)
    expect(cards.count()).toBe(0)
    expect(toWindow).toHaveBeenCalledWith('ai:code-agent:approval-closed', card.id)
    expect(service.closeCard).toHaveBeenCalledWith(card.id)
    // A second answer for the same card finds nothing.
    expect(remoteCards.answer(card.id, false)).toBe(false)
  })

  it('denyAll recusa todos os pendentes e fecha cada um no celular', async () => {
    const { service, cards } = setup()
    const a = cards.request('delete_task', {}, 'A')
    const b = cards.request('create_transaction', {}, 'B')
    const ids = [...cards.pending.keys()]
    cards.denyAll()
    await expect(a).resolves.toBe(false)
    await expect(b).resolves.toBe(false)
    expect(cards.count()).toBe(0)
    for (const id of ids) expect(service.closeCard).toHaveBeenCalledWith(id)
  })

  it('sem resposta em 5 minutos o cartão é recusado', async () => {
    const { cards } = setup()
    const decision = cards.request('delete_goal', {}, 'Excluir meta')
    vi.advanceTimersByTime(MCP_APPROVAL_TIMEOUT_MS)
    await expect(decision).resolves.toBe(false)
    expect(cards.count()).toBe(0)
  })
})
