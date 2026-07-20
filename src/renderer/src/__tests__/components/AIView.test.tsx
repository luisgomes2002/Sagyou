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
import { useKanbanStore } from '../../store/kanban'
import { AI_TASK_PROMPT_TEMPLATE } from '../../types'
import type { Project } from '../../types'
import { runAgent, callModel, MAX_STEPS, AUTO_MAX_STEPS, LOW_STEPS_WARNING } from '../../ai/agent'
import type { RunAgentOptions, AIConfig, PendingCall } from '../../ai/agent'

type UsageSummary = Awaited<ReturnType<typeof window.electronAPI.ai.usage.summary>>

/** The status line's spinner and check are decorative, so match on class/tag. */
function statusIcons(): { running: number; done: number } {
  const lines = Array.from(document.querySelectorAll('p.text-xs')).map(
    (p) => p.parentElement as HTMLElement
  )
  return {
    running: lines.filter((l) => l.querySelector('span.animate-spin')).length,
    done: lines.filter((l) => l.querySelector('svg polyline')).length
  }
}

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
      templates: {
        list: vi.fn(async () => storedTemplates),
        save: vi.fn(async () => ({ template: storedTemplates[0] })),
        delete: vi.fn(async () => {})
      },
      codeAgent: {
        onOutput: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn()),
        // Fires when a finished run has been archived; the picker listens
        // for it rather than guessing when the snapshot exists.
        onArchived: vi.fn(() => vi.fn()),
        runs: vi.fn(async () => []),
        runGet: vi.fn(async () => null),
        // The panel asks for the buffered log on mount — it may have missed the
        // stream entirely while this view was unmounted.
        status: vi.fn(async () => ({ running: false, log: '' })),
        stop: vi.fn()
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
    busy: false,
    abortRequested: false,
    savedTick: 0,
    runningConvId: null,
    parked: {}
  })
  useAiRunStore.getState().reset()
})

const emptyBucket = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  cost: 0,
  unpricedCalls: 0
}
/** Counter behind the fake image ids (img-1, img-2…). Reset per test. */
let savedImageN = 0

/** Gerar Tasks templates on disk. Reset per test. */
let storedTemplates: { id: string; name: string; body: string; createdAt: string; updatedAt: string }[] = []

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
    storedTemplates = []
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
    storedTemplates = []
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
    storedTemplates = []
    savedImageN = 0
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
    storedTemplates = []
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
    storedTemplates = []
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

describe('AIView — Gerar Tasks', () => {
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
    storedTemplates = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()
    useKanbanStore.setState({ projects: [], tasks: [], activeProjectId: null })
  })

  /** A real project in the store, handed to the view the way App.tsx does. */
  const withProject = (): Project => {
    const id = useKanbanStore.getState().createProject('Meu Projeto')
    return useKanbanStore.getState().projects.find((p) => p.id === id)!
  }

  const replyWith = (content: string): void => {
    vi.mocked(callModel).mockResolvedValue({ message: { role: 'assistant', content } })
  }

  const generate = async (project: Project | null, prompt = 'um app de vendas'): Promise<void> => {
    renderAI(<AIView projects={project ? [project] : []} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, prompt)
    await userEvent.click(screen.getByRole('button', { name: 'Gerar Tasks' }))
  }

  const tasksJson = JSON.stringify({
    tasks: [
      { title: 'Modelar banco', priority: 'high', description: 'schema', tags: ['db'] },
      { title: 'Tela de login', priority: 'low' }
    ]
  })

  it('proposes the parsed tasks for review before creating anything', async () => {
    const p = withProject()
    replyWith(`Claro! Aqui vão:\n\`\`\`json\n${tasksJson}\n\`\`\``)

    await generate(p)

    expect(await screen.findByText(/Criar tasks \(2\/2\)/)).toBeInTheDocument()
    expect(screen.getByText('Modelar banco')).toBeInTheDocument()
    // Nothing is written until the user confirms.
    expect(useKanbanStore.getState().tasks).toHaveLength(0)
  })

  it('creates only the ticked tasks, into the active project', async () => {
    const p = withProject()
    replyWith(tasksJson)
    await generate(p)
    await screen.findByText(/Criar tasks \(2\/2\)/)

    await userEvent.click(screen.getAllByRole('checkbox')[1]) // untick the second
    await userEvent.click(screen.getByRole('button', { name: /Criar 1 task/ }))

    const tasks = useKanbanStore.getState().tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ title: 'Modelar banco', projectId: p.id, priority: 'high' })
    expect(await screen.findByText(/1 task criada em Meu Projeto/)).toBeInTheDocument()
  })

  it('toggles the whole selection at once', async () => {
    replyWith(tasksJson)
    await generate(withProject())
    await screen.findByText(/Criar tasks \(2\/2\)/)

    await userEvent.click(screen.getByText('Desmarcar todas'))
    expect(await screen.findByText(/Criar tasks \(0\/2\)/)).toBeInTheDocument()

    await userEvent.click(screen.getByText('Selecionar todas'))
    expect(await screen.findByText(/Criar tasks \(2\/2\)/)).toBeInTheDocument()
  })

  it('cancelling writes nothing', async () => {
    replyWith(tasksJson)
    await generate(withProject())
    await screen.findByText(/Criar tasks \(2\/2\)/)

    await userEvent.click(screen.getByText('Cancelar'))

    await waitFor(() => expect(screen.queryByText(/Criar tasks/)).not.toBeInTheDocument())
    expect(useKanbanStore.getState().tasks).toHaveLength(0)
  })

  it('lets the user review even with no project, but cannot create', async () => {
    replyWith(tasksJson)
    await generate(null)

    expect(await screen.findByText(/Selecione um projeto para poder criar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Criar 2 tasks/ })).toBeDisabled()
  })

  it('reports a reply that carries no usable JSON', async () => {
    replyWith('Não entendi o pedido.')
    await generate(withProject())

    expect(await screen.findByText(/Nenhum JSON encontrado/)).toBeInTheDocument()
    expect(screen.queryByText(/Criar tasks/)).not.toBeInTheDocument()
  })

  it('reports JSON that parses but has no tasks', async () => {
    replyWith(JSON.stringify({ nope: [] }))
    await generate(withProject())
    expect(await screen.findByText(/JSON sem a lista "tasks"/)).toBeInTheDocument()
  })

  it('rejects a task list where every entry is unusable', async () => {
    // Entries without a title are dropped; an all-empty list is not a proposal.
    replyWith(JSON.stringify({ tasks: [{ priority: 'high' }, { title: '   ' }] }))
    await generate(withProject())
    expect(await screen.findByText(/não retornou nenhuma task válida/)).toBeInTheDocument()
  })

  it('needs something to work from', async () => {
    renderAI(<AIView projects={[withProject()]} />)
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Descreva o projeto/)).not.toBeDisabled()
    )

    await userEvent.click(screen.getByRole('button', { name: 'Gerar Tasks' }))

    expect(await screen.findByText(/Descreva o projeto no chat/)).toBeInTheDocument()
    expect(callModel).not.toHaveBeenCalled()
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
    storedTemplates = []
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

    it('closes the Gerar Tasks review without creating anything', async () => {
      vi.mocked(callModel).mockResolvedValue({
        message: { role: 'assistant', content: '{"tasks":[{"title":"T"}]}' }
      })
      useKanbanStore.setState({ projects: [], tasks: [], activeProjectId: null })
      const pid = useKanbanStore.getState().createProject('P')
      const project = useKanbanStore.getState().projects.find((p) => p.id === pid)!
      renderAI(<AIView projects={[project]} />)
      await userEvent.type(await composer(), 'um app')
      await userEvent.click(screen.getByRole('button', { name: 'Gerar Tasks' }))
      await screen.findByText(/Criar tasks/)

      esc()

      await waitFor(() => expect(screen.queryByText(/Criar tasks/)).not.toBeInTheDocument())
      expect(useKanbanStore.getState().tasks).toHaveLength(0)
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
    storedTemplates = []
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

describe('AIView — Gerar Tasks templates', () => {
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
    storedTemplates = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()
    useKanbanStore.setState({ projects: [], tasks: [], activeProjectId: null })
  })

  const template = (id: string, name: string, body: string): (typeof storedTemplates)[number] => ({
    id,
    name,
    body,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z'
  })

  /** Runs Gerar Tasks and returns the prompt that reached the model. */
  const promptSent = async (): Promise<string> => {
    vi.mocked(callModel).mockResolvedValue({
      message: { role: 'assistant', content: '{"tasks":[{"title":"T"}]}' }
    })
    useKanbanStore.getState().createProject('P')
    const project = useKanbanStore.getState().projects[0]
    renderAI(<AIView projects={[project]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'um app')
    await userEvent.click(screen.getByRole('button', { name: 'Gerar Tasks' }))
    await waitFor(() => expect(callModel).toHaveBeenCalled())
    const msgs = vi.mocked(callModel).mock.calls[0][1] as { content: string }[]
    return msgs.at(-1)!.content
  }

  it('uses the built-in template when none is picked', async () => {
    const sent = await promptSent()
    expect(sent).toContain(AI_TASK_PROMPT_TEMPLATE)
    expect(sent).toContain('Descrição do projeto:\num app')
  })

  it('uses the picked template instead', async () => {
    storedTemplates = [template('t1', 'Dev', 'MEU PROMPT DE DEV')]
    storedConfig = { ...storedConfig, taskTemplateId: 't1' }

    const sent = await promptSent()

    expect(sent).toContain('MEU PROMPT DE DEV')
    expect(sent).not.toContain(AI_TASK_PROMPT_TEMPLATE)
    // The description is still appended after it.
    expect(sent).toContain('Descrição do projeto:\num app')
  })

  it('falls back to the built-in when the picked template is gone', async () => {
    // Deleted in another window, or the file was hand-edited. Gerar Tasks must
    // still work rather than send an empty prompt.
    storedTemplates = []
    savedImageN = 0
    storedConfig = { ...storedConfig, taskTemplateId: 'apagado' }

    expect(await promptSent()).toContain(AI_TASK_PROMPT_TEMPLATE)
  })

  it('offers the built-in and every template in the picker', async () => {
    storedTemplates = [template('t1', 'Dev', 'x'), template('t2', 'Estudo', 'y')]
    renderAI(<AIView projects={[]} />)

    const picker = await screen.findByTitle(/Template usado pelo Gerar Tasks/)
    const names = Array.from(picker.querySelectorAll('option')).map((o) => o.textContent)
    // "Padrão" is always there and cannot be deleted — it is the floor.
    expect(names).toEqual(['Padrão', 'Dev', 'Estudo'])
  })

  it('remembers the pick', async () => {
    storedTemplates = [template('t1', 'Dev', 'x')]
    renderAI(<AIView projects={[]} />)
    const picker = await screen.findByTitle(/Template usado pelo Gerar Tasks/)

    await userEvent.selectOptions(picker, 't1')

    const set = vi.mocked(window.electronAPI.ai.config.set)
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ taskTemplateId: 't1' }))
    )
  })

  it('starts a new template from the built-in, not a blank box', async () => {
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Configuração'))

    await userEvent.click(await screen.findByText('+ Novo template'))

    // A blank box invites a prompt that never asks for the JSON the importer
    // needs; starting from the default means it works out of the box.
    const body = screen.getByLabelText('Conteúdo do template') as HTMLTextAreaElement
    expect(screen.getByPlaceholderText(/Nome do template/)).toHaveValue('')
    expect(body.value).toContain('"tasks"')
  })

  it('surfaces a rejected save instead of pretending it worked', async () => {
    vi.mocked(window.electronAPI.ai.templates.save).mockResolvedValue({
      error: 'O template precisa de um nome'
    } as never)
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Configuração'))
    await userEvent.click(await screen.findByText('+ Novo template'))

    await userEvent.click(screen.getByText('Salvar'))

    expect(await screen.findByText('O template precisa de um nome')).toBeInTheDocument()
    // The editor stays open with the work in it.
    expect(screen.getByPlaceholderText(/Nome do template/)).toBeInTheDocument()
  })

  it('picks a newly saved template straight away', async () => {
    const saved = template('novo', 'Marketing', 'corpo')
    vi.mocked(window.electronAPI.ai.templates.save).mockResolvedValue({ template: saved } as never)
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Configuração'))
    await userEvent.click(await screen.findByText('+ Novo template'))
    await userEvent.type(screen.getByPlaceholderText(/Nome do template/), 'Marketing')

    await userEvent.click(screen.getByText('Salvar'))

    const set = vi.mocked(window.electronAPI.ai.config.set)
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ taskTemplateId: 'novo' }))
    )
  })

  it('stops pointing at a template it just deleted', async () => {
    storedTemplates = [template('t1', 'Dev', 'x')]
    storedConfig = { ...storedConfig, taskTemplateId: 't1' }
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Configuração'))
    await screen.findByText('+ Novo template')

    await userEvent.click(screen.getByText('Apagar'))

    expect(window.electronAPI.ai.templates.delete).toHaveBeenCalledWith('t1')
    const set = vi.mocked(window.electronAPI.ai.config.set)
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ taskTemplateId: undefined }))
    )
  })

  it('leaves the pick alone when a different template is deleted', async () => {
    storedTemplates = [template('t1', 'Dev', 'x'), template('t2', 'Estudo', 'y')]
    storedConfig = { ...storedConfig, taskTemplateId: 't1' }
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Configuração'))
    await waitFor(() => expect(screen.getAllByText('Apagar')).toHaveLength(2))

    await userEvent.click(screen.getAllByText('Apagar')[1]) // delete Estudo

    expect(window.electronAPI.ai.templates.delete).toHaveBeenCalledWith('t2')
    const set = vi.mocked(window.electronAPI.ai.config.set)
    expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ taskTemplateId: undefined }))
  })
})

describe('AIView — conversation history', () => {
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
    storedTemplates = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()
  })

  const listReturns = (...convs: { id: string; title: string }[]): void => {
    storedHistory = convs.map((c) => ({ ...c, updatedAt: new Date().toISOString() }))
  }

  it('says so when there is nothing saved', async () => {
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Histórico'))
    expect(await screen.findByText('Nenhuma conversa salva')).toBeInTheDocument()
  })

  it('saves under a title taken from the first thing the user said', async () => {
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())

    await userEvent.type(box, 'planejar o sprint{Enter}')

    const save = vi.mocked(window.electronAPI.ai.conversations.save)
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'planejar o sprint' }))
    )
  })

  it('loads a past conversation into the transcript', async () => {
    listReturns({ id: 'c1', title: 'Antiga' })
    vi.mocked(window.electronAPI.ai.conversations.get).mockResolvedValue({
      id: 'c1',
      title: 'Antiga',
      messages: [
        { role: 'user', content: 'e aí' },
        { role: 'assistant', content: 'olá!' }
      ]
    } as never)

    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.click(await screen.findByText('Antiga'))

    expect(await screen.findByText('e aí')).toBeInTheDocument()
    expect(screen.getByText('olá!')).toBeInTheDocument()
  })

  it('"Nova" clears the transcript without deleting anything', async () => {
    vi.mocked(runAgent).mockResolvedValue('resposta')
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'oi{Enter}')
    expect(await screen.findByText('resposta')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Nova'))

    await waitFor(() => expect(screen.queryByText('resposta')).not.toBeInTheDocument())
    expect(window.electronAPI.ai.conversations.delete).not.toHaveBeenCalled()
  })

  it('asks before deleting a conversation, and only then deletes', async () => {
    listReturns({ id: 'c1', title: 'Antiga' })
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Histórico'))
    await screen.findByText('Antiga')

    await userEvent.click(screen.getByTitle('Apagar conversa'))

    // Destructive and irreversible: it must not go through on one stray click.
    expect(await screen.findByText(/não pode ser desfeita/)).toBeInTheDocument()
    expect(window.electronAPI.ai.conversations.delete).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }))
    await waitFor(() => expect(window.electronAPI.ai.conversations.delete).toHaveBeenCalledWith('c1'))
  })
})

describe('AIView — searching the history', () => {
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
    storedTemplates = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()
  })

  const openHistory = async (): Promise<void> => {
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Histórico'))
  }
  const searchBox = (): HTMLElement => screen.getByPlaceholderText(/Buscar por título ou conteúdo/)

  it('asks the main process to filter, rather than filtering a stale list', async () => {
    storedHistory = [{ id: 'c1', title: 'Planejar sprint', updatedAt: new Date().toISOString() }]
    await openHistory()

    await userEvent.type(searchBox(), 'deploy')

    // Main already has the file open; shipping every message body here to grep
    // it would move megabytes per keystroke.
    const search = vi.mocked(window.electronAPI.ai.conversations.search)
    await waitFor(() => expect(search).toHaveBeenCalledWith('deploy'))
  })

  it('shows the snippet that explains a body match', async () => {
    storedHistory = [
      {
        id: 'c1',
        title: 'Conversa sem título útil',
        updatedAt: new Date().toISOString(),
        snippet: '…precisa rodar o build antes do deploy…'
      }
    ]
    await openHistory()

    expect(await screen.findByText('…precisa rodar o build antes do deploy…')).toBeInTheDocument()
  })

  it('says nothing matched, quoting what was searched for', async () => {
    await openHistory()
    storedHistory = []
    storedTemplates = []
    savedImageN = 0

    await userEvent.type(searchBox(), 'xyz')

    // Distinct from "Nenhuma conversa salva": the history is not empty, the
    // search just found nothing.
    expect(await screen.findByText(/Nada encontrado para "xyz"/)).toBeInTheDocument()
  })

  it('still says the history is empty when it really is', async () => {
    await openHistory()
    expect(await screen.findByText('Nenhuma conversa salva')).toBeInTheDocument()
  })

  it('reopens unfiltered, so no chat looks lost', async () => {
    storedHistory = [{ id: 'c1', title: 'Planejar sprint', updatedAt: new Date().toISOString() }]
    await openHistory()
    await userEvent.type(searchBox(), 'deploy')
    await userEvent.click(screen.getByText('Histórico')) // close

    await userEvent.click(screen.getByText('Histórico')) // reopen

    expect(searchBox()).toHaveValue('')
    const search = vi.mocked(window.electronAPI.ai.conversations.search)
    expect(search).toHaveBeenLastCalledWith('')
  })

  it('keeps the filter when an autosave refreshes the list underneath', async () => {
    storedHistory = [{ id: 'c1', title: 'Planejar sprint', updatedAt: new Date().toISOString() }]
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.type(searchBox(), 'sprint')

    // The debounced autosave refreshes the history; a stale closure there would
    // silently drop the filter and show everything again.
    await userEvent.type(box, 'oi{Enter}')
    await waitFor(() => expect(window.electronAPI.ai.conversations.save).toHaveBeenCalled())

    const search = vi.mocked(window.electronAPI.ai.conversations.search)
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('sprint'))
  })

  it('closes on Escape', async () => {
    await openHistory()
    await userEvent.type(searchBox(), '{Escape}')
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Buscar por título/)).not.toBeInTheDocument()
    )
  })
})

describe('AIView — token + cost indicator', () => {
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
    storedTemplates = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()
  })

  /** Sends one message, feeding the given per-call usage back through the agent. */
  const sendWithUsage = async (
    ...calls: { promptTokens: number; completionTokens: number }[]
  ): Promise<void> => {
    vi.mocked(runAgent).mockImplementation(async (_c, _m, _a, o = {}) => {
      for (const u of calls) o.onUsage?.(u)
      return 'ok'
    })
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'oi{Enter}')
    await waitFor(() => expect(runAgent).toHaveBeenCalled())
  }

  it('shows nothing before any tokens are spent', async () => {
    renderAI(<AIView projects={[]} />)
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument()
  })

  it('sums every call of the turn, not just the last', async () => {
    // Two tool rounds + a final answer are three billed calls.
    await sendWithUsage(
      { promptTokens: 1000, completionTokens: 200 },
      { promptTokens: 2500, completionTokens: 500 }
    )
    await waitFor(() => expect(screen.getByText(/4\.2k tokens/)).toBeInTheDocument())
  })

  it('shows no cost until both prices are configured', async () => {
    await sendWithUsage({ promptTokens: 1000, completionTokens: 200 })
    await waitFor(() => expect(screen.getByText(/tokens/)).toBeInTheDocument())
    // A local model costs nothing; inventing a price would be a lie.
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('quotes the cost once prices are set', async () => {
    storedConfig = { ...storedConfig, inputPricePer1M: 0.15, outputPricePer1M: 0.6 }
    // 1M in @0.15 + 1M out @0.60 = 0.75
    await sendWithUsage({ promptTokens: 1_000_000, completionTokens: 1_000_000 })
    await waitFor(() => expect(screen.getByText(/\$0\.75/)).toBeInTheDocument())
  })

  it('does not price half the tokens at zero when only one price is set', async () => {
    storedConfig = { ...storedConfig, inputPricePer1M: 0.15 }
    await sendWithUsage({ promptTokens: 1_000_000, completionTokens: 1_000_000 })
    await waitFor(() => expect(screen.getByText(/tokens/)).toBeInTheDocument())
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('persists the running total with the conversation', async () => {
    await sendWithUsage({ promptTokens: 1000, completionTokens: 200 })
    const save = vi.mocked(window.electronAPI.ai.conversations.save)
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ usage: { promptTokens: 1000, completionTokens: 200 } })
      )
    )
  })

  it('restores the total when an old conversation is reopened', async () => {
    storedHistory = [{ id: 'c1', title: 'Antiga', updatedAt: new Date().toISOString() }]
    vi.mocked(window.electronAPI.ai.conversations.get).mockResolvedValue({
      id: 'c1',
      title: 'Antiga',
      messages: [{ role: 'user', content: 'oi' }],
      usage: { promptTokens: 4000, completionTokens: 200 }
    } as never)

    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.click(await screen.findByText('Antiga'))

    await waitFor(() => expect(screen.getByText(/4\.2k tokens/)).toBeInTheDocument())
  })

  it('hides the counter for conversations saved before usage was tracked', async () => {
    storedHistory = [{ id: 'c1', title: 'Antiga', updatedAt: new Date().toISOString() }]
    // No usage field: unknown, so claim nothing rather than "0 tokens".
    vi.mocked(window.electronAPI.ai.conversations.get).mockResolvedValue({
      id: 'c1',
      title: 'Antiga',
      messages: [{ role: 'user', content: 'oi' }]
    } as never)

    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.click(await screen.findByText('Antiga'))

    await waitFor(() => expect(screen.getByText('oi')).toBeInTheDocument())
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument()
  })
})

describe('AIView — auto-growing composer', () => {
  let restoreScrollHeight: () => void

  /**
   * jsdom does no layout, so scrollHeight is always 0 and nothing can be
   * measured. Stand in a textarea of ~20px per 30 chars plus 16px padding.
   *
   * The important part is `Math.max(natural, styled)`: a real scrollHeight can
   * never report less than the element's own height. Without that, a mock would
   * happily "shrink" even for code that forgot to reset the height first — and
   * the test would pass while the box grew forever in the actual app.
   */
  const mockLayout = (): (() => void) => {
    const original = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'scrollHeight'
    )
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        const natural = Math.max(1, Math.ceil(this.value.length / 30)) * 20 + 16
        const styled = parseFloat(this.style.height) // NaN for 'auto' / unset
        return Number.isNaN(styled) ? natural : Math.max(natural, styled)
      }
    })
    return () => {
      if (original) Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', original)
      else Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'scrollHeight')
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
    storedTemplates = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()
    restoreScrollHeight = mockLayout()
  })
  afterEach(() => restoreScrollHeight())

  const composer = (): HTMLTextAreaElement =>
    screen.getByPlaceholderText(/Descreva o projeto/) as HTMLTextAreaElement
  const heightOf = (el: HTMLElement): number => parseFloat(el.style.height)

  it('grows as the text wraps onto more lines', async () => {
    renderAI(<AIView projects={[]} />)
    const box = composer()
    await waitFor(() => expect(box).not.toBeDisabled())
    const oneLine = heightOf(box)

    await userEvent.type(box, 'a'.repeat(90)) // ~3 lines

    expect(heightOf(box)).toBeGreaterThan(oneLine)
  })

  it('shrinks again when the text is deleted', async () => {
    renderAI(<AIView projects={[]} />)
    const box = composer()
    await waitFor(() => expect(box).not.toBeDisabled())

    await userEvent.type(box, 'a'.repeat(90))
    const grown = heightOf(box)
    await userEvent.clear(box)

    // Without resetting the height before measuring, scrollHeight can only
    // report the grown size and the box would never come back down.
    expect(heightOf(box)).toBeLessThan(grown)
  })

  it('stops growing at the cap and scrolls instead', async () => {
    renderAI(<AIView projects={[]} />)
    const box = composer()
    await waitFor(() => expect(box).not.toBeDisabled())

    // A pasted wall of text must not push the transcript off screen.
    await userEvent.click(box)
    await userEvent.paste('a'.repeat(5000))

    expect(heightOf(box)).toBe(200)
  })

  it('never drops below its resting two-line size', async () => {
    renderAI(<AIView projects={[]} />)
    const box = composer()
    await waitFor(() => expect(box).not.toBeDisabled())
    // The inline height alone would collapse it to one line; min-h holds it.
    expect(box.className).toContain('min-h-[58px]')
  })

  it('collapses back after sending', async () => {
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    const box = composer()
    await waitFor(() => expect(box).not.toBeDisabled())
    const resting = heightOf(box)

    await userEvent.type(box, 'a'.repeat(120))
    expect(heightOf(box)).toBeGreaterThan(resting)

    await userEvent.type(box, '{Enter}')

    // The box is empty now, so it must not stay tall.
    await waitFor(() => expect(heightOf(box)).toBe(resting))
  })
})

describe('AIView — spend panel', () => {
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
    storedTemplates = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()
  })

  const bucketOf = (calls: number, cost: number, unpriced = 0): UsageSummary['today'] => ({
    calls,
    promptTokens: 4000,
    completionTokens: 200,
    cost,
    unpricedCalls: unpriced
  })

  it('offers the spend history even on a fresh conversation with no tokens yet', async () => {
    // The log outlives any one conversation; "Nova" must not hide past spend.
    storedSpend = { ...storedSpend, total: bucketOf(12, 0.5) }
    renderAI(<AIView projects={[]} />)
    expect(await screen.findByText('Gastos')).toBeInTheDocument()
  })

  it('stays hidden when nothing has ever been logged', async () => {
    renderAI(<AIView projects={[]} />)
    await waitFor(() => expect(window.electronAPI.ai.usage.summary).toHaveBeenCalled())
    expect(screen.queryByText('Gastos')).not.toBeInTheDocument()
  })

  it('breaks spend into today, 30 days and total', async () => {
    storedSpend = {
      today: bucketOf(2, 0.01),
      last30: bucketOf(10, 0.25),
      total: bucketOf(30, 1.5),
      byModel: [{ model: 'gpt-4o-mini', bucket: bucketOf(30, 1.5) }],
      recent: [
        { at: '2026-07-16T12:00:00.000Z', model: 'gpt-4o-mini', promptTokens: 3100, completionTokens: 400, cost: 0.0009 }
      ]
    }
    renderAI(<AIView projects={[]} />)
    await userEvent.click(await screen.findByText('Gastos'))

    expect(screen.getByText('Hoje')).toBeInTheDocument()
    expect(screen.getByText('30 dias')).toBeInTheDocument()
    expect(screen.getByText('$1.50')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument()
  })

  it('says "sem preço" instead of $0.00 when nothing was priced', async () => {
    // 12 unpriced calls cost an unknown amount — not zero.
    storedSpend = { ...storedSpend, total: bucketOf(12, 0, 12), last30: bucketOf(12, 0, 12) }
    renderAI(<AIView projects={[]} />)
    await userEvent.click(await screen.findByText('Gastos'))

    expect(screen.getAllByText('sem preço').length).toBeGreaterThan(0)
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('flags calls left out of the total for want of a price', async () => {
    storedSpend = { ...storedSpend, total: bucketOf(10, 0.4, 3) }
    renderAI(<AIView projects={[]} />)
    await userEvent.click(await screen.findByText('Gastos'))

    // A total that quietly omits 3 calls would read as the full story.
    expect(screen.getByText(/3 chamadas sem preço configurado na época/)).toBeInTheDocument()
  })

  it('refreshes after a turn, so the log reflects the call just made', async () => {
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    const before = vi.mocked(window.electronAPI.ai.usage.summary).mock.calls.length

    await userEvent.type(box, 'oi{Enter}')

    await waitFor(() =>
      expect(vi.mocked(window.electronAPI.ai.usage.summary).mock.calls.length).toBeGreaterThan(
        before
      )
    )
  })
})

describe('AIView — max steps setting', () => {
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
    storedTemplates = []
    savedImageN = 0
    installApi()
    Element.prototype.scrollTo = vi.fn()
  })

  /** Sends a message and reports the maxSteps runAgent was handed. */
  const sentMaxSteps = async (): Promise<number | undefined> => {
    vi.mocked(runAgent).mockResolvedValue('ok')
    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'oi{Enter}')
    await waitFor(() => expect(runAgent).toHaveBeenCalled())
    return vi.mocked(runAgent).mock.calls[0][3]?.maxSteps
  }

  it('uses the manual default when the setting is unset', async () => {
    expect(await sentMaxSteps()).toBe(MAX_STEPS)
  })

  it('passes the stored setting through to the agent', async () => {
    // The whole feature: a middle ground, still in manual (approving) mode.
    storedConfig = { ...storedConfig, maxSteps: 15 }
    expect(await sentMaxSteps()).toBe(15)
  })

  it('carries the stored setting through the load, rather than dropping it', async () => {
    storedConfig = { ...storedConfig, maxSteps: 15 }
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Configuração'))
    const input = await screen.findByPlaceholderText(new RegExp(`${MAX_STEPS}/${AUTO_MAX_STEPS}`))
    await waitFor(() => expect(input).toHaveValue(15))
  })

  it('persists a value typed into the config panel', async () => {
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Configuração'))
    const input = await screen.findByPlaceholderText(new RegExp(`${MAX_STEPS}/${AUTO_MAX_STEPS}`))

    await userEvent.clear(input)
    await userEvent.type(input, '15')

    const set = vi.mocked(window.electronAPI.ai.config.set)
    await waitFor(() => expect(set).toHaveBeenCalledWith(expect.objectContaining({ maxSteps: 15 })))
  })

  it('carries the stored timeout through the load and persists an edit', async () => {
    // Same trap as maxSteps: the loader builds the config field by field, so a
    // new one silently reverts to the default on every boot unless carried.
    storedConfig = { ...storedConfig, timeoutMs: 30_000 }
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Configuração'))
    const input = await screen.findByPlaceholderText(/Padrão \(60s\)/)
    await waitFor(() => expect(input).toHaveValue(30)) // shown in seconds

    await userEvent.clear(input)
    await userEvent.type(input, '45')

    const set = vi.mocked(window.electronAPI.ai.config.set)
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 45_000 }))
    )
  })

  it('warns when the configured cap is low enough to cut a task short', async () => {
    storedConfig = { ...storedConfig, maxSteps: LOW_STEPS_WARNING - 1 }
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Configuração'))

    expect(await screen.findByText(/podem não ser concluídas/i)).toBeInTheDocument()
  })

  it('does not warn at the default, or the warning becomes noise', async () => {
    storedConfig = { ...storedConfig, maxSteps: undefined }
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Configuração'))
    // Wait for the panel itself, so the absence below is a real absence and not
    // just an unrendered panel.
    await screen.findByPlaceholderText(new RegExp(`${MAX_STEPS}/${AUTO_MAX_STEPS}`))

    expect(screen.queryByText(/podem não ser concluídas/i)).not.toBeInTheDocument()
  })

  it('clearing the field goes back to the default, not to zero', async () => {
    storedConfig = { ...storedConfig, maxSteps: 15 }
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Configuração'))
    const input = await screen.findByPlaceholderText(new RegExp(`${MAX_STEPS}/${AUTO_MAX_STEPS}`))
    await waitFor(() => expect(input).toHaveValue(15))

    await userEvent.clear(input)

    const set = vi.mocked(window.electronAPI.ai.config.set)
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ maxSteps: undefined }))
    )
  })
})

describe('AIView — tool call progress', () => {
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
    storedTemplates = []
    savedImageN = 0
    installApi()
    // jsdom has no layout, so the chat's scroll-to-bottom effect has no scrollTo.
    Element.prototype.scrollTo = vi.fn()
  })

  it('spins the tool line while it runs, then settles it into a check', async () => {
    let opts: RunAgentOptions = {}
    let finish: (reply: string) => void = () => {}
    vi.mocked(runAgent).mockImplementation(
      (_cfg, _conv, _approve, o = {}) =>
        new Promise((resolve) => {
          opts = o
          finish = resolve
        })
    )

    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'oi{Enter}')

    // The model announces a tool and it starts running.
    act(() => opts.onStatus?.('Lendo src/App.tsx', 'tool'))
    expect(screen.getByText('Lendo src/App.tsx')).toBeInTheDocument()
    expect(statusIcons()).toEqual({ running: 1, done: 0 })
    // The connecting spinner would be a second spinner for the same wait.
    expect(document.querySelectorAll('div.animate-spin')).toHaveLength(0)

    // The tool returns: the line settles, and the wait is now on the model.
    act(() => opts.onToolEnd?.())
    expect(statusIcons()).toEqual({ running: 0, done: 1 })
    expect(document.querySelectorAll('div.animate-spin')).toHaveLength(1)

    await act(async () => finish('pronto'))
    expect(screen.getByText('pronto')).toBeInTheDocument()
    expect(statusIcons()).toEqual({ running: 0, done: 1 })
  })

  it('badges a status line with its step, and leaves unnumbered lines bare', async () => {
    let opts: RunAgentOptions = {}
    let finish: (v: string) => void = () => {}
    vi.mocked(runAgent).mockImplementation(
      (_cfg, _conv, _approve, o = {}) =>
        new Promise((resolve) => {
          opts = o
          finish = resolve
        })
    )

    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'oi{Enter}')

    act(() => opts.onStatus?.('Lendo src/App.tsx', 'tool', { step: 3, maxSteps: 40 }))
    expect(screen.getByText('3/40')).toBeInTheDocument()

    // A line with no step (a retry notice, the cap warning) must not invent one.
    act(() => opts.onStatus?.('Tentando de novo', 'remark'))
    await act(async () => finish('pronto'))
    expect(screen.getByText('Tentando de novo')).toBeInTheDocument()
    expect(screen.getAllByText(/^\d+\/\d+$/)).toHaveLength(1)
  })

  it('does not leave a tool line spinning when the turn fails', async () => {
    let opts: RunAgentOptions = {}
    let fail: (e: Error) => void = () => {}
    vi.mocked(runAgent).mockImplementation(
      (_cfg, _conv, _approve, o = {}) =>
        new Promise((_resolve, reject) => {
          opts = o
          fail = reject
        })
    )

    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'oi{Enter}')

    act(() => opts.onStatus?.('Lendo src/App.tsx', 'tool'))
    expect(statusIcons()).toEqual({ running: 1, done: 0 })

    // The tool threw and the turn unwound — nothing is running anymore.
    await act(async () => fail(new Error('boom')))
    expect(statusIcons()).toEqual({ running: 0, done: 1 })
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('does not revive a failed turn’s tool line when the next turn starts', async () => {
    let opts: RunAgentOptions = {}
    let settle: { fail: (e: Error) => void } = { fail: () => {} }
    vi.mocked(runAgent).mockImplementation(
      (_cfg, _conv, _approve, o = {}) =>
        new Promise((_resolve, reject) => {
          opts = o
          settle = { fail: reject }
        })
    )

    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())

    await userEvent.type(box, 'oi{Enter}')
    act(() => opts.onStatus?.('Lendo src/App.tsx', 'tool'))
    await act(async () => settle.fail(new Error('boom')))

    // The line from the failed turn stays in the transcript; a second turn
    // flips `busy` back on and must not make it look like it's running again.
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'de novo{Enter}')

    expect(statusIcons()).toEqual({ running: 0, done: 1 })
  })

  it('leaves the model’s own remark as a plain line, with nothing to wait for', async () => {
    let opts: RunAgentOptions = {}
    vi.mocked(runAgent).mockImplementation(
      (_cfg, _conv, _approve, o = {}) =>
        new Promise(() => {
          opts = o
        })
    )

    renderAI(<AIView projects={[]} />)
    const box = screen.getByPlaceholderText(/Descreva o projeto/)
    await waitFor(() => expect(box).not.toBeDisabled())
    await userEvent.type(box, 'oi{Enter}')

    act(() => opts.onStatus?.('Deixa eu ver as tasks', 'remark'))

    expect(screen.getByText('Deixa eu ver as tasks')).toBeInTheDocument()
    expect(statusIcons()).toEqual({ running: 0, done: 0 })
  })
})

/**
 * Naming a chat from the history list.
 *
 * The rule that a user's name outlives the autosave's derived one is the main
 * process's (handlers.test.ts covers it). What's here is the box itself: it
 * lives inside a list whose rows open a chat when clicked, so most of the work
 * is not doing that by accident.
 */
describe('AIView — renaming a chat', () => {
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
    storedTemplates = []
    installApi()
    Element.prototype.scrollTo = vi.fn()
    storedHistory = [{ id: 'c1', title: 'Planejar sprint', updatedAt: new Date().toISOString() }]
    vi.mocked(window.electronAPI.ai.conversations.get).mockResolvedValue({
      id: 'c1',
      title: 'Planejar sprint',
      messages: [{ role: 'user', content: 'conteúdo da c1' }]
    } as never)
  })

  const openRename = async (): Promise<HTMLElement> => {
    renderAI(<AIView projects={[]} />)
    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.click(await screen.findByTitle('Renomear conversa'))
    return screen.getByDisplayValue('Planejar sprint')
  }

  it('renames from the history, without opening the chat', async () => {
    const box = await openRename()
    await userEvent.clear(box)
    await userEvent.type(box, 'Sprint de julho{Enter}')

    expect(window.electronAPI.ai.conversations.rename).toHaveBeenCalledWith('c1', 'Sprint de julho')
    // Starting a rename must not load the chat behind it: the row opens on
    // click, and the pencil sits inside the row.
    expect(screen.queryByText('conteúdo da c1')).not.toBeInTheDocument()
  })

  it('commits when the box loses focus, as a rename does anywhere else', async () => {
    const box = await openRename()
    await userEvent.clear(box)
    await userEvent.type(box, 'Nome por blur')
    fireEvent.blur(box)

    await waitFor(() =>
      expect(window.electronAPI.ai.conversations.rename).toHaveBeenCalledWith('c1', 'Nome por blur')
    )
  })

  it('Escape abandons the edit and keeps the old name', async () => {
    const box = await openRename()
    await userEvent.clear(box)
    await userEvent.type(box, 'arrependimento')
    fireEvent.keyDown(document, { key: 'Escape' })

    // Nothing stored, and the dropdown stays open: Escape peeled the edit only.
    expect(window.electronAPI.ai.conversations.rename).not.toHaveBeenCalled()
    expect(await screen.findByText('Planejar sprint')).toBeInTheDocument()
  })

  it('a blank name is a cancel, not a nameless chat', async () => {
    const box = await openRename()
    await userEvent.clear(box)
    await userEvent.type(box, '   {Enter}')

    expect(window.electronAPI.ai.conversations.rename).not.toHaveBeenCalled()
  })

  it('surfaces a refusal from the main process', async () => {
    vi.mocked(window.electronAPI.ai.conversations.rename).mockResolvedValue({
      error: 'Conversa não encontrada'
    } as never)

    const box = await openRename()
    await userEvent.clear(box)
    await userEvent.type(box, 'algo{Enter}')

    expect(await screen.findByText(/Conversa não encontrada/)).toBeInTheDocument()
  })
})

// ── handing a board task to the assistant ─────────────────────────────────────
//
// The board's "Pedir para a IA" button parks a composer text in App and switches
// view. AIView is unmounted until that switch lands, so it reads the text on
// arrival — and starts a fresh chat for it.

describe('AIView — task handoff (prefill)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drops the handed-over text into the composer and focuses it', async () => {
    renderAI(<AIView projects={[]} prefill={'Task "Corrigir login" (id: t-1)\n\n'} />)

    const box = await screen.findByPlaceholderText(/descreva|pergunta/i)
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toContain('Corrigir login'))
    expect((box as HTMLTextAreaElement).value).toContain('id: t-1')
  })

  it('tells the parent it was taken, so it cannot be applied twice', async () => {
    const onPrefillConsumed = vi.fn()
    renderAI(<AIView projects={[]} prefill="algo" onPrefillConsumed={onPrefillConsumed} />)

    await waitFor(() => expect(onPrefillConsumed).toHaveBeenCalledTimes(1))
  })

  /**
   * Verified in the real app before this existed: the briefing landed in
   * whatever chat happened to be open — an 8.1k-token conversation about
   * something else. Every step of a run resends the whole history, so that
   * context is billed again on each of up to AUTO_MAX_STEPS steps, and the model
   * reads a code task through an unrelated conversation.
   */
  it('starts a new chat rather than appending to whatever was open', async () => {
    useAiRunStore.setState({
      messages: [
        { role: 'user', content: 'quanto rende meu FGTS?' },
        { role: 'assistant', content: 'R$ 3.120' }
      ],
      conversationId: 'conv-fgts'
    })

    renderAI(<AIView projects={[]} prefill={'Task "Corrigir login" (id: t-1)'} />)

    await waitFor(() => expect(useAiRunStore.getState().messages).toEqual([]))
    // Not asserted as null: AiRunHost's autosave effect runs in the same commit,
    // just after this one, and `ensureConversationId` reads the store as it is
    // *now* — already reset — so the blank chat is handed a fresh id on the way
    // out. A new id is the point; the old one no longer being current is what
    // matters, and the FGTS transcript stays on disk under its own.
    expect(useAiRunStore.getState().conversationId).not.toBe('conv-fgts')
    expect(screen.queryByText(/FGTS/)).toBeNull()
  })

  it('leaves an already-blank chat alone instead of dropping its id', async () => {
    useAiRunStore.setState({ messages: [], conversationId: 'conv-vazia' })

    renderAI(<AIView projects={[]} prefill="algo" />)

    await waitFor(() => expect(screen.getByPlaceholderText(/descreva|pergunta/i)).toBeTruthy())
    expect(useAiRunStore.getState().conversationId).toBe('conv-vazia')
  })

  it('appends to a half-written message instead of destroying it', async () => {
    const { rerender } = renderAI(<AIView projects={[]} prefill={null} />)

    const box = (await screen.findByPlaceholderText(
      /descreva|pergunta/i
    )) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'anotação minha' } })

    rerender(
      <>
        <AIView projects={[]} prefill={'Task "X" (id: t-9)'} />
        <AiRunHost activeView="ai" onOpenAI={() => {}} />
      </>
    )

    await waitFor(() => expect(box.value).toContain('Task "X"'))
    // The user's own words survive the handoff.
    expect(box.value).toContain('anotação minha')
  })
})
