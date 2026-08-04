import {
  fn,
  NO_PARAMS,
  resolveTask,
  resolveTaskForDelete,
  clampLimit,
  resolveTaskState,
  normalize,
  isCalendarDate,
  toTarget,
  resolveGoal,
  resolveHabit,
  parseMoney,
  resolveList,
  freeNoteSpot,
  activeRoots,
  codeSearchKey,
  clearCodeSearchCache,
  DEFAULT_TASK_LIMIT,
  OTHER_PROJECTS_MAX,
  CODE_SEARCH_TTL_MS,
  CODE_SEARCH_CACHE_MAX,
  codeSearchCache,
  PRIORITIES,
  PASTA_PARAM,
  type AITool
} from './helpers'
import Decimal from 'decimal.js'
import { leaseBlock, currentRunConvId } from '../tools'

import { useKanbanStore } from '../../store/kanban'
import { D, FINANCIAL_CATEGORIES } from '../../components/financial/shared'
import { computeHabitSummary, todayISO } from '../../utils/habits'
import { isDoneColumn } from '../../utils/columns'
import { PROJECT_COLORS, NOTE_COLORS } from '../../types'
import type { AITaskInput, Priority, Habit } from '../../types'
import glossaryRaw from '../glossary.json'

export const registryEntries: Record<string, AITool> = {
  data_de_hoje: {
    definition: fn(
      'data_de_hoje',
      'Retorna a data e hora atual no fuso de Brasília (America/Sao_Paulo). ' +
        '⚠️ Use esta ferramenta ANTES de qualquer operação que envolva datas — NUNCA adivinhe o dia de hoje. ' +
        'O retorno inclui o dia da semana por extenso (segunda-feira, etc.) e a data em YYYY-MM-DD.',
      NO_PARAMS
    ),
    run: () => {
      const now = new Date()
      const dias = [
        'domingo',
        'segunda-feira',
        'terça-feira',
        'quarta-feira',
        'quinta-feira',
        'sexta-feira',
        'sábado'
      ]
      const pad = (n: number) => String(n).padStart(2, '0')
      const data = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const hora = `${pad(now.getHours())}:${pad(now.getMinutes())}`
      return JSON.stringify({
        dia_semana: dias[now.getDay()],
        data,
        hora,
        fuso: 'America/Sao_Paulo (UTC-3)',
        iso: now.toISOString()
      })
    }
  },

  ler_projetos: {
    definition: fn(
      'ler_projetos',
      'Lista os projetos do usuário com suas colunas e o total de tasks.',
      NO_PARAMS
    ),
    run: () => {
      const { projects: allProjects, tasks } = useKanbanStore.getState()
      const projects = allProjects.filter((p) => !p.archivedAt)
      const projetos = projects.map((p) => ({
        id: p.id,
        nome: p.name,
        colunas: [...p.columns].sort((a, b) => a.order - b.order).map((c) => c.name),
        totalTasks: tasks.filter((t) => t.projectId === p.id).length,
        // The code roots the tools may reach into (several can be selected).
        pastasAtivas: (p.codePaths ?? [])
          .filter((c) => (p.activeCodePathIds ?? []).includes(c.id))
          .map((c) => ({ id: c.id, nome: c.label ?? c.path, path: c.path }))
      }))
      return JSON.stringify({ projetos })
    }
  },

  ler_tasks: {
    definition: fn(
      'ler_tasks',
      'Lista as tasks do projeto: título, coluna, prioridade, tags. ' +
        'Apenas ABERTAS por padrão — use estado="concluidas" ou "todas" quando precisar. ' +
        'Filtre com busca/tag/coluna/prioridade/sprint/prazo para economizar tokens.',
      {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'ID do projeto' },
          projeto: { type: 'string', description: 'Nome do projeto (alternativa ao projectId)' },
          busca: { type: 'string', description: 'Busca por título' },
          tag: { type: 'string', description: 'Filtra por tag' },
          coluna: { type: 'string', description: 'Filtra por nome da coluna' },
          estado: {
            type: 'string',
            enum: ['abertas', 'concluidas', 'todas'],
            description: 'abertas (padrão), concluidas ou todas'
          },
          prioridade: {
            type: 'string',
            enum: [...PRIORITIES],
            description: 'low, medium, high, urgent'
          },
          sprint: { type: 'string', description: 'Nome da sprint' },
          prazo_de: { type: 'string', description: 'YYYY-MM-DD' },
          prazo_ate: { type: 'string', description: 'YYYY-MM-DD' },
          criada_de: { type: 'string', description: 'YYYY-MM-DD' },
          criada_ate: { type: 'string', description: 'YYYY-MM-DD' },
          sem_sprint: { type: 'boolean', description: 'Só tasks sem sprint' },
          limit: {
            type: 'number',
            description: `Máx. tasks (padrão ${DEFAULT_TASK_LIMIT})`
          }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const { projects: allProjects, tasks, sprints, activeProjectId } = useKanbanStore.getState()
      const projects = allProjects.filter((p) => !p.archivedAt)
      const projetoNome = typeof args.projeto === 'string' ? args.projeto.trim() : ''
      const byName = projetoNome
        ? projects.find((p) => p.name.trim().toLowerCase() === projetoNome.toLowerCase())?.id
        : undefined
      const projectId =
        (typeof args.projectId === 'string' && args.projectId) || byName || activeProjectId
      const project = projects.find((p) => p.id === projectId)
      if (!project) return JSON.stringify({ error: 'Projeto não encontrado' })
      const colName = (id: string): string => project.columns.find((c) => c.id === id)?.name ?? '?'

      const busca = typeof args.busca === 'string' ? normalize(args.busca.trim()) : ''
      const tag = typeof args.tag === 'string' ? normalize(args.tag.trim()) : ''
      const coluna = typeof args.coluna === 'string' ? normalize(args.coluna.trim()) : ''
      const prioridade =
        typeof args.prioridade === 'string' ? args.prioridade.trim().toLowerCase() : ''
      const estado = resolveTaskState(args)
      const sprintNome = typeof args.sprint === 'string' ? args.sprint.trim() : ''
      const projectSprints = sprintNome ? sprints.filter((s) => s.projectId === project.id) : []
      const sprintId = sprintNome
        ? projectSprints.find((s) => s.name.trim().toLowerCase() === sprintNome.toLowerCase())?.id
        : undefined
      const prazoDe = typeof args.prazo_de === 'string' ? args.prazo_de.trim() : ''
      const prazoAte = typeof args.prazo_ate === 'string' ? args.prazo_ate.trim() : ''
      const criadaDe = typeof args.criada_de === 'string' ? args.criada_de.trim() : ''
      const criadaAte = typeof args.criada_ate === 'string' ? args.criada_ate.trim() : ''
      const semSprint = args.sem_sprint === true

      // Everything the question matched, *before* the state filter. This is what
      // makes `concluidas_ocultas` truthful: the model has to be able to tell
      // "3 abertas" from "3 tasks", or it answers the wrong board size with
      // total confidence — the same failure `total`/`truncado` guard against.
      const subject = tasks.filter((t) => {
        if (t.projectId !== project.id) return false
        if (busca && !normalize(t.title).includes(busca)) return false
        if (tag && !t.tags.some((x) => normalize(x) === tag)) return false
        if (coluna && normalize(colName(t.columnId)) !== coluna) return false
        if (prioridade && t.priority !== prioridade) return false
        if (sprintId && t.sprintId !== sprintId) return false
        if (semSprint && t.sprintId) return false
        if (prazoDe && (!t.dueDate || t.dueDate < prazoDe)) return false
        if (prazoAte && (!t.dueDate || t.dueDate > prazoAte)) return false
        if (criadaDe && t.createdAt.slice(0, 10) < criadaDe) return false
        if (criadaAte && t.createdAt.slice(0, 10) > criadaAte) return false
        return true
      })

      const matched =
        estado === 'todas'
          ? subject
          : subject.filter((t) => !!t.completedAt === (estado === 'concluidas'))

      // ⚠️ The scope is ONE project — args.projectId, or the active one. When
      // nothing here matched the question at all, the likeliest explanation is
      // that it lives in another project, and staying quiet makes the model
      // answer "essa task não existe" about a task that does. Same class of
      // silent lie as `concluidas_ocultas`, different axis.
      //
      // Only on an empty subject: when something matched, the other projects
      // are noise that every later step of the run would pay for again. Ids and
      // names rather than a bare count, so the model can retry immediately
      // instead of spending a paid step on `ler_projetos` to learn them.
      const others = projects.filter((p) => p.id !== project.id)

      // Bounded by default. The cap sits above any real project here, so today
      // it changes nothing — it's there so a project that grows to thousands
      // can't put its whole board in the prompt, resent on every later step.
      const limit = clampLimit(args.limit)
      const list = matched.slice(0, limit).map((t) => ({
        id: t.id,
        titulo: t.title,
        coluna: colName(t.columnId),
        prioridade: t.priority,
        tags: t.tags,
        concluida: !!t.completedAt
      }))
      return JSON.stringify({
        projeto: project.name,
        // Stated back, not assumed: the model asked for nothing and got a
        // filtered view, so the reply has to say which view it is.
        estado,
        // `total` vs the array's length is how the model knows it's seeing a
        // slice — without it, a truncated list reads as the whole board and it
        // would answer "you have 50 tasks" when there are 300.
        total: matched.length,
        truncado: matched.length > list.length,
        // How many the *state* filter dropped, on top of `truncado`'s slicing.
        // Without this the default view is a silent lie about the board's size.
        concluidas_ocultas: subject.length - matched.length,
        tasks: list,
        ...(subject.length === 0 &&
          others.length > 0 && {
            outros_projetos: others.slice(0, OTHER_PROJECTS_MAX).map((p) => ({
              id: p.id,
              nome: p.name
            }))
          })
      })
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
          tabela: { type: 'string', description: 'Nome ou ID da tabela financeira' },
          de: { type: 'string', description: 'Data inicial YYYY-MM-DD' },
          ate: { type: 'string', description: 'Data final YYYY-MM-DD' }
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
          const linkedIds = new Set(
            l.transactions.filter((t) => t.linkedTransactionId).map((t) => t.linkedTransactionId!)
          )
          const txs = l.transactions.filter((t) => inPeriod(t.date) && !linkedIds.has(t.id))
          let receitas = D(0)
          let despesas = D(0)
          const porCategoria: Record<string, { receita: string; despesa: string }> = {}
          const addCategory = (
            type: 'income' | 'expense',
            category: string | undefined,
            amount: Decimal
          ) => {
            if (amount.lessThanOrEqualTo(0)) return
            const cat = category || 'sem categoria'
            const acc = porCategoria[cat] ?? { receita: '0', despesa: '0' }
            if (type === 'income') acc.receita = D(acc.receita).plus(amount).toString()
            else acc.despesa = D(acc.despesa).plus(amount).toString()
            porCategoria[cat] = acc
          }
          for (const t of txs) {
            const amount = D(t.amount)
            if (t.type === 'income') receitas = receitas.plus(amount)
            else despesas = despesas.plus(amount)
            let remaining = amount
            for (const detail of t.details ?? []) {
              if (remaining.lessThanOrEqualTo(0)) break
              const requested = D(detail.amount)
              if (requested.lessThanOrEqualTo(0)) continue
              const allocated = requested.lessThan(remaining) ? requested : remaining
              addCategory(t.type, detail.category, allocated)
              remaining = remaining.minus(allocated)
            }
            addCategory(t.type, t.category, remaining)
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
          // Without the id, atualizar_meta can only be aimed by title — which
          // is exactly what fails when two goals share one.
          id: g.id,
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
      const todayStr = todayISO(today)
      const resumo = computeHabitSummary(habits, today).map((h) => ({
        // marcar_habito can only be aimed reliably with the id.
        id: h.habit.id,
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

  criar_projeto: {
    write: true,
    definition: fn(
      'criar_projeto',
      'Cria um projeto com colunas padrao (Backlog, In Progress, Review, Done). O projeto criado vira o ativo. Se ja existir com esse nome, devolve o existente.',
      {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome do projeto' },
          descricao: { type: 'string', description: 'Descrição do projeto' },
          cor: {
            type: 'string',
            enum: [...PROJECT_COLORS],
            description: 'Cor do projeto'
          }
        },
        required: ['nome'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      // createProject stores the name as given, so trim here or the project is
      // named "  Site  " forever.
      const nome = typeof args.nome === 'string' ? args.nome.trim() : ''
      if (!nome) return JSON.stringify({ error: 'Informe o nome do projeto' })

      // Creating a twin is worse than failing: it also steals activeProjectId,
      // so the tasks that follow would land in the empty copy.
      const existing = state.projects.find(
        (p) => p.name.trim().toLowerCase() === nome.toLowerCase()
      )
      if (existing) {
        return JSON.stringify({
          error: `Já existe um projeto chamado "${existing.name}"`,
          projectId: existing.id
        })
      }

      let cor: string | undefined
      if (args.cor !== undefined) {
        if (
          typeof args.cor !== 'string' ||
          !(PROJECT_COLORS as readonly string[]).includes(args.cor)
        ) {
          return JSON.stringify({ error: 'Cor inválida', disponiveis: PROJECT_COLORS })
        }
        cor = args.cor
      }

      let descricao: string | undefined
      if (args.descricao !== undefined) {
        if (typeof args.descricao !== 'string') {
          return JSON.stringify({ error: 'descricao deve ser texto' })
        }
        descricao = args.descricao.trim() || undefined
      }

      const projectId = state.createProject(nome, descricao, cor)
      const created = useKanbanStore.getState().projects.find((p) => p.id === projectId)
      return JSON.stringify({
        ok: true,
        projectId,
        nome,
        colunas: [...(created?.columns ?? [])].sort((a, b) => a.order - b.order).map((c) => c.name),
        // Say it outright: the model's next criar_tasks without projectId lands here.
        ativo: true
      })
    }
  },

  criar_tasks: {
    write: true,
    definition: fn(
      'criar_tasks',
      'Cria uma ou mais tasks no projeto. Sem projectId, usa o ativo.',
      {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'ID do projeto' },
          tasks: {
            type: 'array',
            description: 'Tasks a criar',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
                dueDate: { type: 'string', description: 'YYYY-MM-DD' },
                tags: { type: 'array', items: { type: 'string' } },
                column: { type: 'string', description: 'Nome da coluna' },
                sprint: { type: 'string', description: 'Nome da sprint' }
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

  atualizar_task: {
    write: true,
    definition: fn(
      'atualizar_task',
      'Edita prioridade, descrição, tags ou prazo de uma task. Só altera os campos ' +
        'enviados. "" (descricao/dueDate) ou [] (tags) limpam o campo. ' +
        'Identifique por taskId ou titulo.',
      {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID da task' },
          titulo: { type: 'string', description: 'Título exato da task' },
          projectId: { type: 'string', description: 'ID do projeto' },
          prioridade: { type: 'string', enum: PRIORITIES },
          descricao: { type: 'string', description: 'Nova descrição; "" apaga' },
          dueDate: { type: 'string', description: 'YYYY-MM-DD; "" remove o prazo' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Substitui a lista de tags; [] limpa'
          }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const task = resolveTask(args)
      if (!task) return JSON.stringify({ error: 'Task não encontrada' })
      const busy = leaseBlock(task.id)
      if (busy) return busy

      // Only the keys actually present may end up in `updates` — updateTask
      // spreads it over the task, so an undefined value clears the field rather
      // than leaving it alone.
      const updates: Parameters<typeof state.updateTask>[1] = {}

      if (args.prioridade !== undefined) {
        if (!PRIORITIES.includes(args.prioridade as Priority)) {
          return JSON.stringify({
            error: `Prioridade inválida. Use uma de: ${PRIORITIES.join(', ')}.`
          })
        }
        updates.priority = args.prioridade as Priority
      }

      if (args.descricao !== undefined) {
        if (typeof args.descricao !== 'string') {
          return JSON.stringify({ error: 'descricao deve ser texto' })
        }
        updates.description = args.descricao.trim() || undefined
      }

      if (args.dueDate !== undefined) {
        if (typeof args.dueDate !== 'string') {
          return JSON.stringify({ error: 'dueDate deve ser texto' })
        }
        const due = args.dueDate.trim()
        if (due === '') updates.dueDate = undefined
        else if (!isCalendarDate(due)) {
          return JSON.stringify({ error: 'dueDate deve ser uma data real no formato YYYY-MM-DD' })
        } else updates.dueDate = due
      }

      if (args.tags !== undefined) {
        if (!Array.isArray(args.tags) || args.tags.some((t) => typeof t !== 'string')) {
          return JSON.stringify({ error: 'tags deve ser uma lista de textos' })
        }
        updates.tags = (args.tags as string[]).map((t) => t.trim()).filter(Boolean)
      }

      const changed = Object.keys(updates)
      if (changed.length === 0) {
        return JSON.stringify({
          error: 'Nenhum campo informado. Mande prioridade, descricao, dueDate ou tags.'
        })
      }
      state.updateTask(task.id, updates)
      return JSON.stringify({ ok: true, task: task.title, atualizados: changed })
    }
  },

  mover_task: {
    write: true,
    definition: fn(
      'mover_task',
      'Move uma task para outra coluna. Coluna Done = conclui; sair de Done = reabre. ' +
        'Identifique por taskId (prefira) ou titulo.',
      {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID da task' },
          titulo: { type: 'string', description: 'Título exato da task' },
          coluna: { type: 'string', description: 'Nome exato da coluna de destino' },
          projectId: { type: 'string', description: 'ID do projeto' }
        },
        required: ['coluna'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const task = resolveTask(args)
      if (!task) return JSON.stringify({ error: 'Task não encontrada' })
      const busy = leaseBlock(task.id)
      if (busy) return busy
      const project = state.projects.find((p) => p.id === task.projectId)
      if (!project) return JSON.stringify({ error: 'Projeto da task não encontrado' })

      // Resolve against the task's own project, never args.projectId: moveTask
      // looks the column up under task.projectId, so a column from elsewhere
      // would leave the task pointing at an id its board can't render.
      const name = typeof args.coluna === 'string' ? args.coluna.trim().toLowerCase() : ''
      const col = project.columns.find((c) => c.name.toLowerCase() === name)
      if (!col) {
        return JSON.stringify({
          error: 'Coluna não encontrada no projeto da task',
          disponiveis: project.columns.map((c) => c.name)
        })
      }

      const from = project.columns.find((c) => c.id === task.columnId)
      if (col.id === task.columnId) {
        // Re-inserting would reshuffle the column for no reason.
        return JSON.stringify({ ok: true, task: task.title, coluna: col.name, semMudanca: true })
      }

      const index = state.tasks.filter(
        (t) => t.projectId === task.projectId && t.columnId === col.id && t.id !== task.id
      ).length
      state.moveTask(task.id, col.id, index)

      // Crossing the Done boundary silently completes or reopens the task; say so
      // rather than letting the model report a plain move.
      const wasDone = isDoneColumn(from)
      const nowDone = isDoneColumn(col)
      return JSON.stringify({
        ok: true,
        task: task.title,
        de: from?.name,
        para: col.name,
        ...(nowDone && !wasDone && { concluida: true }),
        ...(wasDone && !nowDone && { reaberta: true })
      })
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
          projectId: { type: 'string', description: 'ID do projeto' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const task = resolveTask(args)
      if (!task) return JSON.stringify({ error: 'Task não encontrada' })
      const busy = leaseBlock(task.id)
      if (busy) return busy
      const project = state.projects.find((p) => p.id === task.projectId)
      const doneCol = project?.columns.find(isDoneColumn)
      if (!doneCol) return JSON.stringify({ error: 'Coluna "Done" não encontrada no projeto' })
      const index = state.tasks.filter((t) => t.columnId === doneCol.id).length
      state.moveTask(task.id, doneCol.id, index)
      return JSON.stringify({ ok: true, task: task.title, coluna: doneCol.name })
    }
  },

  deletar_task: {
    write: true,
    definition: fn(
      'deletar_task',
      'Apaga uma task PERMANENTEMENTE (não dá para desfazer). Use só para tasks duplicadas ou ' +
        'irrelevantes, quando o usuário pedir para remover — para uma task que foi finalizada, ' +
        'use concluir_task. Apaga uma task por chamada: para várias, faça uma chamada para cada ' +
        'uma. Identifique por taskId ou titulo; se o título se repetir, a chamada falha e devolve ' +
        'os ids para você escolher.',
      {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'ID da task' },
          titulo: { type: 'string', description: 'Título exato da task' },
          projectId: { type: 'string', description: 'ID do projeto' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const resolved = resolveTaskForDelete(args)
      if ('error' in resolved) return JSON.stringify(resolved)
      const { task } = resolved
      useKanbanStore.getState().deleteTask(task.id)
      return JSON.stringify({ ok: true, deletada: task.title, taskId: task.id })
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
          projectId: { type: 'string', description: 'ID do projeto' }
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
    definition: fn(
      'criar_sprints',
      'Cria uma ou mais sprints no projeto. Sem projectId, usa o ativo.',
      {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'ID do projeto' },
          nomes: { type: 'array', items: { type: 'string' }, description: 'Nomes das sprints' }
        },
        required: ['nomes'],
        additionalProperties: false
      }
    ),
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
          projectId: { type: 'string', description: 'ID do projeto' }
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

  criar_meta: {
    write: true,
    definition: fn(
      'criar_meta',
      'Cria uma meta de progresso (ex.: "Correr", alvo 100, unidade "km"). A meta nasce sem ' +
        'nenhuma entrada, ou seja, com progresso zero — esta ferramenta não registra progresso. ' +
        'Opcionalmente vincule a meta a um projeto com projectId.',
      {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Nome da meta' },
          alvo: { type: 'number', description: 'Valor alvo, maior que zero' },
          unidade: { type: 'string', description: 'Unidade do alvo (ex.: km, páginas). Opcional.' },
          cor: { type: 'string', enum: [...PROJECT_COLORS], description: 'Cor da meta' },
          projectId: { type: 'string', description: 'Projeto ao qual vincular' }
        },
        required: ['titulo', 'alvo'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const titulo = typeof args.titulo === 'string' ? args.titulo.trim() : ''
      if (!titulo) return JSON.stringify({ error: 'Informe o título da meta' })

      const alvo = toTarget(args.alvo)
      if (alvo === null) {
        return JSON.stringify({ error: 'alvo deve ser um número maior que zero' })
      }

      let cor: string = PROJECT_COLORS[0]
      if (args.cor !== undefined) {
        if (
          typeof args.cor !== 'string' ||
          !(PROJECT_COLORS as readonly string[]).includes(args.cor)
        ) {
          return JSON.stringify({ error: 'Cor inválida', disponiveis: PROJECT_COLORS })
        }
        cor = args.cor
      }

      let unidade = ''
      if (args.unidade !== undefined) {
        if (typeof args.unidade !== 'string') {
          return JSON.stringify({ error: 'unidade deve ser texto' })
        }
        unidade = args.unidade.trim()
      }

      let projectId: string | undefined
      if (args.projectId !== undefined) {
        if (typeof args.projectId !== 'string') {
          return JSON.stringify({ error: 'projectId deve ser texto' })
        }
        // A dangling projectId shows up as a goal linked to nothing.
        if (!state.projects.some((p) => p.id === args.projectId)) {
          return JSON.stringify({ error: 'Projeto não encontrado' })
        }
        projectId = args.projectId
      }

      const metaId = state.createGoal({
        title: titulo,
        target: alvo,
        unit: unidade,
        color: cor,
        projectId
      })
      return JSON.stringify({ ok: true, metaId, titulo, alvo, unidade, progresso: 0 })
    }
  },

  atualizar_meta: {
    write: true,
    definition: fn(
      'atualizar_meta',
      'Edita uma meta que já existe: título, alvo, unidade, cor ou o projeto vinculado. Só ' +
        'altera os campos que você mandar. NÃO registra progresso nem mexe nas entradas já ' +
        'lançadas — mudar o alvo só muda a régua, o valor atual continua o mesmo. Para ' +
        'desvincular do projeto, mande projectId "". Identifique por metaId (veja ler_metas) ' +
        'ou pelo titulo exato.',
      {
        type: 'object',
        properties: {
          metaId: { type: 'string', description: 'ID da meta (vem de ler_metas)' },
          titulo: { type: 'string', description: 'Título exato da meta a editar' },
          novoTitulo: { type: 'string', description: 'Novo nome da meta' },
          alvo: { type: 'number', description: 'Novo valor alvo, maior que zero' },
          unidade: { type: 'string', description: 'Nova unidade' },
          cor: { type: 'string', enum: [...PROJECT_COLORS] },
          projectId: { type: 'string', description: 'Novo projeto vinculado; "" desvincula' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const resolved = resolveGoal(args)
      if ('error' in resolved) return JSON.stringify(resolved)
      const { goal } = resolved

      // Only the keys given may land in `updates`: updateGoal spreads it over the
      // goal, so an undefined value would wipe the field instead of skipping it.
      const updates: Parameters<typeof state.updateGoal>[1] = {}

      if (args.novoTitulo !== undefined) {
        if (typeof args.novoTitulo !== 'string' || args.novoTitulo.trim() === '') {
          return JSON.stringify({ error: 'novoTitulo não pode ser vazio' })
        }
        updates.title = args.novoTitulo.trim()
      }

      if (args.alvo !== undefined) {
        const alvo = toTarget(args.alvo)
        if (alvo === null) {
          return JSON.stringify({ error: 'alvo deve ser um número maior que zero' })
        }
        updates.target = alvo
      }

      if (args.unidade !== undefined) {
        if (typeof args.unidade !== 'string') {
          return JSON.stringify({ error: 'unidade deve ser texto' })
        }
        // Goal.unit is a required string — "" is empty, not absent.
        updates.unit = args.unidade.trim()
      }

      if (args.cor !== undefined) {
        if (
          typeof args.cor !== 'string' ||
          !(PROJECT_COLORS as readonly string[]).includes(args.cor)
        ) {
          return JSON.stringify({ error: 'Cor inválida', disponiveis: PROJECT_COLORS })
        }
        updates.color = args.cor
      }

      if (args.projectId !== undefined) {
        if (typeof args.projectId !== 'string') {
          return JSON.stringify({ error: 'projectId deve ser texto' })
        }
        if (args.projectId.trim() === '') updates.projectId = undefined
        else if (!state.projects.some((p) => p.id === args.projectId)) {
          return JSON.stringify({ error: 'Projeto não encontrado' })
        } else updates.projectId = args.projectId
      }

      const changed = Object.keys(updates)
      if (changed.length === 0) {
        return JSON.stringify({
          error: 'Nenhum campo informado. Mande novoTitulo, alvo, unidade, cor ou projectId.'
        })
      }
      state.updateGoal(goal.id, updates)

      // The entries are untouched, so report the progress against the new target.
      const atual = goal.entries.reduce((sum, e) => sum + (e.value || 0), 0)
      const alvo = updates.target ?? goal.target
      return JSON.stringify({
        ok: true,
        metaId: goal.id,
        meta: updates.title ?? goal.title,
        atualizados: changed,
        atual,
        progresso: alvo > 0 ? Math.round((atual / alvo) * 100) : 0
      })
    }
  },

  marcar_habito: {
    write: true,
    definition: fn(
      'marcar_habito',
      'Marca um hábito como feito HOJE. É seguro chamar de novo: se o hábito já estiver marcado ' +
        'hoje, a ferramenta não faz nada e NÃO desmarca. Só mexe no dia de hoje — não marca ' +
        'outros dias nem desfaz marcações. Identifique por habitoId (veja ler_habitos) ou pelo ' +
        'nome exato.',
      {
        type: 'object',
        properties: {
          habitoId: { type: 'string', description: 'ID do hábito (vem de ler_habitos)' },
          nome: { type: 'string', description: 'Nome exato do hábito' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const resolved = resolveHabit(args)
      if ('error' in resolved) return JSON.stringify(resolved)
      const { habit } = resolved
      const now = new Date()
      const hoje = todayISO(now)

      const summary = (h: Habit): number => computeHabitSummary([h], now)[0]?.streak ?? 0

      // store.toggleHabit FLIPS the day. On a habit that's already done today it
      // would unmark it — the exact opposite of what this tool promises — so an
      // already-marked habit is a no-op, not a toggle.
      if (habit.completions.includes(hoje)) {
        return JSON.stringify({
          ok: true,
          habito: habit.name,
          data: hoje,
          jaEstavaMarcado: true,
          streak: summary(habit)
        })
      }

      state.toggleHabit(habit.id, hoje)
      const updated = useKanbanStore.getState().habits.find((h) => h.id === habit.id)
      return JSON.stringify({
        ok: true,
        habito: habit.name,
        data: hoje,
        streak: updated ? summary(updated) : 0
      })
    }
  },

  criar_nota: {
    write: true,
    definition: fn(
      'criar_nota',
      'Cria uma nota adesiva no canvas do projeto. Uma nota por chamada — para várias ideias, ' +
        'faça uma chamada para cada uma e elas se organizam sozinhas lado a lado, sem se ' +
        'sobrepor. Sem projectId, usa o projeto ativo.',
      {
        type: 'object',
        properties: {
          conteudo: { type: 'string', description: 'Texto da nota' },
          cor: { type: 'string', enum: [...NOTE_COLORS], description: 'Cor da nota' },
          projectId: { type: 'string', description: 'ID do projeto' }
        },
        required: ['conteudo'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const projectId =
        (typeof args.projectId === 'string' && args.projectId) || state.activeProjectId
      if (!projectId) return JSON.stringify({ error: 'Nenhum projeto ativo' })
      if (!state.projects.some((p) => p.id === projectId)) {
        return JSON.stringify({ error: 'Projeto não encontrado' })
      }

      const conteudo = typeof args.conteudo === 'string' ? args.conteudo.trim() : ''
      if (!conteudo) return JSON.stringify({ error: 'Informe o conteúdo da nota' })

      let cor: string | undefined
      if (args.cor !== undefined) {
        if (
          typeof args.cor !== 'string' ||
          !(NOTE_COLORS as readonly string[]).includes(args.cor)
        ) {
          return JSON.stringify({ error: 'Cor inválida', disponiveis: NOTE_COLORS })
        }
        cor = args.cor
      }

      const { x, y } = freeNoteSpot(state.notes.filter((n) => n.projectId === projectId))
      const notaId = state.createNote(projectId, { content: conteudo, color: cor, x, y })
      return JSON.stringify({ ok: true, notaId, conteudo, posicao: { x, y } })
    }
  },

  ler_notas: {
    definition: fn(
      'ler_notas',
      'Lista as notas adesivas do canvas de um projeto: conteúdo, cor, posição e se está vinculada ' +
        'a alguma task. Sem projectId, usa o projeto ativo.',
      {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'ID do projeto; usa o ativo' }
        },
        additionalProperties: false
      }
    ),
    run: (args) => {
      const { projects, notes, activeProjectId } = useKanbanStore.getState()
      const projectId = (typeof args.projectId === 'string' && args.projectId) || activeProjectId
      const project = projects.find((p) => p.id === projectId)
      if (!project) return JSON.stringify({ error: 'Projeto não encontrado' })
      const list = notes
        .filter((n) => n.projectId === project.id)
        .map((n) => ({
          id: n.id,
          conteudo: n.content,
          cor: n.color,
          posicao: { x: n.x, y: n.y },
          taskVinculada: n.taskId ?? null,
          criadaEm: n.createdAt,
          tipo: n.type ?? 'note'
        }))
      return JSON.stringify({ projeto: project.name, total: list.length, notas: list })
    }
  },

  buscar_memoria: {
    definition: fn(
      'buscar_memoria',
      'Consulta as suas memórias duráveis (do projeto ativo + as globais). Sem filtro, ' +
        'lista todas; com "id" (o código em [colchetes] no briefing), pega aquela memória exata; ' +
        'com "termo", filtra por título, corpo ou tags (sem diferenciar acento/maiúscula). ' +
        'Use para recuperar o conteúdo de uma memória que aparece só como título no briefing.',
      {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Id da memória (o código entre [colchetes] no briefing). Busca exata.'
          },
          termo: { type: 'string', description: 'Texto a procurar' },
          incluir_arquivadas: {
            type: 'boolean',
            description: 'true = inclui memórias arquivadas'
          }
        },
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      const termo = typeof args.termo === 'string' ? args.termo.trim() : ''
      const projectId = useKanbanStore.getState().activeProjectId
      const all = await window.electronAPI.ai.memory.list({
        projectId: projectId ?? null,
        includeArchived: args.incluir_arquivadas === true
      })
      // An id wins over a term (it's the precise lookup). The briefing shows an
      // 8-char prefix of a uuid, so match a prefix as well as the full id.
      const q = normalize(termo)
      const matched = id
        ? all.filter((m) => m.id === id || m.id.startsWith(id))
        : q
          ? all.filter((m) => normalize(`${m.title} ${m.body} ${m.tags.join(' ')}`).includes(q))
          : all
      const LIMIT = 30
      const top = matched.slice(0, LIMIT)
      // Explicit retrieval is what keeps a memory warm — the bulk briefing is
      // decay-neutral, so this is the only place access is bumped.
      if (top.length) void window.electronAPI.ai.memory.touch(top.map((m) => m.id))
      return JSON.stringify({
        total: matched.length,
        truncado: matched.length > top.length,
        memorias: top.map((m) => ({
          id: m.id,
          tipo: m.type,
          titulo: m.title,
          corpo: m.body,
          tags: m.tags,
          escopo: m.projectId ? 'projeto' : 'global',
          fixada: m.pinned,
          ...(m.archivedAt ? { arquivada: true } : {})
        }))
      })
    }
  },

  buscar_conversas: {
    definition: fn(
      'buscar_conversas',
      'Procura em conversas anteriores com este usuário por título ou por qualquer coisa dita ' +
        'no chat (sem diferenciar acento). Devolve os chats que batem, com um trecho. Use para ' +
        'lembrar o que já foi discutido antes.',
      {
        type: 'object',
        properties: {
          termo: { type: 'string', description: 'Texto a procurar nas conversas' }
        },
        required: ['termo'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const termo = typeof args.termo === 'string' ? args.termo.trim() : ''
      if (!termo) return JSON.stringify({ error: 'Informe o termo a buscar' })
      const res = await window.electronAPI.ai.conversations.search(termo)
      const LIMIT = 20
      return JSON.stringify({
        total: res.length,
        truncado: res.length > LIMIT,
        conversas: res.slice(0, LIMIT).map((c) => ({
          id: c.id,
          titulo: c.title,
          quando: c.updatedAt,
          ...(c.snippet ? { trecho: c.snippet } : {})
        }))
      })
    }
  },

  ler_conversa: {
    definition: fn(
      'ler_conversa',
      'Lê o conteúdo completo de uma conversa anterior pelo id (o "id=..." que um handoff ' +
        '"Última sessão" traz no fim). Use quando um handoff truncado (terminando em "…") for ' +
        'relevante e você precisar do que foi de fato discutido — em vez de refazer do zero. ' +
        'Devolve os turnos (sem as linhas de status), com teto de tamanho.',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id da conversa (ex.: o "id=..." do handoff)' }
        },
        required: ['id'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      if (!id) return JSON.stringify({ error: 'Informe o id da conversa' })
      const conv = await window.electronAPI.ai.conversations.get(id)
      if (!conv) return JSON.stringify({ error: 'Conversa não encontrada' })
      // Status lines are the agent's own tool trace — noise here; keep the real
      // exchange (user/assistant). Cap the total: the transcript is resent on
      // every later step, so a huge one would tax the whole run.
      const MAX_CHARS = 8000
      const turns: { autor: string; texto: string }[] = []
      let used = 0
      let truncado = false
      for (const m of conv.messages ?? []) {
        if (m.role === 'status') continue
        const texto = typeof m.content === 'string' ? m.content : ''
        if (!texto.trim()) continue
        if (used + texto.length > MAX_CHARS) {
          truncado = true
          break
        }
        used += texto.length
        turns.push({ autor: m.role === 'user' ? 'usuario' : 'assistente', texto })
      }
      return JSON.stringify({
        id: conv.id,
        titulo: conv.title,
        quando: conv.updatedAt,
        truncado,
        turnos: turns
      })
    }
  },

  verificar_memorias: {
    definition: fn(
      'verificar_memorias',
      'Audita suas memórias em busca de contradições — pares que falam do mesmo assunto ' +
        '(mesmo título) com conteúdos diferentes, sinal de que uma pode estar desatualizada. ' +
        'Use quando suspeitar que suas memórias se contradizem ou quando o usuário pedir para revisá-las.',
      NO_PARAMS
    ),
    run: async () => {
      const conflicts = await window.electronAPI.ai.memory.conflicts()
      if (!conflicts.length) {
        return JSON.stringify({
          ok: true,
          total: 0,
          conflitos: [],
          mensagem: 'Nenhuma contradição aparente.'
        })
      }
      const all = await window.electronAPI.ai.memory.list({})
      const byId = new Map(all.map((m) => [m.id, m]))
      const fmt = (id: string): Record<string, unknown> => {
        const m = byId.get(id)
        return m
          ? {
              id: m.id,
              tipo: m.type,
              corpo: m.body,
              escopo: m.projectId ? 'projeto' : 'global',
              fixada: m.pinned
            }
          : { id, ausente: true }
      }
      return JSON.stringify({
        total: conflicts.length,
        conflitos: conflicts.map((c) => ({ titulo: c.title, a: fmt(c.a), b: fmt(c.b) })),
        aviso:
          'Cada par fala do mesmo assunto com conteúdos diferentes. Considere atualizar a ' +
          'memória correta e reescrever/apagar a desatualizada.'
      })
    }
  },

  salvar_memoria: {
    write: true,
    definition: fn(
      'salvar_memoria',
      'Guarda um fato durável entre conversas (decisao/tradeoff/gotcha/fato). ' +
        'Uma por chamada. Escopo = projeto ativo; use global=true para fatos pessoais. ' +
        'NUNCA salve segredos — são removidos automaticamente.',
      {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            enum: ['decisao', 'tradeoff', 'gotcha', 'fato'],
            description: 'Tipo: decisao, tradeoff, gotcha ou fato'
          },
          titulo: { type: 'string', description: 'Assunto curto da memória' },
          corpo: { type: 'string', description: 'O fato em si, explicado' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Rótulos opcionais para agrupar/buscar'
          },
          global: {
            type: 'boolean',
            description: 'true = fato sobre o usuário, sem vínculo com projeto'
          },
          fixar: {
            type: 'boolean',
            description: 'true = nunca expira por inatividade (opcional; use com parcimônia)'
          }
        },
        required: ['tipo', 'titulo', 'corpo'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const tipos = ['decisao', 'tradeoff', 'gotcha', 'fato']
      const tipo = tipos.includes(String(args.tipo)) ? String(args.tipo) : 'fato'
      const titulo = typeof args.titulo === 'string' ? args.titulo.trim() : ''
      const corpo = typeof args.corpo === 'string' ? args.corpo.trim() : ''
      if (!titulo && !corpo) return JSON.stringify({ error: 'Informe título e corpo da memória' })

      const global = args.global === true
      const projectId = global
        ? null
        : (typeof args.projectId === 'string' && args.projectId) ||
          useKanbanStore.getState().activeProjectId ||
          null
      const tags = Array.isArray(args.tags)
        ? args.tags.filter((t): t is string => typeof t === 'string')
        : undefined

      const res = await window.electronAPI.ai.memory.save({
        type: tipo,
        title: titulo,
        body: corpo,
        tags,
        projectId,
        pinned: args.fixar === true,
        source: 'modelo'
      })
      if ('error' in res) return JSON.stringify({ error: res.error })
      return JSON.stringify({
        ok: true,
        memoriaId: res.memory.id,
        tipo,
        escopo: projectId ? 'projeto' : 'global',
        // If the scrubber touched anything, say so — the model (and the approval
        // card) shouldn't believe it stored something it didn't.
        ...(res.redacted
          ? { aviso: 'Trechos que pareciam segredos foram removidos antes de salvar.' }
          : {})
      })
    }
  },

  criar_transacao: {
    write: true,
    definition: fn(
      'criar_transacao',
      'Lança uma receita ou despesa numa tabela financeira. O valor é sempre POSITIVO — quem ' +
        'diz se entra ou sai é o "tipo" (receita/despesa). Mande o valor como número (ex.: ' +
        '1500.5); não use separador de milhar. Sem "data", usa hoje. Sem "tabela", usa a única ' +
        'que existir — se houver mais de uma, informe qual.',
      {
        type: 'object',
        properties: {
          descricao: { type: 'string', description: 'Descrição da transação' },
          valor: { type: 'number', description: 'Valor positivo, ex.: 1500.5' },
          tipo: { type: 'string', enum: ['receita', 'despesa'] },
          data: { type: 'string', description: 'Data YYYY-MM-DD (opcional, padrão hoje)' },
          categoria: {
            type: 'string',
            description: `Categoria. Prefira uma existente: ${FINANCIAL_CATEGORIES.join(', ')}`
          },
          tabela: { type: 'string', description: 'Nome ou ID da tabela financeira' }
        },
        required: ['descricao', 'valor', 'tipo'],
        additionalProperties: false
      }
    ),
    run: (args) => {
      const state = useKanbanStore.getState()
      const resolved = resolveList(args)
      if ('error' in resolved) return JSON.stringify(resolved)
      const { list } = resolved

      const descricao = typeof args.descricao === 'string' ? args.descricao.trim() : ''
      if (!descricao) return JSON.stringify({ error: 'Informe a descrição da transação' })

      if (args.tipo !== 'receita' && args.tipo !== 'despesa') {
        return JSON.stringify({ error: 'tipo deve ser "receita" ou "despesa"' })
      }

      const valor = parseMoney(args.valor)
      if (valor === null) {
        return JSON.stringify({
          error: 'valor inválido. Mande um número simples, sem separador de milhar (ex.: 1500.5).'
        })
      }
      // The sign lives in `type`: ler_financeiro sums expenses as positives, so a
      // negative here would quietly subtract from the month's expenses.
      if (!valor.greaterThan(0)) {
        return JSON.stringify({ error: 'valor deve ser maior que zero — use o tipo para o sinal' })
      }

      // todayISO() here is the LOCAL-day helper from utils/habits, not the
      // same-named UTC one in financial/shared.ts (which AddTransactionRow
      // defaults with — see the note in CLAUDE.md).
      let data = todayISO()
      if (args.data !== undefined) {
        if (typeof args.data !== 'string' || !isCalendarDate(args.data.trim())) {
          return JSON.stringify({ error: 'data deve ser uma data real no formato YYYY-MM-DD' })
        }
        data = args.data.trim()
      }

      let categoria: string | undefined
      if (args.categoria !== undefined) {
        if (typeof args.categoria !== 'string') {
          return JSON.stringify({ error: 'categoria deve ser texto' })
        }
        categoria = args.categoria.trim() || undefined
      }

      // Canonical decimal string, rounded like AddTransactionRow does — one
      // rounding rule for the table, whoever wrote the row.
      const amount = valor.toDecimalPlaces(2).toString()
      const txId = state.addTransaction(list.id, {
        description: descricao,
        amount,
        type: args.tipo === 'receita' ? 'income' : 'expense',
        date: data,
        category: categoria
      })
      return JSON.stringify({
        ok: true,
        txId,
        tabela: list.name,
        descricao,
        valor: amount,
        tipo: args.tipo,
        data,
        categoria: categoria ?? null
      })
    }
  },

  rodar_agente_codigo: {
    write: true,
    definition: fn(
      'rodar_agente_codigo',
      'Dispara o agente de código para implementar. Roda em uma pasta. Passe "arquivos" com os caminhos a editar.',
      {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'O que o agente deve fazer no código' },
          arquivos: {
            type: 'array',
            items: { type: 'string' },
            description: 'Caminhos relativos dos arquivos a editar. Evita o passo de descoberta.'
          },
          decisoes: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Decisões de escopo já acertadas que o agente deve respeitar (ex.: "manter o fallback X").'
          },
          ...PASTA_PARAM,
          projectId: { type: 'string', description: 'ID do projeto; usa o ativo' }
        },
        required: ['task'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const { roots, error } = activeRoots(args)
      if (error) return JSON.stringify({ error })
      // The agent is a child process with a single cwd — it cannot span roots,
      // and guessing which one to edit risks writing to the wrong repo.
      if (roots.length > 1) {
        return JSON.stringify({
          error: `O agente roda em uma pasta só, e ${roots.length} estão marcadas. Repita com pastaId.`,
          pastas: roots.map((r) => ({ id: r.id, nome: r.nome }))
        })
      }
      const path = roots[0].path
      const task = typeof args.task === 'string' ? args.task.trim() : ''
      if (!task) return JSON.stringify({ error: 'Tarefa vazia' })
      // Pinning the target files lets the agent edit them directly instead of
      // hunting for them with its own grep/read tools first. Main confines each
      // path to the root; here we just pass the clean list through.
      const files = Array.isArray(args.arquivos)
        ? args.arquivos.filter((f): f is string => typeof f === 'string' && f.trim() !== '')
        : undefined
      // Scope decisions the chat already settled: passed through to the agent's
      // system prompt as constraints, so it doesn't reopen a choice already made.
      const decisoes = Array.isArray(args.decisoes)
        ? args.decisoes.filter((d): d is string => typeof d === 'string' && d.trim() !== '')
        : undefined
      // Fire-and-forget; the real outcome streams to the UI panel. Report the
      // request honestly — do NOT claim guaranteed success.
      // Which chat this run belongs to, so its log and diff can be reopened from
      // there later. `runningConvId` and not `conversationId`: a run belongs to
      // the chat that started it, not to whichever one the user is looking at
      // when the agent finishes.
      // The agent is about to edit files under this root, so any cached code
      // search of it is now potentially stale — drop the cache.
      clearCodeSearchCache()
      const runningConvId = currentRunConvId()
      // Same project the read tools resolved to — so the code agent is briefed
      // with this project's memory (shared with the chat).
      const projectId =
        (typeof args.projectId === 'string' && args.projectId) ||
        useKanbanStore.getState().activeProjectId
      const result = await window.electronAPI.ai.codeAgent.run({
        path,
        task,
        files,
        decisoes,
        convId: runningConvId ?? undefined,
        projectId
      })
      if (!result.success) {
        return JSON.stringify({
          status: 'erro',
          erro: result.error || 'Falha ao iniciar o agente de código'
        })
      }
      return JSON.stringify({
        status: 'solicitado',
        agente: result.agent || 'codex',
        diretorio: path,
        runId: result.runId,
        arquivos: files && files.length ? files : undefined,
        decisoes: decisoes && decisoes.length ? decisoes : undefined,
        aviso:
          'Pedido enviado. Não afirme sucesso: acompanhe o painel de saída. Se o agente não ' +
          'estiver instalado, aparecerá um erro lá.'
      })
    }
  },

  listar_arquivos: {
    definition: fn(
      'listar_arquivos',
      'Lista os arquivos do projeto (recursivo; ignora node_modules/.git/dist). ' +
        'Pagina com inicio=nextOffset; restrinja com subpasta.',
      {
        type: 'object',
        properties: {
          subpasta: {
            type: 'string',
            description: 'Subpasta relativa (ex: src/renderer)'
          },
          inicio: {
            type: 'number',
            description: 'Posição para paginar (padrão 0)'
          },
          max_arquivos: {
            type: 'number',
            description: 'Máx. caminhos (padrão 200, teto 400)'
          },
          ...PASTA_PARAM,
          projectId: { type: 'string', description: 'ID do projeto; usa o ativo' }
        },
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const { roots, error } = activeRoots(args)
      if (error) return JSON.stringify({ error })
      const sub = typeof args.subpasta === 'string' ? args.subpasta : '.'
      const inicio = typeof args.inicio === 'number' ? args.inicio : undefined
      const maxArquivos = typeof args.max_arquivos === 'number' ? args.max_arquivos : undefined
      const pastas = await Promise.all(
        roots.map(async (r) => ({
          pasta: r.nome,
          ...(await window.electronAPI.ai.code.list(r.path, sub, inicio, maxArquivos))
        }))
      )
      return JSON.stringify({ pastas })
    }
  },

  ler_arquivo: {
    definition: fn(
      'ler_arquivo',
      'Lê um arquivo pelo caminho relativo. ' +
        'Prefira simbolo (extrai função/classe) ou linha_inicio/linha_fim a ler o arquivo todo. ' +
        'Quando truncado, use inicio=nextOffset para continuar.',
      {
        type: 'object',
        properties: {
          caminho: { type: 'string', description: 'Caminho relativo do arquivo' },
          simbolo: {
            type: 'string',
            description:
              'Extrai uma função/classe/const/interface pelo nome. Se não achar, retorna "simbolos".'
          },
          linha_inicio: {
            type: 'number',
            description: 'Primeira linha (1-based) do trecho a ler'
          },
          linha_fim: {
            type: 'number',
            description: 'Última linha (1-based) do trecho'
          },
          inicio: {
            type: 'number',
            description: 'Posição em caracteres para paginar (padrão 0)'
          },
          max_chars: {
            type: 'number',
            description: 'Máximo de caracteres (padrão 20000, teto 60000)'
          },
          ...PASTA_PARAM,
          projectId: { type: 'string', description: 'ID do projeto; usa o ativo se omitido' }
        },
        required: ['caminho'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const { roots, error } = activeRoots(args)
      if (error) return JSON.stringify({ error })
      const rel = typeof args.caminho === 'string' ? args.caminho : ''
      if (!rel) return JSON.stringify({ error: 'Caminho vazio' })
      const inicio = typeof args.inicio === 'number' ? args.inicio : undefined
      const maxChars = typeof args.max_chars === 'number' ? args.max_chars : undefined

      // Scoped read: a named symbol or a line range. Only built when asked, so a
      // plain read still calls code.read with four args (its existing contract).
      const simbolo =
        typeof args.simbolo === 'string' && args.simbolo.trim() !== ''
          ? args.simbolo.trim()
          : undefined
      const lineStart = typeof args.linha_inicio === 'number' ? args.linha_inicio : undefined
      const lineEnd = typeof args.linha_fim === 'number' ? args.linha_fim : undefined
      const scope =
        simbolo || lineStart != null || lineEnd != null
          ? { symbol: simbolo, lineStart, lineEnd }
          : undefined

      const reads = await Promise.all(
        roots.map(async (r) => ({
          root: r,
          res: scope
            ? await window.electronAPI.ai.code.read(r.path, rel, inicio, maxChars, scope)
            : await window.electronAPI.ai.code.read(r.path, rel, inicio, maxChars)
        }))
      )
      const hits = reads.filter((h) => !('error' in h.res && h.res.error))
      // Reading the wrong file silently would be worse than asking: when the
      // path is ambiguous across roots, make the model pick.
      if (hits.length > 1) {
        return JSON.stringify({
          error: `"${rel}" existe em mais de uma pasta: ${hits.map((h) => h.root.nome).join(', ')}. Repita com pastaId.`,
          pastas: hits.map((h) => ({ id: h.root.id, nome: h.root.nome }))
        })
      }
      if (!hits.length) {
        return JSON.stringify(reads[0]?.res ?? { error: 'Arquivo não encontrado' })
      }
      return JSON.stringify({ pasta: hits[0].root.nome, ...hits[0].res })
    }
  },

  buscar_no_codigo: {
    definition: fn(
      'buscar_no_codigo',
      'Busca um termo/texto no código do projeto (grep), em todas as pastas marcadas. As ' +
        'ocorrências vêm AGRUPADAS por arquivo — cada arquivo traz suas linhas ("linha"/"texto"). ' +
        'Use a "linha" com ler_arquivo (linha_inicio/linha_fim ou simbolo) para ler só o trecho ' +
        'certo em vez do arquivo todo.',
      {
        type: 'object',
        properties: {
          termo: { type: 'string', description: 'Texto a buscar' },
          ...PASTA_PARAM,
          projectId: { type: 'string', description: 'ID do projeto; usa o ativo' }
        },
        required: ['termo'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const { roots, error } = activeRoots(args)
      if (error) return JSON.stringify({ error })
      const termo = typeof args.termo === 'string' ? args.termo : ''
      if (!termo) return JSON.stringify({ error: 'Termo vazio' })
      // Short-lived cache: a re-search of the same term over the same roots is
      // common within a run, and the result is resent on every later step.
      const key = codeSearchKey(roots, termo)
      const cached = codeSearchCache.get(key)
      if (cached && Date.now() - cached.at < CODE_SEARCH_TTL_MS) return cached.result
      const pastas = await Promise.all(
        roots.map(async (r) => {
          const res = await window.electronAPI.ai.code.search(r.path, termo)
          if (res.error) return { pasta: r.nome, error: res.error }
          // Group by file: the flat list repeats the path on every hit, and a
          // whole result is resent to the model on each later step of the run.
          // One entry per file, its lines nested, is smaller and easier to read.
          const byFile = new Map<string, { linha: number; texto: string }[]>()
          for (const m of res.matches ?? []) {
            const arr = byFile.get(m.file) ?? []
            arr.push({ linha: m.line, texto: m.text })
            byFile.set(m.file, arr)
          }
          return {
            pasta: r.nome,
            arquivos: [...byFile].map(([arquivo, ocorrencias]) => ({ arquivo, ocorrencias })),
            total: (res.matches ?? []).length,
            truncado: res.truncated === true
          }
        })
      )
      const result = JSON.stringify({ pastas })
      // Bounded: on the rare occasion the run explores dozens of distinct terms,
      // drop the whole cache rather than grow without limit.
      if (codeSearchCache.size >= CODE_SEARCH_CACHE_MAX) codeSearchCache.clear()
      codeSearchCache.set(key, { at: Date.now(), result })
      return result
    }
  },

  buscar_na_web: {
    // Not a write tool: it touches no app data. The risk here is the other
    // direction — an untrusted page answering back — and that is main's to
    // police (scheme, private hosts, every redirect hop, size cap). The URL is
    // passed through unvetted on purpose: a second opinion in the renderer
    // would be a second place for the policy to drift out of step.
    definition: fn(
      'buscar_na_web',
      'Lê o texto de uma página web pela URL. Use para consultar documentação ou uma ' +
        'referência que não esteja no app nem no código do projeto. Se a página for uma SPA ' +
        'que renderiza por JavaScript (o texto vier vazio ou só o esqueleto), repita com ' +
        'renderizar_js=true para carregá-la num navegador de verdade.',
      {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL completa da página (http:// ou https://)' },
          renderizar_js: {
            type: 'boolean',
            description:
              'Renderiza a página num navegador headless (executa JavaScript). Mais lento; ' +
              'use só quando o fetch simples devolver pouco ou nenhum texto (opcional, padrão false)'
          }
        },
        required: ['url'],
        additionalProperties: false
      }
    ),
    run: async (args) => {
      const url = typeof args.url === 'string' ? args.url.trim() : ''
      if (!url) return JSON.stringify({ error: 'URL vazia' })
      const render = args.renderizar_js === true
      // Shape is `{ content, url, truncated }` or `{ error }`; `url` is the
      // final one after redirects, so the model is told where it actually
      // landed rather than where it aimed.
      return JSON.stringify(await window.electronAPI.ai.web.fetch(url, render))
    }
  },

  ler_linhagem: {
    definition: fn(
      'ler_linhagem',
      'Consulta o histórico de alterações (event log) de uma entidade específica. ' +
        'Retorna quando foi criada, atualizada ou removida, e por quem (usuário ou IA). ' +
        'Use para rastrear a proveniência de uma task, meta, nota ou transação.',
      {
        type: 'object',
        properties: {
          tipo: {
            type: 'string',
            description:
              'Tipo da entidade: project, task, sprint, note, goal, habit, financial_table, file'
          },
          id: { type: 'string', description: 'ID da entidade (ex: id da task, id da meta)' }
        },
        required: ['tipo', 'id']
      }
    ),
    run: async (args) => {
      const tipo = typeof args.tipo === 'string' ? args.tipo : ''
      const id = typeof args.id === 'string' ? args.id : ''
      if (!tipo || !id) return JSON.stringify({ error: 'Informe tipo e id da entidade' })
      const events = await window.electronAPI.ai.lineage.list(tipo, id)
      return JSON.stringify({ tipo, id, eventos: events, total: events.length })
    }
  },

  // ── Planner tools ──────────────────────────────────────────────────────────

  ler_plano: {
    definition: fn(
      'ler_plano',
      'Lê os blocos de tempo (time blocks) do planejamento para um dia ou uma semana. ' +
        'Também inclui tasks com dueDate no período, hábitos do dia, e transações financeiras do mês ' +
        '(contas a pagar/receber). Use para ver o que já está agendado antes de criar ou ajustar um plano.',
      {
        type: 'object',
        properties: {
          data: {
            type: 'string',
            description:
              'Data YYYY-MM-DD para ler o plano de um dia, ou YYYY-MM-DD/YYYY-MM-DD para uma semana.'
          }
        },
        required: ['data']
      }
    ),
    run: (args) => {
      const raw = typeof args.data === 'string' ? args.data : ''
      if (!raw)
        return JSON.stringify({
          error: 'Informe uma data (YYYY-MM-DD) ou intervalo (YYYY-MM-DD/YYYY-MM-DD)'
        })
      const parts = raw.split('/')
      const dateStart = parts[0]
      const dateEnd = parts[1] ?? parts[0]
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(dateEnd))
        return JSON.stringify({
          error: 'Formato inválido. Use YYYY-MM-DD ou YYYY-MM-DD/YYYY-MM-DD'
        })

      const { timeBlocks, tasks, habits, lists } = useKanbanStore.getState()

      const blocks = timeBlocks
        .filter((tb) => tb.date >= dateStart && tb.date <= dateEnd)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))

      const tasksInRange = tasks.filter(
        (t) => t.dueDate && t.dueDate >= dateStart && t.dueDate <= dateEnd
      )

      const habitsToday =
        dateStart === dateEnd
          ? habits
              .filter((h) => h.completions.includes(dateStart))
              .map((h) => ({ nome: h.name, cor: h.color }))
          : undefined

      const today = dateStart.slice(0, 7) // YYYY-MM
      const monthTransactions: {
        descricao: string
        valor: string
        tipo: string
        data: string
        categoria?: string
      }[] = []
      for (const list of lists) {
        for (const tx of list.transactions) {
          if (tx.date.startsWith(today))
            monthTransactions.push({
              descricao: tx.description,
              valor: tx.amount,
              tipo: tx.type,
              data: tx.date,
              ...(tx.category ? { categoria: tx.category } : {})
            })
        }
      }

      const planosPorDia: Record<string, { blocos: unknown[]; tasks: unknown[] }> = {}
      for (const block of blocks) {
        const day = (planosPorDia[block.date] ??= { blocos: [], tasks: [] })
        day.blocos.push({
          id: block.id,
          titulo: block.title,
          inicio: block.startTime,
          fim: block.endTime,
          tipo: block.type,
          ...(block.description ? { descricao: block.description } : {}),
          ...(block.taskId ? { taskId: block.taskId } : {}),
          ...(block.habitId ? { habitId: block.habitId } : {}),
          ...(block.color ? { cor: block.color } : {})
        })
      }
      for (const t of tasksInRange) {
        const day = (planosPorDia[t.dueDate!] ??= { blocos: [], tasks: [] })
        day.tasks.push({
          id: t.id,
          titulo: t.title,
          prioridade: t.priority,
          coluna: t.columnId,
          ...(t.order ? {} : {})
        })
      }

      return JSON.stringify({
        intervalo: { de: dateStart, ate: dateEnd },
        planosPorDia,
        totalBlocos: blocks.length,
        totalTasksComPrazo: tasksInRange.length,
        ...(habitsToday ? { habitosConcluidosHoje: habitsToday } : {}),
        ...(monthTransactions.length
          ? {
              transacoesDoMes: monthTransactions.slice(0, 30),
              totalTransacoesMes: monthTransactions.length,
              truncado: monthTransactions.length > 30
            }
          : {})
      })
    }
  },

  criar_plano: {
    definition: fn(
      'criar_plano',
      'Cria blocos de tempo no planejamento. Cada bloco tem data, horário de início/fim, título e ' +
        'tipo: task (vinculada ao kanban), routine, buffer (deslocamento/banho/almoço) ou custom.',
      {
        type: 'object',
        properties: {
          blocos: {
            type: 'array',
            description: 'Blocos de tempo a criar',
            items: {
              type: 'object',
              properties: {
                data: { type: 'string', description: 'YYYY-MM-DD' },
                inicio: { type: 'string', description: 'HH:MM' },
                fim: { type: 'string', description: 'HH:MM' },
                titulo: { type: 'string', description: 'Título do bloco' },
                descricao: { type: 'string', description: 'Descrição' },
                tipo: { type: 'string', enum: ['task', 'routine', 'buffer', 'custom'] },
                taskId: { type: 'string', description: 'ID da task (só se tipo=task)' },
                cor: { type: 'string', description: 'Cor hex (ex: #7c3aed)' }
              },
              required: ['data', 'inicio', 'fim', 'titulo', 'tipo']
            }
          }
        },
        required: ['blocos']
      }
    ),
    write: true,
    run: (args) => {
      const blocos = Array.isArray(args.blocos) ? args.blocos : []
      if (!blocos.length) return JSON.stringify({ error: 'Informe ao menos um bloco' })

      const store = useKanbanStore.getState()
      const criados: string[] = []
      for (const b of blocos) {
        const data = typeof b.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.data) ? b.data : ''
        const inicio =
          typeof b.inicio === 'string' && /^\d{2}:\d{2}$/.test(b.inicio) ? b.inicio : ''
        const fim = typeof b.fim === 'string' && /^\d{2}:\d{2}$/.test(b.fim) ? b.fim : ''
        const titulo = typeof b.titulo === 'string' ? b.titulo.trim() : ''
        const tipo = (['task', 'routine', 'buffer', 'custom'] as const).includes(
          b.tipo as typeof b.tipo & string
        )
          ? b.tipo
          : 'custom'
        if (!data || !inicio || !fim || !titulo) continue
        if (fim <= inicio) continue
        const descricao = typeof b.descricao === 'string' ? b.descricao.trim() : undefined
        const taskId = typeof b.taskId === 'string' ? b.taskId : undefined
        const cor = typeof b.cor === 'string' ? b.cor : undefined
        const existingBlocks = store.timeBlocks.filter((tb) => tb.date === data)
        const maxOrder = existingBlocks.reduce((m, tb) => Math.max(m, tb.order), -1)
        const id = store.createTimeBlock({
          date: data,
          startTime: inicio,
          endTime: fim,
          title: titulo,
          ...(descricao ? { description: descricao } : {}),
          ...(taskId ? { taskId } : {}),
          type: tipo,
          ...(cor ? { color: cor } : {}),
          order: maxOrder + 1
        })
        criados.push(id)
      }

      return JSON.stringify({
        criado: criados.length,
        ids: criados,
        dica: 'Use ler_plano para ver o resultado'
      })
    }
  },

  atualizar_plano: {
    definition: fn(
      'atualizar_plano',
      'Atualiza ou remove blocos de tempo do planejamento. Use para reordenar, mudar horários, ' +
        'ou remover blocos que o usuário quer ajustar.',
      {
        type: 'object',
        properties: {
          blocos: {
            type: 'array',
            description: 'Array de blocos a atualizar. Cada um precisa do id.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'ID do bloco a atualizar' },
                remover: { type: 'boolean', description: 'Se true, remove o bloco' },
                inicio: { type: 'string', description: 'Novo horário de início HH:MM' },
                fim: { type: 'string', description: 'Novo horário de fim HH:MM' },
                titulo: { type: 'string', description: 'Novo título' },
                descricao: { type: 'string', description: 'Nova descrição' },
                cor: { type: 'string', description: 'Nova cor hex' }
              },
              required: ['id']
            }
          }
        },
        required: ['blocos']
      }
    ),
    write: true,
    run: (args) => {
      const blocos = Array.isArray(args.blocos) ? args.blocos : []
      if (!blocos.length)
        return JSON.stringify({ error: 'Informe ao menos um bloco para atualizar' })

      const store = useKanbanStore.getState()
      let atualizados = 0
      let removidos = 0
      for (const b of blocos) {
        const id = typeof b.id === 'string' ? b.id : ''
        if (!id) continue
        const existing = store.timeBlocks.find((tb) => tb.id === id)
        if (!existing) continue
        if (b.remover === true) {
          store.deleteTimeBlock(id)
          removidos++
          continue
        }
        const updates: Record<string, unknown> = {}
        if (typeof b.inicio === 'string' && /^\d{2}:\d{2}$/.test(b.inicio))
          updates.startTime = b.inicio
        if (typeof b.fim === 'string' && /^\d{2}:\d{2}$/.test(b.fim)) updates.endTime = b.fim
        if (typeof b.titulo === 'string') updates.title = b.titulo.trim()
        if (typeof b.descricao === 'string') updates.description = b.descricao.trim()
        if (typeof b.cor === 'string') updates.color = b.cor
        if (Object.keys(updates).length > 0) {
          store.updateTimeBlock(id, updates as Parameters<typeof store.updateTimeBlock>[1])
          atualizados++
        }
      }

      return JSON.stringify({ atualizados, removidos })
    }
  },

  ajustar_bloco_e_deslocar_posteriores: {
    definition: fn(
      'ajustar_bloco_e_deslocar_posteriores',
      'Para um ajuste mecânico de agenda: muda o horário final de UM bloco e desloca todos os blocos posteriores ' +
        'do mesmo dia pela diferença. Use diretamente quando o usuário informou data, atividade e novo fim; ' +
        'não é preciso chamar ler_plano antes. Por segurança, título ambíguo ou horário que atravesse meia-noite ' +
        'não altera nada.',
      {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'Data YYYY-MM-DD' },
          blocoId: { type: 'string', description: 'ID do bloco, se já o tiver' },
          titulo: { type: 'string', description: 'Título exato do bloco, se não tiver o ID' },
          novoFim: { type: 'string', description: 'Novo horário final do bloco, HH:MM' }
        },
        required: ['data', 'novoFim']
      }
    ),
    write: true,
    run: (args) => {
      const firstText = (...keys: string[]): string => {
        for (const key of keys) {
          const value = args[key]
          if (typeof value === 'string' && value.trim()) return value.trim()
        }
        return ''
      }
      const data = firstText('data', 'date')
      // These aliases make a malformed tool call recoverable without making the
      // model spend another round merely to translate an obvious field name.
      const novoFim = firstText('novoFim', 'fim', 'endTime', 'horarioFim', 'horario_fim')
      const toMinutes = (time: string): number | null => {
        const match = /^(\d{2}):(\d{2})$/.exec(time)
        if (!match) return null
        const hours = Number(match[1])
        const minutes = Number(match[2])
        return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
      }
      const toTime = (minutes: number): string =>
        `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

      if (!isCalendarDate(data)) return JSON.stringify({ error: 'Data inválida. Use YYYY-MM-DD.' })
      const newEndMinutes = toMinutes(novoFim)
      if (newEndMinutes === null)
        return JSON.stringify({ error: 'novoFim inválido. Use HH:MM entre 00:00 e 23:59.' })

      const store = useKanbanStore.getState()
      const blocks = store.timeBlocks
        .filter((block) => block.date === data)
        .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.order - b.order)
      const byId = firstText('blocoId', 'id')
      const title = firstText('titulo', 'bloco', 'atividade', 'nome')
      const candidates = byId
        ? blocks.filter((block) => block.id === byId)
        : title
          ? blocks.filter((block) => {
              const candidate = normalize(block.title)
              const query = normalize(title)
              return candidate === query || candidate.includes(query) || query.includes(candidate)
            })
          : []

      if (!byId && !title) return JSON.stringify({ error: 'Informe blocoId ou titulo.' })
      if (candidates.length === 0)
        return JSON.stringify({ error: 'Bloco não encontrado nessa data.' })
      if (candidates.length > 1) {
        return JSON.stringify({
          error:
            'Há mais de um bloco com esse título nessa data. Informe blocoId para não alterar o errado.',
          candidatos: candidates.map((block) => ({
            id: block.id,
            titulo: block.title,
            inicio: block.startTime,
            fim: block.endTime
          }))
        })
      }

      const target = candidates[0]
      const targetStartMinutes = toMinutes(target.startTime)
      const oldEndMinutes = toMinutes(target.endTime)
      if (targetStartMinutes === null || oldEndMinutes === null) {
        return JSON.stringify({
          error: 'O bloco encontrado tem um horário inválido e não foi alterado.'
        })
      }
      if (newEndMinutes <= targetStartMinutes) {
        return JSON.stringify({ error: 'O novo fim precisa ser posterior ao início do bloco.' })
      }

      const offset = newEndMinutes - oldEndMinutes
      const targetIndex = blocks.findIndex((block) => block.id === target.id)
      const laterBlocks = blocks.slice(targetIndex + 1)
      const shifted = laterBlocks.map((block) => {
        const start = toMinutes(block.startTime)
        const end = toMinutes(block.endTime)
        if (start === null || end === null || start + offset < 0 || end + offset >= 24 * 60)
          return null
        return { id: block.id, startTime: toTime(start + offset), endTime: toTime(end + offset) }
      })
      if (shifted.some((block) => block === null)) {
        return JSON.stringify({
          error: 'O deslocamento levaria um bloco para fora do dia; nenhuma alteração foi feita.'
        })
      }
      if (offset === 0) {
        return JSON.stringify({
          atualizados: 0,
          deslocamentoMinutos: 0,
          bloco: {
            id: target.id,
            titulo: target.title,
            inicio: target.startTime,
            fim: target.endTime
          }
        })
      }

      const now = new Date().toISOString()
      const shiftsById = new Map(
        (shifted as { id: string; startTime: string; endTime: string }[]).map((block) => [
          block.id,
          block
        ])
      )
      store.setTimeBlocks(
        store.timeBlocks.map((block) => {
          if (block.id === target.id) return { ...block, endTime: novoFim, updatedAt: now }
          const shift = shiftsById.get(block.id)
          return shift ? { ...block, ...shift, updatedAt: now } : block
        })
      )
      return JSON.stringify({
        atualizados: laterBlocks.length + 1,
        deslocamentoMinutos: offset,
        bloco: { id: target.id, titulo: target.title, inicio: target.startTime, fim: novoFim },
        posterioresDeslocados: laterBlocks.length
      })
    }
  },

  resolver_termo: {
    definition: fn(
      'resolver_termo',
      'Consulta o glossário de termos do domínio Sagyou. Use quando encontrar um termo ' +
        'cujo significado exato no contexto deste app você não domina (ex: "sprint", "meta", ' +
        '"coluna Done", "handoff"). Retorna a definição, as ferramentas relevantes e um exemplo.',
      {
        type: 'object',
        properties: {
          termo: {
            type: 'string',
            description: 'Termo a consultar (ex: "kanban", "handoff", "dueDate")'
          }
        },
        required: ['termo']
      }
    ),
    run: (args) => {
      const termo = typeof args.termo === 'string' ? args.termo.trim().toLowerCase() : ''
      if (!termo) return JSON.stringify({ error: 'Informe o termo a consultar' })
      const glossary = glossaryRaw as {
        termo: string
        definicao: string
        contexto: string
        ferramentas_relevantes: string[]
        exemplo: string
      }[]
      // Exact match first, then accent-insensitive substring match
      const exact = glossary.find((g) => g.termo.toLowerCase() === termo)
      if (exact)
        return JSON.stringify({
          termo: exact.termo,
          definicao: exact.definicao,
          contexto: exact.contexto,
          ferramentas: exact.ferramentas_relevantes,
          exemplo: exact.exemplo
        })
      // Normalize accents for fuzzy matching
      const normalized = termo.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const fuzzy = glossary.filter((g) => {
        const n = g.termo
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
        return n.includes(normalized) || normalized.includes(n)
      })
      if (fuzzy.length === 0) {
        const termos = glossary.map((g) => g.termo).join(', ')
        return JSON.stringify({
          error: `Termo "${args.termo}" não encontrado no glossário.`,
          termos_disponiveis: termos
        })
      }
      if (fuzzy.length === 1) {
        const g = fuzzy[0]
        return JSON.stringify({
          termo: g.termo,
          definicao: g.definicao,
          contexto: g.contexto,
          ferramentas: g.ferramentas_relevantes,
          exemplo: g.exemplo
        })
      }
      return JSON.stringify({
        ambiguo: true,
        opcoes: fuzzy.map((g) => ({ termo: g.termo, definicao: g.definicao })),
        dica: 'Especifique o termo exato dentre as opções acima.'
      })
    }
  },

  ler_documento: {
    definition: fn(
      'ler_documento',
      'Lê o conteúdo de um arquivo (PDF, DOCX, XLSX, CSV, TXT, MD, JSON, HTML, XML, YAML, RTF, ODT, ODS) ' +
        'que foi carregado nos anexos do projeto via FilesView. Extrai o texto e retorna — útil para ' +
        'buscar informações em documentos de referência salvos no projeto.',
      {
        type: 'object',
        properties: {
          fileId: {
            type: 'string',
            description: 'ID do arquivo (obtido da lista de anexos do projeto). Prefira este campo.'
          },
          projectId: {
            type: 'string',
            description: 'Projeto alvo. Padrão: projeto ativo.'
          }
        },
        required: ['fileId']
      }
    ),
    run: async (args) => {
      const fileId = typeof args.fileId === 'string' ? args.fileId.trim() : ''
      if (!fileId) return JSON.stringify({ error: 'Informe o fileId do arquivo a ler' })

      try {
        const api = window.electronAPI?.ai?.projectFile
        if (!api?.read) return JSON.stringify({ error: 'Leitura de documentos não disponível' })
        const result = await api.read(fileId)
        if ('error' in result) return JSON.stringify({ error: result.error })
        return JSON.stringify({
          texto: result.text,
          truncado: result.truncated,
          ...(result.size !== undefined && { tamanho_bytes: result.size })
        })
      } catch (e) {
        return JSON.stringify({
          error: e instanceof Error ? e.message : 'Falha ao ler o documento'
        })
      }
    }
  }
}
