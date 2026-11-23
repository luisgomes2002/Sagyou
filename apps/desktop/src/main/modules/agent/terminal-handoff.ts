import { buildMemory, handoffId, HANDOFF_RUNNING_TAG, type AiMemory } from '../ai/memory'
import { RUNNING_RESULT_LINE, RUNNING_STATUS_LINE, RUNNING_TITLE_PREFIX } from '../ai/handoff-state'

export interface TerminalHandoffInput {
  projectId: string | null
  runId: string
  request: string
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'not_applied'
  result: string
  changedFiles: string[]
  /** What the session was about: its request, or the first MCP write it applied. */
  subject?: string
  /** Decisions the chat passed at launch and `decisao` memories the run saved. */
  decisions?: string[]
  /** Card summaries of the MCP writes the run applied. */
  actions?: string[]
  /** Tasks whose timer the run started and did not complete. */
  pending?: string[]
}

const REQUEST_LIMIT = 900
const RESULT_LIMIT = 700
const SUBJECT_LIMIT = 160
const ITEM_LIMIT = 200
const LIST_LIMIT = 12
const FILE_LIMIT = 20
const TITLE_LIMIT = 120
const BODY_LIMIT = 2_400

const items = (values: string[] | undefined): string[] =>
  (values ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, LIST_LIMIT)
    .map((value) => value.slice(0, ITEM_LIMIT))

/**
 * A small, deterministic breadcrumb; full terminal output remains in its run
 * archive. Every line comes from a recorded source (the request, the chat's
 * decisions, applied MCP writes), never from the PTY log or an unapplied diff.
 */
export function buildTerminalHandoff(
  input: TerminalHandoffInput,
  now: string,
  existing: AiMemory | null = null
): AiMemory {
  const running = input.status === 'running'
  const subject = input.subject?.trim().slice(0, SUBJECT_LIMIT) ?? ''
  const decisions = items(input.decisions)
  const actions = items(input.actions)
  const pending = items(input.pending)
  const files = input.changedFiles.slice(0, FILE_LIMIT).map((file) => `- ${file.slice(0, 180)}`)
  const filesLabel = running
    ? 'Arquivos alterados até o último checkpoint'
    : input.status === 'not_applied'
      ? 'Arquivos alterados na worktree, não aplicados ao projeto'
      : 'Arquivos alterados'
  const reference = `Referências: run=${input.runId}`
  const body = [
    `Pedido: ${input.request.trim().slice(0, REQUEST_LIMIT) || '(não informado)'}`,
    ...(subject ? [`Assunto: ${subject}`] : []),
    running
      ? RUNNING_RESULT_LINE
      : `Resultado: ${input.result.trim().slice(0, RESULT_LIMIT) || '(sem resumo)'}`,
    running ? RUNNING_STATUS_LINE : `Status: ${input.status}`,
    ...(decisions.length ? ['Decisões:', ...decisions.map((item) => `- ${item}`)] : []),
    ...(actions.length
      ? [`Ações pelo MCP (${actions.length}):`, ...actions.map((item) => `- ${item}`)]
      : []),
    ...(pending.length
      ? ['Pendências:', ...pending.map((item) => `- ${item} (não concluída nesta sessão)`)]
      : []),
    ...(!subject && !decisions.length && !actions.length
      ? [
          `Sem assunto, decisões ou ações registrados; consulte o histórico local da run ${input.runId}.`
        ]
      : []),
    `${filesLabel} (${input.changedFiles.length}):`,
    ...(files.length ? files : ['- nenhum detectado'])
  ]
    .join('\n')
    // The run reference is how the full record is found, so it survives the cut.
    .slice(0, BODY_LIMIT - reference.length - 1)
  const title = running
    ? `${RUNNING_TITLE_PREFIX}${subject ? `Sessão de terminal: ${subject}` : 'Sessão de terminal'}`
    : subject
      ? `Sessão de terminal: ${subject}`
      : 'Última sessão de terminal'
  const built = buildMemory(
    existing,
    {
      projectId: input.projectId,
      type: 'handoff',
      title: title.slice(0, TITLE_LIMIT),
      body: `${body}\n${reference}`,
      tags: ['handoff', 'terminal', running ? HANDOFF_RUNNING_TAG : input.status],
      source: 'modelo'
    },
    handoffId(input.projectId, input.runId),
    now
  )
  if ('error' in built) throw new Error(built.error)
  // buildMemory reactivates what it edits. A handoff the user archived stays
  // archived, and writing it still keeps it warm (access count untouched).
  return { ...built.memory, archivedAt: existing?.archivedAt ?? null, lastAccessedAt: now }
}
