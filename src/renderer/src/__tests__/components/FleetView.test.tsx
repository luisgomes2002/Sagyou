import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { FleetView } from '../../components/ai/FleetView'
import type { Project } from '../../types'
import { useKanbanStore } from '../../store/kanban'

// xterm needs a real canvas/matchMedia; the terminal itself is covered by AgentTerminal.test.
vi.mock('../../components/ai/AgentTerminal', () => ({
  AgentTerminal: ({ log }: { log: string }) => <pre data-testid="terminal">{log}</pre>
}))

// FleetView is a pure view over the code-agent state from the main process.
// The code-agent IPC is mocked; the component fetches status, runs, and
// listens to events.

const projects = [
  { id: 'p1', name: 'Projeto Um', codePaths: [{ path: '/home/user/projeto-um' }] },
  { id: 'p2', name: 'Projeto Dois', codePaths: [{ path: '/home/user/projeto-dois' }] }
] as Project[]

/** A running code-agent mock (what status() returns). */
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
    ...overrides
  }
}

beforeEach(() => {
  useKanbanStore.setState({ activeProjectId: 'p1' })
  if (!window.electronAPI) {
    // @ts-expect-error partial mock for tests
    window.electronAPI = {}
  }
  window.electronAPI.ai ??= {} as never
  window.electronAPI.ai.codeAgent = {
    status: vi.fn().mockResolvedValue({ running: false, runs: [], log: '', hint: null }),
    run: vi.fn(),
    stop: vi.fn(),
    terminalInput: vi.fn(),
    terminalResize: vi.fn().mockResolvedValue({ success: true }),
    setAuto: vi.fn().mockResolvedValue(undefined),
    onStarted: vi.fn(() => vi.fn()),
    onOutput: vi.fn(() => vi.fn()),
    onProgress: vi.fn(() => vi.fn()),
    onExit: vi.fn(() => vi.fn()),
    onAutoChanged: vi.fn(() => vi.fn()),
    onApproveRequest: vi.fn(() => vi.fn()),
    onQuestion: vi.fn(() => vi.fn()),
    onHint: vi.fn(() => vi.fn()),
    onArchived: vi.fn(() => vi.fn()),
    runs: vi.fn().mockResolvedValue([]),
    runGet: vi.fn().mockResolvedValue(null),
    runRenew: vi.fn().mockResolvedValue(undefined),
    diff: vi
      .fn()
      .mockResolvedValue({ patch: '', files: [], truncated: false, omittedNewFiles: [] }),
    approve: vi.fn()
  } as never
  window.electronAPI.legacyChat = {
    notice: vi.fn().mockResolvedValue(null),
    dismiss: vi.fn().mockResolvedValue(undefined)
  } as never
  window.electronAPI.ai.harnesses = {
    status: vi.fn().mockResolvedValue([
      {
        id: 'codex',
        label: 'Codex',
        installed: true,
        capabilities: {
          interactiveTerminal: 'available',
          createSession: 'available',
          resumeSession: 'unknown',
          modelSelection: 'unknown',
          modelStatus: 'unknown',
          permissionPrompts: 'available',
          cancellation: 'available',
          mcp: 'available',
          localInstructionDiscovery: 'unknown'
        }
      }
    ])
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
}

/** Set up two mock code-agent runs. */
function twoRuns(): void {
  const runA = makeRun({ id: 'run-A', task: 'tarefa A', dir: '/home/user/projeto-um' })
  const runB = makeRun({ id: 'run-B', task: 'tarefa B', dir: '/home/user/projeto-dois' })
  ;(window.electronAPI.ai.codeAgent.status as ReturnType<typeof vi.fn>).mockResolvedValue({
    running: true,
    runs: [runA, runB],
    log: '',
    hint: null
  })
}

describe('FleetView', () => {
  it('offers a new session when nothing is running', async () => {
    render(<FleetView projects={projects} />)
    expect(await screen.findByText('Nenhum agente ativo')).toBeInTheDocument()
    expect(screen.getByText('Ativas · 0')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Projeto da sessão' })).toBeInTheDocument()
  })

  it('shows progress and prevents duplicate clicks while opening a native terminal', async () => {
    let finishStart:
      | ((value: { success: boolean; runId: string; dir: string; agent: string }) => void)
      | null = null
    ;(window.electronAPI.ai.codeAgent.run as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = resolve
        })
    )
    const projectWithRoot = [
      {
        ...projects[0],
        codePaths: [{ id: 'root-1', path: '/home/user/projeto-um' }],
        activeCodePathIds: ['root-1']
      }
    ] as Project[]
    const user = userEvent.setup()
    render(<FleetView projects={projectWithRoot} />)

    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Projeto da sessão' }),
      'p1'
    )
    await user.click(screen.getByRole('button', { name: 'Abrir sessão' }))

    expect(screen.getAllByRole('button', { name: 'Abrindo terminal…' })[0]).toBeDisabled()
    expect(window.electronAPI.ai.codeAgent.run).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishStart?.({
        success: true,
        runId: 'run-terminal',
        dir: '/tmp/run-terminal',
        agent: 'Codex'
      })
    })
  })

  it('opens a general terminal without a selected project or repository', async () => {
    useKanbanStore.setState({ activeProjectId: null })
    ;(window.electronAPI.ai.codeAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      runId: 'general-run',
      dir: '/tmp/general-run',
      agent: 'Codex'
    })
    const user = userEvent.setup()
    render(<FleetView projects={projects} />)

    expect(await screen.findByRole('combobox', { name: 'Projeto da sessão' })).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Abrir sessão' }))

    expect(window.electronAPI.ai.codeAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ path: '', projectId: null, task: '', blank: true })
    )
    const sent = (window.electronAPI.ai.codeAgent.run as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>
    expect(typeof sent.sessionId).toBe('string')
    expect((sent.sessionId as string).length).toBeGreaterThan(0)
    expect(sent).not.toHaveProperty('convId')
  })

  it('persists the chosen executor before starting the session', async () => {
    window.electronAPI.ai.config = {
      get: vi.fn().mockResolvedValue({ codeHarness: 'claude-code' }),
      set: vi.fn().mockResolvedValue(undefined)
    } as never
    ;(window.electronAPI.ai.codeAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      runId: 'r',
      dir: '/tmp/r'
    })
    const user = userEvent.setup()
    render(<FleetView projects={projects} />)

    await screen.findByRole('option', { name: 'Codex' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Executor' }), 'codex')
    await user.click(screen.getByRole('button', { name: 'Abrir sessão' }))

    expect(window.electronAPI.ai.config.set).toHaveBeenCalledWith(
      expect.objectContaining({ codeHarness: 'codex' })
    )
  })

  it('lists every running code agent in the rail, with its project', async () => {
    twoRuns()
    render(<FleetView projects={projects} />)

    expect(await screen.findByRole('button', { name: /^tarefa A/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^tarefa B/ })).toBeInTheDocument()
    expect(screen.getAllByText(/Projeto Um/).length).toBeGreaterThan(0)
    expect(screen.getByText('Ativas · 2')).toBeInTheDocument()
  })

  it('selecting a session switches the workspace to it', async () => {
    twoRuns()
    render(<FleetView projects={projects} />)

    await userEvent.click(await screen.findByRole('button', { name: /^tarefa B/ }))
    expect(screen.getByRole('heading', { name: 'tarefa B' })).toBeInTheDocument()
  })

  it('shows only the current step for an unlimited agent', async () => {
    oneRun({ progress: { step: 15, maxSteps: 0, promptTokens: 100, completionTokens: 20 } })
    render(<FleetView projects={projects} />)

    expect((await screen.findAllByText('15')).length).toBeGreaterThan(0)
    expect(screen.queryByText('15/0')).not.toBeInTheDocument()
  })

  it('the inspector shows only the context, without activity or changes tabs', async () => {
    oneRun({ harness: 'codex', codeRoot: '/home/user/projeto-um', worktreeDir: '/tmp/run-1' })
    render(<FleetView projects={projects} />)

    const inspector = await screen.findByRole('complementary', { name: 'Inspetor' })
    expect(within(inspector).getByRole('heading', { name: 'Contexto' })).toBeInTheDocument()
    expect(within(inspector).queryByRole('tab')).not.toBeInTheDocument()
    expect(within(inspector).getByText('Tokens')).toBeInTheDocument()
    expect(screen.getByText('/tmp/run-1')).toBeInTheDocument()
    expect(screen.getByText('não informado pelo harness')).toBeInTheDocument()
    expect(window.electronAPI.ai.codeAgent.terminalInput).not.toHaveBeenCalled()
  })

  it('"Parar" stops the code agent', async () => {
    oneRun()
    render(<FleetView projects={projects} />)

    await userEvent.click(await screen.findByRole('button', { name: /Parar agente/ }))

    expect(window.electronAPI.ai.codeAgent.stop).toHaveBeenCalledWith('run-1')
  })

  it('does not offer to stop an interactive terminal from the renderer', async () => {
    oneRun({ interactive: true })
    render(<FleetView projects={projects} />)

    await screen.findByRole('heading', { name: 'Corrigir bug no login' })
    expect(screen.queryByRole('button', { name: /Parar agente/ })).not.toBeInTheDocument()
  })

  it('flags a session that needs the user and lets them approve it', async () => {
    oneRun({
      approvals: [
        { id: 'approval-1', name: 'escrever_arquivo', args: {}, resumo: 'Editar o cronômetro' }
      ]
    })
    render(<FleetView projects={projects} />)

    expect(await screen.findByText('Aguardando sua aprovação (1)')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Corrigir bug no login — Precisa de você/ })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }))

    expect(window.electronAPI.ai.codeAgent.approve).toHaveBeenCalledWith('approval-1', true)
  })

  it('shows the one-time removal notice with the snapshot path and dismisses it', async () => {
    ;(window.electronAPI.legacyChat.notice as ReturnType<typeof vi.fn>).mockResolvedValue({
      snapshotDir: 'C:\\dados\\backups\\pre-remocao-chat-1'
    })
    render(<FleetView projects={projects} />)

    expect(
      await screen.findByText(
        'O histórico de conversas foi removido. Um backup foi salvo em C:\\dados\\backups\\pre-remocao-chat-1.'
      )
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }))

    expect(window.electronAPI.legacyChat.dismiss).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/O histórico de conversas foi removido/)).not.toBeInTheDocument()
  })

  it('shows no notice when the migration reports nothing', async () => {
    render(<FleetView projects={projects} />)
    await screen.findByText('Nenhum agente ativo')
    expect(window.electronAPI.legacyChat.notice).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/O histórico de conversas foi removido/)).not.toBeInTheDocument()
  })
})
