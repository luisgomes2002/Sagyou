import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Drive the agent by hand so the test controls exactly when a tool starts and
// finishes — the point here is what the chat renders in between. Only the two
// calls are stubbed; the module's constants and helpers stay real, so importing
// a new one in AIView can't quietly turn it into undefined here.
vi.mock('../../ai/agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ai/agent')>()),
  runAgent: vi.fn(),
  callModel: vi.fn()
}))

vi.mock('../../services/ElectronStorage', () => ({
  ElectronStorage: class {
    load = vi.fn(async () => null)
    save = vi.fn(async () => {})
  }
}))

import { AIView } from '../../components/AIView'
import { AiRunHost } from '../../components/AiRunHost'
import { useAiRunStore } from '../../store/aiRun'
import { runAgent, AUTO_MAX_STEPS } from '../../ai/agent'
import type { RunAgentOptions, AIConfig, PendingCall } from '../../ai/agent'

type UsageSummary = Awaited<ReturnType<typeof window.electronAPI.ai.usage.summary>>

let storedConfig: AIConfig = {
  baseUrl: 'http://x',
  apiKey: 'k',
  model: 'm'
}

function installApi(): void {
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    ai: {
      config: { get: vi.fn(async () => storedConfig), set: vi.fn(async () => {}) },
      models: vi.fn(async () => ({ success: true, models: ['m'] })),
      conversations: {
        list: vi.fn(async () => []),
        search: vi.fn(async () => storedHistory),
        get: vi.fn(async () => null),
        save: vi.fn(async () => {}),
        rename: vi.fn(async (_id: string, title: string) => ({ title })),
        delete: vi.fn(async () => {})
      },
      usage: { summary: vi.fn(async () => storedSpend) },
      images: {
        save: vi.fn(async () => ({ id: `img-${++savedImageN}` })),
        get: vi.fn(async () => ({ error: 'Imagem não encontrada' })),
        delete: vi.fn(async () => {})
      },
      skills: { list: vi.fn(async () => []), save: vi.fn(), delete: vi.fn(async () => {}), import: vi.fn() },
      codeAgent: {
        onOutput: vi.fn(() => vi.fn()),
        onStarted: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn()),
        // Fires when a finished run has been archived; the picker listens
        // for it rather than guessing when the snapshot exists.
        onArchived: vi.fn(() => vi.fn()),
        // Native agent: a tool step, and the per-action approval card.
        onToolEvent: vi.fn(() => vi.fn()),
        onApproveRequest: vi.fn(() => vi.fn()),
        // A recognised environment failure (e.g. the sandbox couldn't start).
        onHint: vi.fn(() => vi.fn()),
        // Live step + token counter pushed each step.
        onProgress: vi.fn(() => vi.fn()),
        approve: vi.fn(),
        runs: vi.fn(async () => []),
        runGet: vi.fn(async () => null),
        // The panel asks for the buffered log on mount — it may have missed the
        // stream entirely while this view was unmounted.
        status: vi.fn(async () => ({ running: false, log: '' })),
        stop: vi.fn()
      },
      jail: {
        // Available so the onboarding modal stays closed in these tests.
        status: vi.fn(async () => ({
          available: true,
          version: '1.15.0',
          path: '/usr/local/bin/ai-jail',
          platform: 'linux',
          installable: true,
          enabled: true,
          onboardingDismissed: true,
          wslCommand: 'wsl --install'
        })),
        install: vi.fn(async () => ({ success: true })),
        dismissOnboarding: vi.fn(),
        onProgress: vi.fn(() => vi.fn())
      }
    }
  }
}

/**
 * Mount the view the way App does — next to AiRunHost, which draws the approval
 * card and owns the autosave. Both are needed for a run to be observable: the
 * run's state lives in the store above them, not in the view.
 *
 * activeView 'ai' because that is when AIView is on screen; it's what tells the
 * host to leave Escape to the view, which peels one layer at a time.
 */
function renderAI(ui: React.ReactElement): ReturnType<typeof render> {
  return render(
    <>
      {ui}
      <AiRunHost activeView="ai" onOpenAI={() => {}} />
    </>
  )
}

/**
 * The run outlives any one component now, so it also outlives a test: the store
 * is module state, and a leaked transcript would land in the next test's chat.
 */
beforeEach(() => {
  // Clear the run *first*: `reset()` is the "Nova" button, not a wipe, and it
  // deliberately spares a run in flight — parking its transcript and keeping
  // its approval. Called while a previous test's `busy` was still set, it would
  // hand this test that test's parked chat, which then legitimately outranks
  // the stored one when the same id is reopened.
  useAiRunStore.setState({
    running: new Set(),
    abortRequested: new Set(),
    autoApprove: new Set(),
    pendingApprovals: [],
    streaming: {},
    streamingTools: {},
    runProjects: {},
    savedTick: 0,
    parked: {}
  })
  useAiRunStore.getState().reset()
})

const emptyBucket = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  cost: 0,
  unpricedCalls: 0,
  cachedPromptTokens: 0,
  cacheReportedPromptTokens: 0
}
/** Counter behind the fake image ids (img-1, img-2…). Reset per test. */
let savedImageN = 0


/** What the history search returns. Reset per test. */
let storedHistory: { id: string; title: string; updatedAt: string; snippet?: string }[] = []

/** What the main process's usage log reports back. Reset per test. */
let storedSpend: UsageSummary = {
  today: emptyBucket,
  last30: emptyBucket,
  total: emptyBucket,
  byModel: [],
  recent: []
}

// The approval card is the only thing between the model and the user's data:
// every write tool (criar_tasks, deletar_task, criar_transacao…) is funnelled
// through the ApprovalRequest that AIView hands runAgent. These tests drive
// that callback the way the agent loop does.

describe('AIView — reopening the last chat', () => {
  let restoreLayout: () => void

  /**
   * jsdom has no layout, so every scroll metric reads 0 — which makes
   * `scrollHeight - scrollTop - clientHeight < 120` trivially true and hides
   * the bug entirely. Stand in a tall, scrolled-to-top container: that is the
   * state a freshly opened transcript is actually in, and the one where the
   * "follow only if already at the bottom" rule leaves the user at the start.
   */
  const mockScrollBox = (): (() => void) => {
    const saved = ['scrollHeight', 'clientHeight'].map(
      (p) => [p, Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, p)] as const
    )
    Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 1000
    })
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 300
    })
    return () => {
      for (const [p, d] of saved) {
        if (d) Object.defineProperty(HTMLDivElement.prototype, p, d)
        else Reflect.deleteProperty(HTMLDivElement.prototype, p)
      }
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    storedConfig = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
    storedSpend = {
      today: emptyBucket,
      last30: emptyBucket,
      total: emptyBucket,
      byModel: [],
      recent: []
    }
    storedHistory = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()
    restoreLayout = mockScrollBox()
  })
  afterEach(() => restoreLayout())

  const conversation = {
    id: 'c1',
    title: 'Planejar sprint',
    messages: [
      { role: 'user', content: 'primeira mensagem' },
      { role: 'assistant', content: 'última mensagem' }
    ]
  }

  const storeConversation = (conv: unknown = conversation): void => {
    vi.mocked(window.electronAPI.ai.conversations.get).mockResolvedValue(conv as never)
    // The dropdown lists whatever the search returns — '' means "everything".
    storedHistory = [{ id: 'c1', title: 'Planejar sprint', updatedAt: new Date().toISOString() }]
  }

  it('reopens the chat that was last in front of the user', async () => {
    storedConfig = { ...storedConfig, lastConversationId: 'c1' }
    storeConversation()

    renderAI(<AIView projects={[]} />)

    expect(await screen.findByText('última mensagem')).toBeInTheDocument()
    expect(window.electronAPI.ai.conversations.get).toHaveBeenCalledWith('c1')
  })

  it('opens at the END of that chat, not the top', async () => {
    storedConfig = { ...storedConfig, lastConversationId: 'c1' }
    storeConversation()

    renderAI(<AIView projects={[]} />)
    await screen.findByText('última mensagem')

    // The container is tall and at scrollTop 0 — the "already at the bottom"
    // rule would decline to scroll here, leaving the oldest message on screen.
    await waitFor(() => expect(Element.prototype.scrollTo).toHaveBeenCalledWith({ top: 1000 }))
  })

  it('starts blank when nothing was open', async () => {
    renderAI(<AIView projects={[]} />)
    expect(await screen.findByText(/Converse com o modelo/)).toBeInTheDocument()
    expect(window.electronAPI.ai.conversations.get).not.toHaveBeenCalled()
  })

  it('remembers a brand-new chat from its first message', async () => {
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())

    await userEvent.type(box, 'oi{Enter}')

    // The id is minted on the first message — miss it and this is the one
    // conversation that never reopens.
    const set = vi.mocked(window.electronAPI.ai.config.set)
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({ lastConversationId: expect.any(String) })
      )
    )
  })

  it('remembers a chat picked from the history', async () => {
    storeConversation()
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.click(await screen.findByText('Planejar sprint'))

    const set = vi.mocked(window.electronAPI.ai.config.set)
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ lastConversationId: 'c1' }))
    )
  })

  it('opens a chat picked from the history at its end too', async () => {
    storeConversation()
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Histórico'))
    vi.mocked(Element.prototype.scrollTo).mockClear()

    await userEvent.click(await screen.findByText('Planejar sprint'))

    await waitFor(() => expect(Element.prototype.scrollTo).toHaveBeenCalledWith({ top: 1000 }))
  })

  it('forgets the chat when the user asks for a new one', async () => {
    storedConfig = { ...storedConfig, lastConversationId: 'c1' }
    storeConversation()
    renderAI(<AIView projects={[]} />)
    await screen.findByText('última mensagem')

    await userEvent.click(screen.getByText('Nova'))

    // Asking for a blank chat must mean a blank chat next time as well.
    const set = vi.mocked(window.electronAPI.ai.config.set)
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ lastConversationId: undefined }))
    )
  })

  it('forgets an id whose conversation is gone, instead of retrying forever', async () => {
    storedConfig = { ...storedConfig, lastConversationId: 'apagada' }
    vi.mocked(window.electronAPI.ai.conversations.get).mockResolvedValue(null as never)

    renderAI(<AIView projects={[]} />)

    expect(await screen.findByText(/Converse com o modelo/)).toBeInTheDocument()
    const set = vi.mocked(window.electronAPI.ai.config.set)
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ lastConversationId: undefined }))
    )
  })

  it('jumps once, then hands control back to the follow rule', async () => {
    // The flag must be consumed by the restore. If it latched on, every later
    // render would force the view down and the user could never read back
    // through the chat they just reopened.
    storedConfig = { ...storedConfig, lastConversationId: 'c1' }
    storeConversation()
    let opts: RunAgentOptions = {}
    vi.mocked(runAgent).mockImplementation(
      (_c, _m, _a, o = {}) =>
        new Promise(() => {
          opts = o
        })
    )
    renderAI(<AIView projects={[]} />)
    await screen.findByText('última mensagem')
    await waitFor(() => expect(Element.prototype.scrollTo).toHaveBeenCalledWith({ top: 1000 }))

    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'mais uma{Enter}')
    vi.mocked(Element.prototype.scrollTo).mockClear()

    act(() => opts.onStream?.('resposta chegando'))

    expect(Element.prototype.scrollTo).not.toHaveBeenCalled()
  })

  it('still does not yank a user who scrolled up mid-answer', async () => {
    // The restore jump is a one-off; the ordinary follow rule must survive it.
    let opts: RunAgentOptions = {}
    vi.mocked(runAgent).mockImplementation(
      (_c, _m, _a, o = {}) =>
        new Promise(() => {
          opts = o
        })
    )
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'oi{Enter}')
    vi.mocked(Element.prototype.scrollTo).mockClear()

    act(() => opts.onStream?.('resposta chegando'))

    // Container is tall and at the top: reading back is not interrupted.
    expect(Element.prototype.scrollTo).not.toHaveBeenCalled()
  })
})

describe('AIView — write approval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storedConfig = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
    storedSpend = {
      today: emptyBucket,
      last30: emptyBucket,
      total: emptyBucket,
      byModel: [],
      recent: []
    }
    storedHistory = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()
  })

  const writes: PendingCall[] = [
    { id: 'w1', name: 'criar_tasks', args: { tasks: [{ title: 'A' }] } },
    { id: 'w2', name: 'deletar_task', args: { titulo: 'Velha' } }
  ]

  /**
   * Sends a message and returns the approval decision the agent receives.
   * Mirrors the loop: call onApprove with pending writes, resolve with the ids.
   */
  const askApproval = async (
    pending: PendingCall[] = writes
  ): Promise<{ decision: Promise<Set<string>> }> => {
    let decision!: Promise<Set<string>>
    vi.mocked(runAgent).mockImplementation(async (_c, _m, onApprove) => {
      decision = onApprove(pending)
      await decision
      return 'ok'
    })
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'oi{Enter}')
    await waitFor(() => expect(runAgent).toHaveBeenCalled())
    return { decision }
  }

  it('asks before running write actions, listing each one', async () => {
    await askApproval()

    expect(await screen.findByText(/Aprovar ações da IA/)).toBeInTheDocument()
    // Each action is spelled out — approving a blank "criar_tasks" is not a
    // real approval.
    expect(screen.getByText(/Criar 1 task/)).toBeInTheDocument()
    expect(screen.getByText(/Deletar task PERMANENTEMENTE: Velha/)).toBeInTheDocument()
  })

  it('approves everything that is still ticked', async () => {
    const { decision } = await askApproval()
    await screen.findByText(/Aprovar ações da IA/)

    await userEvent.click(screen.getByRole('button', { name: /^Aprovar 2$/ }))

    expect(await decision).toEqual(new Set(['w1', 'w2']))
  })

  it('runs only the actions left ticked', async () => {
    const { decision } = await askApproval()
    await screen.findByText(/Aprovar ações da IA/)

    // Untick the delete, keep the create.
    await userEvent.click(screen.getAllByRole('checkbox')[1])
    await userEvent.click(screen.getByRole('button', { name: /^Aprovar 1$/ }))

    expect(await decision).toEqual(new Set(['w1']))
  })

  it('"Recusar tudo" approves nothing', async () => {
    const { decision } = await askApproval()
    await screen.findByText(/Aprovar ações da IA/)

    await userEvent.click(screen.getByText('Recusar tudo'))

    // The agent reports each denial back to the model rather than running it.
    expect(await decision).toEqual(new Set())
  })

  it('cannot approve an empty selection', async () => {
    await askApproval()
    await screen.findByText(/Aprovar ações da IA/)

    for (const cb of screen.getAllByRole('checkbox')) await userEvent.click(cb)

    expect(screen.getByRole('button', { name: /^Aprovar$/ })).toBeDisabled()
  })

  it('closes the card once decided, so it cannot be answered twice', async () => {
    const { decision } = await askApproval()
    await screen.findByText(/Aprovar ações da IA/)

    await userEvent.click(screen.getByText('Recusar tudo'))
    await decision

    await waitFor(() => expect(screen.queryByText(/Aprovar ações da IA/)).not.toBeInTheDocument())
  })
})

describe('AIView — automatic mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storedConfig = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
    storedSpend = {
      today: emptyBucket,
      last30: emptyBucket,
      total: emptyBucket,
      byModel: [],
      recent: []
    }
    storedHistory = []
    savedImageN = 0
    useAiRunStore.getState().ensureConversationId()
    installApi()
    Element.prototype.scrollTo = vi.fn()
  })

  const writes: PendingCall[] = [{ id: 'w1', name: 'criar_tasks', args: { tasks: [] } }]

  /**
   * The toggle no longer flips the mode — it opens the cost gate, and the mode
   * only changes if the user confirms there. Every test that wants automatic
   * mode on goes through the dialog, exactly like a user does.
   */
  const turnAutoOn = async (): Promise<void> => {
    await userEvent.click(await screen.findByText('Auto'))
    await userEvent.click(await screen.findByText('Ligar automático'))
  }

  it('asks before switching on, and stays off if the gate is refused', async () => {
    renderAI(<AIView projects={[]} />)
    await userEvent.click(await screen.findByText('Auto'))
    // The cap is the fact always worth stating, so it is always in the message.
    expect(await screen.findByText(new RegExp(`${AUTO_MAX_STEPS} rodadas`))).toBeInTheDocument()

    await userEvent.click(screen.getByText('Cancelar'))
    expect(screen.queryByText('Auto: ON')).not.toBeInTheDocument()
  })

  it('is off by default, and says so', async () => {
    renderAI(<AIView projects={[]} />)
    const auto = await screen.findByText('Auto')
    expect(auto).toHaveAttribute(
      'title',
      'Modo autônomo DESLIGADO — cada ação pede sua aprovação. Clique para não perguntar mais.'
    )
    expect(screen.queryByText('Auto: ON')).not.toBeInTheDocument()
  })

  it('updates the Auto tooltip when autonomous mode is on', async () => {
    renderAI(<AIView projects={[]} />)
    await turnAutoOn()

    expect(
      screen.getByTitle(
        'Modo autônomo LIGADO — a IA trabalha sem interrupção. Clique para voltar a pedir aprovação.'
      )
    ).toHaveTextContent('Auto: ON')
  })

  it('approves without asking once switched on', async () => {
    let decision!: Promise<Set<string>>
    vi.mocked(runAgent).mockImplementation(async (_c, _m, onApprove) => {
      decision = onApprove(writes)
      await decision
      return 'ok'
    })
    renderAI(<AIView projects={[]} />)
    await turnAutoOn()
    expect(screen.getByText('Auto: ON')).toBeInTheDocument()

    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'oi{Enter}')

    // No card at all — this is the trade the toggle makes.
    await waitFor(() => expect(decision).toBeDefined())
    expect(await decision).toEqual(new Set(['w1']))
    expect(screen.queryByText(/Aprovar ações da IA/)).not.toBeInTheDocument()
  })

  it('"Sempre permitir" approves and latches automatic mode on', async () => {
    let decision!: Promise<Set<string>>
    vi.mocked(runAgent).mockImplementation(async (_c, _m, onApprove) => {
      decision = onApprove(writes)
      await decision
      return 'ok'
    })
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'oi{Enter}')
    await screen.findByText(/Aprovar ações da IA/)

    await userEvent.click(screen.getByText('Sempre permitir'))

    expect(await decision).toEqual(new Set(['w1']))
    // It is a mode switch, not a one-off: the user must be able to see that.
    expect(await screen.findByText('Auto: ON')).toBeInTheDocument()
  })

  it('raises the step cap in automatic mode', async () => {
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    await turnAutoOn()
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await userEvent.type(box, 'oi{Enter}')

    await waitFor(() => expect(runAgent).toHaveBeenCalled())
    expect(vi.mocked(runAgent).mock.calls[0][3]?.maxSteps).toBe(AUTO_MAX_STEPS)
  })
})

describe('AIView — stopping a run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storedConfig = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
    storedSpend = {
      today: emptyBucket,
      last30: emptyBucket,
      total: emptyBucket,
      byModel: [],
      recent: []
    }
    storedHistory = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()
  })

  it('tells the agent to abort when Parar is pressed', async () => {
    let opts: RunAgentOptions = {}
    let finish: (s: string) => void = () => {}
    vi.mocked(runAgent).mockImplementation(
      (_c, _m, _a, o = {}) =>
        new Promise((resolve) => {
          opts = o
          finish = resolve
        })
    )
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'oi{Enter}')

    expect(opts.shouldAbort?.()).toBe(false)
    await userEvent.click(await screen.findByLabelText('Parar'))

    // The loop polls this between steps; flipping it is the whole mechanism.
    expect(opts.shouldAbort?.()).toBe(true)
    await act(async () => finish('Execução interrompida.'))
  })

  it('starts each turn un-aborted, so a past stop does not kill the next one', async () => {
    let opts: RunAgentOptions = {}
    vi.mocked(runAgent).mockImplementation(async (_c, _m, _a, o = {}) => {
      opts = o
      return 'ok'
    })
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())

    await userEvent.type(box, 'um{Enter}')
    await waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'dois{Enter}')
    await waitFor(() => expect(runAgent).toHaveBeenCalledTimes(2))

    expect(opts.shouldAbort?.()).toBe(false)
  })
})

describe('AIView — composer gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storedSpend = {
      today: emptyBucket,
      last30: emptyBucket,
      total: emptyBucket,
      byModel: [],
      recent: []
    }
    storedHistory = []
    savedImageN = 0
    Element.prototype.scrollTo = vi.fn()
  })

  it('stays usable on a first run, falling back to the built-in defaults', async () => {
    // No ai-config.json yet: the loader substitutes defaults rather than
    // locking the user out of their own chat.
    storedConfig = { baseUrl: '', apiKey: '', model: '' }
    installApi()
    renderAI(<AIView projects={[]} />)

    const box = await screen.findByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    expect(screen.queryByText(/Configure a Base URL e o Model/)).not.toBeInTheDocument()
  })

  it('blocks sending once the base URL is cleared by hand', async () => {
    storedConfig = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
    installApi()
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())

    await userEvent.click(screen.getByText('Configuração'))
    await userEvent.clear(screen.getByPlaceholderText('https://api.openai.com/v1'))

    // Sending would fail at the provider anyway; say so up front instead.
    await waitFor(() => expect(box).toBeDisabled())
    expect(screen.getByText(/Configure a Base URL e o Model/)).toBeInTheDocument()
  })

  it('does not send an empty or whitespace-only prompt', async () => {
    storedConfig = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
    installApi()
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())

    await userEvent.type(box, '   {Enter}')

    expect(runAgent).not.toHaveBeenCalled()
  })

  it('shift+enter makes a newline instead of sending', async () => {
    storedConfig = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
    installApi()
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/) as HTMLTextAreaElement
    await waitFor(() => expect(box).not.toBeDisabled())

    await userEvent.type(box, 'linha um{Shift>}{Enter}{/Shift}linha dois')

    expect(runAgent).not.toHaveBeenCalled()
    expect(box.value).toBe('linha um\nlinha dois')
  })

  it('surfaces a failed turn as an error banner', async () => {
    storedConfig = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
    installApi()
    vi.mocked(runAgent).mockRejectedValue(new Error('401 chave inválida'))
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())

    await userEvent.type(box, 'oi{Enter}')

    expect(await screen.findByText('401 chave inválida')).toBeInTheDocument()
    // …and the composer comes back, rather than staying stuck on "busy".
    await waitFor(() => expect(box).not.toBeDisabled())
  })
})


describe('AIView — keyboard shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storedConfig = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
    storedSpend = {
      today: emptyBucket,
      last30: emptyBucket,
      total: emptyBucket,
      byModel: [],
      recent: []
    }
    storedHistory = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()
  })

  const composer = async (): Promise<HTMLElement> => {
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    return box
  }
  const esc = (): boolean => fireEvent.keyDown(document, { key: 'Escape' })

  describe('sending', () => {
    it('Ctrl+Enter sends', async () => {
      vi.mocked(runAgent).mockResolvedValue('ok')
      renderAI(<AIView projects={[]} />)
      const box = await composer()
      await userEvent.type(box, 'oi')

      fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })

      await waitFor(() => expect(runAgent).toHaveBeenCalled())
    })

    it('Cmd+Enter sends, for the mac muscle memory', async () => {
      vi.mocked(runAgent).mockResolvedValue('ok')
      renderAI(<AIView projects={[]} />)
      const box = await composer()
      await userEvent.type(box, 'oi')

      fireEvent.keyDown(box, { key: 'Enter', metaKey: true })

      await waitFor(() => expect(runAgent).toHaveBeenCalled())
    })

    it('plain Enter still sends', async () => {
      vi.mocked(runAgent).mockResolvedValue('ok')
      renderAI(<AIView projects={[]} />)
      await userEvent.type(await composer(), 'oi{Enter}')
      await waitFor(() => expect(runAgent).toHaveBeenCalled())
    })

    it('Shift+Enter still makes a newline', async () => {
      vi.mocked(runAgent).mockResolvedValue('ok')
      renderAI(<AIView projects={[]} />)
      const box = (await composer()) as HTMLTextAreaElement

      await userEvent.type(box, 'um{Shift>}{Enter}{/Shift}dois')

      expect(runAgent).not.toHaveBeenCalled()
      expect(box.value).toBe('um\ndois')
    })
  })

  describe('Escape', () => {
    it('answers the approval card instead of just hiding it', async () => {
      // The agent is awaiting this promise: a card that closes without an
      // answer leaves the run hanging forever with no way back.
      let decision!: Promise<Set<string>>
      vi.mocked(runAgent).mockImplementation(async (_c, _m, onApprove) => {
        decision = onApprove([{ id: 'w1', name: 'deletar_task', args: {} }])
        await decision
        return 'ok'
      })
      renderAI(<AIView projects={[]} />)
      await userEvent.type(await composer(), 'oi{Enter}')
      await screen.findByText(/Aprovar ações da IA/)

      esc()

      // Escape is a cancel, and cancel means approve nothing.
      expect(await decision).toEqual(new Set())
      await waitFor(() => expect(screen.queryByText(/Aprovar ações da IA/)).not.toBeInTheDocument())
    })


    it('closes the history, wherever the focus is', async () => {
      renderAI(<AIView projects={[]} />)
      await userEvent.click(screen.getByText('Histórico'))
      await screen.findByPlaceholderText(/Buscar por título/)

      esc()

      await waitFor(() =>
        expect(screen.queryByPlaceholderText(/Buscar por título/)).not.toBeInTheDocument()
      )
    })

    it('closes the spend panel', async () => {
      storedSpend = { ...storedSpend, total: { ...emptyBucket, calls: 3 } }
      renderAI(<AIView projects={[]} />)
      await userEvent.click(await screen.findByText('Gastos'))
      await screen.findByText('Gastos com o modelo')

      esc()

      await waitFor(() => expect(screen.queryByText('Gastos com o modelo')).not.toBeInTheDocument())
    })

    it('closes the config panel', async () => {
      renderAI(<AIView projects={[]} />)
      await userEvent.click(screen.getByText('Configuração'))
      await screen.findByPlaceholderText('sk-...')

      esc()

      await waitFor(() => expect(screen.queryByPlaceholderText('sk-...')).not.toBeInTheDocument())
    })

    it('closes the delete confirmation without deleting', async () => {
      storedHistory = [{ id: 'c1', title: 'Antiga', updatedAt: new Date().toISOString() }]
      renderAI(<AIView projects={[]} />)
      await userEvent.click(screen.getByText('Histórico'))
      await userEvent.click(await screen.findByTitle('Apagar conversa'))
      await screen.findByText(/não pode ser desfeita/)

      esc()

      await waitFor(() => expect(screen.queryByText(/não pode ser desfeita/)).not.toBeInTheDocument())
      expect(window.electronAPI.ai.conversations.delete).not.toHaveBeenCalled()
    })

    it('peels one layer at a time, topmost first', async () => {
      // The confirmation sits on top of the history: Escape must take that,
      // not reach past it and dismiss the list underneath.
      storedHistory = [{ id: 'c1', title: 'Antiga', updatedAt: new Date().toISOString() }]
      renderAI(<AIView projects={[]} />)
      await userEvent.click(screen.getByText('Histórico'))
      await userEvent.click(await screen.findByTitle('Apagar conversa'))
      await screen.findByText(/não pode ser desfeita/)

      esc()
      await waitFor(() => expect(screen.queryByText(/não pode ser desfeita/)).not.toBeInTheDocument())

      // …and the config panel underneath is still reachable by a second press.
      await userEvent.click(screen.getByText('Configuração'))
      await screen.findByPlaceholderText('sk-...')
      esc()
      await waitFor(() => expect(screen.queryByPlaceholderText('sk-...')).not.toBeInTheDocument())
    })

    it('does nothing when there is nothing open', async () => {
      vi.mocked(runAgent).mockResolvedValue('ok')
      renderAI(<AIView projects={[]} />)
      const box = (await composer()) as HTMLTextAreaElement
      await userEvent.type(box, 'texto em progresso')

      esc()

      // It must not wipe the draft or fire anything off.
      expect(box.value).toBe('texto em progresso')
      expect(runAgent).not.toHaveBeenCalled()
    })
  })
})

describe('AIView — pasted images', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storedConfig = { baseUrl: 'http://x', apiKey: 'k', model: 'm' }
    storedSpend = {
      today: emptyBucket,
      last30: emptyBucket,
      total: emptyBucket,
      byModel: [],
      recent: []
    }
    storedHistory = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()

    // jsdom has no canvas or codecs, so the real downscale can't run here; it
    // is exercised where it belongs (utils/images). Stand in a decoded image.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 2000, height: 1000, close: vi.fn() }))
    )
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as never
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => FAKE_DATA_URL)
  })
  afterEach(() => vi.unstubAllGlobals())

  const FAKE_DATA_URL = 'data:image/png;base64,ZmFrZQ=='

  const pngFile = (name = 'shot.png'): File =>
    new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })

  /** Paste files onto the composer the way a screenshot arrives. */
  const paste = async (...files: File[]): Promise<void> => {
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.paste(box, { clipboardData: { files, types: ['Files'], getData: () => '' } })
    await waitFor(() => expect(window.electronAPI.ai.images.save).toHaveBeenCalled())
  }

  it('attaches a pasted screenshot and previews it', async () => {
    renderAI(<AIView projects={[]} />)
    await paste(pngFile())

    expect(await screen.findByAltText('Anexo')).toBeInTheDocument()
    // Stored as a file; the renderer keeps only the id.
    expect(window.electronAPI.ai.images.save).toHaveBeenCalledWith(FAKE_DATA_URL)
  })

  it('lets ordinary text paste through untouched', async () => {
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())

    fireEvent.paste(box, { clipboardData: { files: [], types: ['text/plain'], getData: () => 'oi' } })

    expect(window.electronAPI.ai.images.save).not.toHaveBeenCalled()
  })

  it('sends the image to the model as a vision part, with the text', async () => {
    vi.mocked(runAgent).mockResolvedValue('vejo um erro')
    renderAI(<AIView projects={[]} />)
    await paste(pngFile())

    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await userEvent.type(box, 'o que é isso?{Enter}')
    await waitFor(() => expect(runAgent).toHaveBeenCalled())

    const sent = vi.mocked(runAgent).mock.calls[0][1]
    expect(sent.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'o que é isso?' },
        { type: 'image_url', image_url: { url: FAKE_DATA_URL } }
      ]
    })
  })

  it('keeps a text-only turn a plain string', async () => {
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())

    await userEvent.type(box, 'só texto{Enter}')
    await waitFor(() => expect(runAgent).toHaveBeenCalled())

    // Not every OpenAI-compatible provider takes the array shape; don't make
    // them cope with it for a chat that has no images.
    expect(vi.mocked(runAgent).mock.calls[0][1].at(-1)).toEqual({
      role: 'user',
      content: 'só texto'
    })
  })

  it('sends an image with no text at all', async () => {
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    await paste(pngFile())

    // "What is this?" is a fair question with the picture alone.
    const send = screen.getByRole('button', { name: 'Enviar' })
    expect(send).not.toBeDisabled()
    await userEvent.click(send)

    await waitFor(() => expect(runAgent).toHaveBeenCalled())
  })

  it('never lets base64 reach the saved transcript', async () => {
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    await paste(pngFile())
    await userEvent.type(screen.getByPlaceholderText(/Descreva o projeto/), 'oi{Enter}')

    const save = vi.mocked(window.electronAPI.ai.conversations.save)
    await waitFor(() => expect(save).toHaveBeenCalled())

    // The whole point of files-on-disk: ai-conversations.json is re-read on
    // every autosave and every keystroke of the history search.
    const saved = JSON.stringify(save.mock.calls.at(-1)?.[0])
    expect(saved).not.toContain('base64')
    expect(saved).toContain('img-1') // the id, and only the id
  })

  it('clears the tray once sent', async () => {
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    await paste(pngFile())
    await userEvent.type(screen.getByPlaceholderText(/Descreva o projeto/), 'oi{Enter}')

    await waitFor(() => expect(screen.queryByAltText('Anexo')).not.toBeInTheDocument())
  })

  it('bins an attachment removed before sending', async () => {
    renderAI(<AIView projects={[]} />)
    await paste(pngFile())

    await userEvent.click(await screen.findByLabelText('Remover imagem'))

    // It belongs to no conversation — leaving it would orphan it on disk.
    expect(window.electronAPI.ai.images.delete).toHaveBeenCalledWith(['img-1'])
    expect(screen.queryByAltText('Anexo')).not.toBeInTheDocument()
  })

  it('bins attachments abandoned by "Nova"', async () => {
    renderAI(<AIView projects={[]} />)
    await paste(pngFile())

    await userEvent.click(screen.getByText('Nova'))

    expect(window.electronAPI.ai.images.delete).toHaveBeenCalledWith(['img-1'])
  })

  it('loads the pictures back when a conversation is reopened', async () => {
    storedHistory = [{ id: 'c1', title: 'Antiga', updatedAt: new Date().toISOString() }]
    vi.mocked(window.electronAPI.ai.conversations.get).mockResolvedValue({
      id: 'c1',
      title: 'Antiga',
      messages: [{ role: 'user', content: 'o que é isso?', imageIds: ['img-9'] }]
    } as never)
    vi.mocked(window.electronAPI.ai.images.get).mockResolvedValue({
      dataUrl: FAKE_DATA_URL
    } as never)

    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.click(await screen.findByText('Antiga'))

    // The transcript carries ids; the bytes are fetched from disk.
    expect(window.electronAPI.ai.images.get).toHaveBeenCalledWith('img-9')
    expect(await screen.findByAltText('Imagem enviada')).toHaveAttribute('src', FAKE_DATA_URL)
  })

  it('says so when an image file has gone missing', async () => {
    storedHistory = [{ id: 'c1', title: 'Antiga', updatedAt: new Date().toISOString() }]
    vi.mocked(window.electronAPI.ai.conversations.get).mockResolvedValue({
      id: 'c1',
      title: 'Antiga',
      messages: [{ role: 'user', content: 'o que é isso?', imageIds: ['sumiu'] }]
    } as never)
    vi.mocked(window.electronAPI.ai.images.get).mockResolvedValue({
      error: 'Imagem não encontrada'
    } as never)

    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.click(await screen.findByText('Antiga'))

    // The turn's text still stands; only the picture is gone.
    expect(await screen.findByText('[imagem indisponível]')).toBeInTheDocument()
    expect(screen.getByText('o que é isso?')).toBeInTheDocument()
  })

  it('takes the image files with the conversation it deletes', async () => {
    storedHistory = [{ id: 'c1', title: 'Antiga', updatedAt: new Date().toISOString() }]
    vi.mocked(window.electronAPI.ai.conversations.get).mockResolvedValue({
      id: 'c1',
      title: 'Antiga',
      messages: [{ role: 'user', content: 'x', imageIds: ['img-a', 'img-b'] }]
    } as never)

    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.click(await screen.findByTitle('Apagar conversa'))
    await userEvent.click(await screen.findByRole('button', { name: 'Apagar' }))

    // Nothing else references them: not deleting these orphans them forever.
    await waitFor(() =>
      expect(window.electronAPI.ai.images.delete).toHaveBeenCalledWith(['img-a', 'img-b'])
    )
    expect(window.electronAPI.ai.conversations.delete).toHaveBeenCalledWith('c1')
  })

  it('reports a rejected image instead of attaching nothing silently', async () => {
    vi.mocked(window.electronAPI.ai.images.save).mockResolvedValue({
      error: 'Tipo de imagem não suportado: image/tiff'
    } as never)
    renderAI(<AIView projects={[]} />)
    await paste(pngFile('weird.tiff'))

    expect(await screen.findByText(/Tipo de imagem não suportado/)).toBeInTheDocument()
    expect(screen.queryByAltText('Anexo')).not.toBeInTheDocument()
  })
})
