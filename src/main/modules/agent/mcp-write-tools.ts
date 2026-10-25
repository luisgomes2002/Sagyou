import type { McpWriteOutcome } from './mcp-write-queue'
import {
  MCP_MEMORY_WRITE_TOOLS,
  MCP_RENDERER_WRITE_TOOLS,
  type McpActionResult,
  type McpWriteTool
} from './mcp-write-types'

export interface McpToolDefinition {
  name: McpWriteTool
  description: string
  inputSchema: Record<string, unknown>
}

const text = (description: string): Record<string, unknown> => ({ type: 'string', description })
const projectId = text('ID do projeto (list_projects); omita para o projeto da sessão.')
const taskRef = {
  id: text('ID exato da tarefa (preferido).'),
  title: text('Título exato da tarefa, se não tiver o ID.')
}
const goalRef = {
  id: text('ID exato da meta (preferido).'),
  title: text('Título exato da meta, se não tiver o ID.')
}
const tags = { type: 'array', items: { type: 'string' }, description: 'Substitui a lista.' }
const priority = { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }
const transactionType = { type: 'string', enum: ['receita', 'despesa'] }
const amount = {
  type: ['string', 'number'],
  description: 'Valor positivo, sem separador de milhar (ex.: "1500.50" ou "1500,50").'
}
const date = text('Data YYYY-MM-DD; omita para hoje.')
const memoryType = {
  type: 'string',
  enum: ['decisao', 'tradeoff', 'gotcha', 'fato', 'planejamento']
}

function tool(
  name: McpWriteTool,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = []
): McpToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false
    }
  }
}

const APPROVAL_NOTE = ' Exige aprovação no Sagyou.'

export const MCP_WRITE_TOOLS: McpToolDefinition[] = [
  tool(
    'create_project',
    'Cria um projeto com as colunas padrão. Nome repetido devolve o projeto existente.',
    { name: text('Nome do projeto.'), description: text('Descrição.'), color: text('Cor hex.') },
    ['name']
  ),
  tool(
    'update_project',
    'Edita nome, descrição, cor ou links de um projeto. links substitui a lista inteira.',
    {
      projectId,
      name: text('Novo nome.'),
      description: text('Nova descrição; "" limpa.'),
      color: text('Cor hex.'),
      links: {
        type: 'array',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, url: { type: 'string' } },
          required: ['url'],
          additionalProperties: false
        }
      }
    }
  ),
  tool('archive_project', 'Arquiva um projeto.' + APPROVAL_NOTE, { projectId }),
  tool('unarchive_project', 'Desarquiva um projeto.', { projectId }),
  tool('delete_project', 'Exclui um projeto e suas tarefas, como o botão do app.' + APPROVAL_NOTE, {
    projectId
  }),
  tool(
    'create_column',
    'Cria uma coluna no fim do board do projeto.',
    { projectId, name: text('Nome da coluna.'), color: text('Cor hex.') },
    ['name']
  ),
  tool(
    'update_column',
    'Renomeia ou muda a cor de uma coluna.',
    {
      projectId,
      column: text('ID ou nome da coluna.'),
      name: text('Novo nome.'),
      color: text('Cor hex.')
    },
    ['column']
  ),
  tool(
    'reorder_columns',
    'Reordena as colunas; columnIds precisa listar todas, uma vez cada.',
    { projectId, columnIds: { type: 'array', items: { type: 'string' } } },
    ['columnIds']
  ),
  tool(
    'delete_column',
    'Exclui uma coluna vazia.' + APPROVAL_NOTE,
    { projectId, column: text('ID ou nome da coluna.') },
    ['column']
  ),
  tool('update_task', 'Edita só os campos enviados de uma tarefa; "" ou [] limpam.', {
    projectId,
    ...taskRef,
    newTitle: text('Novo título.'),
    description: text('Nova descrição; "" limpa.'),
    dueDate: text('Prazo YYYY-MM-DD; "" limpa.'),
    priority,
    tags
  }),
  tool(
    'move_task',
    'Move uma tarefa para outra coluna, inclusive de outro projeto (projectId destino).',
    {
      ...taskRef,
      projectId: text('Projeto de destino; omita para manter o projeto da tarefa.'),
      fromProjectId: text('Projeto onde procurar a tarefa por título; omita para o da sessão.'),
      column: text('ID ou nome da coluna no projeto de destino.')
    }
  ),
  tool('complete_task', 'Conclui uma tarefa movendo-a para a coluna Done.', {
    projectId,
    ...taskRef
  }),
  tool('reopen_task', 'Reabre uma tarefa concluída na primeira coluna aberta.', {
    projectId,
    ...taskRef
  }),
  tool('delete_task', 'Exclui uma tarefa definitivamente.' + APPROVAL_NOTE, {
    projectId,
    ...taskRef
  }),
  tool(
    'create_goal',
    'Cria uma meta de quantidade ou de conclusão única.',
    {
      projectId: text('Projeto da meta; omita para uma meta sem projeto.'),
      title: text('Título.'),
      target: { type: 'number', description: 'Alvo > 0 (ignorado em kind completion).' },
      unit: text('Unidade.'),
      kind: { type: 'string', enum: ['quantity', 'completion'] },
      color: text('Cor hex.')
    },
    ['title']
  ),
  tool('update_goal', 'Edita uma meta.', {
    ...goalRef,
    newTitle: text('Novo título.'),
    target: { type: 'number' },
    unit: text('Unidade.'),
    color: text('Cor hex.'),
    projectId: text('Novo projeto da meta.')
  }),
  tool('add_goal_progress', 'Registra progresso numa meta; numa meta de conclusão, conclui.', {
    ...goalRef,
    value: { type: 'number', description: 'Incremento > 0 (metas de quantidade).' },
    date,
    label: text('Observação.')
  }),
  tool('delete_goal', 'Exclui uma meta.' + APPROVAL_NOTE, goalRef),
  tool(
    'create_note',
    'Cria uma nota no canvas do projeto, numa posição livre.',
    { projectId, content: text('Texto da nota.'), color: text('Cor hex.') },
    ['content']
  ),
  tool(
    'update_note',
    'Edita o texto ou a cor de uma nota.',
    { id: text('ID da nota.'), content: text('Novo texto.'), color: text('Cor hex.') },
    ['id']
  ),
  tool('delete_note', 'Exclui uma nota.' + APPROVAL_NOTE, { id: text('ID da nota.') }, ['id']),
  tool(
    'create_transaction',
    'Lança uma transação numa tabela do perfil financeiro da sessão.' + APPROVAL_NOTE,
    {
      tableId: text('ID da tabela (read_financial_data).'),
      type: transactionType,
      amount,
      description: text('Descrição.'),
      date,
      category: text('Categoria.')
    },
    ['tableId', 'type', 'amount', 'description']
  ),
  tool(
    'update_transaction',
    'Edita uma transação; a auditoria registra a mudança.' + APPROVAL_NOTE,
    {
      tableId: text('ID da tabela.'),
      id: text('ID da transação.'),
      type: transactionType,
      amount,
      description: text('Descrição.'),
      date: text('Data YYYY-MM-DD.'),
      category: text('Categoria; "" limpa.')
    },
    ['tableId', 'id']
  ),
  tool(
    'delete_transaction',
    'Exclui uma transação.' + APPROVAL_NOTE,
    { tableId: text('ID da tabela.'), id: text('ID da transação.') },
    ['tableId', 'id']
  ),
  tool(
    'create_financial_table',
    'Cria uma tabela financeira no perfil da sessão.' + APPROVAL_NOTE,
    { name: text('Nome da tabela.'), currency: { type: 'string', enum: ['BRL', 'USD', 'JPY'] } },
    ['name', 'currency']
  ),
  tool(
    'add_financial_category',
    'Adiciona uma categoria personalizada ao perfil da sessão.',
    { category: text('Categoria.') },
    ['category']
  ),
  tool(
    'remove_financial_category',
    'Remove uma categoria sugerida do perfil; transações antigas mantêm a categoria.' +
      APPROVAL_NOTE,
    { category: text('Categoria.') },
    ['category']
  ),
  tool(
    'create_financial_profile',
    'Cria um perfil financeiro. A sessão continua escrevendo só no perfil atual.' + APPROVAL_NOTE,
    { name: text('Nome do perfil.') },
    ['name']
  ),
  tool(
    'rename_financial_profile',
    'Renomeia o perfil financeiro da sessão.' + APPROVAL_NOTE,
    { name: text('Novo nome.') },
    ['name']
  ),
  tool(
    'update_memory',
    'Edita uma memória ativa. Segredos são removidos; memórias de handoff não podem ser editadas.',
    {
      id: text('ID exato da memória.'),
      title: text('Novo título.'),
      body: text('Novo corpo.'),
      tags: { type: 'array', items: { type: 'string' } },
      type: memoryType
    },
    ['id']
  ),
  tool('archive_memory', 'Arquiva uma memória (reversível).', { id: text('ID da memória.') }, [
    'id'
  ]),
  tool('unarchive_memory', 'Restaura uma memória arquivada.', { id: text('ID da memória.') }, [
    'id'
  ]),
  tool(
    'delete_memory',
    'Exclui uma memória definitivamente.' + APPROVAL_NOTE,
    {
      id: text('ID da memória.')
    },
    ['id']
  ),
  tool(
    'resolve_memory_conflict',
    'Resolve uma contradição de check_memories arquivando um lado; body atualiza o que fica.',
    {
      keepId: text('ID da memória que fica.'),
      archiveId: text('ID da memória arquivada.'),
      body: text('Corpo atualizado da memória que fica.')
    },
    ['keepId', 'archiveId']
  )
]

export const MCP_WRITE_TOOL_NAMES: readonly McpWriteTool[] = [
  ...MCP_RENDERER_WRITE_TOOLS,
  ...MCP_MEMORY_WRITE_TOOLS
]

/** Decided by name alone, never by arguments: a risky tool always shows the card. */
export const MCP_APPROVAL_REQUIRED: ReadonlySet<string> = new Set<McpWriteTool>([
  'archive_project',
  'delete_project',
  'delete_column',
  'delete_task',
  'delete_goal',
  'delete_note',
  'create_transaction',
  'update_transaction',
  'delete_transaction',
  'create_financial_table',
  'remove_financial_category',
  'create_financial_profile',
  'rename_financial_profile',
  'delete_memory'
])

export const MCP_NO_APPROVAL: ReadonlySet<string> = new Set<McpWriteTool>([
  'create_project',
  'update_project',
  'unarchive_project',
  'create_column',
  'update_column',
  'reorder_columns',
  'update_task',
  'move_task',
  'complete_task',
  'reopen_task',
  'create_goal',
  'update_goal',
  'add_goal_progress',
  'create_note',
  'update_note',
  'add_financial_category',
  'update_memory',
  'archive_memory',
  'unarchive_memory',
  'resolve_memory_conflict'
])

export const MCP_MEMORY_TOOLS: ReadonlySet<string> = new Set<string>(MCP_MEMORY_WRITE_TOOLS)

/** Full sentence per approval tool, so the noun's gender agrees. */
export const MCP_DENIAL_MESSAGE: Record<string, string> = {
  archive_project: 'Arquivamento não aprovado pelo usuário.',
  delete_project: 'Exclusão não aprovada pelo usuário.',
  delete_column: 'Exclusão não aprovada pelo usuário.',
  delete_task: 'Exclusão não aprovada pelo usuário.',
  delete_goal: 'Exclusão não aprovada pelo usuário.',
  delete_note: 'Exclusão não aprovada pelo usuário.',
  create_transaction: 'Lançamento não aprovado pelo usuário.',
  update_transaction: 'Edição não aprovada pelo usuário.',
  delete_transaction: 'Exclusão não aprovada pelo usuário.',
  create_financial_table: 'Criação não aprovada pelo usuário.',
  remove_financial_category: 'Exclusão não aprovada pelo usuário.',
  create_financial_profile: 'Criação não aprovada pelo usuário.',
  rename_financial_profile: 'Edição não aprovada pelo usuário.',
  delete_memory: 'Exclusão não aprovada pelo usuário.'
}

export const MCP_RUN_ENDED = 'A execução MCP foi encerrada.'

/** Turns a queue outcome into the tool's reply; every refusal is an `ok: false` result. */
export function mcpWriteResult(
  name: string,
  outcome: McpWriteOutcome<McpActionResult>
): McpActionResult {
  if (outcome.ended) return { ok: false, error: MCP_RUN_ENDED }
  if (outcome.refused && outcome.value) return outcome.value
  if (!outcome.approved)
    return { ok: false, error: MCP_DENIAL_MESSAGE[name] ?? 'Escrita não aprovada pelo usuário.' }
  return outcome.value ?? { ok: false, error: 'A escrita MCP não devolveu resultado.' }
}
