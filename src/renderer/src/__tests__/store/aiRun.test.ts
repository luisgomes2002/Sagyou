import { describe, it, expect, beforeEach, vi } from 'vitest'
import { writeHandoff } from '../../store/aiRun'
import { useKanbanStore } from '../../store/kanban'

// writeHandoff derives a per-project breadcrumb from the last exchange and sends
// it through window.electronAPI.ai.memory.handoff (the main process upserts it).
// Here the bridge is stubbed — what's under test is the derivation: scope, title,
// body shape, truncation, and the skips.

const st = (): ReturnType<typeof useKanbanStore.getState> => useKanbanStore.getState()

function installHandoff(): ReturnType<typeof vi.fn> {
  const handoff = vi.fn(async () => ({ ok: true as const }))
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { ai: { memory: { handoff } } }
  return handoff
}

describe('writeHandoff', () => {
  beforeEach(() => {
    useKanbanStore.setState({ projects: [], activeProjectId: null, isLoaded: false })
  })

  it('sends a breadcrumb scoped to the active project, titled with its name', async () => {
    const pid = st().createProject('Sagyou')
    const handoff = installHandoff()

    await writeHandoff('como funciona o backup?', 'O backup exporta tudo para um JSON.')

    expect(handoff).toHaveBeenCalledWith({
      projectId: pid,
      title: 'Última sessão — Sagyou',
      body: 'Perguntou: "como funciona o backup?". Conclusão: O backup exporta tudo para um JSON.'
    })
  })

  it('truncates a long answer', async () => {
    st().createProject('P')
    const handoff = installHandoff()

    await writeHandoff('q', 'x'.repeat(1000))

    const body = handoff.mock.calls[0][0].body as string
    expect(body).toContain('…')
    expect(body.length).toBeLessThan(700)
  })

  it('skips an aborted or empty reply', async () => {
    st().createProject('P')
    const handoff = installHandoff()

    await writeHandoff('q', 'Execução interrompida.')
    await writeHandoff('q', '   ')

    expect(handoff).not.toHaveBeenCalled()
  })

  it('is a no-op when the memory bridge is absent (never throws)', async () => {
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { ai: {} }
    await expect(writeHandoff('q', 'uma resposta real')).resolves.toBeUndefined()
  })
})
