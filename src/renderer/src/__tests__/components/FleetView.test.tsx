import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { FleetView } from '../../components/FleetView'
import { useAiRunStore, EMPTY_USAGE } from '../../store/aiRun'
import type { Project } from '../../types'

// FleetView is a pure view over the desingletonised run store: it derives the
// list of agents from `running` + `runProjects` and reads each one's live
// state. No electronAPI, no agent loop — the store is set directly.

const projects = [
  { id: 'p1', name: 'Projeto Um' },
  { id: 'p2', name: 'Projeto Dois' }
] as Project[]

/** A blank run store, so each test starts with no agents. */
function resetRun(): void {
  useAiRunStore.setState({
    messages: [],
    running: new Set(),
    streaming: {},
    streamingTools: {},
    error: null,
    usage: EMPTY_USAGE,
    conversationId: null,
    parked: {},
    runProjects: {},
    runUsage: {},
    taskLeases: {},
    pendingApprovals: [],
    autoApprove: new Set(),
    abortRequested: new Set()
  })
}

beforeEach(resetRun)

/** Two agents live at once: A parked, B on screen and mid-tool. */
function twoAgents(): void {
  useAiRunStore.setState({
    running: new Set(['A', 'B']),
    conversationId: 'B',
    messages: [
      { role: 'user', content: 'tarefa B' },
      { role: 'status', content: 'Lendo App.tsx', done: false, step: 2, maxSteps: 40 }
    ],
    usage: { promptTokens: 500, completionTokens: 100 },
    parked: {
      A: { messages: [{ role: 'user', content: 'tarefa A' }], usage: EMPTY_USAGE }
    },
    runProjects: { A: 'p1', B: 'p2' },
    runUsage: {
      A: { promptTokens: 1500, completionTokens: 300 },
      B: { promptTokens: 500, completionTokens: 100 }
    }
  })
}

describe('FleetView', () => {
  it('says so when nothing is running', () => {
    render(<FleetView projects={projects} onOpenChat={() => {}} />)
    expect(screen.getByText('Nenhum agente ativo')).toBeInTheDocument()
    expect(screen.getByText('0 ativos')).toBeInTheDocument()
  })

  it('lists one card per running agent, with its project', () => {
    twoAgents()
    render(<FleetView projects={projects} onOpenChat={() => {}} />)

    expect(screen.getByText('2 ativos')).toBeInTheDocument()
    // Derived from running + runProjects.
    expect(screen.getByText('tarefa A')).toBeInTheDocument()
    expect(screen.getByText('tarefa B')).toBeInTheDocument()
    expect(screen.getByText('Projeto Um')).toBeInTheDocument()
    expect(screen.getByText('Projeto Dois')).toBeInTheDocument()
  })

  it('shows what an agent is doing and its step progress', () => {
    twoAgents()
    render(<FleetView projects={projects} onOpenChat={() => {}} />)

    // B's last in-flight status line and its step badge.
    expect(screen.getByText('Lendo App.tsx')).toBeInTheDocument()
    expect(screen.getByText('2/40')).toBeInTheDocument()
  })

  it('shows the token spend per agent — input and output', () => {
    twoAgents()
    render(<FleetView projects={projects} onOpenChat={() => {}} />)

    // A billed 1.5k prompt + 300 completion this run.
    expect(screen.getByText('↑ 1.5k entrada')).toBeInTheDocument()
    expect(screen.getByText('↓ 300 saída')).toBeInTheDocument()
    // B billed 500 + 100.
    expect(screen.getByText('↑ 500 entrada')).toBeInTheDocument()
    expect(screen.getByText('↓ 100 saída')).toBeInTheDocument()
  })

  it('flags an agent parked on approval', () => {
    twoAgents()
    useAiRunStore.setState({
      pendingApprovals: [{ convId: 'A', writes: [], selected: new Set() }]
    })
    render(<FleetView projects={projects} onOpenChat={() => {}} />)

    expect(screen.getByText('Aguardando sua aprovação…')).toBeInTheDocument()
  })

  it('"Abrir chat" opens that agent\'s conversation and switches to the AI view', async () => {
    twoAgents()
    const onOpenChat = vi.fn()
    render(<FleetView projects={projects} onOpenChat={onOpenChat} />)

    // First card is A (insertion order of the running set).
    await userEvent.click(screen.getAllByRole('button', { name: 'Abrir chat' })[0])

    expect(useAiRunStore.getState().conversationId).toBe('A')
    expect(onOpenChat).toHaveBeenCalled()
  })

  it('"Parar" aborts that agent, not another', async () => {
    twoAgents()
    render(<FleetView projects={projects} onOpenChat={() => {}} />)

    // Second card is B.
    await userEvent.click(screen.getAllByRole('button', { name: /Parar/ })[1])

    expect(useAiRunStore.getState().abortRequested.has('B')).toBe(true)
    expect(useAiRunStore.getState().abortRequested.has('A')).toBe(false)
  })
})
