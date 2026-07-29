import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildWorkbook } from '../../utils/excelExport'
import type { Project, Task, Habit, Goal, FinancialTable, Sprint, StickyNote } from '../../types'

// ── helpers ───────────────────────────────────────────────────────────────────

function sheetRows(wb: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const sheet = wb.Sheets[name]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet)
}

function sheetNames(wb: XLSX.WorkBook): string[] {
  return wb.SheetNames
}

function build(
  selected: string[],
  overrides: {
    projects?: Project[]
    tasks?: Task[]
    sprints?: Sprint[]
    habits?: Habit[]
    goals?: Goal[]
    notes?: StickyNote[]
    lists?: FinancialTable[]
  } = {}
): XLSX.WorkBook {
  return buildWorkbook(
    new Set(selected) as Set<import('../../utils/excelExport').ExportKey>,
    overrides.projects ?? [],
    overrides.tasks    ?? [],
    overrides.sprints  ?? [],
    overrides.habits   ?? [],
    overrides.goals    ?? [],
    overrides.notes    ?? [],
    overrides.lists    ?? []
  )
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const PROJECT: Project = {
  id: 'p1',
  name: 'Meu App',
  color: '#6366f1',
  description: 'App principal',
  columns: [
    { id: 'col-backlog', name: 'Backlog', order: 0 },
    { id: 'col-done',    name: 'Done',    order: 1 },
  ],
  links: [{ id: 'l1', label: 'GitHub', url: 'https://github.com' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const SPRINT: Sprint = {
  id: 's1',
  projectId: 'p1',
  name: 'Sprint 1',
  createdAt: '2026-05-01T00:00:00.000Z',
  closedAt: '2026-05-14T00:00:00.000Z',
}

const TASK: Task = {
  id: 't1',
  projectId: 'p1',
  columnId: 'col-backlog',
  title: 'Implementar login',
  description: 'Autenticação JWT',
  priority: 'high',
  tags: ['auth', 'backend'],
  dueDate: '2026-07-01',
  timeSpent: 3600,
  sprintId: 's1',
  order: 0,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
}

const HABIT: Habit = {
  id: 'h1',
  name: 'Exercício',
  color: '#22c55e',
  completions: ['2026-06-10', '2026-06-15', '2026-06-17'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-06-17T00:00:00.000Z',
}

const GOAL: Goal = {
  id: 'g1',
  title: 'Ler 12 livros',
  target: 12,
  unit: 'livros',
  color: '#f97316',
  projectId: 'p1',
  entries: [
    { id: 'e1', date: '2026-03-01', value: 5, createdAt: '2026-03-01T00:00:00.000Z' },
    { id: 'e2', date: '2026-06-01', value: 3, createdAt: '2026-06-01T00:00:00.000Z' },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

const NOTE: StickyNote = {
  id: 'n1',
  projectId: 'p1',
  content: 'Lembrar de testar no mobile',
  color: '#fef08a',
  x: 100, y: 200, width: 200, height: 150,
  type: 'note',
  createdAt: '2026-06-10T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
}

const LIST: FinancialTable = {
  id: 'fl1',
  name: 'Pessoal',
  currency: 'BRL',
  items: [
    { id: 'i1', name: 'Teclado', qty: 1, price: '350', done: false, link: 'https://loja.com/teclado' },
    { id: 'i2', name: 'Mouse',   qty: 2, price: '120', done: true },
  ],
  transactions: [
    { id: 'tx1', description: 'Salário', amount: '5000', type: 'income',  date: '2026-06-05', category: 'trabalho' },
    { id: 'tx2', description: 'Aluguel', amount: '1500', type: 'expense', date: '2026-06-10' },
  ],
  goals: [
    { id: 'fg1', name: 'Viagem JP', targetAmount: '10000', targetMonth: 12, targetYear: 2026 },
    { id: 'fg2', name: 'Notebook',  targetAmount: '5000',  targetMonth: 3,  targetYear: 2027,
      completedAt: '2026-06-15', completionNote: 'Comprado!' },
  ],
  yieldSources: [],
  yieldEntries: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-06-17T00:00:00.000Z',
}

// ── sheet selection ───────────────────────────────────────────────────────────

describe('buildWorkbook — sheet selection', () => {
  it('produces no sheets when selection is empty', () => {
    expect(sheetNames(build([]))).toHaveLength(0)
  })

  it('produces exactly the selected sheets', () => {
    const wb = build(['projects', 'sprints'], { projects: [PROJECT], sprints: [SPRINT] })
    expect(sheetNames(wb)).toEqual(['Projetos', 'Sprints'])
  })

  it('produces all 9 sheet groups when all keys are selected', () => {
    const wb = build(
      ['projects', 'tasks', 'sprints', 'habits', 'goals', 'notes', 'shopping', 'transactions', 'financialGoals'],
      { projects: [PROJECT], tasks: [TASK], sprints: [SPRINT], habits: [HABIT], goals: [GOAL], notes: [NOTE], lists: [LIST] }
    )
    expect(sheetNames(wb)).toEqual([
      'Projetos', 'Tarefas', 'Sprints', 'Hábitos', 'Metas', 'Notas',
      'Itens de compra', 'Pessoal', 'Metas financeiras',
    ])
  })
})

// ── Projetos sheet ────────────────────────────────────────────────────────────

describe('buildWorkbook — Projetos sheet', () => {
  function rows() {
    return sheetRows(build(['projects'], { projects: [PROJECT] }), 'Projetos')
  }

  it('maps name, description and color', () => {
    const [row] = rows()
    expect(row['Nome']).toBe('Meu App')
    expect(row['Descrição']).toBe('App principal')
    expect(row['Cor']).toBe('#6366f1')
  })

  it('counts columns correctly', () => {
    const [row] = rows()
    expect(row['Colunas']).toBe(2)
  })

  it('counts links correctly', () => {
    const [row] = rows()
    expect(row['Links']).toBe(1)
  })

  it('reports 0 links when project has none', () => {
    const noLinks: Project = { ...PROJECT, links: undefined }
    const wb = build(['projects'], { projects: [noLinks] })
    expect(sheetRows(wb, 'Projetos')[0]['Links']).toBe(0)
  })

  it('maps createdAt as YYYY-MM-DD', () => {
    const [row] = rows()
    expect(row['Criado']).toBe('2026-01-01')
  })

  it('leaves Descrição blank when undefined', () => {
    const noDesc: Project = { ...PROJECT, description: undefined }
    const wb = build(['projects'], { projects: [noDesc] })
    expect(sheetRows(wb, 'Projetos')[0]['Descrição']).toBe('')
  })

  it('produces one row per project', () => {
    const p2: Project = { ...PROJECT, id: 'p2', name: 'Outro' }
    const wb = build(['projects'], { projects: [PROJECT, p2] })
    expect(sheetRows(wb, 'Projetos')).toHaveLength(2)
  })
})

// ── Tarefas sheet ─────────────────────────────────────────────────────────────

describe('buildWorkbook — Tarefas sheet', () => {
  function rows() {
    return sheetRows(
      build(['tasks'], { projects: [PROJECT], tasks: [TASK], sprints: [SPRINT] }),
      'Tarefas'
    )
  }

  it('maps title, project, column', () => {
    const [row] = rows()
    expect(row['Título']).toBe('Implementar login')
    expect(row['Projeto']).toBe('Meu App')
    expect(row['Coluna']).toBe('Backlog')
  })

  it('maps sprint name', () => {
    const [row] = rows()
    expect(row['Sprint']).toBe('Sprint 1')
  })

  it('leaves Sprint blank when task has no sprint', () => {
    const noSprint: Task = { ...TASK, sprintId: undefined }
    const wb = build(['tasks'], { projects: [PROJECT], tasks: [noSprint] })
    expect(sheetRows(wb, 'Tarefas')[0]['Sprint']).toBe('')
  })

  it('maps priority and tags joined by comma', () => {
    const [row] = rows()
    expect(row['Prioridade']).toBe('high')
    expect(row['Tags']).toBe('auth, backend')
  })

  it('maps due date and created date', () => {
    const [row] = rows()
    expect(row['Prazo']).toBe('2026-07-01')
    expect(row['Criada']).toBe('2026-06-01')
  })

  it('converts timeSpent seconds to minutes', () => {
    expect(rows()[0]['Tempo gasto (min)']).toBe(60)
  })

  it('fills completedAt when present', () => {
    const done: Task = { ...TASK, completedAt: '2026-06-17T15:00:00.000Z' }
    const wb = build(['tasks'], { projects: [PROJECT], tasks: [done] })
    expect(sheetRows(wb, 'Tarefas')[0]['Concluída']).toBe('2026-06-17')
  })

  it('leaves blank fields for missing optional data', () => {
    const minimal: Task = { ...TASK, dueDate: undefined, timeSpent: undefined, sprintId: undefined, description: undefined }
    const wb = build(['tasks'], { projects: [PROJECT], tasks: [minimal] })
    const [row] = sheetRows(wb, 'Tarefas')
    expect(row['Prazo']).toBe('')
    expect(row['Tempo gasto (min)']).toBe('')
    expect(row['Sprint']).toBe('')
    expect(row['Descrição']).toBe('')
  })

  it('produces empty sheet when no tasks', () => {
    expect(sheetRows(build(['tasks']), 'Tarefas')).toHaveLength(0)
  })
})

// ── Sprints sheet ─────────────────────────────────────────────────────────────

describe('buildWorkbook — Sprints sheet', () => {
  function rows() {
    return sheetRows(build(['sprints'], { projects: [PROJECT], sprints: [SPRINT] }), 'Sprints')
  }

  it('maps name and project', () => {
    const [row] = rows()
    expect(row['Nome']).toBe('Sprint 1')
    expect(row['Projeto']).toBe('Meu App')
  })

  it('reports status Fechada for closed sprint', () => {
    expect(rows()[0]['Status']).toBe('Fechada')
  })

  it('reports status Aberta for open sprint', () => {
    const open: Sprint = { ...SPRINT, closedAt: undefined }
    const wb = build(['sprints'], { projects: [PROJECT], sprints: [open] })
    expect(sheetRows(wb, 'Sprints')[0]['Status']).toBe('Aberta')
  })

  it('maps closedAt as YYYY-MM-DD', () => {
    expect(rows()[0]['Fechada']).toBe('2026-05-14')
  })

  it('leaves Fechada blank for open sprint', () => {
    const open: Sprint = { ...SPRINT, closedAt: undefined }
    const wb = build(['sprints'], { projects: [PROJECT], sprints: [open] })
    expect(sheetRows(wb, 'Sprints')[0]['Fechada']).toBe('')
  })

  it('produces empty sheet when no sprints', () => {
    expect(sheetRows(build(['sprints']), 'Sprints')).toHaveLength(0)
  })
})

// ── Hábitos sheet ─────────────────────────────────────────────────────────────

describe('buildWorkbook — Hábitos sheet', () => {
  function rows() {
    return sheetRows(build(['habits'], { habits: [HABIT] }), 'Hábitos')
  }

  it('maps name and total completions', () => {
    const [row] = rows()
    expect(row['Nome']).toBe('Exercício')
    expect(row['Total de conclusões']).toBe(3)
  })

  it('maps the most recent completion date', () => {
    expect(rows()[0]['Última conclusão']).toBe('2026-06-17')
  })

  it('picks latest date regardless of insertion order', () => {
    const shuffled: Habit = { ...HABIT, completions: ['2026-06-17', '2026-06-10', '2026-06-15'] }
    const wb = build(['habits'], { habits: [shuffled] })
    expect(sheetRows(wb, 'Hábitos')[0]['Última conclusão']).toBe('2026-06-17')
  })

  it('leaves última conclusão blank and total 0 when no completions', () => {
    const empty: Habit = { ...HABIT, completions: [] }
    const wb = build(['habits'], { habits: [empty] })
    const [row] = sheetRows(wb, 'Hábitos')
    expect(row['Última conclusão']).toBe('')
    expect(row['Total de conclusões']).toBe(0)
  })
})

// ── Metas sheet ───────────────────────────────────────────────────────────────

describe('buildWorkbook — Metas sheet', () => {
  function rows() {
    return sheetRows(build(['goals'], { projects: [PROJECT], goals: [GOAL] }), 'Metas')
  }

  it('maps title, target and unit', () => {
    const [row] = rows()
    expect(row['Título']).toBe('Ler 12 livros')
    expect(row['Meta']).toBe(12)
    expect(row['Unidade']).toBe('livros')
  })

  it('sums all entry values', () => {
    expect(rows()[0]['Progresso atual']).toBe(8)
  })

  it('calculates percentage rounded', () => {
    expect(rows()[0]['% concluído']).toBe(67)
  })

  it('leaves % blank when target is 0', () => {
    const zero: Goal = { ...GOAL, target: 0 }
    const wb = build(['goals'], { goals: [zero] })
    expect(sheetRows(wb, 'Metas')[0]['% concluído']).toBe('')
  })

  it('resolves project name', () => {
    expect(rows()[0]['Projeto']).toBe('Meu App')
  })

  it('leaves Projeto blank when goal has no projectId', () => {
    const noProj: Goal = { ...GOAL, projectId: undefined }
    const wb = build(['goals'], { goals: [noProj] })
    expect(sheetRows(wb, 'Metas')[0]['Projeto']).toBe('')
  })
})

// ── Notas sheet ───────────────────────────────────────────────────────────────

describe('buildWorkbook — Notas sheet', () => {
  function rows() {
    return sheetRows(build(['notes'], { projects: [PROJECT], notes: [NOTE] }), 'Notas')
  }

  it('maps project name and content', () => {
    const [row] = rows()
    expect(row['Projeto']).toBe('Meu App')
    expect(row['Conteúdo']).toBe('Lembrar de testar no mobile')
  })

  it('maps type "note" as Nota', () => {
    expect(rows()[0]['Tipo']).toBe('Nota')
  })

  it('maps type "text" as Texto', () => {
    const text: StickyNote = { ...NOTE, type: 'text' }
    const wb = build(['notes'], { projects: [PROJECT], notes: [text] })
    expect(sheetRows(wb, 'Notas')[0]['Tipo']).toBe('Texto')
  })

  it('defaults type to Nota when undefined', () => {
    const noType: StickyNote = { ...NOTE, type: undefined }
    const wb = build(['notes'], { projects: [PROJECT], notes: [noType] })
    expect(sheetRows(wb, 'Notas')[0]['Tipo']).toBe('Nota')
  })

  it('maps createdAt as YYYY-MM-DD', () => {
    expect(rows()[0]['Criada']).toBe('2026-06-10')
  })

  it('fills Concluída when completedAt is present', () => {
    const done: StickyNote = { ...NOTE, completedAt: '2026-06-17T12:00:00.000Z' }
    const wb = build(['notes'], { notes: [done] })
    expect(sheetRows(wb, 'Notas')[0]['Concluída']).toBe('2026-06-17')
  })

  it('leaves Concluída blank when not completed', () => {
    expect(rows()[0]['Concluída']).toBe('')
  })

  it('leaves Projeto blank when projectId has no matching project', () => {
    const wb = build(['notes'], { projects: [], notes: [NOTE] })
    expect(sheetRows(wb, 'Notas')[0]['Projeto']).toBe('')
  })

  it('produces empty sheet when no notes', () => {
    expect(sheetRows(build(['notes']), 'Notas')).toHaveLength(0)
  })
})

// ── Itens de compra sheet ─────────────────────────────────────────────────────

describe('buildWorkbook — Itens de compra sheet', () => {
  function rows() {
    return sheetRows(build(['shopping'], { lists: [LIST] }), 'Itens de compra')
  }

  it('maps list name, item name and quantity', () => {
    const [row] = rows()
    expect(row['Lista']).toBe('Pessoal')
    expect(row['Nome']).toBe('Teclado')
    expect(row['Quantidade']).toBe(1)
  })

  it('maps price and calculates total', () => {
    const [row] = rows()
    expect(row['Preço']).toBe(350)
    expect(row['Total']).toBe(350)
  })

  it('calculates total with qty > 1', () => {
    const rows_ = rows()
    expect(rows_[1]['Total']).toBe(240) // 2 * 120
  })

  it('maps currency label', () => {
    expect(rows()[0]['Moeda']).toBe('Real')
  })

  it('maps done as Sim/Não', () => {
    const rows_ = rows()
    expect(rows_[0]['Concluído']).toBe('Não')
    expect(rows_[1]['Concluído']).toBe('Sim')
  })

  it('maps link when present', () => {
    expect(rows()[0]['Link']).toBe('https://loja.com/teclado')
  })

  it('leaves Link blank when absent', () => {
    expect(rows()[1]['Link']).toBe('')
  })

  it('leaves Preço and Total blank when price is undefined', () => {
    const noPrice: FinancialTable = {
      ...LIST,
      items: [{ id: 'i3', name: 'Caderno', qty: 3, done: false }],
    }
    const wb = build(['shopping'], { lists: [noPrice] })
    const [row] = sheetRows(wb, 'Itens de compra')
    expect(row['Preço']).toBe('')
    expect(row['Total']).toBe('')
  })

  it('combines items from multiple lists into one sheet', () => {
    const list2: FinancialTable = { ...LIST, id: 'fl2', name: 'Trabalho', items: [
      { id: 'i4', name: 'Cadeira', qty: 1, price: '800', done: false }
    ] }
    const wb = build(['shopping'], { lists: [LIST, list2] })
    expect(sheetRows(wb, 'Itens de compra')).toHaveLength(3)
  })

  it('produces empty sheet when all lists have no items', () => {
    const empty: FinancialTable = { ...LIST, items: [] }
    expect(sheetRows(build(['shopping'], { lists: [empty] }), 'Itens de compra')).toHaveLength(0)
  })
})

// ── Transações sheet ──────────────────────────────────────────────────────────

describe('buildWorkbook — Transações sheet', () => {
  function rows() {
    return sheetRows(build(['transactions'], { lists: [LIST] }), 'Pessoal')
  }

  it('maps description, amount and date', () => {
    const [row] = rows()
    expect(row['Descrição']).toBe('Salário')
    expect(row['Valor']).toBe(5000)
    expect(row['Data']).toBe('2026-06-05')
  })

  it('translates income to Receita and expense to Despesa', () => {
    const rows_ = rows()
    expect(rows_[0]['Tipo']).toBe('Receita')
    expect(rows_[1]['Tipo']).toBe('Despesa')
  })

  it('resolves currency label', () => {
    expect(rows()[0]['Moeda']).toBe('Real')
  })

  it('maps category, leaves blank when absent', () => {
    const rows_ = rows()
    expect(rows_[0]['Categoria']).toBe('trabalho')
    expect(rows_[1]['Categoria']).toBe('')
  })

  it('creates one sheet per list named after the list', () => {
    const list2: FinancialTable = { ...LIST, id: 'fl2', name: 'Empresa', transactions: [] }
    const wb = build(['transactions'], { lists: [LIST, list2] })
    expect(sheetNames(wb)).toEqual(['Pessoal', 'Empresa'])
  })

  it('truncates sheet names longer than 31 characters', () => {
    const long: FinancialTable = { ...LIST, name: 'Nome muito longo que ultrapassa o limite do Excel definitivamente' }
    const wb = build(['transactions'], { lists: [long] })
    expect(sheetNames(wb)[0].length).toBeLessThanOrEqual(31)
  })

  it('handles USD currency', () => {
    const usd: FinancialTable = { ...LIST, currency: 'USD' }
    const wb = build(['transactions'], { lists: [usd] })
    expect(sheetRows(wb, 'Pessoal')[0]['Moeda']).toBe('Dólar')
  })

  it('handles JPY currency', () => {
    const jpy: FinancialTable = { ...LIST, currency: 'JPY' }
    const wb = build(['transactions'], { lists: [jpy] })
    expect(sheetRows(wb, 'Pessoal')[0]['Moeda']).toBe('Iene')
  })
})

// ── Metas financeiras sheet ───────────────────────────────────────────────────

describe('buildWorkbook — Metas financeiras sheet', () => {
  function rows() {
    return sheetRows(build(['financialGoals'], { lists: [LIST] }), 'Metas financeiras')
  }

  it('maps list name, goal name and target amount', () => {
    const [row] = rows()
    expect(row['Lista']).toBe('Pessoal')
    expect(row['Nome']).toBe('Viagem JP')
    expect(row['Valor alvo']).toBe(10000)
  })

  it('maps currency label', () => {
    expect(rows()[0]['Moeda']).toBe('Real')
  })

  it('formats Mês/Ano with zero-padded month', () => {
    expect(rows()[0]['Mês/Ano']).toBe('12/2026')
  })

  it('zero-pads single-digit months', () => {
    expect(rows()[1]['Mês/Ano']).toBe('03/2027')
  })

  it('reports Em andamento for incomplete goals', () => {
    expect(rows()[0]['Status']).toBe('Em andamento')
  })

  it('reports Concluída for completed goals', () => {
    expect(rows()[1]['Status']).toBe('Concluída')
  })

  it('maps completedAt date', () => {
    expect(rows()[1]['Concluída em']).toBe('2026-06-15')
  })

  it('leaves Concluída em blank for pending goals', () => {
    expect(rows()[0]['Concluída em']).toBe('')
  })

  it('maps completion note', () => {
    expect(rows()[1]['Nota']).toBe('Comprado!')
  })

  it('leaves Nota blank when absent', () => {
    expect(rows()[0]['Nota']).toBe('')
  })

  it('combines goals from multiple lists into one sheet', () => {
    const list2: FinancialTable = { ...LIST, id: 'fl2', name: 'Trabalho', goals: [
      { id: 'fg3', name: 'Curso', targetAmount: '500', targetMonth: 8, targetYear: 2026 }
    ] }
    const wb = build(['financialGoals'], { lists: [LIST, list2] })
    expect(sheetRows(wb, 'Metas financeiras')).toHaveLength(3)
  })

  it('produces empty sheet when all lists have no financial goals', () => {
    const empty: FinancialTable = { ...LIST, goals: [] }
    expect(sheetRows(build(['financialGoals'], { lists: [empty] }), 'Metas financeiras')).toHaveLength(0)
  })
})
