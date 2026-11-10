import type { SyncConflictView, SyncVersionView } from './engine'
import { parseHlc } from './hlc'
import { extractDataRecords, type SyncKind, type SyncSourceData } from './records'
import { recordName, syncKindLabel } from './view'

/**
 * The conflict comparison both apps draw: Portuguese field names, readable
 * values, the differing fields first and a suggested pick per field. Pure: the
 * apps hand in a name lookup for ids, the engine writes the choice.
 */

export type Side = 'local' | 'remote'
export type NameLookup = (kind: SyncKind, id: string) => string | null

export interface Segment {
  text: string
  changed: boolean
}

export interface FieldValue {
  text: string
  present: boolean
  segments?: Segment[]
}

export interface FieldRow {
  field: string
  label: string
  local: FieldValue
  remote: FieldValue
}

export interface ConflictComparison {
  choosable: boolean
  /** Null when the two versions' clocks give no order. */
  newer: Side | null
  differing: FieldRow[]
  equal: FieldRow[]
  /** The suggested pick, only for `differing` fields. */
  initial: Record<string, Side>
  /** The larger time spent came from the older version. */
  timeNote: boolean
}

export const CONFLICT_TEXTS = {
  explain:
    'O mesmo item mudou em dois aparelhos antes de um receber a mudança do outro. Escolha o que fica; a escolha vai para todos os aparelhos.',
  thisDevice: 'Este aparelho',
  newer: 'Mais recente',
  empty: '(vazio)',
  onlyIn: (device: string): string => `Só em ${device}`,
  equalSection: (n: number): string => `Igual nos dois (${n})`,
  diffHint: 'Trecho diferente destacado',
  timeNote: 'Marcamos o maior tempo para não perder tempo do cronômetro.',
  save: 'Salvar escolha',
  keepNewer: 'Ficar com a mais recente',
  keepThis: 'Ficar com a deste aparelho',
  keepOther: (device: string): string => `Ficar com a de ${device}`,
  pickThis: 'Usar a deste aparelho',
  pickOther: (device: string): string => `Usar a de ${device}`,
  deleted: 'Apagado',
  deletedIn: (device: string): string => `Apagado em ${device}`,
  missingRef: '(item não encontrado)',
  alreadyResolved: 'Este conflito já foi resolvido em outro aparelho.',
  changed: 'O item mudou enquanto você comparava. Confira de novo.',
  chooseAll: 'Escolha um valor para cada campo diferente.'
} as const

/** Fields per kind, in the order `extractDataRecords` builds them (id and updatedAt left out). */
export const FIELD_ORDER: Record<SyncKind, readonly string[]> = {
  project: ['name', 'description', 'color', 'order', 'archivedAt', 'createdAt'],
  project_column: ['projectId', 'name', 'order', 'color'],
  project_link: ['projectId', 'label', 'url'],
  task: [
    'projectId',
    'columnId',
    'title',
    'description',
    'priority',
    'dueDate',
    'sprintId',
    'timeSpent',
    'order',
    'createdAt',
    'completedAt',
    'tags',
    'images'
  ],
  sprint: ['projectId', 'name', 'createdAt', 'closedAt'],
  note: [
    'projectId',
    'content',
    'color',
    'borderStyle',
    'x',
    'y',
    'width',
    'height',
    'taskId',
    'taskIds',
    'goalIds',
    'fontSize',
    'type',
    'completedAt',
    'createdAt',
    'connections'
  ],
  goal: ['title', 'kind', 'target', 'unit', 'color', 'projectId', 'createdAt'],
  goal_entry: ['goalId', 'date', 'label', 'value', 'createdAt'],
  habit: ['name', 'color', 'createdAt'],
  habit_completion: ['habitId', 'date'],
  financial_profile: [
    'name',
    'createdAt',
    'customCategories',
    'savedSources',
    'savedCounterparties'
  ],
  financial_table: [
    'name',
    'currency',
    'createdAt',
    'profileId',
    'provider',
    'actualBalance',
    'actualBalanceUpdatedAt',
    'legacyFinancialMetadata'
  ],
  financial_debt: [
    'tableId',
    'name',
    'originalAmount',
    'remainingAmount',
    'createdAt',
    'completedAt'
  ],
  transaction: [
    'tableId',
    'description',
    'amount',
    'type',
    'date',
    'category',
    'fromShopping',
    'linkedTransactionId',
    'source',
    'details',
    'receiptFileIds',
    'bankReference',
    'counterparty',
    'createdAt',
    'reconciledAt',
    'audit',
    'currencyTransferId',
    'currencyTransferFee',
    'currencyTransferFeeCurrency',
    'debtId'
  ],
  shopping_item: ['tableId', 'name', 'qty', 'price', 'done', 'link', 'linkedTransactionId'],
  financial_goal: [
    'tableId',
    'name',
    'targetAmount',
    'targetMonth',
    'targetYear',
    'completedAt',
    'completionNote'
  ],
  yield_source: ['tableId', 'name', 'createdAt'],
  yield_entry: ['tableId', 'sourceId', 'date', 'amount', 'createdAt'],
  file: ['name', 'ext', 'size', 'createdAt', 'projectId'],
  time_block: [
    'date',
    'startTime',
    'endTime',
    'title',
    'description',
    'taskId',
    'habitId',
    'type',
    'color',
    'borderStyle',
    'order',
    'createdAt'
  ],
  routine: [
    'title',
    'description',
    'startTime',
    'endTime',
    'daysOfWeek',
    'color',
    'borderStyle',
    'active',
    'createdAt'
  ],
  memory: [
    'projectId',
    'type',
    'title',
    'body',
    'tags',
    'pinned',
    'source',
    'createdAt',
    'archivedAt'
  ]
}

/** Labels shared by most kinds; a kind's own table overrides them. */
const COMMON_LABELS: Record<string, string> = {
  projectId: 'Projeto',
  columnId: 'Coluna',
  sprintId: 'Sprint',
  taskId: 'Task',
  taskIds: 'Tasks ligadas',
  goalId: 'Meta',
  goalIds: 'Metas ligadas',
  habitId: 'Hábito',
  tableId: 'Tabela',
  profileId: 'Perfil financeiro',
  sourceId: 'Fonte de rendimento',
  debtId: 'Dívida',
  linkedTransactionId: 'Transação ligada',
  receiptFileIds: 'Comprovantes',
  title: 'Título',
  name: 'Nome',
  label: 'Rótulo',
  description: 'Descrição',
  content: 'Texto',
  body: 'Texto',
  color: 'Cor',
  borderStyle: 'Borda',
  order: 'Posição',
  type: 'Tipo',
  date: 'Data',
  startTime: 'Início',
  endTime: 'Fim',
  url: 'Endereço',
  link: 'Link',
  createdAt: 'Criado em',
  completedAt: 'Concluído em',
  closedAt: 'Encerrada em',
  archivedAt: 'Arquivado em',
  amount: 'Valor',
  value: 'Valor',
  tags: 'Tags'
}

const OWN_LABELS: Partial<Record<SyncKind, Record<string, string>>> = {
  project: {},
  project_column: { order: 'Posição no quadro' },
  task: {
    priority: 'Prioridade',
    dueDate: 'Prazo',
    timeSpent: 'Tempo gasto',
    order: 'Posição na coluna',
    createdAt: 'Criada em',
    completedAt: 'Concluída em',
    images: 'Imagens'
  },
  sprint: { createdAt: 'Criada em' },
  note: {
    x: 'Posição horizontal',
    y: 'Posição vertical',
    width: 'Largura',
    height: 'Altura',
    fontSize: 'Tamanho da letra',
    connections: 'Ligações',
    createdAt: 'Criada em',
    completedAt: 'Concluída em'
  },
  goal: { kind: 'Tipo de meta', target: 'Alvo', unit: 'Unidade', createdAt: 'Criada em' },
  goal_entry: {},
  habit: {},
  habit_completion: { date: 'Dia' },
  financial_profile: {
    customCategories: 'Categorias próprias',
    savedSources: 'Origens salvas',
    savedCounterparties: 'Pessoas salvas'
  },
  financial_table: {
    currency: 'Moeda',
    provider: 'Banco',
    actualBalance: 'Saldo real',
    actualBalanceUpdatedAt: 'Saldo real conferido em',
    legacyFinancialMetadata: 'Dados antigos',
    createdAt: 'Criada em'
  },
  financial_debt: {
    originalAmount: 'Valor original',
    remainingAmount: 'Valor restante',
    createdAt: 'Criada em',
    completedAt: 'Quitada em'
  },
  transaction: {
    category: 'Categoria',
    fromShopping: 'Veio da lista de compras',
    source: 'Origem',
    details: 'Detalhes',
    bankReference: 'Referência do banco',
    counterparty: 'Pessoa',
    createdAt: 'Criada em',
    reconciledAt: 'Conferida em',
    audit: 'Histórico de alterações',
    currencyTransferId: 'Transferência entre moedas',
    currencyTransferFee: 'Tarifa da transferência',
    currencyTransferFeeCurrency: 'Moeda da tarifa'
  },
  shopping_item: { qty: 'Quantidade', price: 'Preço', done: 'Comprado' },
  financial_goal: {
    targetAmount: 'Valor alvo',
    targetMonth: 'Mês alvo',
    targetYear: 'Ano alvo',
    completedAt: 'Concluída em',
    completionNote: 'Nota de conclusão'
  },
  yield_source: {},
  yield_entry: {},
  file: { ext: 'Extensão', size: 'Tamanho' },
  time_block: {},
  routine: { daysOfWeek: 'Dias da semana', active: 'Ativa', createdAt: 'Criada em' },
  memory: { type: 'Tipo de memória', pinned: 'Fixada', source: 'Origem', createdAt: 'Criada em' }
}

/** Every label: own table over the common one, for the fields of each kind. */
export const FIELD_LABELS: Record<SyncKind, Record<string, string>> = Object.fromEntries(
  (Object.keys(FIELD_ORDER) as SyncKind[]).map((kind) => [
    kind,
    Object.fromEntries(
      FIELD_ORDER[kind]
        .map((field): [string, string | undefined] => [
          field,
          OWN_LABELS[kind]?.[field] ?? COMMON_LABELS[field]
        ])
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
    )
  ])
) as Record<SyncKind, Record<string, string>>

export function fieldLabel(kind: SyncKind, field: string): string {
  const own = FIELD_LABELS[kind]?.[field]
  if (own) return own
  const words = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// ---- values ----

/** Which kind an id field points at. */
const REFERENCES: Record<string, SyncKind> = {
  projectId: 'project',
  columnId: 'project_column',
  sprintId: 'sprint',
  taskId: 'task',
  taskIds: 'task',
  goalId: 'goal',
  goalIds: 'goal',
  habitId: 'habit',
  tableId: 'financial_table',
  profileId: 'financial_profile',
  sourceId: 'yield_source',
  debtId: 'financial_debt',
  linkedTransactionId: 'transaction',
  receiptFileIds: 'file',
  connections: 'note'
}

const MONEY_FIELDS = new Set([
  'amount',
  'originalAmount',
  'remainingAmount',
  'targetAmount',
  'price',
  'actualBalance',
  'currencyTransferFee'
])

/** Flags: `false` is dropped from the payload, so an absent value reads "Não". */
const BOOLEAN_FIELDS = new Set(['done', 'fromShopping', 'active', 'pinned'])

const PRIORITY: Record<string, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  urgent: 'Urgente'
}

const ENUMS: Record<string, Record<string, string>> = {
  priority: PRIORITY,
  borderStyle: { solid: 'Contínua', dashed: 'Tracejada' }
}

const KIND_ENUMS: Partial<Record<SyncKind, Record<string, Record<string, string>>>> = {
  transaction: { type: { income: 'Receita', expense: 'Despesa' } },
  goal: { kind: { completion: 'Conclusão', quantity: 'Quantidade' } }
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const MAX_OBJECT_TEXT = 200

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0)
  )
}

function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  if (m > 0) return `${m} min`
  return `${total} s`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function scalar(value: unknown): string {
  if (typeof value === 'string') {
    const date = DATE_ONLY.exec(value)
    if (date) return `${date[3]}/${date[2]}/${date[1]}`
    if (DATE_TIME.test(value)) {
      const ms = Date.parse(value)
      if (!Number.isNaN(ms)) return new Date(ms).toLocaleString('pt-BR')
    }
    return value
  }
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'number') return String(value)
  const json = JSON.stringify(value) ?? ''
  return json.length > MAX_OBJECT_TEXT ? `${json.slice(0, MAX_OBJECT_TEXT - 1)}…` : json
}

export function formatFieldValue(
  kind: SyncKind,
  field: string,
  value: unknown,
  names: NameLookup
): string {
  if (BOOLEAN_FIELDS.has(field)) return value === true ? 'Sim' : 'Não'
  if (isEmpty(value)) return CONFLICT_TEXTS.empty
  const ref = REFERENCES[field]
  if (ref) {
    const ids = Array.isArray(value) ? value : [value]
    return ids.map((id) => names(ref, String(id)) ?? CONFLICT_TEXTS.missingRef).join(', ')
  }
  if (field === 'timeSpent' && typeof value === 'number') return duration(value)
  if (field === 'order' && typeof value === 'number') return `Posição ${value + 1}`
  if (MONEY_FIELDS.has(field)) return String(value).replace('.', ',')
  const enumLabels = KIND_ENUMS[kind]?.[field] ?? ENUMS[field]
  if (enumLabels && typeof value === 'string') return enumLabels[value] ?? value
  if (field === 'images' && Array.isArray(value)) return plural(value.length, 'imagem', 'imagens')
  if (field === 'details' && Array.isArray(value))
    return plural(value.length, 'detalhe', 'detalhes')
  if (field === 'audit' && Array.isArray(value))
    return plural(value.length, 'alteração', 'alterações')
  if (field === 'daysOfWeek' && Array.isArray(value))
    return value.map((d) => WEEKDAYS[Number(d)] ?? String(d)).join(', ')
  if (field === 'size' && typeof value === 'number') return `${value} bytes`
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null))
    return value.map(scalar).join(', ')
  return scalar(value)
}

// ---- word diff ----

const MAX_DIFF_WORDS = 4000
const LONG_TEXT = 80

function tokens(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t !== '')
}

function words(list: string[]): number {
  return list.filter((t) => !/^\s+$/.test(t)).length
}

function segments(list: string[], keep: boolean[]): Segment[] {
  const out: Segment[] = []
  list.forEach((text, i) => {
    // Whitespace follows the word before it, so a change reads as one block.
    const changed = /^\s+$/.test(text) ? (out[out.length - 1]?.changed ?? false) : !keep[i]
    const last = out[out.length - 1]
    if (last && last.changed === changed) last.text += text
    else out.push({ text, changed })
  })
  return out
}

/** Word-level difference of two texts; null when they are too long to compare. */
export function wordDiff(a: string, b: string): { local: Segment[]; remote: Segment[] } | null {
  const x = tokens(a)
  const y = tokens(b)
  if (words(x) + words(y) > MAX_DIFF_WORDS) return null
  // Longest common subsequence over the tokens.
  const rows = x.length + 1
  const cols = y.length + 1
  const table = new Uint32Array(rows * cols)
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      table[i * cols + j] =
        x[i] === y[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1])
  const keepX = new Array<boolean>(x.length).fill(false)
  const keepY = new Array<boolean>(y.length).fill(false)
  let i = 0
  let j = 0
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      keepX[i++] = true
      keepY[j++] = true
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) i++
    else j++
  }
  return { local: segments(x, keepX), remote: segments(y, keepY) }
}

// ---- comparison ----

/**
 * Whole-version only. Money records: mixing fields could leave a bank check
 * covering an unchecked amount, or a debt payment out of step with its debt
 * (decided by Luis, 2026-11-10). A debt's balance is tied to its payments; a
 * memory has its own write rules.
 */
const NO_FIELD_CHOICE: ReadonlySet<SyncKind> = new Set([
  'financial_debt',
  'transaction',
  'shopping_item',
  'financial_goal',
  'yield_entry',
  'memory'
])

/**
 * Fields that only make sense together, picked as one: a task's column must
 * belong to its project (the backup validator refuses anything else).
 */
export const FIELD_GROUPS: Partial<
  Record<SyncKind, { key: string; label: string; fields: readonly string[] }>
> = {
  task: { key: 'place', label: 'Lugar', fields: ['projectId', 'columnId', 'sprintId', 'order'] },
  note: {
    key: 'links',
    label: 'Projeto e ligações',
    fields: ['projectId', 'taskId', 'taskIds', 'goalIds', 'connections']
  }
}

function hasContent(v: SyncVersionView): boolean {
  return !v.deleted && v.payload !== null
}

/** Whether this conflict can be resolved field by field. */
export function canChooseFields(c: SyncConflictView): boolean {
  return (
    c.type !== 'orphan' &&
    !NO_FIELD_CHOICE.has(c.kind) &&
    hasContent(c.local) &&
    hasContent(c.remote)
  )
}

/** The HLC of this device's current version, as the screen read it (`expectedHlc`). */
export function currentHlcOf(c: SyncConflictView): string | null {
  return c[c.current].hlc
}

/** The newer of two versions by their clocks; null when unknown or equal. */
export function newerSide(c: SyncConflictView): Side | null {
  const a = c.local.hlc ? parseHlc(c.local.hlc) : null
  const b = c.remote.hlc ? parseHlc(c.remote.hlc) : null
  if (!a || !b) return null
  const order =
    a.ms - b.ms ||
    a.counter - b.counter ||
    (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0)
  return order > 0 ? 'local' : order < 0 ? 'remote' : null
}

/** One rule for "the same value" in the screen and the engine: empty equals absent. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

function canonical(value: unknown): unknown {
  if (isEmpty(value)) return null
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => [k, canonical((value as Record<string, unknown>)[k])] as const)
      .filter(([, v]) => v !== null)
    return entries.length ? Object.fromEntries(entries) : null
  }
  return value
}

/** The fields of a kind in display order: the listed ones, then unknown keys alphabetically. */
function fieldsOf(
  kind: SyncKind,
  a: Record<string, unknown>,
  b: Record<string, unknown>
): string[] {
  const listed = FIELD_ORDER[kind] ?? []
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  keys.delete('id')
  keys.delete('updatedAt')
  const extra = [...keys].filter((k) => !listed.includes(k)).sort()
  return [...listed.filter((k) => keys.has(k)), ...extra]
}

function value(kind: SyncKind, field: string, raw: unknown, names: NameLookup): FieldValue {
  return {
    text: formatFieldValue(kind, field, raw, names),
    present: BOOLEAN_FIELDS.has(field) || !isEmpty(raw)
  }
}

function isLongText(v: unknown): v is string {
  return typeof v === 'string' && (v.length > LONG_TEXT || v.includes('\n'))
}

export function compareConflict(c: SyncConflictView, names: NameLookup): ConflictComparison {
  const choosable = canChooseFields(c)
  const newer = newerSide(c)
  if (!hasContent(c.local) || !hasContent(c.remote))
    return { choosable, newer, differing: [], equal: [], initial: {}, timeNote: false }
  const a = c.local.payload as Record<string, unknown>
  const b = c.remote.payload as Record<string, unknown>
  const differing: FieldRow[] = []
  const equal: FieldRow[] = []
  for (const field of fieldsOf(c.kind, a, b)) {
    const row: FieldRow = {
      field,
      label: fieldLabel(c.kind, field),
      local: value(c.kind, field, a[field], names),
      remote: value(c.kind, field, b[field], names)
    }
    if (sameValue(a[field], b[field])) {
      equal.push(row)
      continue
    }
    if (isLongText(a[field]) && isLongText(b[field])) {
      const diff = wordDiff(a[field], b[field])
      if (diff) {
        row.local.segments = diff.local
        row.remote.segments = diff.remote
      }
    }
    differing.push(row)
  }
  const group = FIELD_GROUPS[c.kind]
  if (group && differing.some((row) => group.fields.includes(row.field))) {
    // One row for the whole group, built from every member on each side.
    const text = (payload: Record<string, unknown>): FieldValue => {
      const parts = group.fields
        .filter((f) => !isEmpty(payload[f]))
        .map((f) => formatFieldValue(c.kind, f, payload[f], names))
      return {
        text: parts.length ? parts.join(' › ') : CONFLICT_TEXTS.empty,
        present: parts.length > 0
      }
    }
    const row: FieldRow = { field: group.key, label: group.label, local: text(a), remote: text(b) }
    const at = differing.findIndex((r) => group.fields.includes(r.field))
    const rest = differing.filter((r) => !group.fields.includes(r.field))
    rest.splice(Math.min(at, rest.length), 0, row)
    differing.splice(0, differing.length, ...rest)
    const keep = equal.filter((r) => !group.fields.includes(r.field))
    equal.splice(0, equal.length, ...keep)
  }
  const initial: Record<string, Side> = {}
  let timeNote = false
  if (choosable) {
    const pick: Side = newer ?? 'local'
    for (const row of differing) initial[row.field] = pick
    if ('timeSpent' in initial) {
      const local = Number(a.timeSpent ?? 0)
      const remote = Number(b.timeSpent ?? 0)
      initial.timeSpent = local >= remote ? 'local' : 'remote'
      timeNote = initial.timeSpent !== pick
    }
  }
  return { choosable, newer, differing, equal, initial, timeNote }
}

function deviceOf(c: SyncConflictView, side: Side): string {
  return side === 'local' ? CONFLICT_TEXTS.thisDevice : c.remote.deviceName
}

/** "3 campos diferentes · mais recente: Dell", the line under a conflict in the list. */
export function conflictSummary(c: SyncConflictView, cmp: ConflictComparison): string {
  const newer = cmp.newer ? ` · mais recente: ${deviceOf(c, cmp.newer)}` : ''
  if (!hasContent(c.local)) return `${CONFLICT_TEXTS.deletedIn(CONFLICT_TEXTS.thisDevice)}${newer}`
  if (!hasContent(c.remote)) return `${CONFLICT_TEXTS.deletedIn(c.remote.deviceName)}${newer}`
  const n = cmp.differing.length
  return `${plural(n, 'campo diferente', 'campos diferentes')}${newer}`
}

/** Names of every record in the app's data, for the ids a conflict shows. */
export function conflictNames(data: SyncSourceData): NameLookup {
  const names = new Map<string, string>()
  for (const record of extractDataRecords(data)) {
    const name = recordName(record.payload)
    if (name) names.set(`${record.kind}:${record.id}`, name)
  }
  return (kind, id) => names.get(`${kind}:${id}`) ?? null
}

/** "Task: Comprar pão", the heading of a conflict in both apps. */
export function conflictTitle(c: SyncConflictView): string {
  const name = recordName(c.remote.payload) ?? recordName(c.local.payload)
  return `${syncKindLabel(c.kind)}${name ? `: ${name}` : ''}`
}
