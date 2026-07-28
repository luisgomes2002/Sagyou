import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { FleetView } from '../../components/ai/FleetView'
import type { Project } from '../../types'

// FleetView is a pure view over the code-agent state from the main process.
// The code-agent IPC is mocked; the component fetches status, runs, and
// listens to events.

const projects = [
  { id: 'p1', name: 'Projeto Um', codePaths: [{ path: '/home/user/projeto-um' }] },
  { id: 'p2', name: 'Projeto Dois', codePaths: [{ path: '/home/user/projeto-dois' }] }
] as Project[]

/** A running code-agent card mock (what status() returns). */
function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    dir: '/home/user/projeto-um',
    task: 'Corrigir bug no login',
    model: 'gpt-4',
    startedAt: Date.now() - 60_000,
    log: '[tool] ler_arquivo\n[resultado] App.tsx lido\n',
    hint: null,
    progress: { step: 3, maxSteps: 40, promptTokens: 1500, completionTokens: 300 },
    approval: null,
    toolEvent: { phase: 'call', name: 'ler_arquivo' },
    ...overrides
  }
}

beforeEach(() => {
  // Mock the code-agent IPC so that useCodeAgentRuns doesn't crash.
  if (!window.electronAPI) {
    // @ts-expect-error partial mock for tests
    window.electronAPI = {}
  }
  window.electronAPI.ai ??= {} as never
  window.electronAPI.ai.codeAgent = {
    status: vi.fn().mockResolvedValue({ running: false, runs: [], log: '', hint: null }),
    stop: vi.fn(),
    setAuto: vi.fn().mockResolvedValue(undefined),
    onStarted: vi.fn(() => vi.fn()),
    onOutput: vi.fn(() => vi.fn()),
    onProgress: vi.fn(() => vi.fn()),
    onExit: vi.fn(() => vi.fn()),
    onAutoChanged: vi.fn(() => vi.fn()),
    onApproveRequest: vi.fn(() => vi.fn()),
    onHint: vi.fn(() => vi.fn()),
    onToolEvent: vi.fn(() => vi.fn()),
    onArchived: vi.fn(() => vi.fn()),
    runs: vi.fn().mockResolvedValue([]),
    runGet: vi.fn().mockResolvedValue(null),
    approve: vi.fn()
  } as never
})

/** Set up one mock code-agent run via the status call. */
function oneRun(overrides: Record<string, unknown> = {}): void {
  const run = makeRun(overrides)
  ;(window.electronAPI.ai.codeAgent.status as ReturnType<typeof vi.fn>).mockResolvedValue({
    running: true,
    runs: [run],
    log: run.log,
    hint: null
  })
  ;(window.electronAPI.ai.codeAgent.runs as ReturnType<typeof vi.fn>).mockResolvedValue([])
}

/** Set up two mock code-agent runs. */
function twoRuns(): void {
  const runA = makeRun({ id: 'run-A', task: 'tarefa A', dir: '/home/user/projeto-um' })
  const runB = makeRun({
    id: 'run-B',
    task: 'tarefa B',
    dir: '/home/user/projeto-dois',
    toolEvent: { phase: 'result', name: 'escrever_arquivo' }
  })
  ;(window.electronAPI.ai.codeAgent.status as ReturnType<typeof vi.fn>).mockResolvedValue({
    running: true,
    runs: [runA, runB],
    log: '',
    hint: null
  })
  ;(window.electronAPI.ai.codeAgent.runs as ReturnType<typeof vi.fn>).mockResolvedValue([])
}

describe('FleetView', () => {
  it('says so when nothing is running', async () => {
    render(<FleetView projects={projects} onOpenChat={() => {}} />)
    expect(await screen.findByText('Nenhum agente ativo')).toBeInTheDocument()
    expect(screen.getByText('0 ativos')).toBeInTheDocument()
  })

  it('lists one card per running code-agent, with its project', async () => {
    twoRuns()
    render(<FleetView projects={projects} onOpenChat={() => {}} />)

    expect(await screen.findByText('tarefa A')).toBeInTheDocument()
    expect(screen.getByText('tarefa B')).toBeInTheDocument()
    expect(screen.getByText('Projeto Um')).toBeInTheDocument()
    expect(screen.getByText('Projeto Dois')).toBeInTheDocument()
    expect(screen.getByText('2 ativos')).toBeInTheDocument()
  })

  it('shows what a code-agent is doing and its step progress', async () => {
    oneRun()
    render(<FleetView projects={projects} onOpenChat={() => {}} />)

    expect(await screen.findByText('3/40')).toBeInTheDocument()
    // The tool event shows as "[tool] ler_arquivo"
    expect(screen.getByText(/\[tool\] ler_arquivo/)).toBeInTheDocument()
  })

  it('shows the token spend per code-agent — input and output', async () => {
    oneRun()
    render(<FleetView projects={projects} onOpenChat={() => {}} />)

    expect(await screen.findByText('↑ 1,500 entrada')).toBeInTheDocument()
    expect(screen.getByText('↓ 300 saída')).toBeInTheDocument()
  })

  it('shows the code-agent model and step progress', async () => {
    oneRun()
    render(<FleetView projects={projects} onOpenChat={() => {}} />)

    await screen.findByText('Corrigir bug no login')
    expect(screen.getByText(/gpt-4/)).toBeInTheDocument()
  })

  it('"Abrir chat" opens the inline chat view for a running code agent', async () => {
    oneRun()
    const onOpenChat = vi.fn()
    render(<FleetView projects={projects} onOpenChat={onOpenChat} />)

    await screen.findByText('Corrigir bug no login')
    await userEvent.click(screen.getByRole('button', { name: 'Abrir chat' }))

    await screen.findByPlaceholderText('Digite uma mensagem para o agente de código…')
  })

  it('"Parar" stops the code-agent', async () => {
    oneRun()
    render(<FleetView projects={projects} onOpenChat={() => {}} />)

    await screen.findByText('Corrigir bug no login')
    await userEvent.click(screen.getByRole('button', { name: /Parar/ }))

    expect(window.electronAPI.ai.codeAgent.stop).toHaveBeenCalledWith('run-1')
  })
})
