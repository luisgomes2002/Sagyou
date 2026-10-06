import * as XLSX from 'xlsx'
import Decimal from 'decimal.js'
import type {
  Project,
  Task,
  Habit,
  Goal,
  FinancialTable,
  FinancialProfile,
  StoredFile,
  Sprint,
  StickyNote
} from '../types'
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
  | 'financialTables'
  | 'yields'

function appendSheet(wb: XLSX.WorkBook, rows: Record<string, unknown>[], name: string): void {
  const base =
    name
      .replace(/[\\/?*:]/g, ' ')
      .replaceAll('[', ' ')
      .replaceAll(']', ' ')
      .trim()
      .slice(0, 31) || 'Tabela'
  let candidate = base
  let suffix = 2
  while (wb.SheetNames.some((existing) => existing.toLowerCase() === candidate.toLowerCase())) {
    const ending = ` (${suffix++})`
    candidate = `${base.slice(0, 31 - ending.length)}${ending}`
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), candidate)
}

export function buildWorkbook(
  selected: Set<ExportKey>,
  projects: Project[],
  tasks: Task[],
  sprints: Sprint[],
  habits: Habit[],
  goals: Goal[],
  notes: StickyNote[],
  lists: FinancialTable[],
  financialProfiles: FinancialProfile[] = [],
  files: StoredFile[] = []
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]))
  const profileMap = Object.fromEntries(
    financialProfiles.map((profile) => [profile.id, profile.name])
  )
  const profileName = (list: FinancialTable): string =>
    profileMap[list.profileId ?? 'personal'] ?? 'Minhas finanças'

  // ── Projetos ────────────────────────────────────────────────────────────────
  if (selected.has('projects')) {
    const rows = projects.map((p) => ({
      ID: p.id,
      Nome: p.name,
      Descrição: p.description ?? '',
      Cor: p.color,
      Colunas: p.columns.length,
      Links: p.links?.length ?? 0,
      Ordem: p.order ?? '',
      'Arquivado em': p.archivedAt ?? '',
      Criado: p.createdAt.slice(0, 10),
      Atualizado: p.updatedAt
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Projetos')
    appendSheet(
      wb,
      projects.flatMap((project) =>
        project.columns.map((column) => ({
          ID: column.id,
          'ID do projeto': project.id,
          Projeto: project.name,
          Nome: column.name,
          Ordem: column.order,
          Cor: column.color ?? ''
        }))
      ),
      'Colunas'
    )
    appendSheet(
      wb,
      projects.flatMap((project) =>
        (project.links ?? []).map((link) => ({
          ID: link.id,
          'ID do projeto': project.id,
          Projeto: project.name,
          Nome: link.label,
          URL: link.url
        }))
      ),
      'Links de projetos'
    )
    appendSheet(
      wb,
      projects.flatMap((project) =>
        (project.codePaths ?? []).map((codePath) => ({
          ID: codePath.id,
          'ID do projeto': project.id,
          Projeto: project.name,
          Nome: codePath.label ?? '',
          Caminho: codePath.path,
          Ativo: (
            project.activeCodePathIds ??
            (project.activeCodePathId ? [project.activeCodePathId] : [])
          ).includes(codePath.id)
            ? 'Sim'
            : 'Não'
        }))
      ),
      'Caminhos de código'
    )
  }

  // ── Tarefas ─────────────────────────────────────────────────────────────────
  if (selected.has('tasks')) {
    const columnMap: Record<string, string> = {}
    for (const p of projects) {
      for (const c of p.columns) columnMap[c.id] = c.name
    }
    const sprintMap = Object.fromEntries(sprints.map((s) => [s.id, s.name]))

    const rows = tasks.map((t) => ({
      ID: t.id,
      'ID do projeto': t.projectId,
      'ID da coluna': t.columnId,
      'ID do sprint': t.sprintId ?? '',
      Título: t.title,
      Descrição: t.description ?? '',
      Projeto: projectMap[t.projectId]?.name ?? '',
      Coluna: columnMap[t.columnId] ?? '',
      Sprint: t.sprintId ? (sprintMap[t.sprintId] ?? '') : '',
      Prioridade: t.priority,
      Tags: t.tags.join(', '),
      Prazo: t.dueDate ?? '',
      'Tempo gasto (min)': t.timeSpent ? Math.round(t.timeSpent / 60) : '',
      'Tempo gasto (s)': t.timeSpent ?? 0,
      Ordem: t.order,
      Imagens: t.images?.length ?? 0,
      Criada: t.createdAt.slice(0, 10),
      Atualizada: t.updatedAt,
      Concluída: t.completedAt ? t.completedAt.slice(0, 10) : ''
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Tarefas')
    appendSheet(
      wb,
      tasks.flatMap((task) =>
        (task.images ?? []).map((image) => ({
          ID: image.id,
          'ID da tarefa': task.id,
          Tarefa: task.title,
          Nome: image.name,
          Extensão: image.ext,
          'Tamanho (bytes)': image.size,
          Adicionada: image.addedAt
        }))
      ),
      'Imagens tarefas'
    )
  }

  // ── Sprints ─────────────────────────────────────────────────────────────────
  if (selected.has('sprints')) {
    const rows = sprints.map((s) => ({
      ID: s.id,
      'ID do projeto': s.projectId,
      Nome: s.name,
      Projeto: projectMap[s.projectId]?.name ?? '',
      Status: s.closedAt ? 'Fechada' : 'Aberta',
      Criada: s.createdAt.slice(0, 10),
      Fechada: s.closedAt ? s.closedAt.slice(0, 10) : ''
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sprints')
  }

  // ── Hábitos ─────────────────────────────────────────────────────────────────
  if (selected.has('habits')) {
    const rows = habits.map((h) => ({
      ID: h.id,
      Nome: h.name,
      Cor: h.color,
      'Total de conclusões': h.completions.length,
      'Última conclusão': h.completions.length > 0 ? [...h.completions].sort().at(-1)! : '',
      'Criado em': h.createdAt.slice(0, 10),
      Atualizado: h.updatedAt
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Hábitos')
    appendSheet(
      wb,
      habits.flatMap((habit) =>
        habit.completions.map((date) => ({
          'ID do hábito': habit.id,
          Hábito: habit.name,
          Data: date
        }))
      ),
      'Conclusões hábitos'
    )
  }

  // ── Metas ───────────────────────────────────────────────────────────────────
  if (selected.has('goals')) {
    const rows = goals.map((g) => {
      const total = g.entries.reduce((s, e) => s + e.value, 0)
      return {
        ID: g.id,
        Título: g.title,
        Meta: g.target,
        Unidade: g.unit,
        'Progresso atual': total,
        '% concluído': g.target > 0 ? Math.round((total / g.target) * 100) : '',
        Projeto: g.projectId ? (projectMap[g.projectId]?.name ?? '') : '',
        'ID do projeto': g.projectId ?? '',
        Cor: g.color,
        Criada: g.createdAt.slice(0, 10),
        Atualizada: g.updatedAt
      }
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Metas')
    appendSheet(
      wb,
      goals.flatMap((goal) =>
        goal.entries.map((entry) => ({
          ID: entry.id,
          'ID da meta': goal.id,
          Meta: goal.title,
          Data: entry.date,
          Valor: entry.value,
          Rótulo: entry.label ?? '',
          Criada: entry.createdAt
        }))
      ),
      'Registros de metas'
    )
  }

  // ── Notas (canvas) ──────────────────────────────────────────────────────────
  if (selected.has('notes')) {
    const rows = notes.map((n) => ({
      ID: n.id,
      'ID do projeto': n.projectId,
      Projeto: projectMap[n.projectId]?.name ?? '',
      Tipo: n.type === 'text' ? 'Texto' : 'Nota',
      Conteúdo: n.content,
      Cor: n.color,
      Borda: n.borderStyle ?? '',
      X: n.x,
      Y: n.y,
      Largura: n.width,
      Altura: n.height,
      'Tamanho da fonte': n.fontSize ?? '',
      'IDs de tarefas': (n.taskIds ?? (n.taskId ? [n.taskId] : [])).join(', '),
      'IDs de metas': (n.goalIds ?? []).join(', '),
      Conexões: (n.connections ?? []).join(', '),
      Concluída: n.completedAt ? n.completedAt.slice(0, 10) : '',
      Criada: n.createdAt.slice(0, 10),
      Atualizada: n.updatedAt
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Notas')
  }

  // ── Itens de compra ─────────────────────────────────────────────────────────
  if (selected.has('shopping')) {
    const rows = lists.flatMap((list) => {
      const cfg = CURRENCY_CONFIG[list.currency]
      return list.items.map((item) => ({
        'ID do item': item.id,
        Perfil: profileName(list),
        Lista: list.name,
        'ID da tabela': list.id,
        Nome: item.name,
        Quantidade: item.qty,
        Preço: item.price != null ? Number(item.price) : '',
        'Preço exato': item.price ?? '',
        Moeda: cfg.label,
        Total: item.price != null ? new Decimal(item.price).times(item.qty).toNumber() : '',
        Concluído: item.done ? 'Sim' : 'Não',
        Link: item.link ?? '',
        'ID da transação vinculada': item.linkedTransactionId ?? ''
      }))
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Itens de compra')
  }

  // ── Transações ──────────────────────────────────────────────────────────────
  if (selected.has('transactions')) {
    const allTransactions: Record<string, unknown>[] = []
    const allDetails: Record<string, unknown>[] = []
    const allAudit: Record<string, unknown>[] = []
    const transferGroups = new Map<
      string,
      { list: FinancialTable; tx: FinancialTable['transactions'][number] }[]
    >()
    const tableSheets: { name: string; rows: Record<string, unknown>[] }[] = []
    for (const list of lists) {
      const cfg = CURRENCY_CONFIG[list.currency]
      const rows = list.transactions.map((tx) => {
        const row = {
          'ID da transação': tx.id,
          Perfil: profileName(list),
          Tabela: list.name,
          'ID da tabela': list.id,
          Descrição: tx.description,
          Valor: Number(tx.amount),
          'Valor exato': tx.amount,
          Moeda: cfg.label,
          Código: list.currency,
          Tipo: tx.type === 'income' ? 'Receita' : 'Despesa',
          Data: tx.date,
          Mês: tx.date.slice(0, 7),
          Categoria: tx.category ?? '',
          Origem: tx.source ?? '',
          Contraparte: tx.counterparty ?? '',
          'ID bancário/Pix': tx.bankReference ?? '',
          Comprovantes: (tx.receiptFileIds ?? [])
            .map((id) => files.find((file) => file.id === id)?.name ?? 'Arquivo ausente')
            .join(' | '),
          'IDs dos comprovantes': (tx.receiptFileIds ?? []).join(' | '),
          'Conferido em': tx.reconciledAt ?? '',
          'Criado em': tx.createdAt ?? '',
          'Alterado em': tx.updatedAt ?? '',
          'ID do câmbio': tx.currencyTransferId ?? '',
          'Tarifa do câmbio': tx.currencyTransferFee != null ? Number(tx.currencyTransferFee) : '',
          'Tarifa exata': tx.currencyTransferFee ?? '',
          'Moeda da tarifa': tx.currencyTransferFeeCurrency ?? '',
          'Vinda de compra': tx.fromShopping ? 'Sim' : 'Não',
          'ID da transação vinculada': tx.linkedTransactionId ?? '',
          'Quantidade de detalhes': tx.details?.length ?? 0
        }
        if (tx.currencyTransferId) {
          const members = transferGroups.get(tx.currencyTransferId) ?? []
          members.push({ list, tx })
          transferGroups.set(tx.currencyTransferId, members)
        }
        for (const entry of tx.audit ?? []) {
          for (const change of entry.changes) {
            allAudit.push({
              'ID da transação': tx.id,
              Perfil: profileName(list),
              Tabela: list.name,
              Data: entry.at,
              Campo: change.field,
              Antes: change.before == null ? '' : JSON.stringify(change.before),
              Depois: change.after == null ? '' : JSON.stringify(change.after)
            })
          }
        }
        for (const detail of tx.details ?? []) {
          allDetails.push({
            'ID do detalhe': detail.id,
            'ID da transação': tx.id,
            Perfil: profileName(list),
            Tabela: list.name,
            Descrição: detail.description,
            Valor: Number(detail.amount),
            'Valor exato': detail.amount,
            Moeda: cfg.label,
            Categoria: detail.category ?? '',
            Data: detail.date ?? tx.date,
            'ID da transação espelho': detail.linkedTransactionId ?? ''
          })
        }
        return row
      })
      allTransactions.push(...rows)
      tableSheets.push({ name: list.name, rows })
    }
    appendSheet(
      wb,
      allTransactions.sort((a, b) => String(a.Data).localeCompare(String(b.Data))),
      'Todas transações'
    )
    appendSheet(wb, allDetails, 'Detalhes financeiros')
    if (allAudit.length) appendSheet(wb, allAudit, 'Histórico financeiro')
    if (transferGroups.size)
      appendSheet(
        wb,
        [...transferGroups].map(([id, members]) => {
          const sent = members.find((member) => member.tx.type === 'expense')
          const received = members.find((member) => member.tx.type === 'income')
          return {
            ID: id,
            Perfil: sent ? profileName(sent.list) : received ? profileName(received.list) : '',
            'ID da saída': sent?.tx.id ?? '',
            'Data da saída': sent?.tx.date ?? '',
            'Tabela da saída': sent?.list.name ?? '',
            'Valor enviado': sent ? Number(sent.tx.amount) : '',
            'Valor enviado exato': sent?.tx.amount ?? '',
            'Moeda enviada': sent?.list.currency ?? '',
            'ID da entrada': received?.tx.id ?? '',
            'Data da entrada': received?.tx.date ?? '',
            'Tabela da entrada': received?.list.name ?? '',
            'Valor recebido': received ? Number(received.tx.amount) : '',
            'Valor recebido exato': received?.tx.amount ?? '',
            'Moeda recebida': received?.list.currency ?? '',
            'Taxa efetiva':
              sent && received && new Decimal(sent.tx.amount).greaterThan(0)
                ? new Decimal(received.tx.amount).div(sent.tx.amount).toString()
                : '',
            Tarifa: sent?.tx.currencyTransferFee ?? received?.tx.currencyTransferFee ?? '',
            'Moeda da tarifa':
              sent?.tx.currencyTransferFeeCurrency ?? received?.tx.currencyTransferFeeCurrency ?? ''
          }
        }),
        'Câmbio entre contas'
      )
    for (const sheet of tableSheets) appendSheet(wb, sheet.rows, sheet.name)
  }

  // ── Metas financeiras ────────────────────────────────────────────────────────
  if (selected.has('financialGoals')) {
    const rows = lists.flatMap((list) =>
      list.goals.map((fg) => ({
        'ID da meta': fg.id,
        Perfil: profileName(list),
        Lista: list.name,
        'ID da tabela': list.id,
        Nome: fg.name,
        'Valor alvo': Number(fg.targetAmount),
        'Valor alvo exato': fg.targetAmount,
        Moeda: CURRENCY_CONFIG[list.currency].label,
        'Mês/Ano': `${String(fg.targetMonth).padStart(2, '0')}/${fg.targetYear}`,
        Mês: fg.targetMonth,
        Ano: fg.targetYear,
        Status: fg.completedAt ? 'Concluída' : 'Em andamento',
        'Concluída em': fg.completedAt ? fg.completedAt.slice(0, 10) : '',
        Nota: fg.completionNote ?? ''
      }))
    )
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Metas financeiras')
  }

  if (selected.has('financialTables')) {
    appendSheet(
      wb,
      financialProfiles.map((profile) => ({
        ID: profile.id,
        Nome: profile.name,
        'Categorias personalizadas': (profile.customCategories ?? []).join(', '),
        Criado: profile.createdAt,
        Atualizado: profile.updatedAt
      })),
      'Perfis financeiros'
    )
    appendSheet(
      wb,
      lists.map((list) => ({
        'ID da tabela': list.id,
        Perfil: profileName(list),
        Nome: list.name,
        Moeda: CURRENCY_CONFIG[list.currency].label,
        Código: list.currency,
        Banco: list.provider ?? '',
        'Saldo real': list.actualBalance != null ? Number(list.actualBalance) : '',
        'Saldo real exato': list.actualBalance ?? '',
        'Saldo atualizado em': list.actualBalanceUpdatedAt ?? '',
        Criada: list.createdAt,
        Atualizada: list.updatedAt
      })),
      'Tabelas financeiras'
    )
  }

  if (selected.has('yields')) {
    appendSheet(
      wb,
      lists.flatMap((list) =>
        (list.yieldSources ?? []).map((source) => ({
          ID: source.id,
          Perfil: profileName(list),
          Tabela: list.name,
          Nome: source.name,
          Criada: source.createdAt
        }))
      ),
      'Fontes rendimento'
    )
    appendSheet(
      wb,
      lists.flatMap((list) =>
        (list.yieldEntries ?? []).map((entry) => ({
          ID: entry.id,
          Perfil: profileName(list),
          Tabela: list.name,
          'ID da fonte': entry.sourceId,
          Fonte: list.yieldSources?.find((source) => source.id === entry.sourceId)?.name ?? '',
          Data: entry.date,
          Valor: Number(entry.amount),
          'Valor exato': entry.amount,
          Moeda: list.currency,
          Criada: entry.createdAt
        }))
      ),
      'Rendimentos'
    )
  }

  return wb
}
