import { useEffect } from 'react'
import { useAiRunStore } from '../store/aiRun'
import type { ChatMessage } from '../store/aiRun'
import { describeToolCall } from '../ai/tools'

// ---------------------------------------------------------------------------
// The agent run's home outside the AI view.
//
// Mounted by App next to the view switch, so it is alive whatever the user is
// looking at. It owns the two things a run needs that must not depend on
// AIView being on screen:
//
//   - the autosave, so an answer that arrives while the user is on the Board
//     still reaches ai-conversations.json;
//   - the approval card, because the loop parks until it is answered — asking
//     only inside the AI view would mean a background run stops dead the
//     moment the user looks away, holding its progress forever.
//
// The card is rendered here and nowhere else. When the AI view is open, this
// still draws it (it's a fixed overlay, so it lands over that view exactly as
// before) — one mount site, wherever the user happens to be.
// ---------------------------------------------------------------------------

/** Where the user is, so the host knows whether AIView is on screen. */
type ActiveView = string

/**
 * A chat's name, taken from what was first asked of it.
 *
 * Sent on every save, but only applied to chats the user hasn't named: the main
 * process keeps a renamed title and ignores this one (`titleCustom`), so the
 * autosave doesn't need to know which is which.
 */
function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? 'Conversa'
  return firstUser.slice(0, 60)
}

export function AiRunHost({
  activeView,
  onOpenAI
}: {
  activeView: ActiveView
  onOpenAI: () => void
}): React.JSX.Element {
  const messages = useAiRunStore((s) => s.messages)
  const conversationId = useAiRunStore((s) => s.conversationId)
  const usage = useAiRunStore((s) => s.usage)
  const parked = useAiRunStore((s) => s.parked)
  const busy = useAiRunStore((s) => s.busy)
  const pendingApproval = useAiRunStore((s) => s.pendingApproval)
  const ensureConversationId = useAiRunStore((s) => s.ensureConversationId)
  const markSaved = useAiRunStore((s) => s.markSaved)
  const resolveApproval = useAiRunStore((s) => s.resolveApproval)
  const toggleApproval = useAiRunStore((s) => s.toggleApproval)
  const setAutoApprove = useAiRunStore((s) => s.setAutoApprove)

  const onAIView = activeView === 'ai'

  // Auto-save the current conversation whenever it changes (debounced). The id
  // is normally minted when the run starts; this also covers a transcript that
  // never went through `send` (Gerar Tasks). The title is the first user
  // message.
  useEffect(() => {
    if (messages.length === 0) return
    const id = ensureConversationId()
    const timer = setTimeout(() => {
      window.electronAPI.ai.conversations
        .save({ id, title: deriveTitle(messages), messages, usage })
        .then(() => markSaved())
    }, 600)
    return () => clearTimeout(timer)
  }, [messages, conversationId, usage, ensureConversationId, markSaved])

  // Chats the user walked away from mid-run save on the same terms — the run is
  // still appending to them, and nothing else is watching. Without this, leaving
  // a chat mid-run would strand every answer that arrived after the last save.
  useEffect(() => {
    const entries = Object.entries(parked)
    if (entries.length === 0) return
    const timer = setTimeout(() => {
      void Promise.all(
        entries.map(([id, p]) =>
          window.electronAPI.ai.conversations.save({
            id,
            title: deriveTitle(p.messages),
            messages: p.messages,
            usage: p.usage
          })
        )
      ).then(() => markSaved())
    }, 600)
    return () => clearTimeout(timer)
  }, [parked, markSaved])

  /**
   * Escape cancels the approval — but only out here. While the AI view is open
   * it owns Escape, peeling one layer at a time (a confirmation on top of the
   * card must take the press first); a second listener would reach past that
   * ordering and answer the card anyway.
   */
  useEffect(() => {
    if (onAIView) return
    const onKey = (e: KeyboardEvent): void => {
      // Same reading as in the view: cancel means approve nothing, and the card
      // must be *answered*, not hidden, or the loop waits forever.
      if (e.key === 'Escape' && pendingApproval) resolveApproval(new Set())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onAIView, pendingApproval, resolveApproval])

  return (
    <>
      {/* The agent is working somewhere else — a way back, and proof it didn't die. */}
      {busy && !onAIView && (
        <button
          onClick={onOpenAI}
          title="A IA está trabalhando — clique para acompanhar"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3 py-2 rounded-full bg-[#13151f] border border-[#2a2d42] shadow-lg hover:border-[#6366f1] transition-colors"
        >
          <span className="w-3 h-3 shrink-0 rounded-full border-[1.5px] border-[#a5b4fc] border-t-transparent animate-spin" />
          <span className="text-xs text-[#e2e8f0]">IA trabalhando…</span>
        </button>
      )}

      {/* Approval card — write actions the agent wants to run */}
      {pendingApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[520px] max-h-[80vh] flex flex-col rounded-xl bg-[#13151f] border border-[#2a2d42] shadow-2xl">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-[#2a2d42]">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <h2 className="text-sm font-semibold text-[#e2e8f0]">
                Aprovar ações da IA ({pendingApproval.selected.size}/{pendingApproval.writes.length})
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              <p className="text-xs text-[#8892a4] mb-1">
                A IA quer executar as ações abaixo. Marque as que você aprova.
              </p>
              {pendingApproval.writes.map((w) => (
                <label
                  key={w.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-[#0d0f18] border border-[#2a2d42] cursor-pointer hover:border-[#3a3e58]"
                >
                  <input
                    type="checkbox"
                    checked={pendingApproval.selected.has(w.id)}
                    onChange={() => toggleApproval(w.id)}
                    className="mt-0.5 accent-[#6366f1]"
                  />
                  <span className="text-sm text-[#e2e8f0]">{describeToolCall(w.name, w.args)}</span>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-[#2a2d42] gap-2">
              <button
                onClick={() => resolveApproval(new Set())}
                className="px-3 py-1.5 rounded-lg text-sm text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors shrink-0"
              >
                Recusar tudo
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setAutoApprove(true)
                    resolveApproval(new Set(pendingApproval.writes.map((w) => w.id)))
                  }}
                  title="A IA trabalhará sem interrupção nesta conversa — como o modo always allow do Claude Code"
                  className="px-3 py-1.5 rounded-lg text-xs text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
                >
                  Sempre permitir
                </button>
                <button
                  onClick={() => resolveApproval(pendingApproval.selected)}
                  disabled={pendingApproval.selected.size === 0}
                  className="px-4 py-1.5 rounded-lg bg-[#6366f1] text-sm text-white font-medium hover:bg-[#4f52d4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Aprovar {pendingApproval.selected.size > 0 ? pendingApproval.selected.size : ''}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
