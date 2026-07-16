import { useKanbanStore } from '../store/kanban'
import { D } from '../components/financial/shared'
import { computeHabitSummary } from '../utils/habits'
import { isDoneColumn } from '../utils/columns'
import type { AITaskInput, Task } from '../types'

// ---------------------------------------------------------------------------
// AI tool registry
//
// One place to declare the tools the assistant can call. Each entry pairs an
// OpenAI-format `definition` (sent to the model) with a `run` function executed
// against the Zustand store. Add a tool by adding one entry to REGISTRY — the
// definition list and the dispatcher are derived from it.
// ---------------------------------------------------------------------------

/** An OpenAI-format function/tool definition. */
export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** A tool = its OpenAI definition + the handler that runs it against the store. */
interface AITool {
  definition: ToolDef
  /** Whether the tool mutates state — used to gate it behind user approval. */
  write?: boolean
  /** Runs the tool, returning a JSON string result fed back to the model. */
  run: (args: Record<string, unknown>) => string | Promise<string>
}

/** Build a function tool definition. */
function fn(name: string, description: string, parameters: Record<string, unknown>): ToolDef {
  return { type: 'function', function: { name, description, parameters } }
}

const NO_PARAMS = { type: 'object', properties: {}, additionalProperties: false }

/** Find a task by taskId, else by exact title within the (active) project. */
function resolveTask(args: Record<string, unknown>): Task | undefined {
  const state = useKanbanStore.getState()
  if (typeof args.taskId === 'string') {
    const byId = state.tasks.find((t) => t.id === args.taskId)
    if (byId) return byId
  }
  if (typeof args.titulo === 'string') {
    const projectId =
      (typeof args.projectId === 'string' && args.projectId) || state.activeProjectId
    const title = args.titulo.toLowerCase()
    return state.tasks.find((t) => t.projectId === projectId && t.title.toLowerCase() === title)
  }
  return undefined
}

/** Resolve the active code path of the (active) project, or an error. */
function activeCodePath(args: Record<string, unknown>): { path?: string; error?: string } {
  const { projects, activeProjectId } = useKanbanStore.getState()
  const projectId = (typeof args.projectId === 'string' && args.projectId) || activeProjectId
  const project = projects.find((p) => p.id === projectId)
  if (!project) return { error: 'Projeto não encontrado' }
  const path = project.codePaths?.find((c) => c.id === project.activeCodePathId)?.path
  if (!path) return { error: 'Nenhum path de código selecionado neste projeto' }
  return { path }
}

// --- Registry: name -> tool. This is the map the task asks for. ---
const REGISTRY: Record<string, AITool> = {
  ler_projetos: {
    definition: fn(
      'ler_projetos',
      'Lista os projetos do usuário com suas colunas e o total de tasks.',
      NO_PARAMS
    ),
    run: () => {
      const { projects, tasks } = useKanbanStore.getState()
      const projetos = projects.map((p) => ({
        id: p.id,
        nome: p.name,
        colunas: [...p.columns].sort((a, b) => a.order - b.order).map((c) => c.name),
        totalTasks: tasks.filter((t) => t.projectId === p.id).length,
        pathAtivo: p.codePaths?.find((c) => c.id === p.activeCodePathId)?.path ?? null
      }))
      return JSON.stringify({ projetos })
    }
  },

  ler_tasks: {
    definition: fn(
      'ler_tasks',
      'Lista as tasks de um projeto (título, coluna, prioridade, tags, se concluída). ' +
        'Sem projectId, usa o projeto ativo.',
      {
        type: 'object',
        properties: { projectId: { type: 'string', description: 'ID do projeto (opcional)' } },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const { projects, tasks, activeProjectId } = useKanbanStore.getState()
      const projectId = (typeof args.projectId === 'string' && args.projectId) || activeProjectId
      const project = projects.find((p) => p.id === projectId)
      if (!project) return JSON.stringify({ error: 'Projeto não encontrado' })
      const colName = (id: string): string => project.columns.find((c) => c.id === id)?.name ?? '?'
      const list = tasks
        .filter((t) => t.projectId === project.id)
        .map((t) => ({
          id: t.id,
          titulo: t.title,
          coluna: colName(t.columnId),
          prioridade: t.priority,
          tags: t.tags,
          concluida: !!t.completedAt
        }))
      return JSON.stringify({ projeto: project.name, tasks: list })
    }
  },

  ler_financeiro: {
    definition: fn(
      'ler_financeiro',
      'Resumo financeiro por tabela: totais de receitas/despesas/saldo, gastos por categoria, ' +
        'metas financeiras e uma amostra das transações. Filtra por período (de/ate, YYYY-MM-DD) ' +
        'e por tabela. Sem período, considera tudo.',
      {
        type: 'object',
        properties: {
          tabela: { type: 'string', description: 'Nome ou ID da tabela financeira (opcional)' },
          de: { type: 'string', description: 'Data inicial YYYY-MM-DD (opcional)' },
          ate: { type: 'string', description: 'Data final YYYY-MM-DD (opcional)' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const { lists } = useKanbanStore.getState()
      const filtro = typeof args.tabela === 'string' ? args.tabela.toLowerCase() : null
      const de = typeof args.de === 'string' ? args.de : null
      const ate = typeof args.ate === 'string' ? args.ate : null
      const inPeriod = (date: string): boolean => (!de || date >= de) && (!ate || date <= ate)

      const tabelas = lists
        .filter((l) => !filtro || l.name.toLowerCase() === filtro || l.id === args.tabela)
        .map((l) => {
          const txs = l.transactions.filter((t) => inPeriod(t.date))
          let receitas = D(0)
          let despesas = D(0)
          const porCategoria: Record<string, { receita: string; despesa: string }> = {}
          for (const t of txs) {
            const amount = D(t.amount)
            if (t.type === 'income') receitas = receitas.plus(amount)
            else despesas = despesas.plus(amount)
            const cat = t.category || 'sem categoria'
            const acc = porCategoria[cat] ?? { receita: '0', despesa: '0' }
            if (t.type === 'income') acc.receita = D(acc.receita).plus(amount).toString()
            else acc.despesa = D(acc.despesa).plus(amount).toString()
            porCategoria[cat] = acc
          }
          const amostra = [...txs]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 15)
            .map((t) => ({
              data: t.date,
              descricao: t.description,
              tipo: t.type === 'income' ? 'receita' : 'despesa',
              valor: t.amount,
              categoria: t.category
            }))
          return {
            nome: l.name,
            moeda: l.currency,
            receitas: receitas.toString(),
            despesas: despesas.toString(),
            saldo: receitas.minus(despesas).toString(),
            qtdTransacoes: txs.length,
            porCategoria,
            metasFinanceiras: l.goals.map((g) => ({
              nome: g.name,
              alvo: g.targetAmount,
              mes: g.targetMonth,
              ano: g.targetYear,
              concluida: !!g.completedAt
            })),
            amostraTransacoes: amostra,
            truncado: txs.length > amostra.length
          }
        })
      return JSON.stringify({ periodo: { de, ate }, tabelas })
    }
  },

  ler_metas: {
    definition: fn(
      'ler_metas',
      'Lista as metas de progresso: título, unidade, alvo, valor atual, progresso (%) e ' +
        'quantas entradas tem.',
      NO_PARAMS
    ),
    run: () => {
      const { goals } = useKanbanStore.getState()
      const metas = goals.map((g) => {
        const atual = g.entries.reduce((sum, e) => sum + (e.value || 0), 0)
        const ultima = g.entries.reduce((max, e) => (e.date > max ? e.date : max), '')
        return {
          titulo: g.title,
          unidade: g.unit,
          alvo: g.target,
          atual,
          progresso: g.target > 0 ? Math.round((atual / g.target) * 100) : 0,
          qtdEntradas: g.entries.length,
          ultimaEntrada: ultima || null,
          projetoId: g.projectId ?? null
        }
      })
      return JSON.stringify({ metas })
    }
  },

  ler_habitos: {
    definition: fn(
      'ler_habitos',
      'Resumo dos hábitos: sequência atual (streak), feitos no mês, taxa do mês (%) e se foi ' +
        'feito hoje.',
      NO_PARAMS
    ),
    run: () => {
      const { habits } = useKanbanStore.getState()
      const today = new Date()
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const resumo = computeHabitSummary(habits, today).map((h) => ({
        nome: h.habit.name,
        streak: h.streak,
        feitosNoMes: h.monthDone,
        taxaMes: h.rate,
        feitoHoje: h.habit.completions.includes(todayStr),
        totalConclusoes: h.habit.completions.length
      }))
      return JSON.stringify({ habitos: resumo })
    }
  },

  criar_tasks: {
    write: true,
    definition: fn(
      'criar_tasks',
      'Cria uma ou mais tasks no projeto (mesma estrutura do import). Sem projectId, usa o ativo.',
      {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'ID do projeto (opcional)' },
          tasks: {
            type: 'array',
            description: 'Lista de tasks a criar',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
                dueDate: { type: 'string', description: 'YYYY-MM-DD' },
                tags: { type: 'array', items: { type: 'string' } },
                column: { type: 'string', description: 'Nome exato da coluna' },
                sprint: { type: 'string', description: 'Nome exato da sprint' }
              },
              required: ['title'],
              additionalProperties: false
            }
          }
        },
        required: ['tasks'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const projectId =
        (typeof args.projectId === 'string' && args.projectId) || state.activeProjectId
      if (!projectId) return JSON.stringify({ error: 'Nenhum projeto ativo' })
      if (!Array.isArray(args.tasks) || args.tasks.length === 0) {
        return JSON.stringify({ error: 'Nenhuma task informada' })
      }
      const count = state.importTasksFromAIChat(projectId, args.tasks as AITaskInput[])
      return JSON.stringify({ criadas: count })
    }
  },

  concluir_task: {
    write: true,
    definition: fn(
      'concluir_task',
      'Move a task para a coluna Done (conclui a task e pausa o cronômetro dela). ' +
        'Identifique por taskId ou titulo.',
      {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID da task' },
          titulo: { type: 'string', description: 'Título exato da task' },
          projectId: { type: 'string', description: 'ID do projeto (opcional)' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const task = resolveTask(args)
      if (!task) return JSON.stringify({ error: 'Task não encontrada' })
      const project = state.projects.find((p) => p.id === task.projectId)
      const doneCol = project?.columns.find(isDoneColumn)
      if (!doneCol) return JSON.stringify({ error: 'Coluna "Done" não encontrada no projeto' })
      const index = state.tasks.filter((t) => t.columnId === doneCol.id).length
      state.moveTask(task.id, doneCol.id, index)
      return JSON.stringify({ ok: true, task: task.title, coluna: doneCol.name })
    }
  },

  iniciar_cronometro: {
    write: true,
    definition: fn(
      'iniciar_cronometro',
      'Inicia o cronômetro de uma task para registrar o tempo gasto (pausa sozinho ao concluir). ' +
        'Identifique por taskId ou titulo.',
      {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID da task' },
          titulo: { type: 'string', description: 'Título exato da task' },
          projectId: { type: 'string', description: 'ID do projeto (opcional)' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const task = resolveTask(args)
      if (!task) return JSON.stringify({ error: 'Task não encontrada' })
      state.startTimer(task.id)
      return JSON.stringify({ ok: true, task: task.title })
    }
  },

  criar_sprints: {
    write: true,
    definition: fn('criar_sprints', 'Cria uma ou mais sprints no projeto. Sem projectId, usa o ativo.', {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'ID do projeto (opcional)' },
        nomes: { type: 'array', items: { type: 'string' }, description: 'Nomes das sprints' }
      },
      required: ['nomes'],
      additionalProperties: false
    }),
    run: (args) => {
      const state = useKanbanStore.getState()
      const projectId =
        (typeof args.projectId === 'string' && args.projectId) || state.activeProjectId
      if (!projectId) return JSON.stringify({ error: 'Nenhum projeto ativo' })
      const nomes = Array.isArray(args.nomes)
        ? args.nomes.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
        : []
      if (nomes.length === 0) return JSON.stringify({ error: 'Nenhum nome de sprint informado' })
      state.createSprints(projectId, nomes)
      return JSON.stringify({ criadas: nomes })
    }
  },

  atribuir_sprint: {
    write: true,
    definition: fn(
      'atribuir_sprint',
      'Atribui uma sprint (por nome) a uma task. A sprint precisa já existir no projeto ' +
        '(use criar_sprints antes). Identifique a task por taskId ou titulo.',
      {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID da task' },
          titulo: { type: 'string', description: 'Título exato da task' },
          sprint: { type: 'string', description: 'Nome exato da sprint' },
          projectId: { type: 'string', description: 'ID do projeto (opcional)' }
        },
        required: ['sprint'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const task = resolveTask(args)
      if (!task) return JSON.stringify({ error: 'Task não encontrada' })
      const sprintName = typeof args.sprint === 'string' ? args.sprint.toLowerCase() : ''
      const projectSprints = state.sprints.filter((s) => s.projectId === task.projectId)
      const sprint = projectSprints.find((s) => s.name.toLowerCase() === sprintName)
      if (!sprint) {
        return JSON.stringify({
          error: 'Sprint não encontrada',
          disponiveis: projectSprints.map((s) => s.name)
        })
      }
      state.updateTask(task.id, { sprintId: sprint.id })
      return JSON.stringify({ ok: true, task: task.title, sprint: sprint.name })
    }
  },

  rodar_agente_codigo: {
    write: true,
    definition: fn(
      'rodar_agente_codigo',
      'Dispara um agente de código externo (Aider/Codex) no diretório do projeto para ' +
        'implementar uma tarefa de código. Requer um path de código selecionado no projeto. ' +
        'O agente escreve arquivos e roda comandos, por isso passa por aprovação.',
      {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'O que o agente deve fazer no código' },
          agent: { type: 'string', enum: ['aider', 'codex'], description: 'Agente (padrão: aider)' },
          projectId: { type: 'string', description: 'ID do projeto (opcional; usa o ativo)' }
        },
        required: ['task'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const { projects, activeProjectId } = useKanbanStore.getState()
      const projectId = (typeof args.projectId === 'string' && args.projectId) || activeProjectId
      const project = projects.find((p) => p.id === projectId)
      if (!project) return JSON.stringify({ error: 'Projeto não encontrado' })
      const path = project.codePaths?.find((c) => c.id === project.activeCodePathId)?.path
      if (!path) {
        return JSON.stringify({ error: 'Nenhum path de código selecionado neste projeto' })
      }
      const task = typeof args.task === 'string' ? args.task.trim() : ''
      if (!task) return JSON.stringify({ error: 'Tarefa vazia' })
      const agent = args.agent === 'codex' ? 'codex' : 'aider'
      // Fire-and-forget; the real outcome streams to the UI panel. Report the
      // request honestly — do NOT claim guaranteed success.
      void window.electronAPI.ai.codeAgent.run({ path, task, agent })
      return JSON.stringify({
        status: 'solicitado',
        agente: agent,
        diretorio: path,
        aviso:
          'Pedido enviado. Não afirme sucesso: acompanhe o painel de saída. Se o agente não ' +
          'estiver instalado, aparecerá um erro lá.'
      })
    }
  },

  listar_arquivos: {
    definition: fn(
      'listar_arquivos',
      'Lista os arquivos do código do projeto (recursivo; ignora node_modules/.git/dist). ' +
        'Use para descobrir a estrutura antes de ler arquivos. Requer path de código no projeto.',
      {
        type: 'object',
        properties: {
          subpasta: { type: 'string', description: 'Subpasta relativa (opcional, ex: src/renderer)' },
          projectId: { type: 'string', description: 'ID do projeto (opcional; usa o ativo)' }
        },
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const { path, error } = activeCodePath(args)
      if (!path) return JSON.stringify({ error })
      const sub = typeof args.subpasta === 'string' ? args.subpasta : '.'
      return JSON.stringify(await window.electronAPI.ai.code.list(path, sub))
    }
  },

  ler_arquivo: {
    definition: fn(
      'ler_arquivo',
      'Lê um arquivo do código do projeto pelo caminho relativo (ex: src/main/store.ts).',
      {
        type: 'object',
        properties: {
          caminho: { type: 'string', description: 'Caminho relativo do arquivo' },
          projectId: { type: 'string', description: 'ID do projeto (opcional; usa o ativo)' }
        },
        required: ['caminho'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const { path, error } = activeCodePath(args)
      if (!path) return JSON.stringify({ error })
      const rel = typeof args.caminho === 'string' ? args.caminho : ''
      if (!rel) return JSON.stringify({ error: 'Caminho vazio' })
      return JSON.stringify(await window.electronAPI.ai.code.read(path, rel))
    }
  },

  buscar_no_codigo: {
    definition: fn(
      'buscar_no_codigo',
      'Busca um termo/texto no código do projeto (grep). Retorna arquivos e linhas que casam.',
      {
        type: 'object',
        properties: {
          termo: { type: 'string', description: 'Texto a buscar' },
          projectId: { type: 'string', description: 'ID do projeto (opcional; usa o ativo)' }
        },
        required: ['termo'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const { path, error } = activeCodePath(args)
      if (!path) return JSON.stringify({ error })
      const termo = typeof args.termo === 'string' ? args.termo : ''
      if (!termo) return JSON.stringify({ error: 'Termo vazio' })
      return JSON.stringify(await window.electronAPI.ai.code.search(path, termo))
    }
  }
}

/** Tool definitions sent to the model each turn (derived from the registry). */
export const TOOL_DEFS: ToolDef[] = Object.values(REGISTRY).map((t) => t.definition)

/** Dispatch one tool call by name, returning a JSON string result. */
export async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = REGISTRY[name]
  if (!tool) return JSON.stringify({ error: `Ferramenta desconhecida: ${name}` })
  try {
    return await tool.run(args)
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : 'Falha na ferramenta' })
  }
}

/** Whether a tool mutates state (used to gate it behind user approval). */
export function isWriteTool(name: string): boolean {
  return REGISTRY[name]?.write === true
}

/**
 * What the assistant is doing right now, in the present tense — shown as a
 * status line in the transcript while the agent works. Unlike describeToolCall
 * (write actions only), this covers every tool, including the read ones.
 */
export function describeToolActivity(name: string, args: Record<string, unknown>): string {
  const str = (v: unknown): string => (typeof v === 'string' && v.trim() !== '' ? v : '')
  switch (name) {
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
      return caminho ? `Lendo ${caminho}` : 'Lendo um arquivo'
    }
    case 'buscar_no_codigo': {
      const termo = str(args.termo)
      return termo ? `Buscando "${termo}" no código` : 'Buscando no código'
    }
    case 'criar_tasks':
      return `Criando ${Array.isArray(args.tasks) ? args.tasks.length : 0} task(s)`
    case 'concluir_task':
      return `Concluindo a task ${str(args.titulo) || str(args.taskId) || '?'}`
    case 'iniciar_cronometro':
      return `Iniciando o cronômetro em ${str(args.titulo) || str(args.taskId) || '?'}`
    case 'criar_sprints':
      return `Criando sprints: ${Array.isArray(args.nomes) ? args.nomes.join(', ') : ''}`
    case 'atribuir_sprint':
      return `Atribuindo a sprint "${str(args.sprint) || '?'}"`
    case 'rodar_agente_codigo':
      return `Rodando o agente de código (${str(args.agent) || 'aider'})`
    default:
      return name
  }
}

/** Human-readable summary of a write action, shown in the approval card. */
export function describeToolCall(name: string, args: Record<string, unknown>): string {
  const alvo = (args.titulo ?? args.taskId ?? '?') as string
  switch (name) {
    case 'criar_tasks':
      return `Criar ${Array.isArray(args.tasks) ? args.tasks.length : 0} task(s)`
    case 'concluir_task':
      return `Concluir task: ${alvo}`
    case 'iniciar_cronometro':
      return `Iniciar cronômetro: ${alvo}`
    case 'criar_sprints':
      return `Criar sprints: ${Array.isArray(args.nomes) ? args.nomes.join(', ') : ''}`
    case 'atribuir_sprint':
      return `Atribuir sprint "${args.sprint ?? '?'}" à task ${alvo}`
    case 'rodar_agente_codigo':
      return `⚠️ Rodar agente de código (${args.agent ?? 'aider'}) no projeto: ${args.task ?? ''}`
    default:
      return name
  }
}
