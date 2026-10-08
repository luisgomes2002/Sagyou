import type { TokenUsage } from './usage'

export interface StoredConversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: {
    role: 'user' | 'assistant' | 'status'
    content: string
    feedback?: 'positive' | 'negative'
    /** Chat-image ids; the bytes live under chat-images/. Absent on old files. */
    imageIds?: string[]
    /** Status lines: whether the tool finished. See ChatMessage.done. */
    done?: boolean
    /**
     * Status lines: the step that produced the line and the cap it ran under,
     * rendered as a "3/40" badge. Both stored, so an old transcript keeps the
     * cap *that* run had rather than being relabelled against today's setting.
     * Absent on old files and on lines that aren't a step (retries, warnings).
     */
    step?: number
    maxSteps?: number
  }[]
  /** Tokens billed across this conversation's whole life. Absent on old files. */
  usage?: TokenUsage
  /**
   * The user named this chat, so `title` is theirs to keep.
   *
   * Titles are otherwise derived from the first user message on every autosave,
   * which would overwrite a rename within the second. The flag lives here and
   * is enforced in `ai:conversations:save` rather than in the renderer: the
   * autosave keeps sending its derived title and this side ignores it once the
   * name is the user's. Absent on old files — an underived title is just a
   * title, and stays derivable until someone renames it.
   */
  titleCustom?: boolean
}
