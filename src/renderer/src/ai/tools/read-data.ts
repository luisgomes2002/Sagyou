import { useKanbanStore } from '../../store/kanban'
import { DEFAULT_FINANCIAL_PROFILE_ID } from '../../types'
import { fn, type AITool } from './helpers'

const AREAS = [
  'projetos',
  'tasks',
  'sprints',
  'notas',
  'metas',
  'habitos',
  'blocos',
  'rotinas',
  'arquivos',
  'cronometros',
  'perfil_financeiro',
  'tabelas_financeiras',
  'transacoes',
  'itens_compra',
  'metas_financeiras',
  'fontes_rendimento',
  'rendimentos'
] as const
type Area = (typeof AREAS)[number]
type Row = { id: string; value: Record<string, unknown>; projectId?: string; tableId?: string }

/** Read the persisted app model on demand. Lists stay small; an id returns the full record. */
export const readDataTool: AITool = {
  definition: fn(
    'ler_dados',
    'Consulta todas as áreas dos dados do Sagyou. Sem area, mostra o índice e totais. ' +
      'Com area, lista registros paginados; com area e id, retorna o registro completo, ' +
      'incluindo descrições, datas, vínculos e históricos. Para arquivos, use ler_documento ' +
      'para ler o conteúdo; para código fonte, use listar_arquivos/ler_arquivo/buscar_no_codigo. ' +
      'Dados financeiros ficam restritos ao perfil ativo. Verifique total e truncado antes de afirmar completude.',
    {
      type: 'object',
      properties: {
        area: {
          type: 'string',
          enum: [...AREAS],
          description: 'Área a consultar. Omita para ver o índice.'
        },
        id: {
          type: 'string',
          description: 'ID exato do registro para obter todos os seus campos.'
        },
        projetoId: {
          type: 'string',
          description: 'Filtra registros do projeto (quando aplicável).'
        },
        tabelaId: {
          type: 'string',
          description: 'Filtra registros de uma tabela do perfil financeiro ativo.'
        },
        inicio: { type: 'number', description: 'Índice inicial, padrão 0.' },
        limite: { type: 'number', description: 'Registros por página, padrão 20, máximo 50.' }
      },
      additionalProperties: false
    }
  ),
  run: (args) => {
    const state = useKanbanStore.getState()
    const profileId = state.activeFinancialProfileId || DEFAULT_FINANCIAL_PROFILE_ID
    const tables = state.lists.filter(
      (table) => (table.profileId ?? DEFAULT_FINANCIAL_PROFILE_ID) === profileId
    )
    const financial = (
      field: 'transactions' | 'items' | 'goals' | 'yieldSources' | 'yieldEntries'
    ): Row[] =>
      tables.flatMap((table) =>
        ((table[field] ?? []) as { id: string }[]).map((value) => ({
          id: value.id,
          tableId: table.id,
          value: value as Record<string, unknown>
        }))
      )
    const rows = (area: Area): Row[] => {
      switch (area) {
        case 'projetos':
          return state.projects.map((value) => ({
            id: value.id,
            projectId: value.id,
            value: { ...value }
          }))
        case 'tasks':
          return state.tasks.map((value) => ({
            id: value.id,
            projectId: value.projectId,
            value: {
              ...value,
              images: value.images?.map((image) => ({
                id: image.id,
                name: image.name,
                ext: image.ext,
                size: image.size,
                addedAt: image.addedAt
              }))
            }
          }))
        case 'sprints':
          return state.sprints.map((value) => ({
            id: value.id,
            projectId: value.projectId,
            value: { ...value }
          }))
        case 'notas':
          return state.notes.map((value) => ({
            id: value.id,
            projectId: value.projectId,
            value: { ...value }
          }))
        case 'metas':
          return state.goals.map((value) => ({
            id: value.id,
            projectId: value.projectId,
            value: { ...value }
          }))
        case 'habitos':
          return state.habits.map((value) => ({ id: value.id, value: { ...value } }))
        case 'blocos':
          return state.timeBlocks.map((value) => ({ id: value.id, value: { ...value } }))
        case 'rotinas':
          return state.routines.map((value) => ({ id: value.id, value: { ...value } }))
        case 'arquivos':
          return state.files.map((value) => ({
            id: value.id,
            projectId: value.projectId,
            value: { ...value, conteudo: 'Use ler_documento com este id.' }
          }))
        case 'cronometros':
          return state.activeTimers.map((value) => ({
            id: value.taskId,
            projectId: state.tasks.find((task) => task.id === value.taskId)?.projectId,
            value: { ...value }
          }))
        case 'perfil_financeiro':
          return state.financialProfiles
            .filter((value) => value.id === profileId)
            .map((value) => ({ id: value.id, value: { ...value } }))
        case 'tabelas_financeiras':
          return tables.map((value) => ({
            id: value.id,
            tableId: value.id,
            value: {
              ...value,
              items: undefined,
              transactions: undefined,
              goals: undefined,
              yieldSources: undefined,
              yieldEntries: undefined,
              totais: {
                transacoes: value.transactions.length,
                itensCompra: value.items.length,
                metas: value.goals.length,
                fontesRendimento: value.yieldSources?.length ?? 0,
                rendimentos: value.yieldEntries?.length ?? 0
              }
            }
          }))
        case 'transacoes':
          return financial('transactions')
        case 'itens_compra':
          return financial('items')
        case 'metas_financeiras':
          return financial('goals')
        case 'fontes_rendimento':
          return financial('yieldSources')
        case 'rendimentos':
          return financial('yieldEntries')
      }
    }
    const area = args.area
    if (area === undefined) {
      return JSON.stringify({
        areas: AREAS.map((name) => ({ area: name, total: rows(name).length })),
        perfilFinanceiroAtivo: profileId,
        dica: 'Chame ler_dados com area; use id para todos os campos de um registro. Listas são paginadas.'
      })
    }
    if (typeof area !== 'string' || !AREAS.includes(area as Area)) {
      return JSON.stringify({ error: 'Área inválida', areas: AREAS })
    }
    const projectId = typeof args.projetoId === 'string' ? args.projetoId : undefined
    const tableId = typeof args.tabelaId === 'string' ? args.tabelaId : undefined
    const matches = rows(area as Area).filter(
      (row) => (!projectId || row.projectId === projectId) && (!tableId || row.tableId === tableId)
    )
    if (typeof args.id === 'string') {
      const found = matches.find((row) => row.id === args.id)
      return JSON.stringify(
        found
          ? {
              area,
              id: found.id,
              projetoId: found.projectId,
              tabelaId: found.tableId,
              registro: found.value
            }
          : {
              error: 'Registro não encontrado neste escopo',
              area,
              id: args.id,
              perfilFinanceiroAtivo: profileId
            }
      )
    }
    const inicio =
      typeof args.inicio === 'number' && Number.isFinite(args.inicio)
        ? Math.max(0, Math.floor(args.inicio))
        : 0
    const limite =
      typeof args.limite === 'number' && Number.isFinite(args.limite)
        ? Math.max(1, Math.min(50, Math.floor(args.limite)))
        : 20
    const page = matches.slice(inicio, inicio + limite)
    return JSON.stringify({
      area,
      projetoId: projectId,
      tabelaId: tableId,
      perfilFinanceiroAtivo: profileId,
      total: matches.length,
      inicio,
      retornados: page.length,
      truncado: inicio + page.length < matches.length,
      proximoInicio: inicio + page.length < matches.length ? inicio + page.length : null,
      registros: page.map(({ id, projectId: pid, tableId: tid, value }) => {
        const label = value.name ?? value.title ?? value.description ?? value.content
        const name = typeof label === 'string' ? label : undefined
        return {
          id,
          projetoId: pid,
          tabelaId: tid,
          nome: name?.slice(0, 160),
          resumoTruncado: name !== undefined && name.length > 160,
          data: value.date ?? value.dueDate ?? value.createdAt,
          valor: value.amount ?? value.price ?? value.targetAmount,
          tipo: value.type,
          atualizadoEm: value.updatedAt
        }
      })
    })
  }
}
