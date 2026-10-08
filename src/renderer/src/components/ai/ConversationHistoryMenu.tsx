import type { Dispatch, MouseEvent, SetStateAction } from 'react'

interface ConversationSummary {
  id: string
  title: string
  updatedAt: string
  snippet?: string
}

interface Props {
  showHistory: boolean
  setShowHistory: Dispatch<SetStateAction<boolean>>
  historyQuery: string
  setQuery: (query: string) => void
  conversations: ConversationSummary[]
  conversationId: string | null
  runningConvId: string | null
  renaming: { id: string; value: string } | null
  setRenaming: Dispatch<SetStateAction<{ id: string; value: string } | null>>
  commitRename: () => Promise<void>
  handleLoadConversation: (id: string) => Promise<void>
  startRename: (id: string, title: string, event: MouseEvent) => void
  handleDeleteConversation: (id: string, title: string, event: MouseEvent) => void
}

export function ConversationHistoryMenu({
  showHistory,
  setShowHistory,
  historyQuery,
  setQuery,
  conversations,
  conversationId,
  runningConvId,
  renaming,
  setRenaming,
  commitRename,
  handleLoadConversation,
  startRename,
  handleDeleteConversation
}: Props): React.JSX.Element {
  return (
    <div className="relative">
      <button
        onClick={() => {
          // Reopening always starts unfiltered — a stale query would
          // look like the history had lost conversations.
          if (!showHistory) setQuery('')
          setShowHistory((v) => !v)
        }}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          showHistory
            ? 'bg-[#3b3b3b] text-[#a080f0]'
            : 'text-[#999999] hover:text-[#d4d4d4] hover:bg-[#2a2a2a]'
        }`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 3v5h5" />
          <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
          <path d="M12 7v5l4 2" />
        </svg>
        Histórico
      </button>

      {showHistory && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowHistory(false)} />
          <div className="absolute right-0 top-full mt-1 z-40 w-80 max-h-96 overflow-y-auto rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] shadow-2xl py-1">
            <div className="sticky top-0 bg-[#1b1b1b] px-2 pt-1 pb-2 border-b border-[#3b3b3b]">
              <input
                autoFocus
                value={historyQuery}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por título ou conteúdo…"
                className="w-full px-2.5 py-1.5 rounded-md bg-[#232323] border border-[#3b3b3b] text-xs text-[#d4d4d4] placeholder:text-[#666666] focus:outline-none focus:border-[#7c3aed]"
              />
            </div>
            {conversations.length === 0 ? (
              <p className="px-3 py-3 text-xs text-[#666666] italic text-center">
                {historyQuery.trim()
                  ? `Nada encontrado para "${historyQuery.trim()}"`
                  : 'Nenhuma conversa salva'}
              </p>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  onClick={() => handleLoadConversation(c.id)}
                  className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                    c.id === conversationId ? 'bg-[#3b3b3b]' : 'hover:bg-[#2a2a2a]'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    {renaming?.id === c.id ? (
                      <input
                        autoFocus
                        value={renaming.value}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenaming({ id: c.id, value: e.target.value })}
                        // Clicking away is a commit, like a rename in a
                        // file manager. Escape is handled by the view's
                        // ordering above, which clears `renaming` first
                        // — so by the time blur fires there is nothing
                        // to commit and the old name stands.
                        onBlur={() => void commitRename()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename()
                        }}
                        className="w-full px-1.5 py-0.5 rounded bg-[#1b1b1b] border border-[#7c3aed] text-xs text-[#d4d4d4] focus:outline-none"
                      />
                    ) : (
                      <p className="text-xs text-[#d4d4d4] truncate">{c.title}</p>
                    )}
                    {c.snippet && (
                      // Matched on the body, not the title: show the
                      // line, or the result looks arbitrary.
                      <p className="text-[10px] text-[#999999] truncate italic">{c.snippet}</p>
                    )}
                    <p className="text-[10px] text-[#666666]">
                      {new Date(c.updatedAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  {c.id === runningConvId && (
                    // This chat is the one the agent is working in —
                    // worth saying, since it's about to change on its
                    // own and it isn't necessarily the one on screen.
                    <span
                      title="A IA está trabalhando nesta conversa"
                      className="w-3 h-3 shrink-0 rounded-full border-[1.5px] border-[#a080f0] border-t-transparent animate-spin"
                    />
                  )}
                  <button
                    onClick={(e) => startRename(c.id, c.title, e)}
                    title="Renomear conversa"
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-[#999999] hover:text-[#d4d4d4] shrink-0"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => handleDeleteConversation(c.id, c.title, e)}
                    title="Apagar conversa"
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-[#999999] hover:text-[#e04040] shrink-0"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
