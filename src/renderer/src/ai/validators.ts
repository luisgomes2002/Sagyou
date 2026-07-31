// ── Output Validation Layer ──────────────────────────────────────────────────
//
// Validates AI tool outputs against expected shapes before they reach the store.
// Errors are surfaced as warnings on the approval card — never block execution,
// because the human makes the final decision.
//
// Step 9 supplement of the AI agent construction framework:
// "Mecanismos de segurança e pontos de verificação humana."

import { PRIORITY_CONFIG, PROJECT_COLORS, NOTE_COLORS } from '../types'
import { FINANCIAL_CATEGORIES } from '../components/financial/shared'

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

function ok(warnings: string[] = []): ValidationResult {
  return { valid: true, errors: [], warnings }
}

function fail(errors: string[]): ValidationResult {
  return { valid: false, errors, warnings: [] }
}

const VALID_PRIORITIES = new Set(Object.keys(PRIORITY_CONFIG))
const VALID_PROJECT_COLORS: Set<string> = new Set(PROJECT_COLORS)
const VALID_NOTE_COLORS: Set<string> = new Set(NOTE_COLORS)
const VALID_CATEGORIES = new Set(FINANCIAL_CATEGORIES)

// ── Helpers ───────────────────────────────────────────────────────────────────

function isStr(v: unknown): v is string {
  return typeof v === 'string'
}

const CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isCalendarDate(v: string): boolean {
  if (!CALENDAR_DATE_RE.test(v)) return false
  const d = new Date(v + 'T00:00:00')
  return !isNaN(d.getTime())
}

// ── Validators — one per write tool ───────────────────────────────────────────

export function validateCriarProjeto(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  const nome = isStr(args.nome) ? args.nome.trim() : ''
  if (!nome) issues.push('nome é obrigatório')
  if (nome.length > 100) issues.push('nome muito longo (máx 100)')
  const cor = isStr(args.cor) ? args.cor : ''
  if (cor && !VALID_PROJECT_COLORS.has(cor)) issues.push(`cor "${cor}" não é válida`)
  return issues.length ? fail(issues) : ok()
}

export function validateCriarTasks(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  const warnings: string[] = []
  if (!Array.isArray(args.tasks)) {
    return fail(['tasks deve ser um array'])
  }
  if (args.tasks.length === 0) issues.push('array de tasks vazio')
  for (let i = 0; i < args.tasks.length; i++) {
    const t = args.tasks[i] as Record<string, unknown> | undefined
    if (!t || typeof t.titulo !== 'string' || !t.titulo.trim()) {
      issues.push(`task[${i}]: título é obrigatório`)
    }
    if (t && typeof t.titulo === 'string' && t.titulo.length > 500) {
      issues.push(`task[${i}]: título muito longo (máx 500)`)
    }
    if (t && t.prioridade !== undefined && typeof t.prioridade === 'string' && !VALID_PRIORITIES.has(t.prioridade as 'low')) {
      issues.push(`task[${i}]: prioridade "${t.prioridade}" inválida`)
    }
  }
  if (issues.length === 0 && args.tasks.length > 20) {
    warnings.push(`${args.tasks.length} tasks de uma vez é um volume alto — confira os títulos`)
  }
  return issues.length ? fail(issues) : ok(warnings)
}

export function validateAtualizarTask(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  const campos = ['prioridade', 'descricao', 'dueDate', 'tags'] as const
  const algumCampo = campos.some((c) => args[c] !== undefined)
  if (!algumCampo) issues.push('nenhum campo para atualizar')
  if (args.prioridade !== undefined && typeof args.prioridade === 'string' && !VALID_PRIORITIES.has(args.prioridade as 'low')) {
    issues.push(`prioridade "${args.prioridade}" inválida`)
  }
  if (args.dueDate !== undefined && typeof args.dueDate === 'string' && args.dueDate.trim() !== '') {
    if (!isCalendarDate(args.dueDate.trim())) issues.push(`dueDate "${args.dueDate}" não é uma data válida (YYYY-MM-DD)`)
  }
  if (args.tags !== undefined && !Array.isArray(args.tags)) {
    issues.push('tags deve ser um array')
  }
  return issues.length ? fail(issues) : ok()
}

export function validateMoverTask(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  if (!isStr(args.coluna) || !args.coluna!.trim()) issues.push('coluna é obrigatória')
  if (!isStr(args.titulo) && !isStr(args.taskId)) issues.push('titulo ou taskId é obrigatório')
  return issues.length ? fail(issues) : ok()
}

export function validateConcluirTask(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  if (!isStr(args.titulo) && !isStr(args.taskId)) issues.push('titulo ou taskId é obrigatório')
  return issues.length ? fail(issues) : ok()
}

export function validateDeletarTask(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  if (!isStr(args.titulo) && !isStr(args.taskId)) issues.push('titulo ou taskId é obrigatório')
  return issues.length ? fail(issues) : ok()
}

export function validateCriarSprints(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  const nome = isStr(args.nome) ? args.nome.trim() : ''
  if (!nome) issues.push('nome é obrigatório')
  return issues.length ? fail(issues) : ok()
}

export function validateAtribuirSprint(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  if (!isStr(args.sprint)) issues.push('sprint é obrigatório')
  if (!isStr(args.titulo) && !isStr(args.taskId)) issues.push('titulo ou taskId é obrigatório')
  return issues.length ? fail(issues) : ok()
}

export function validateCriarMeta(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  const titulo = isStr(args.titulo) ? args.titulo.trim() : ''
  if (!titulo) issues.push('titulo é obrigatório')
  const target = Number(args.alvo ?? args.target)
  if (!isFinite(target) || target <= 0) issues.push('alvo deve ser um número > 0')
  if (!isStr(args.unidade) && !isStr(args.unit)) issues.push('unidade é obrigatória')
  return issues.length ? fail(issues) : ok()
}

export function validateAtualizarMeta(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  const algumCampo = ['titulo', 'target', 'alvo', 'unidade', 'unit', 'cor'].some((c) => args[c] !== undefined)
  if (!algumCampo) issues.push('nenhum campo para atualizar')
  const target = args.target !== undefined ? Number(args.target) : args.alvo !== undefined ? Number(args.alvo) : undefined
  if (target !== undefined && (!isFinite(target) || target <= 0)) issues.push('target deve ser um número > 0')
  return issues.length ? fail(issues) : ok()
}

export function validateMarcarHabito(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  if (!isStr(args.nome) && !isStr(args.habitoId)) issues.push('nome ou habitoId é obrigatório')
  return issues.length ? fail(issues) : ok()
}

export function validateCriarNota(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  const conteudo = isStr(args.conteudo) ? args.conteudo.trim() : ''
  if (!conteudo) issues.push('conteudo é obrigatório')
  const cor = isStr(args.cor) ? args.cor : ''
  if (cor && !VALID_NOTE_COLORS.has(cor)) issues.push(`cor "${cor}" não é válida`)
  return issues.length ? fail(issues) : ok()
}

export function validateCriarTransacao(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  if (!isStr(args.descricao) || !args.descricao!.trim()) issues.push('descricao é obrigatória')
  const tipo = isStr(args.tipo) ? args.tipo : ''
  if (tipo !== 'receita' && tipo !== 'despesa') issues.push('tipo deve ser "receita" ou "despesa"')
  const valor = args.valor
  if (valor === undefined || valor === null || valor === '') {
    issues.push('valor é obrigatório')
  } else {
    const n = Number(valor)
    if (!isFinite(n) || n <= 0) issues.push('valor deve ser um número positivo')
  }
  const data = isStr(args.data) ? args.data : ''
  if (data && !isCalendarDate(data)) issues.push(`data "${data}" não é uma data válida (YYYY-MM-DD)`)
  const cat = isStr(args.categoria) ? args.categoria : ''
  if (cat && !VALID_CATEGORIES.has(cat)) {
    // category might be custom — warn but don't block
  }
  return issues.length ? fail(issues) : ok()
}

export function validateSalvarMemoria(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  const titulo = isStr(args.titulo) ? args.titulo.trim() : ''
  if (!titulo) issues.push('titulo é obrigatório')
  if (titulo.length > 200) issues.push('titulo muito longo (máx 200)')
  const corpo = isStr(args.corpo) ? args.corpo.trim() : ''
  if (!corpo) issues.push('corpo é obrigatório')
  const tipo = isStr(args.tipo) ? args.tipo : ''
  const tiposValidos = ['decisao', 'tradeoff', 'gotcha', 'fato']
  if (tipo && !tiposValidos.includes(tipo)) issues.push(`tipo "${tipo}" inválido; use: ${tiposValidos.join(', ')}`)
  return issues.length ? fail(issues) : ok()
}

export function validateAjustarBlocoEDeslocarPosteriores(args: Record<string, unknown>): ValidationResult {
  const issues: string[] = []
  const text = (...keys: string[]): string => {
    for (const key of keys) {
      const value = args[key]
      if (isStr(value) && value.trim()) return value.trim()
    }
    return ''
  }
  const data = text('data', 'date')
  if (!isCalendarDate(data)) issues.push('data deve ser uma data válida (YYYY-MM-DD)')
  if (!text('blocoId', 'id', 'titulo', 'bloco', 'atividade', 'nome'))
    issues.push('blocoId ou titulo é obrigatório')
  const novoFim = text('novoFim', 'fim', 'endTime', 'horarioFim', 'horario_fim')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(novoFim)) issues.push('novoFim deve estar em HH:MM')
  return issues.length ? fail(issues) : ok()
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

const VALIDATORS: Record<string, (args: Record<string, unknown>) => ValidationResult> = {
  criar_projeto: validateCriarProjeto,
  criar_tasks: validateCriarTasks,
  atualizar_task: validateAtualizarTask,
  mover_task: validateMoverTask,
  concluir_task: validateConcluirTask,
  deletar_task: validateDeletarTask,
  criar_sprints: validateCriarSprints,
  atribuir_sprint: validateAtribuirSprint,
  criar_meta: validateCriarMeta,
  atualizar_meta: validateAtualizarMeta,
  marcar_habito: validateMarcarHabito,
  criar_nota: validateCriarNota,
  criar_transacao: validateCriarTransacao,
  salvar_memoria: validateSalvarMemoria,
  ajustar_bloco_e_deslocar_posteriores: validateAjustarBlocoEDeslocarPosteriores
}

/**
 * Validate a write tool's arguments before the tool runs.
 * Returns validation errors/warnings to surface on the approval card.
 */
export function validateToolInput(
  name: string,
  args: Record<string, unknown>
): ValidationResult {
  const v = VALIDATORS[name]
  if (!v) return ok()
  return v(args)
}
