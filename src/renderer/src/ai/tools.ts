import { useAiRunStore } from '../store/aiRun'
import { isWriteTool as isWriteFromRegistry } from './permission-registry'
import { validateToolInput } from './validators'
import { registryEntries } from './tools/entries'
import type { AITool, ToolDef } from './tools/helpers'

export type { ToolDef, AITool }
export { clearCodeSearchCache, codeSearchCache, CODE_SEARCH_TTL_MS, CODE_SEARCH_CACHE_MAX } from './tools/helpers'

// ---------------------------------------------------------------------------
// AI tool registry
//
// One place to declare the tools the assistant can call. Each entry pairs an
// OpenAI-format `definition` (sent to the model) with a `run` function executed
// against the Zustand store. Add a tool by adding one entry to REGISTRY — the
// definition list and the dispatcher are derived from it.
// ---------------------------------------------------------------------------


// --- Registry: name -> tool. This is the map the task asks for. ---
const REGISTRY: Record<string, AITool> = registryEntries

/** Tool definitions sent to the model each turn (derived from the registry). */
export const TOOL_DEFS: ToolDef[] = Object.values(REGISTRY).map((t) => t.definition)

/** Code-only tool subset — excludes kanban, finance, habits, and other non-code
 *  tools. Used by the code-focused chat so the model doesn't waste tokens on
 *  irrelevant tools and isn't distracted by data it shouldn't touch.
 *  The `run` handler still exists for all tools; this only filters what the
 *  model *offers* to call. */
const CODE_TOOL_NAMES = new Set([
  'ler_projetos',
  'listar_arquivos', 'ler_arquivo', 'buscar_no_codigo',
  'rodar_agente_codigo',
  'buscar_na_web',
  'buscar_memoria', 'salvar_memoria', 'buscar_conversas', 'ler_conversa', 'verificar_memorias',
  'ler_linhagem',
  'resolver_termo'
])
export const CODE_TOOL_DEFS: ToolDef[] = Object.values(REGISTRY)
  .filter((t) => CODE_TOOL_NAMES.has(t.definition.function.name))
  .map((t) => t.definition)

/** Kanban-only tool subset — excludes code-reading tools (listar_arquivos,
 *  ler_arquivo, buscar_no_codigo). The model can manage tasks, habits, finances,
 *  goals, notes, planner, and memory, but cannot read/write project source code.
 *  ~6.7k tokens instead of ~8.9k (saves ~2.2k per call). */
const KANBAN_TOOL_NAMES = new Set([
  'data_de_hoje',
  'ler_projetos',
  'ler_tasks', 'criar_tasks', 'atualizar_task', 'mover_task', 'concluir_task', 'deletar_task',
  'iniciar_cronometro',
  'ler_financeiro', 'criar_transacao',
  'ler_metas', 'criar_meta', 'atualizar_meta',
  'ler_habitos', 'marcar_habito',
  'ler_notas', 'criar_nota',
  'criar_projeto',
  'criar_sprints', 'atribuir_sprint',
  'ler_plano', 'criar_plano', 'atualizar_plano',
  'ler_documento',
  'buscar_memoria', 'salvar_memoria', 'buscar_conversas', 'ler_conversa', 'verificar_memorias',
  'ler_linhagem',
  'resolver_termo',
  'buscar_na_web',
  'rodar_agente_codigo'
])

export const KANBAN_TOOL_DEFS: ToolDef[] = Object.values(REGISTRY)
  .filter((t) => KANBAN_TOOL_NAMES.has(t.definition.function.name))
  .map((t) => t.definition)

/** Minimal tool set for a mechanical change to blocks already on the calendar. */
const PLANNER_EDIT_TOOL_NAMES = new Set([
  'data_de_hoje',
  'ler_plano',
  'atualizar_plano',
  'ajustar_bloco_e_deslocar_posteriores'
])
export const PLANNER_EDIT_TOOL_DEFS: ToolDef[] = Object.values(REGISTRY)
  .filter((t) => PLANNER_EDIT_TOOL_NAMES.has(t.definition.function.name))
  .map((t) => t.definition)

/**
 * Choose which tool set to send based on the user's message.
 *
 * A code question (code, arquivo, bug, refatorar, backup, etc.) gets only
 * CODE tools (~2.1k tokens instead of ~8.9k). A kanban/finance/habit
 * question gets only KANBAN tools (~6.7k). A mechanical calendar adjustment
 * gets the four planner-edit tools above. An ambiguous question gets all tools
 * as a safe fallback.
 *
 * The checklist is run once per run, from the first user message. A run that
 * starts in one domain and needs tools from the other must wait for the next
 * turn — the fallback covers exactly that case.
 */
export function routeTools(userText: string): ToolDef[] {
  const t = userText
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

  const codeWords = /\b(codigo|arquivo|funcao|bug|refator|implement|backup|back-end|backend|front-end|frontend|api|component|modulo|typescript|javascript|css|html|teste|typecheck|lint|build|deploy|git|commit|branch|merge|diff|log|compil|execut|script|roda|rode|rodar agente|agente de codigo|sandbox|electron|react|zustand|sqlite|ipc|handler|preload|renderer|main process)\w*/
  const plannerContextWords = /\b(plano|planej|agenda|bloco|rotina|horario|dia|atividad|trabalho)\w*/
  const plannerEditWords = /\b(ajust|atualiz|alter|mud|remarc|empurr|desloc|adiant|atras|estend|encurt|prolong|reduz|aument|diminu|termin)\w*/
  const kanbanWords = /\b(task|projeto|coluna|kanban|quadro|sprint|scrum|habito|meta|objetivo|financeiro|transacao|gasto|receita|despesa|orcamento|compras?|lista de compras|supermercado|nota|canvas|cronometro|timer|plano|planej|saldo|conta|fatura|boleto|pagar|pagamento|renda|ganhos?|gastos|economia|orçamento|dia|semana|mes\b|hoje|amanha|rotina|lembrete)\w*/

  if (codeWords.test(t)) return CODE_TOOL_DEFS
  if (plannerContextWords.test(t) && plannerEditWords.test(t)) return PLANNER_EDIT_TOOL_DEFS
  if (kanbanWords.test(t)) return KANBAN_TOOL_DEFS
  return TOOL_DEFS
}

/** Dispatch one tool call by name, returning a JSON string result. */
/**
 * The conversation the tool currently executing belongs to.
 *
 * A tool handler is module-global and shared across every run, so with several
 * runs in flight the store's on-screen `conversationId` is not the one that
 * asked. `runTool` sets this synchronously right before calling the handler, and
 * a handler that needs it (rodar_agente_codigo) reads it synchronously at the
 * top — before any await — so an interleaved run can't overwrite it first.
 */
let activeRunConvId: string | null = null
export function currentRunConvId(): string | null {
  return activeRunConvId
}

/**
 * Cooperative task lease for the multi-agent case: before a work tool mutates a
 * task, claim it for the running conversation. If another *active* run already
 * holds it, return a synthetic "someone else has this one" result — the model
 * reads it and moves on, exactly like the loop's other brakes, rather than two
 * agents duplicating the same task.
 *
 * A no-op outside a run (no owning convId — Gerar Tasks, tests): a single actor
 * needs no coordination. Returns the block message to return, or null to go on.
 */
export function leaseBlock(taskId: string): string | null {
  const convId = currentRunConvId()
  if (!convId) return null
  if (useAiRunStore.getState().acquireLease(taskId, convId)) return null
  return JSON.stringify({
    error:
      'Outra IA já está trabalhando nesta task agora. Escolha outra task e, se precisar, volte a esta mais tarde.',
    lease: 'ocupada'
  })
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  convId: string | null = null
): Promise<string> {
  const tool = REGISTRY[name]
  if (!tool) return JSON.stringify({ error: `Ferramenta desconhecida: ${name}` })
  activeRunConvId = convId
  try {
    const result = await tool.run(args)
    // Validate write-tool outputs: check args against expected shapes and
    // attach warnings to the result so the approval card can surface them.
    if (tool.write) {
      const v = validateToolInput(name, args)
      if (!v.valid || v.warnings.length > 0) {
        const parsed = JSON.parse(result)
        parsed._validation = { valid: v.valid, errors: v.errors, warnings: v.warnings }
        return JSON.stringify(parsed)
      }
    }
    return result
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : 'Falha na ferramenta' })
  }
}

/** Whether a tool mutates state (used to gate it behind user approval). */
export function isWriteTool(name: string): boolean {
  return isWriteFromRegistry(name) || REGISTRY[name]?.write === true
}

/**
 * What the assistant is doing right now, in the present tense — shown as a
 * status line in the transcript while the agent works. Unlike describeToolCall
 * (write actions only), this covers every tool, including the read ones.
 */
export function describeToolActivity(name: string, args: Record<string, unknown>): string {
  const str = (v: unknown): string => (typeof v === 'string' && v.trim() !== '' ? v : '')
  // `args` may legitimately be EMPTY: this also labels a tool call the model is
  // still composing, whose name arrives a beat before its arguments. So every
  // case must degrade to the generic verb rather than invent the detail — a
  // guessed number or type reads as fact and is worse than saying less. The
  // same restraint covers a model that sends malformed args at execution time.
  const n = (v: unknown): number | null => (Array.isArray(v) ? v.length : null)
  switch (name) {
    case 'data_de_hoje':
      return 'Verificando a data de hoje'
    case 'ler_projetos':
      return 'Consultando os projetos'
    case 'ler_tasks':
      return 'Consultando as tasks'
    case 'ler_financeiro':
      return 'Consultando o financeiro'
    case 'ler_metas':
      return 'Consultando as metas'
    case 'ler_habitos':
      return 'Consultando os hábitos'
    case 'listar_arquivos': {
      const sub = str(args.subpasta)
      return sub ? `Listando os arquivos em ${sub}` : 'Listando os arquivos do projeto'
    }
    case 'ler_arquivo': {
      const caminho = str(args.caminho)
      const simbolo = str(args.simbolo)
      if (caminho && simbolo) return `Lendo ${simbolo} em ${caminho}`
      return caminho ? `Lendo ${caminho}` : 'Lendo um arquivo'
    }
    case 'buscar_no_codigo': {
      const termo = str(args.termo)
      return termo ? `Buscando "${termo}" no código` : 'Buscando no código'
    }
    case 'buscar_na_web': {
      const url = str(args.url)
      return url ? `Lendo ${url}` : 'Lendo uma página web'
    }
    case 'buscar_memoria': {
      const termo = str(args.termo)
      return termo ? `Buscando "${termo}" na memória` : 'Consultando a memória'
    }
    case 'buscar_conversas': {
      const termo = str(args.termo)
      return termo ? `Buscando "${termo}" nas conversas` : 'Buscando nas conversas'
    }
    case 'ler_conversa':
      return 'Lendo uma conversa anterior'
    case 'verificar_memorias':
      return 'Verificando contradições na memória'
    case 'ler_linhagem':
      return 'Consultando o histórico da entidade'
    case 'resolver_termo':
      return `Consultando o glossário: "${str(args.termo) || '?'}"`
    case 'criar_projeto': {
      const nome = str(args.nome)
      return nome ? `Criando o projeto ${nome}` : 'Criando um projeto'
    }
    case 'criar_tasks': {
      // Never "Criando 0 task(s)": with no args yet that is simply false, and
      // it is the label shown while a big criar_tasks writes its arguments.
      const count = n(args.tasks)
      return count === null ? 'Criando tasks' : `Criando ${count} task(s)`
    }
    case 'atualizar_task': {
      const alvo = str(args.titulo) || str(args.taskId)
      return alvo ? `Atualizando a task ${alvo}` : 'Atualizando uma task'
    }
    case 'mover_task':
      return `Movendo ${str(args.titulo) || str(args.taskId) || 'a task'} para ${
        str(args.coluna) || 'outra coluna'
      }`
    case 'concluir_task': {
      const alvo = str(args.titulo) || str(args.taskId)
      return alvo ? `Concluindo a task ${alvo}` : 'Concluindo uma task'
    }
    case 'deletar_task': {
      const alvo = str(args.titulo) || str(args.taskId)
      return alvo ? `Deletando a task ${alvo}` : 'Deletando uma task'
    }
    case 'iniciar_cronometro': {
      const alvo = str(args.titulo) || str(args.taskId)
      return alvo ? `Iniciando o cronômetro em ${alvo}` : 'Iniciando o cronômetro'
    }
    case 'marcar_habito': {
      const alvo = str(args.nome) || str(args.habitoId)
      return alvo ? `Marcando o hábito ${alvo} como feito` : 'Marcando um hábito como feito'
    }
    case 'ler_notas':
      return 'Consultando as notas do canvas'
    case 'criar_nota':
      return `Criando uma nota no canvas`
    case 'salvar_memoria': {
      const titulo = str(args.titulo)
      return titulo ? `Salvando na memória: ${titulo}` : 'Salvando na memória'
    }
    case 'criar_transacao': {
      // Defaulting the type to 'despesa' would announce the wrong direction for
      // money before the model has said which it is.
      const tipo = args.tipo === 'receita' ? 'receita' : args.tipo === 'despesa' ? 'despesa' : ''
      if (!tipo || args.valor === undefined) return 'Lançando uma transação'
      return `Lançando ${tipo} de ${args.valor}`
    }
    case 'criar_meta': {
      const titulo = str(args.titulo)
      return titulo ? `Criando a meta ${titulo}` : 'Criando uma meta'
    }
    case 'atualizar_meta': {
      const alvo = str(args.titulo) || str(args.metaId)
      return alvo ? `Atualizando a meta ${alvo}` : 'Atualizando uma meta'
    }
    case 'criar_sprints': {
      const nomes = Array.isArray(args.nomes) ? args.nomes.join(', ') : ''
      return nomes ? `Criando sprints: ${nomes}` : 'Criando sprints'
    }
    case 'atribuir_sprint': {
      const sprint = str(args.sprint)
      return sprint ? `Atribuindo a sprint "${sprint}"` : 'Atribuindo uma sprint'
    }
    case 'rodar_agente_codigo':
      return 'Rodando o agente de código'
    case 'ler_plano': {
      const data = str(args.data)
      return data ? `Consultando o plano de ${data}` : 'Consultando o plano'
    }
    case 'criar_plano': {
      const count = n(args.blocos)
      return count === null ? 'Criando blocos no plano' : `Criando ${count} bloco(s) no plano`
    }
    case 'atualizar_plano':
      return 'Atualizando o plano'
    case 'ajustar_bloco_e_deslocar_posteriores':
      return 'Ajustando um bloco e deslocando os posteriores'
    case 'ler_documento': {
      const fileId = str(args.fileId)
      return fileId ? `Lendo o documento ${fileId}` : 'Lendo um documento do projeto'
    }
    default:
      return name
  }
}

/** Human-readable summary of a write action, shown in the approval card. */
export function describeToolCall(name: string, args: Record<string, unknown>): string {
  const alvo = (args.titulo ?? args.taskId ?? '?') as string
  switch (name) {
    // Worth spelling out: this also switches the active project.
    case 'criar_projeto':
      return `Criar projeto "${args.nome ?? '?'}" (passa a ser o projeto ativo)`
    case 'criar_tasks':
      return `Criar ${Array.isArray(args.tasks) ? args.tasks.length : 0} task(s)`
    // Spell out each field: approving "atualizar_task" without seeing that it
    // wipes the tags is not a real approval.
    case 'atualizar_task': {
      const blank = (v: unknown): boolean => typeof v === 'string' && v.trim() === ''
      const campos: string[] = []
      if (args.prioridade !== undefined) campos.push(`prioridade → ${args.prioridade}`)
      if (args.descricao !== undefined) {
        campos.push(blank(args.descricao) ? 'apagar a descrição' : 'nova descrição')
      }
      if (args.dueDate !== undefined) {
        campos.push(blank(args.dueDate) ? 'remover o prazo' : `prazo → ${args.dueDate}`)
      }
      if (args.tags !== undefined) {
        const tags = Array.isArray(args.tags) ? args.tags : []
        campos.push(tags.length > 0 ? `tags → ${tags.join(', ')}` : 'apagar as tags')
      }
      return `Atualizar task ${alvo}: ${campos.join('; ') || '(nada)'}`
    }
    case 'mover_task':
      return `Mover task ${alvo} para a coluna "${args.coluna ?? '?'}"`
    case 'concluir_task':
      return `Concluir task: ${alvo}`
    // Unlike the rest, this one can't be undone — flag it like the code agent.
    case 'deletar_task':
      return `⚠️ Deletar task PERMANENTEMENTE: ${alvo}`
    case 'iniciar_cronometro':
      return `Iniciar cronômetro: ${alvo}`
    case 'marcar_habito':
      return `Marcar hábito ${args.nome ?? args.habitoId ?? '?'} como feito hoje`
    case 'ler_notas':
      return 'Ler notas do canvas'
    case 'criar_nota': {
      const texto = String(args.conteudo ?? '')
      return `Criar nota: "${texto.length > 60 ? `${texto.slice(0, 60)}…` : texto}"`
    }
    case 'salvar_memoria': {
      const titulo = String(args.titulo ?? '')
      const escopo = args.global === true ? 'global' : 'projeto'
      const t = titulo.length > 60 ? `${titulo.slice(0, 60)}…` : titulo
      return `Salvar memória (${escopo}, ${args.tipo ?? 'fato'}): "${t}"`
    }
    // Money: the amount and where it lands have to be on the card itself.
    case 'criar_transacao': {
      const tipo = args.tipo === 'receita' ? 'Receita' : 'Despesa'
      const extra = [
        args.categoria ? `categoria ${args.categoria}` : '',
        args.data ? `em ${args.data}` : 'hoje',
        args.tabela ? `tabela ${args.tabela}` : ''
      ].filter(Boolean)
      return `${tipo} de ${args.valor ?? '?'} — "${args.descricao ?? ''}" (${extra.join(', ')})`
    }
    case 'criar_meta':
      return `Criar meta "${args.titulo ?? '?'}": alvo ${args.alvo ?? '?'} ${args.unidade ?? ''}`.trim()
    case 'atualizar_meta': {
      const campos: string[] = []
      if (args.novoTitulo !== undefined) campos.push(`nome → ${args.novoTitulo}`)
      if (args.alvo !== undefined) campos.push(`alvo → ${args.alvo}`)
      if (args.unidade !== undefined) campos.push(`unidade → ${args.unidade || '(vazia)'}`)
      if (args.cor !== undefined) campos.push('nova cor')
      if (args.projectId !== undefined) {
        campos.push(
          String(args.projectId).trim() === '' ? 'desvincular do projeto' : 'novo projeto'
        )
      }
      const alvoMeta = (args.titulo ?? args.metaId ?? '?') as string
      return `Atualizar meta ${alvoMeta}: ${campos.join('; ') || '(nada)'}`
    }
    case 'criar_sprints':
      return `Criar sprints: ${Array.isArray(args.nomes) ? args.nomes.join(', ') : ''}`
    case 'atribuir_sprint':
      return `Atribuir sprint "${args.sprint ?? '?'}" à task ${alvo}`
    case 'ajustar_bloco_e_deslocar_posteriores': {
      const bloco = args.titulo ?? args.blocoId ?? '?'
      return `Ajustar "${bloco}" para terminar às ${args.novoFim ?? '?'} e deslocar os blocos posteriores`
    }
    case 'rodar_agente_codigo':
      return `⚠️ Rodar agente de código no projeto: ${args.task ?? ''}`
    default:
      return name
  }
}
