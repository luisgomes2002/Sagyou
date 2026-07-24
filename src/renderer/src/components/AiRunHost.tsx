import { useEffect, useState } from 'react'
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
  // One or more runs are working somewhere. Was the global `busy`; now derived
  // from the set of running conversations.
  const anyRunning = useAiRunStore((s) => s.running.size > 0)
  const pendingApprovals = useAiRunStore((s) => s.pendingApprovals)
  const ensureConversationId = useAiRunStore((s) => s.ensureConversationId)
  const markSaved = useAiRunStore((s) => s.markSaved)
  const resolveApproval = useAiRunStore((s) => s.resolveApproval)
  const toggleApproval = useAiRunStore((s) => s.toggleApproval)
  const setAutoApprove = useAiRunStore((s) => s.setAutoApprove)

  const onAIView = activeView === 'ai'

  /**
   * A conversation's transcript, wherever it lives — on screen or parked — so a
   * card can be labelled with the chat that raised it. A running chat is always
   * one or the other.
   */
  const messagesOf = (id: string): ChatMessage[] =>
    id === conversationId ? messages : (parked[id]?.messages ?? [])

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

  // ── Code agent approval (lives here so it works even when FleetView is not
  //    mounted — FleetView is a view that unmounts on navigation, and a parked
  //    code agent never resolves if its approval handler disappears).
  interface CodeApproval {
    runId: string
    id: string
    name: string
    resumo: string
    conteudo?: string
    comando?: string
    diff?: { kind: string; text: string }[]
    diffTruncated?: boolean
    irreversivel?: boolean
  }

  const [codeApprovals, setCodeApprovals] = useState<CodeApproval[]>([])

  useEffect(() => {
    const off = window.electronAPI.ai.codeAgent.onApproveRequest((req) => {
      setCodeApprovals((prev) => [
        ...prev.filter((a) => a.runId !== req.runId),
        {
          runId: req.runId,
          id: req.id,
          name: req.name,
          resumo: req.resumo,
          conteudo: req.conteudo,
          comando: req.comando,
          diff: req.diff,
          diffTruncated: req.diffTruncated,
          irreversivel: req.irreversivel
        }
      ])
    })
    return () => off()
  }, [])

  const approveCodeAction = (id: string, approved: boolean): void => {
    window.electronAPI.ai.codeAgent.approve(id, approved)
    setCodeApprovals((prev) => prev.filter((a) => a.id !== id))
  }

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
      // must be *answered*, not hidden, or the loop waits forever. With a queue,
      // Escape answers the topmost card (the last one raised, drawn on top).
      const top = pendingApprovals[pendingApprovals.length - 1]
      if (e.key === 'Escape' && top) resolveApproval(top.convId, new Set())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onAIView, pendingApprovals, resolveApproval])

  return (
    <>
      {/* The agent is working somewhere else — a way back, and proof it didn't die. */}
      {anyRunning && !onAIView && (
        <button
          onClick={onOpenAI}
          title="A IA está trabalhando — clique para acompanhar"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3 py-2 rounded-full bg-[#13151f] border border-[#2a2d42] shadow-lg hover:border-[#6366f1] transition-colors"
        >
          <span className="w-3 h-3 shrink-0 rounded-full border-[1.5px] border-[#a5b4fc] border-t-transparent animate-spin" />
          <span className="text-xs text-[#e2e8f0]">IA trabalhando…</span>
        </button>
      )}

      {/* Code agent approval cards — rendered here (not only in FleetView) so
          a run doesn't hang forever when the user is on another view. */}
      {codeApprovals.map((ca) => (
        <div
          key={ca.id}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="w-[520px] max-h-[80vh] flex flex-col rounded-xl bg-[#13151f] border border-[#2a2d42] shadow-2xl">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-[#2a2d42]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <h2 className="text-sm font-semibold text-[#e2e8f0]">
                Agente de código — {ca.name === 'escrever_arquivo' ? 'escrever arquivo' : 'executar comando'}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              <p className="text-sm text-[#e2e8f0]">{ca.resumo}</p>
              {ca.conteudo && (
                <pre className="text-[11px] font-mono text-[#a5b4fc] bg-[#0d0f18] p-3 rounded-lg max-h-60 overflow-y-auto whitespace-pre-wrap">{ca.conteudo}</pre>
              )}
              {ca.comando && (
                <div className="text-[11px] font-mono text-[#a5b4fc] bg-[#0d0f18] p-3 rounded-lg">{ca.comando}</div>
              )}
              {ca.diff && ca.diff.length > 0 && (
                <div className="bg-[#0d0f18] p-3 rounded-lg max-h-60 overflow-y-auto">
                  {ca.diff.map((d, i) => (
                    <div
                      key={i}
                      className={`text-[11px] font-mono whitespace-pre-wrap ${
                        d.kind === 'add' ? 'text-green-400' : d.kind === 'del' ? 'text-red-400' : 'text-[#8892a4]'
                      }`}
                    >
                      {d.text}
                    </div>
                  ))}
                  {ca.diffTruncated && <p className="text-[10px] text-[#4a5068] mt-1">…diff truncado</p>}
                </div>
              )}
              {ca.irreversivel && <p className="text-[11px] text-amber-400">⚠️ Esta ação não pode ser desfeita.</p>}
            </div>
            <div className="flex items-center justify-end px-5 py-3 border-t border-[#2a2d42] gap-2">
              <button
                onClick={() => approveCodeAction(ca.id, false)}
                className="px-3 py-1.5 rounded-lg text-sm text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors"
              >
                Recusar
              </button>
              <button
                onClick={() => approveCodeAction(ca.id, true)}
                className="px-4 py-1.5 rounded-lg bg-[#6366f1] text-sm text-white font-medium hover:bg-[#4f52d4] transition-colors"
              >
                Aprovar
              </button>
            </div>
          </div>
        </div>
      ))}

      {/* Chat agent approval cards — one per run parked awaiting approval. Several runs can
          stop at once now, so this is a queue; each card is labelled with the
          conversation that raised it when there is more than one to tell apart,
          and each is answered against its own convId. */}
      {pendingApprovals.length > 0 && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/50 py-6 overflow-y-auto">
          {pendingApprovals.map((pa) => (
            <div
              key={pa.convId}
              className="w-[520px] max-h-[80vh] flex flex-col rounded-xl bg-[#13151f] border border-[#2a2d42] shadow-2xl"
            >
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
                  Aprovar ações da IA ({pa.selected.size}/{pa.writes.length})
                </h2>
              </div>

              {pendingApprovals.length > 1 && (
                // Which chat is asking — only worth the line when more than one
                // card is up and they need telling apart.
                <p className="px-5 pt-2 text-[11px] text-[#8892a4] truncate">
                  Conversa: {deriveTitle(messagesOf(pa.convId))}
                </p>
              )}

              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
                <p className="text-xs text-[#8892a4] mb-1">
                  A IA quer executar as ações abaixo. Marque as que você aprova.
                </p>
                {pa.writes.map((w) => (
                  <label
                    key={w.id}
                    className="flex items-start gap-3 p-3 rounded-lg bg-[#0d0f18] border border-[#2a2d42] cursor-pointer hover:border-[#3a3e58]"
                  >
                    <input
                      type="checkbox"
                      checked={pa.selected.has(w.id)}
                      onChange={() => toggleApproval(pa.convId, w.id)}
                      className="mt-0.5 accent-[#6366f1]"
                    />
                    <span className="text-sm text-[#e2e8f0]">{describeToolCall(w.name, w.args)}</span>
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-between px-5 py-3 border-t border-[#2a2d42] gap-2">
                <button
                  onClick={() => resolveApproval(pa.convId, new Set())}
                  className="px-3 py-1.5 rounded-lg text-sm text-[#8892a4] hover:text-[#e2e8f0] hover:bg-[#1e2235] transition-colors shrink-0"
                >
                  Recusar tudo
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setAutoApprove(pa.convId, true)
                      resolveApproval(pa.convId, new Set(pa.writes.map((w) => w.id)))
                    }}
                    title="A IA trabalhará sem interrupção nesta conversa — como o modo always allow do Claude Code"
                    className="px-3 py-1.5 rounded-lg text-xs text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-colors"
                  >
                    Sempre permitir
                  </button>
                  <button
                    onClick={() => resolveApproval(pa.convId, pa.selected)}
                    disabled={pa.selected.size === 0}
                    className="px-4 py-1.5 rounded-lg bg-[#6366f1] text-sm text-white font-medium hover:bg-[#4f52d4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Aprovar {pa.selected.size > 0 ? pa.selected.size : ''}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
