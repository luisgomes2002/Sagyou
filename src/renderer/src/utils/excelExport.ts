import * as XLSX from 'xlsx'
import Decimal from 'decimal.js'
import type { Project, Task, Habit, Goal, FinancialTable, Sprint, StickyNote } from '../types'
import { CURRENCY_CONFIG } from '../types'

export type ExportKey =
  | 'projects'
  | 'tasks'
  | 'sprints'
  | 'habits'
  | 'goals'
  | 'notes'
  | 'shopping'
  | 'transactions'
  | 'financialGoals'

export function buildWorkbook(
  selected: Set<ExportKey>,
  projects: Project[],
  tasks: Task[],
  sprints: Sprint[],
  habits: Habit[],
  goals: Goal[],
  notes: StickyNote[],
  lists: FinancialTable[]
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]))

  // ── Projetos ────────────────────────────────────────────────────────────────
  if (selected.has('projects')) {
    const rows = projects.map((p) => ({
      Nome: p.name,
      Descrição: p.description ?? '',
      Cor: p.color,
      Colunas: p.columns.length,
      Links: p.links?.length ?? 0,
      Criado: p.createdAt.slice(0, 10),
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Projetos')
  }

  // ── Tarefas ─────────────────────────────────────────────────────────────────
  if (selected.has('tasks')) {
    const columnMap: Record<string, string> = {}
    for (const p of projects) {
      for (const c of p.columns) columnMap[c.id] = c.name
    }
    const sprintMap = Object.fromEntries(sprints.map((s) => [s.id, s.name]))

    const rows = tasks.map((t) => ({
      Título: t.title,
      Descrição: t.description ?? '',
      Projeto: projectMap[t.projectId]?.name ?? '',
      Coluna: columnMap[t.columnId] ?? '',
      Sprint: t.sprintId ? (sprintMap[t.sprintId] ?? '') : '',
      Prioridade: t.priority,
      Tags: t.tags.join(', '),
      Prazo: t.dueDate ?? '',
      'Tempo gasto (min)': t.timeSpent ? Math.round(t.timeSpent / 60) : '',
      Criada: t.createdAt.slice(0, 10),
      Concluída: t.completedAt ? t.completedAt.slice(0, 10) : '',
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Tarefas')
  }

  // ── Sprints ─────────────────────────────────────────────────────────────────
  if (selected.has('sprints')) {
    const rows = sprints.map((s) => ({
      Nome: s.name,
      Projeto: projectMap[s.projectId]?.name ?? '',
      Status: s.closedAt ? 'Fechada' : 'Aberta',
      Criada: s.createdAt.slice(0, 10),
      Fechada: s.closedAt ? s.closedAt.slice(0, 10) : '',
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sprints')
  }

  // ── Hábitos ─────────────────────────────────────────────────────────────────
  if (selected.has('habits')) {
    const rows = habits.map((h) => ({
      Nome: h.name,
      'Total de conclusões': h.completions.length,
      'Última conclusão': h.completions.length > 0
        ? [...h.completions].sort().at(-1)!
        : '',
      'Criado em': h.createdAt.slice(0, 10),
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Hábitos')
  }

  // ── Metas ───────────────────────────────────────────────────────────────────
  if (selected.has('goals')) {
    const rows = goals.map((g) => {
      const total = g.entries.reduce((s, e) => s + e.value, 0)
      return {
        Título: g.title,
        Meta: g.target,
        Unidade: g.unit,
        'Progresso atual': total,
        '% concluído': g.target > 0 ? Math.round((total / g.target) * 100) : '',
        Projeto: g.projectId ? (projectMap[g.projectId]?.name ?? '') : '',
        Criada: g.createdAt.slice(0, 10),
      }
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Metas')
  }

  // ── Notas (canvas) ──────────────────────────────────────────────────────────
  if (selected.has('notes')) {
    const rows = notes.map((n) => ({
      Projeto: projectMap[n.projectId]?.name ?? '',
      Tipo: n.type === 'text' ? 'Texto' : 'Nota',
      Conteúdo: n.content,
      Concluída: n.completedAt ? n.completedAt.slice(0, 10) : '',
      Criada: n.createdAt.slice(0, 10),
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Notas')
  }

  // ── Itens de compra ─────────────────────────────────────────────────────────
  if (selected.has('shopping')) {
    const rows = lists.flatMap((list) => {
      const cfg = CURRENCY_CONFIG[list.currency]
      return list.items.map((item) => ({
        Lista: list.name,
        Nome: item.name,
        Quantidade: item.qty,
        Preço: item.price != null ? Number(item.price) : '',
        Moeda: cfg.label,
        'Total': item.price != null ? new Decimal(item.price).times(item.qty).toNumber() : '',
        Concluído: item.done ? 'Sim' : 'Não',
        Link: item.link ?? '',
      }))
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Itens de compra')
  }

  // ── Transações ──────────────────────────────────────────────────────────────
  if (selected.has('transactions')) {
    for (const list of lists) {
      const cfg = CURRENCY_CONFIG[list.currency]
      const rows = list.transactions.map((tx) => ({
        Descrição: tx.description,
        Valor: Number(tx.amount),
        Moeda: cfg.label,
        Tipo: tx.type === 'income' ? 'Receita' : 'Despesa',
        Data: tx.date,
        Categoria: tx.category ?? '',
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), list.name.slice(0, 31))
    }
  }

  // ── Metas financeiras ────────────────────────────────────────────────────────
  if (selected.has('financialGoals')) {
    const rows = lists.flatMap((list) =>
      list.goals.map((fg) => ({
        Lista: list.name,
        Nome: fg.name,
        'Valor alvo': Number(fg.targetAmount),
        Moeda: CURRENCY_CONFIG[list.currency].label,
        'Mês/Ano': `${String(fg.targetMonth).padStart(2, '0')}/${fg.targetYear}`,
        Status: fg.completedAt ? 'Concluída' : 'Em andamento',
        'Concluída em': fg.completedAt ? fg.completedAt.slice(0, 10) : '',
        Nota: fg.completionNote ?? '',
      }))
    )
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Metas financeiras')
  }

  return wb
}
