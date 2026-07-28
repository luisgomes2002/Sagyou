import { useEffect, useState } from 'react'
import { useAiRunStore } from '../../store/aiRun'
import type { ChatMessage } from '../../store/aiRun'
import { describeToolCall } from '../../ai/tools'

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
  const autoApprove = useAiRunStore((s) => s.autoApprove)

  const onAIView = activeView === 'ai'

  /**
   * A conversation's transcript, wherever it lives — on screen or parked — so a
   * card can be labelled with the chat that raised it. A running chat is always
   * one or the other.
   */
  const messagesOf = (id: string): ChatMessage[] =>
    id === conversationId ? messages : (parked[id]?.messages ?? [])

  // Auto-save the current conversation AND parked conversations together.
  // They're sent in one batch to avoid a read-modify-write race in main:
  // sending two concurrent IPC saves means they can load the file before the
  // other wrote, then the last writer overwrites the first one's changes.
  useEffect(() => {
    const parkedEntries = Object.entries(parked)
    if (messages.length === 0 && parkedEntries.length === 0) return
    const id = messages.length > 0 ? ensureConversationId() : null
    const timer = setTimeout(() => {
      const saves: Promise<unknown>[] = []
      if (id) {
        saves.push(
          window.electronAPI.ai.conversations.save({ id, title: deriveTitle(messages), messages, usage })
        )
      }
      for (const [parkedId, p] of parkedEntries) {
        saves.push(
          window.electronAPI.ai.conversations.save({ id: parkedId, title: deriveTitle(p.messages), messages: p.messages, usage: p.usage })
        )
      }
      void Promise.all(saves).then(() => markSaved())
    }, 600)
    return () => clearTimeout(timer)
  }, [messages, conversationId, usage, parked, ensureConversationId, markSaved])

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
        ...prev.filter((a) => a.id !== req.id),
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
    const offExit = window.electronAPI.ai.codeAgent.onExit((payload) => {
      setCodeApprovals((prev) => prev.filter((a) => a.runId !== payload.runId))
    })
    return () => {
      off()
      offExit()
    }
  }, [])

  const approveCodeAction = (id: string, approved: boolean): void => {
    window.electronAPI.ai.codeAgent.approve(id, approved)
    setCodeApprovals((prev) => prev.filter((a) => a.id !== id))
  }

  /**
   * Global keyboard shortcuts that work from any view.
   * Ctrl+Tab toggles auto-approve for the current conversation.
   * Escape cancels the approval card — only when the AI view is closed
   * (AIView owns Escape otherwise, peeling one layer at a time).
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Ctrl+Tab toggles auto-approve globally, from any view.
      if (e.key === 'Tab' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (conversationId) {
          setAutoApprove(conversationId, !autoApprove.has(conversationId))
        }
        return
      }
      if (onAIView) return
      const top = pendingApprovals[pendingApprovals.length - 1]
      if (e.key === 'Escape' && top) resolveApproval(top.convId, new Set())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onAIView, conversationId, pendingApprovals, resolveApproval, setAutoApprove, autoApprove])

  return (
    <>
      {/* The agent is working somewhere else — a way back, and proof it didn't die. */}
      {anyRunning && !onAIView && (
        <button
          onClick={onOpenAI}
          title="A IA está trabalhando — clique para acompanhar"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3 py-2 rounded-full bg-[#232323] border border-[#3b3b3b] shadow-lg hover:border-[#7c3aed] transition-colors"
        >
          <span className="w-3 h-3 shrink-0 rounded-full border-[1.5px] border-[#a080f0] border-t-transparent animate-spin" />
          <span className="text-xs text-[#d4d4d4]">IA trabalhando…</span>
        </button>
      )}

      {/* Code agent approval cards — rendered here (not only in FleetView) so
          a run doesn't hang forever when the user is on another view. */}
      {codeApprovals.map((ca) => (
        <div
          key={ca.id}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="w-[520px] max-h-[80vh] flex flex-col rounded-xl bg-[#232323] border border-[#3b3b3b] shadow-2xl">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-[#3b3b3b]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f0b820" strokeWidth="2">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <h2 className="text-sm font-semibold text-[#d4d4d4]">
                Agente de código — {ca.name === 'escrever_arquivo' ? 'escrever arquivo' : 'executar comando'}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              <p className="text-sm text-[#d4d4d4]">{ca.resumo}</p>
              {ca.conteudo && (
                <pre className="text-[11px] font-mono text-[#a080f0] bg-[#1b1b1b] p-3 rounded-lg max-h-60 overflow-y-auto whitespace-pre-wrap">{ca.conteudo}</pre>
              )}
              {ca.comando && (
                <div className="text-[11px] font-mono text-[#a080f0] bg-[#1b1b1b] p-3 rounded-lg">{ca.comando}</div>
              )}
              {ca.diff && ca.diff.length > 0 && (
                <div className="bg-[#1b1b1b] p-3 rounded-lg max-h-60 overflow-y-auto">
                  {ca.diff.map((d, i) => (
                    <div
                      key={i}
                      className={`text-[11px] font-mono whitespace-pre-wrap ${
                        d.kind === 'add' ? 'text-[#46d478]' : d.kind === 'del' ? 'text-[#e04040]' : 'text-[#999999]'
                      }`}
                    >
                      {d.text}
                    </div>
                  ))}
                  {ca.diffTruncated && <p className="text-[10px] text-[#666666] mt-1">…diff truncado</p>}
                </div>
              )}
              {ca.irreversivel && <p className="text-[11px] text-[#f0b820]">Esta acao nao pode ser desfeita.</p>}
            </div>
            <div className="flex items-center justify-end px-5 py-3 border-t border-[#3b3b3b] gap-2">
              <button
                onClick={() => approveCodeAction(ca.id, false)}
                className="px-3 py-1.5 rounded-lg text-sm text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors"
              >
                Recusar
              </button>
              <button
                onClick={() => approveCodeAction(ca.id, true)}
                className="px-4 py-1.5 rounded-lg bg-[#7c3aed] text-sm text-white font-medium hover:bg-[#6d28d9] transition-colors"
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
              className="w-[520px] max-h-[80vh] flex flex-col rounded-xl bg-[#232323] border border-[#3b3b3b] shadow-2xl"
            >
              <div className="flex items-center gap-2 px-5 py-4 border-b border-[#3b3b3b]">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#f0b820"
                  strokeWidth="2"
                >
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <h2 className="text-sm font-semibold text-[#d4d4d4]">
                  Aprovar ações da IA ({pa.selected.size}/{pa.writes.length})
                </h2>
              </div>

              {pendingApprovals.length > 1 && (
                // Which chat is asking — only worth the line when more than one
                // card is up and they need telling apart.
                <p className="px-5 pt-2 text-[11px] text-[#999999] truncate">
                  Conversa: {deriveTitle(messagesOf(pa.convId))}
                </p>
              )}

              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
                <p className="text-xs text-[#999999] mb-1">
                  A IA quer executar as ações abaixo. Marque as que você aprova.
                </p>
                {pa.writes.map((w) => (
                  <label
                    key={w.id}
                    className="flex items-start gap-3 p-3 rounded-lg bg-[#1b1b1b] border border-[#3b3b3b] cursor-pointer hover:border-[#555555]"
                  >
                    <input
                      type="checkbox"
                      checked={pa.selected.has(w.id)}
                      onChange={() => toggleApproval(pa.convId, w.id)}
                      className="mt-0.5 accent-[#7c3aed]"
                    />
                    <span className="text-sm text-[#d4d4d4]">{describeToolCall(w.name, w.args)}</span>
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-between px-5 py-3 border-t border-[#3b3b3b] gap-2">
                <button
                  onClick={() => resolveApproval(pa.convId, new Set())}
                  className="px-3 py-1.5 rounded-lg text-sm text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a] transition-colors shrink-0"
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
                    className="px-3 py-1.5 rounded-lg text-xs text-[#f0b820] border border-[#f0b820]/30 hover:bg-[#f0b820]/10 transition-colors"
                  >
                    Sempre permitir
                  </button>
                  <button
                    onClick={() => resolveApproval(pa.convId, pa.selected)}
                    disabled={pa.selected.size === 0}
                    className="px-4 py-1.5 rounded-lg bg-[#7c3aed] text-sm text-white font-medium hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
