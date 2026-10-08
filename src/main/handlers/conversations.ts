import type { IpcMain } from 'electron'
import type { TokenUsage } from '../usage'
import type { StoredConversation } from '../conversation-types'
import { searchConversations } from '../conversation-search'
import { referencedConversationIds, retainReferencedConversations } from '../conversation-retention'

interface ConversationHandlerDeps {
  loadConversations: () => StoredConversation[]
  saveConversations: (list: StoredConversation[]) => void
  safeConversationsSave: (op: () => void) => void
  listMemories: typeof import('../store').listMemories
}

export function registerConversationHandlers(
  ipcMain: IpcMain,
  deps: ConversationHandlerDeps
): void {
  // --- AI conversation history ---
  ipcMain.handle('ai:conversations:list', () =>
    deps
      .loadConversations()
      .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  )

  // Searching here rather than in the renderer: the file is already read on
  // this side, and shipping every message body over IPC to filter it there
  // would move megabytes for a substring test.
  ipcMain.handle('ai:conversations:search', (_, term: string) =>
    searchConversations(deps.loadConversations(), typeof term === 'string' ? term : '')
  )

  ipcMain.handle(
    'ai:conversations:get',
    (_, id: string) => deps.loadConversations().find((c) => c.id === id) ?? null
  )

  ipcMain.handle(
    'ai:conversations:save',
    (
      _,
      conv: {
        id: string
        title: string
        messages: StoredConversation['messages']
        usage?: TokenUsage
      }
    ) => {
      deps.safeConversationsSave(() => {
        const list = deps.loadConversations()
        const now = new Date().toISOString()
        const idx = list.findIndex((c) => c.id === conv.id)
        if (idx >= 0) {
          list[idx] = {
            ...list[idx],
            title: list[idx].titleCustom ? list[idx].title : conv.title,
            messages: conv.messages,
            usage: conv.usage,
            updatedAt: now
          }
        } else {
          list.push({
            id: conv.id,
            title: conv.title,
            messages: conv.messages,
            usage: conv.usage,
            createdAt: now,
            updatedAt: now
          })
        }
        deps.saveConversations(list)
      })
    }
  )

  /**
   * Name a chat by hand, latching the title against the autosave's derived one.
   *
   * Renaming reaches any chat in the history, not just the open one, so it goes
   * through the file rather than through the run store — the renderer only
   * holds the transcript of what's on screen.
   */
  ipcMain.handle('ai:conversations:rename', (_, id: string, title: string) => {
    if (typeof id !== 'string' || typeof title !== 'string')
      return { error: 'Argumentos inválidos' }
    const name = title.trim()
    if (!name) return { error: 'O nome não pode ficar vazio' }
    // A title is a one-line label in a narrow dropdown; the rest is not shown
    // and would only bloat a file re-read on every autosave and every keystroke
    // of the search.
    const clipped = name.slice(0, 120)
    const list = deps.loadConversations()
    const idx = list.findIndex((c) => c.id === id)
    if (idx < 0) return { error: 'Conversa não encontrada' }
    // updatedAt is deliberately untouched: it orders the history by when the
    // chat was last *talked to*, and renaming would jump it to the top.
    list[idx] = { ...list[idx], title: clipped, titleCustom: true }
    deps.saveConversations(list)
    return { title: clipped }
  })

  ipcMain.handle('ai:conversations:delete', (_, id: string) => {
    if (typeof id !== 'string' || !id) return { error: 'Conversa inválida' }
    if (referencedConversationIds(deps.listMemories({ includeArchived: true })).has(id)) {
      return {
        error:
          'Esta conversa é referenciada por uma memória. Exclua a memória antes de apagar a conversa.'
      }
    }
    deps.saveConversations(deps.loadConversations().filter((c) => c.id !== id))
    return { ok: true }
  })

  // Full history read/write — used by backup export/import, which needs every
  // conversation with its messages rather than the metadata `list` returns.
  ipcMain.handle('ai:conversations:all', () => deps.loadConversations())

  ipcMain.handle('ai:conversations:replace', (_, list: StoredConversation[]) => {
    if (!Array.isArray(list)) return
    const now = new Date().toISOString()
    const clean = list
      .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
      .map((c) => ({
        id: c.id,
        title: typeof c.title === 'string' ? c.title : 'Conversa',
        // Carried through, or restoring a backup would quietly un-name every
        // chat the user had renamed: the title survives the round trip but the
        // next autosave, seeing no flag, derives over it.
        ...(c.titleCustom === true && { titleCustom: true }),
        // Likewise carried: without it an imported chat reports its cost as
        // unknown, having lost a count it was exported with.
        ...(c.usage && { usage: c.usage }),
        createdAt: typeof c.createdAt === 'string' ? c.createdAt : now,
        updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : now,
        messages: c.messages.filter(
          (m) =>
            m &&
            (m.role === 'user' || m.role === 'assistant' || m.role === 'status') &&
            typeof m.content === 'string'
        )
      }))
    // Backup import writes conversations before memories. A local memory may
    // still cite a conversation absent from the backup; keep its evidence.
    const referenced = referencedConversationIds(deps.listMemories({ includeArchived: true }))
    deps.saveConversations(
      retainReferencedConversations(clean, deps.loadConversations(), referenced)
    )
  })
}
