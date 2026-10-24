import { buildMemory, handoffId, type AiMemory } from '../ai/memory'

export interface TerminalHandoffInput {
  projectId: string | null
  conversationId: string | null
  runId: string
  request: string
  status: 'completed' | 'cancelled' | 'failed' | 'not_applied'
  result: string
  changedFiles: string[]
}

const REQUEST_LIMIT = 900
const RESULT_LIMIT = 700
const FILE_LIMIT = 20
const BODY_LIMIT = 2_400

/** A small, deterministic breadcrumb; full terminal output remains in its run archive. */
export function buildTerminalHandoff(input: TerminalHandoffInput, now: string): AiMemory {
  const files = input.changedFiles.slice(0, FILE_LIMIT).map((file) => `- ${file.slice(0, 180)}`)
  const body = [
    `Pedido: ${input.request.trim().slice(0, REQUEST_LIMIT) || '(não informado)'}`,
    `Resultado: ${input.result.trim().slice(0, RESULT_LIMIT) || '(sem resumo)'}`,
    `Status: ${input.status}`,
    `Arquivos alterados (${input.changedFiles.length}):`,
    ...(files.length ? files : ['- nenhum detectado']),
    `Referências: conversa=${input.conversationId ?? 'nenhuma'}; run=${input.runId}`
  ]
    .join('\n')
    .slice(0, BODY_LIMIT)
  const built = buildMemory(
    null,
    {
      projectId: input.projectId,
      type: 'handoff',
      title: 'Última sessão de terminal',
      body,
      tags: ['handoff', 'terminal', input.status],
      source: 'modelo',
      sourceConversationId: input.conversationId
    },
    handoffId(input.projectId),
    now
  )
  if ('error' in built) throw new Error(built.error)
  return built.memory
}
