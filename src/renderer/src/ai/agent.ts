import { TOOL_DEFS, runTool, isWriteTool, describeToolActivity, type ToolDef } from './tools'

// ---------------------------------------------------------------------------
// Agent — the tool-calling loop, proxied through the main process (ai:chat).
// Keeps the API key out of the renderer and avoids CORS on hosted providers.
// ---------------------------------------------------------------------------

/** AI provider config (base URL, key, model). */
export interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** A message on the wire — carries tool plumbing (tool_calls / tool_call_id). */
export interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

/** A pending write action awaiting the user's approval. */
export interface PendingCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/** Asks the user which write actions to approve; resolves with the approved ids. */
export type ApprovalRequest = (writes: PendingCall[]) => Promise<Set<string>>

export const SYSTEM_PROMPT =
  'Você é o assistente do Sagyou — um app pessoal de kanban, hábitos, metas e finanças. ' +
  'Ajude o usuário a discutir, resumir e organizar o trabalho dele. Você tem ferramentas para ' +
  'ler os dados do app: use-as quando precisar de informação concreta em vez de adivinhar. ' +
  'Se o projeto tiver pastas de código marcadas (veja "pastasAtivas" em ler_projetos), você ' +
  'pode investigar o código-fonte diretamente com listar_arquivos, ler_arquivo e ' +
  'buscar_no_codigo — use essas ferramentas para responder perguntas sobre o código (bugs, ' +
  'desempenho, estrutura) sem pedir o diretório ao usuário. Essas ferramentas cobrem todas as ' +
  'pastas marcadas de uma vez; passe "pastaId" só para restringir a uma delas. ' +
  'Só use rodar_agente_codigo quando for para IMPLEMENTAR/alterar código, não para apenas ' +
  'analisar — ele roda em uma pasta só, então informe "pastaId" se houver mais de uma. ' +
  'Responda sempre em português, de forma objetiva.'

/** Default safety cap on loop iterations, so a misbehaving model can't spin forever. */
export const MAX_STEPS = 6

export interface RunAgentOptions {
  /** Max loop iterations before forcing a final answer (default MAX_STEPS). */
  maxSteps?: number
  /** Checked between iterations; if it returns true, the loop stops early. */
  shouldAbort?: () => boolean
  /**
   * Called as the model types, with the accumulated text of the assistant
   * message currently being generated. Resets to '' at the start of each step,
   * so a step that only calls tools doesn't leave its text on screen.
   */
  onStream?: (text: string) => void
  /**
   * Called once per intermediate step with what the agent is doing: the model's
   * own remark on the way to a tool call ("vou verificar as tasks…"), then one
   * line per tool. Lets the caller keep a trace of the work in the transcript;
   * without it these steps are invisible and the text is discarded.
   */
  onStatus?: (text: string) => void
}

/**
 * One round-trip to the model, returning the full assistant message. Pass
 * onDelta to stream the text out chunk by chunk as it's generated; the resolved
 * message is the same either way.
 */
export async function callModel(
  cfg: AIConfig,
  messages: ApiMessage[],
  tools?: ToolDef[],
  onDelta?: (chunk: string) => void
): Promise<ApiMessage> {
  const request = {
    messages,
    tools,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model
  }
  const res = onDelta
    ? await window.electronAPI.ai.chatStream(request, onDelta)
    : await window.electronAPI.ai.chat(request)
  if (!res.success || !res.message) {
    throw new Error(res.error || 'Falha ao contatar o modelo')
  }
  return res.message as ApiMessage
}

/**
 * The tool-calling loop: call the model with tools; while it returns
 * tool_calls, run each against the store and feed the results back; stop when
 * it answers with plain text (or after MAX_STEPS as a safety cap).
 *
 * Read tools run automatically; write tools pause the loop for user approval
 * (onApprove) and only run if approved — denied ones report back to the model.
 */
export async function runAgent(
  cfg: AIConfig,
  conversation: ApiMessage[],
  onApprove: ApprovalRequest,
  opts: RunAgentOptions = {}
): Promise<string> {
  const maxSteps = opts.maxSteps ?? MAX_STEPS
  const msgs: ApiMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...conversation]
  const { onStream, onStatus } = opts

  for (let step = 0; step < maxSteps; step++) {
    if (opts.shouldAbort?.()) return 'Execução interrompida.'
    let buffer = ''
    onStream?.('')
    const assistant = await callModel(
      cfg,
      msgs,
      TOOL_DEFS,
      onStream &&
        ((chunk) => {
          buffer += chunk
          onStream(buffer)
        })
    )
    msgs.push(assistant)
    const calls = assistant.tool_calls
    if (!calls || calls.length === 0) return assistant.content ?? ''

    // This step calls tools, so its text is only a remark on the way to the
    // real answer ("deixa eu ver as tasks…"). Keep it as a status line — the
    // streamed copy is about to be cleared for the next step.
    const remark = assistant.content?.trim()
    if (remark) {
      onStatus?.(remark)
      // Hand off from the typing bubble to the status line now, not at the top
      // of the next step — the tools in between can take a while, and the text
      // would sit on screen twice.
      onStream?.('')
    }

    // Parse args once; a tool result must be returned for every tool_call.
    const parsed = calls.map((call) => {
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
        return { call, args: args as Record<string, unknown>, parseError: null as string | null }
      } catch {
        return { call, args: {} as Record<string, unknown>, parseError: 'Argumentos inválidos (JSON)' }
      }
    })

    // Gate write tools behind approval; reads run without asking.
    const writes = parsed
      .filter((p) => !p.parseError && isWriteTool(p.call.function.name))
      .map((p) => ({ id: p.call.id, name: p.call.function.name, args: p.args }))
    const approved = writes.length > 0 ? await onApprove(writes) : new Set<string>()

    for (const { call, args, parseError } of parsed) {
      let result: string
      if (parseError) {
        result = JSON.stringify({ error: parseError })
      } else if (isWriteTool(call.function.name) && !approved.has(call.id)) {
        result = JSON.stringify({ error: 'Ação recusada pelo usuário' })
      } else {
        onStatus?.(describeToolActivity(call.function.name, args))
        result = await runTool(call.function.name, args)
      }
      msgs.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  // Safety cap reached — force a final text answer with tools disabled.
  let buffer = ''
  onStream?.('')
  const final = await callModel(
    cfg,
    msgs,
    undefined,
    onStream &&
      ((chunk) => {
        buffer += chunk
        onStream(buffer)
      })
  )
  return final.content || 'Parei após várias etapas. Pode reformular o pedido?'
}
