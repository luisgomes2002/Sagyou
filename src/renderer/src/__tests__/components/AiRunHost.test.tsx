import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Drive the agent by hand: what's under test is what survives the user walking
// away mid-run, so the test has to hold a run open across a navigation.
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
import { runAgent } from '../../ai/agent'

const emptyBucket = { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0, unpricedCalls: 0 }

function installApi(): void {
  ;(window as unknown as { electronAPI: unknown }).electronAPI = {
    ai: {
      config: {
        get: vi.fn(async () => ({ baseUrl: 'http://x', apiKey: 'k', model: 'm' })),
        set: vi.fn(async () => {})
      },
      models: vi.fn(async () => ({ success: true, models: ['m'] })),
      conversations: {
        list: vi.fn(async () => []),
        search: vi.fn(async () => []),
        get: vi.fn(async () => null),
        save: vi.fn(async () => {}),
        delete: vi.fn(async () => {})
      },
      usage: {
        summary: vi.fn(async () => ({
          today: emptyBucket,
          last30: emptyBucket,
          total: emptyBucket,
          byModel: [],
          recent: []
        }))
      },
      images: { save: vi.fn(), get: vi.fn(), delete: vi.fn(async () => {}) },
      templates: { list: vi.fn(async () => []), save: vi.fn(), delete: vi.fn(async () => {}) },
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
 * App in miniature: the host outside the view switch, AIView inside it. The
 * switch is the point — AIView is unmounted by navigating away, which is what
 * used to take the run down with it.
 */
function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState('ai')
  return (
    <>
      <AiRunHost activeView={activeView} onOpenAI={() => setActiveView('ai')} />
      <button onClick={() => setActiveView('board')}>ir para o board</button>
      <button onClick={() => setActiveView('ai')}>ir para a IA</button>
      {activeView === 'ai' ? <AIView projects={[]} /> : <div>Board</div>}
    </>
  )
}

const leaveAIView = async (): Promise<void> =>
  userEvent.click(screen.getByText('ir para o board'))

const returnToAIView = async (): Promise<void> =>
  userEvent.click(screen.getByText('ir para a IA'))

/** Send a message from the composer, leaving the run in flight. */
async function startRun(): Promise<void> {
  const box = await screen.findByPlaceholderText(/Descreva o projeto/)
  await userEvent.type(box, 'pergunta{Enter}')
  await waitFor(() => expect(runAgent).toHaveBeenCalled())
}

beforeEach(() => {
  vi.clearAllMocks()
  installApi()
  // busy off before reset: reset() spares a run in flight by design, so a
  // previous test's run would survive into this one. See AIView.test.tsx.
  useAiRunStore.setState({
    busy: false,
    abortRequested: false,
    savedTick: 0,
    runningConvId: null,
    parked: {}
  })
  useAiRunStore.getState().reset()
  // jsdom has no layout, and the transcript scrolls itself on every message.
  Element.prototype.scrollTo = vi.fn()
})

/**
 * A run belongs to the chat that started it, not to the chat on screen.
 *
 * Switching chats mid-run used to swap the transcript out from under the loop:
 * the answer was appended to whatever the user had opened, and the autosave
 * wrote it there. Two chats, one of them wrong, and no way back.
 */
describe('a run and the chat it belongs to', () => {
  /** The other chat in the history, to switch to mid-run. */
  const OTHER = { id: 'c-outra', title: 'Outra conversa', updatedAt: new Date().toISOString() }

  beforeEach(() => {
    vi.mocked(window.electronAPI.ai.conversations.search).mockResolvedValue([OTHER] as never)
    vi.mocked(window.electronAPI.ai.conversations.get).mockImplementation(
      async (id: string) =>
        (id === OTHER.id
          ? { ...OTHER, messages: [{ role: 'user', content: 'assunto sem relação' }] }
          : null) as never
    )
  })

  const switchToOther = async (): Promise<void> => {
    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.click(await screen.findByText(OTHER.title))
  }

  it('delivers the answer to the chat that asked, not the one being looked at', async () => {
    let finish!: (reply: string) => void
    vi.mocked(runAgent).mockImplementation(() => new Promise<string>((r) => (finish = r)))

    render(<App />)
    await startRun()
    const asked = useAiRunStore.getState().conversationId!

    await switchToOther()
    finish('a resposta da primeira conversa')

    // It is saved against the chat that asked …
    await waitFor(() =>
      expect(window.electronAPI.ai.conversations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: asked,
          messages: expect.arrayContaining([
            { role: 'assistant', content: 'a resposta da primeira conversa' }
          ])
        })
      )
    )

    // … and nowhere near the one the user moved to, on screen or on disk.
    // (The open chat is still autosaved as usual — what must never happen is
    // the answer being written under an id that didn't ask for it.)
    expect(screen.queryByText('a resposta da primeira conversa')).not.toBeInTheDocument()
    const stray = vi
      .mocked(window.electronAPI.ai.conversations.save)
      .mock.calls.map(([c]) => c)
      .filter(
        (c) =>
          c.id !== asked &&
          c.messages.some((m) => m.content === 'a resposta da primeira conversa')
      )
    expect(stray).toEqual([])
  })

  it('bills the tokens to the chat that asked', async () => {
    let finish!: (reply: string) => void
    let report!: (u: { promptTokens: number; completionTokens: number }) => void
    vi.mocked(runAgent).mockImplementation((_c, _m, _a, opts) => {
      report = (u) => opts?.onUsage?.(u)
      return new Promise<string>((r) => (finish = r))
    })

    render(<App />)
    await startRun()
    const asked = useAiRunStore.getState().conversationId!
    await switchToOther()
    // Reported *after* the user moved on — the call it pays for was made by the
    // chat left behind. Billing it here would charge the wrong conversation.
    act(() => report({ promptTokens: 100, completionTokens: 20 }))
    finish('pronto')

    await waitFor(() =>
      expect(window.electronAPI.ai.conversations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: asked,
          usage: { promptTokens: 100, completionTokens: 20 }
        })
      )
    )
    // The chat merely on screen didn't spend anything.
    expect(useAiRunStore.getState().usage).toEqual({ promptTokens: 0, completionTokens: 0 })
  })

  it('shows what the run did while the user was in another chat', async () => {
    let finish!: (reply: string) => void
    vi.mocked(runAgent).mockImplementation(() => new Promise<string>((r) => (finish = r)))

    render(<App />)
    await startRun()
    const asked = useAiRunStore.getState().conversationId!

    // Both chats are in the history now, so the user can come back to this one.
    vi.mocked(window.electronAPI.ai.conversations.search).mockResolvedValue([
      { id: asked, title: 'pergunta', updatedAt: new Date().toISOString() },
      OTHER
    ] as never)
    // The stored file is behind the run: it was last written before the answer
    // arrived. Re-opening must show the live transcript, not this stale copy.
    vi.mocked(window.electronAPI.ai.conversations.get).mockImplementation(
      async (id: string) =>
        (id === asked
          ? { id: asked, title: 'pergunta', messages: [{ role: 'user', content: 'pergunta' }] }
          : { ...OTHER, messages: [] }) as never
    )

    await switchToOther()
    finish('terminei enquanto você lia outra')

    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.click(await screen.findByText('pergunta'))

    expect(await screen.findByText('terminei enquanto você lia outra')).toBeInTheDocument()
  })

  it('does not spin a thinking bubble over a chat that is not running', async () => {
    vi.mocked(runAgent).mockImplementation(() => new Promise<string>(() => {}))

    render(<App />)
    await startRun()
    // Its own chat offers to stop it.
    expect(screen.getByLabelText('Parar')).toBeInTheDocument()

    await switchToOther()

    // This one isn't working, so it must not claim to be — nor offer to stop
    // a run that isn't its own.
    expect(screen.queryByLabelText('Parar')).not.toBeInTheDocument()
  })

  it('"Nova" leaves a run in flight alone', async () => {
    let finish!: (reply: string) => void
    vi.mocked(runAgent).mockImplementation(() => new Promise<string>((r) => (finish = r)))

    render(<App />)
    await startRun()
    const asked = useAiRunStore.getState().conversationId!

    // Asking for a blank chat is not asking to cancel: this used to resolve the
    // loop's approval and abandon the transcript.
    await userEvent.click(screen.getByText('Nova'))
    finish('a resposta sobreviveu à Nova')

    await waitFor(() =>
      expect(window.electronAPI.ai.conversations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: asked,
          messages: expect.arrayContaining([
            { role: 'assistant', content: 'a resposta sobreviveu à Nova' }
          ])
        })
      )
    )
  })

  it('stops a run whose chat has just been deleted', async () => {
    vi.mocked(runAgent).mockImplementation(() => new Promise<string>(() => {}))

    render(<App />)
    await startRun()
    const asked = useAiRunStore.getState().conversationId!

    // Nowhere left to write: every further step would be billed and discarded.
    useAiRunStore.getState().dropConversation(asked)

    expect(useAiRunStore.getState().abortRequested).toBe(true)
  })
})

describe('a run in the background', () => {
  it('keeps going, and its answer is saved, when the user walks away mid-run', async () => {
    // The whole point of the card: the model is working, the user has other
    // things to do. Before, this threw the answer away — the run kept billing
    // and nothing was left of it.
    let finish!: (reply: string) => void
    vi.mocked(runAgent).mockImplementation(() => new Promise<string>((r) => (finish = r)))

    render(<App />)
    await startRun()
    await leaveAIView()
    expect(screen.getByText('Board')).toBeInTheDocument()

    finish('a resposta que o usuário pagou')

    await waitFor(() =>
      expect(window.electronAPI.ai.conversations.save).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            { role: 'assistant', content: 'a resposta que o usuário pagou' }
          ])
        })
      )
    )
  })

  it('still has the answer waiting when the user comes back', async () => {
    let finish!: (reply: string) => void
    vi.mocked(runAgent).mockImplementation(() => new Promise<string>((r) => (finish = r)))

    render(<App />)
    await startRun()
    await leaveAIView()
    finish('terminei enquanto você não olhava')

    // Back to the AI view: the transcript is the run's, not a blank chat.
    await returnToAIView()

    expect(await screen.findByText('terminei enquanto você não olhava')).toBeInTheDocument()
  })

  it('the indicator is the way back to the chat', async () => {
    vi.mocked(runAgent).mockImplementation(() => new Promise<string>(() => {}))

    render(<App />)
    await startRun()
    await leaveAIView()

    await userEvent.click(screen.getByTitle(/A IA está trabalhando/))

    expect(await screen.findByPlaceholderText(/Descreva o projeto/)).toBeInTheDocument()
  })

  it('shows a way back while it works, and only while it works', async () => {
    let finish!: (reply: string) => void
    vi.mocked(runAgent).mockImplementation(() => new Promise<string>((r) => (finish = r)))

    render(<App />)
    await startRun()
    // Inside the AI view the chat already shows its own progress.
    expect(screen.queryByText('IA trabalhando…')).not.toBeInTheDocument()

    await leaveAIView()
    expect(screen.getByText('IA trabalhando…')).toBeInTheDocument()

    finish('pronto')
    await waitFor(() => expect(screen.queryByText('IA trabalhando…')).not.toBeInTheDocument())
  })
})

describe('approval from another view', () => {
  /** Start a run that asks to approve one write, and hand back its decision. */
  function runAskingApproval(): { decision: () => Promise<Set<string>> } {
    let decision!: Promise<Set<string>>
    vi.mocked(runAgent).mockImplementation(async (_c, _m, onApprove) => {
      decision = onApprove([{ id: 'w1', name: 'criar_tasks', args: { tasks: [{ title: 'T' }] } }])
      await decision
      return 'ok'
    })
    return { decision: () => decision }
  }

  it('asks wherever the user is, instead of parking the run forever', async () => {
    // A card only the AI view can show means a background run stops dead at the
    // first write and holds its progress with no way to answer it.
    const { decision } = runAskingApproval()

    render(<App />)
    await startRun()
    await leaveAIView()

    expect(await screen.findByText(/Aprovar ações da IA/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Aprovar 1/ }))

    expect(await decision()).toEqual(new Set(['w1']))
  })

  it('spells out what it would do, on the Board as in the chat', async () => {
    runAskingApproval()

    render(<App />)
    await startRun()
    await leaveAIView()

    expect(await screen.findByText('Criar 1 task(s)')).toBeInTheDocument()
  })

  it('Escape from another view cancels: approve nothing, and answer the loop', async () => {
    const { decision } = runAskingApproval()

    render(<App />)
    await startRun()
    await leaveAIView()
    await screen.findByText(/Aprovar ações da IA/)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(await decision()).toEqual(new Set())
    await waitFor(() => expect(screen.queryByText(/Aprovar ações da IA/)).not.toBeInTheDocument())
  })

  it('leaves Escape to the AI view while that view is open', async () => {
    // Both bind Escape; only one may act, or the host would reach past the
    // view's ordering (a confirmation on top of the card takes the press first)
    // and answer the card anyway.
    runAskingApproval()

    render(<App />)
    await startRun()
    await screen.findByText(/Aprovar ações da IA/)

    fireEvent.keyDown(document, { key: 'Escape' })

    // Answered once, by the view — not twice.
    await waitFor(() => expect(screen.queryByText(/Aprovar ações da IA/)).not.toBeInTheDocument())
  })
})

describe('a run happening in a chat you are not looking at', () => {
  it('says so, instead of leaving a dead composer with no explanation', async () => {
    vi.mocked(window.electronAPI.ai.conversations.search).mockResolvedValue([
      { id: 'c-outra', title: 'Outra conversa', updatedAt: new Date().toISOString() }
    ] as never)
    vi.mocked(window.electronAPI.ai.conversations.get).mockResolvedValue({
      id: 'c-outra',
      title: 'Outra conversa',
      messages: []
    } as never)
    vi.mocked(runAgent).mockImplementation(() => new Promise<string>(() => {}))

    render(<App />)
    await startRun()
    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.click(await screen.findByText('Outra conversa'))

    // Sending is blocked here (one run at a time) and the run's own chat is
    // out of sight, so this is the only thing on screen that accounts for it.
    expect(await screen.findByText(/trabalhando em outra conversa/)).toBeInTheDocument()
  })

  it('is the way back to it', async () => {
    vi.mocked(window.electronAPI.ai.conversations.search).mockResolvedValue([
      { id: 'c-outra', title: 'Outra conversa', updatedAt: new Date().toISOString() }
    ] as never)
    vi.mocked(runAgent).mockImplementation(() => new Promise<string>(() => {}))

    render(<App />)
    await startRun()
    const asked = useAiRunStore.getState().conversationId!
    vi.mocked(window.electronAPI.ai.conversations.get).mockImplementation(
      async (id: string) =>
        (id === asked
          ? { id: asked, title: 'pergunta', messages: [{ role: 'user', content: 'pergunta' }] }
          : { id: 'c-outra', title: 'Outra conversa', messages: [] }) as never
    )
    await userEvent.click(screen.getByText('Histórico'))
    await userEvent.click(await screen.findByText('Outra conversa'))

    await userEvent.click(await screen.findByText(/trabalhando em outra conversa/))

    // Back on the running chat: its own progress is on screen again.
    await waitFor(() => expect(screen.getByLabelText('Parar')).toBeInTheDocument())
  })
})
