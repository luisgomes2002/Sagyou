import { createHash } from 'crypto'
import type { AiMemory } from '../ai/memory'
import { moneyText, transactionDetails } from '../financial/money-text'

/**
 * The units sync versions. Each one is small on purpose: a transaction, a habit
 * day or a board column is its own record, so edits made on different devices
 * rarely compete for the same one (a financial table is not one blob holding
 * every transaction).
 */
export type SyncKind =
  | 'project'
  | 'project_column'
  | 'project_link'
  | 'task'
  | 'sprint'
  | 'note'
  | 'goal'
  | 'goal_entry'
  | 'habit'
  | 'habit_completion'
  | 'financial_profile'
  | 'financial_table'
  | 'financial_debt'
  | 'transaction'
  | 'shopping_item'
  | 'financial_goal'
  | 'yield_source'
  | 'yield_entry'
  | 'file'
  | 'time_block'
  | 'routine'
  | 'memory'

export const DATA_KINDS: readonly SyncKind[] = [
  'project',
  'project_column',
  'project_link',
  'task',
  'sprint',
  'note',
  'goal',
  'goal_entry',
  'habit',
  'habit_completion',
  'financial_profile',
  'financial_table',
  'financial_debt',
  'transaction',
  'shopping_item',
  'financial_goal',
  'yield_source',
  'yield_entry',
  'file',
  'time_block',
  'routine'
]

export const MEMORY_KINDS: readonly SyncKind[] = ['memory']

export interface SyncRecord {
  kind: SyncKind
  id: string
  payload: Record<string, unknown>
  hash: string
}

/**
 * The parts of the store's save payload that sync reads. Everything is `unknown`
 * so this module never imports store.ts; device-only parts (timers, UI
 * preferences, the active profile, code paths) are simply never read.
 */
export interface SyncSourceData {
  projects?: unknown
  tasks?: unknown
  sprints?: unknown
  notes?: unknown
  goals?: unknown
  habits?: unknown
  lists?: unknown
  financialProfiles?: unknown
  files?: unknown
  timeBlocks?: unknown
  routines?: unknown
}

type Row = Record<string, unknown>

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((v): v is Row => !!v && typeof v === 'object' && !Array.isArray(v))
    : []
}

function sortedSet(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string'))].sort()
    : []
}

function borderStyle(value: unknown): unknown {
  return value === 'solid' || value === 'dashed' ? value : undefined
}

/** A number SQLite keeps in a TEXT column (notes.font_size) reads back as a string. */
function numeric(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') return value
  const n = Number(value)
  return Number.isFinite(n) ? n : value
}

function optionalMoney(value: unknown): string | undefined {
  return value == null || value === '' ? undefined : moneyText(value)
}

/**
 * Drop everything that only means "nothing here": undefined, null, '', false,
 * empty arrays and empty objects. The renderer and loadData() disagree on these
 * (an absent field reads back absent, a 0/1 flag reads back true/false, an empty
 * JSON list reads back missing); collapsing them keeps both shapes on one hash.
 */
function clean(value: unknown): unknown {
  if (value === undefined || value === null || value === '' || value === false) return undefined
  if (Array.isArray(value)) {
    const items = value.map(clean).filter((v) => v !== undefined)
    return items.length ? items : undefined
  }
  if (typeof value === 'object') {
    const out: Row = {}
    for (const [key, v] of Object.entries(value as Row)) {
      const cleaned = clean(v)
      if (cleaned !== undefined) out[key] = cleaned
    }
    return Object.keys(out).length ? out : undefined
  }
  return value
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Row)[key])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * `updatedAt` stays in the payload but out of the hash: the renderer bumps a
 * parent's updatedAt whenever one of its children changes (a transaction, a
 * habit day, a code path), and that alone is not an edit of the parent.
 */
export function hashPayload(payload: Record<string, unknown>): string {
  const content = { ...payload }
  delete content.updatedAt
  return createHash('sha256').update(canonicalJson(content)).digest('hex')
}

function record(kind: SyncKind, id: string, fields: Row): SyncRecord {
  const payload = (clean(fields) as Row | undefined) ?? {}
  return { kind, id, payload, hash: hashPayload(payload) }
}

// Field lists mirror what prepareWrite().insert in store.ts stores, so a record
// read back by loadData() hashes like the renderer's object. A field added to a
// persisted entity must be added here too, or edits to it are never versioned.
export function extractDataRecords(data: SyncSourceData): SyncRecord[] {
  const out: SyncRecord[] = []

  for (const p of rows(data.projects)) {
    const id = String(p.id)
    out.push(
      record('project', id, {
        id,
        name: p.name,
        description: p.description,
        color: p.color,
        order: p.order,
        archivedAt: p.archivedAt,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      })
    )
    for (const c of rows(p.columns))
      out.push(
        record('project_column', String(c.id), {
          id: c.id,
          projectId: id,
          name: c.name,
          order: c.order,
          color: c.color
        })
      )
    for (const l of rows(p.links))
      out.push(
        record('project_link', String(l.id), {
          id: l.id,
          projectId: id,
          label: l.label,
          url: l.url
        })
      )
  }

  for (const t of rows(data.tasks))
    out.push(
      record('task', String(t.id), {
        id: t.id,
        projectId: t.projectId,
        columnId: t.columnId,
        title: t.title,
        description: t.description,
        priority: t.priority,
        dueDate: t.dueDate,
        sprintId: t.sprintId,
        timeSpent: t.timeSpent,
        order: t.order,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        completedAt: t.completedAt,
        tags: sortedSet(t.tags),
        images: rows(t.images).map((i) => ({
          id: i.id,
          name: i.name,
          ext: i.ext,
          size: i.size,
          addedAt: i.addedAt
        }))
      })
    )

  for (const s of rows(data.sprints))
    out.push(
      record('sprint', String(s.id), {
        id: s.id,
        projectId: s.projectId,
        name: s.name,
        createdAt: s.createdAt,
        closedAt: s.closedAt
      })
    )

  for (const n of rows(data.notes))
    out.push(
      record('note', String(n.id), {
        id: n.id,
        projectId: n.projectId,
        content: n.content,
        color: n.color,
        borderStyle: borderStyle(n.borderStyle),
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
        taskId: n.taskId,
        taskIds: n.taskIds,
        goalIds: n.goalIds,
        fontSize: numeric(n.fontSize),
        type: n.type,
        completedAt: n.completedAt,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        connections: sortedSet(n.connections)
      })
    )

  for (const g of rows(data.goals)) {
    const id = String(g.id)
    out.push(
      record('goal', id, {
        id,
        title: g.title,
        kind: g.kind === 'completion' || g.kind === 'quantity' ? g.kind : undefined,
        target: g.target,
        unit: g.unit,
        color: g.color,
        projectId: g.projectId,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt
      })
    )
    for (const e of rows(g.entries))
      out.push(
        record('goal_entry', String(e.id), {
          id: e.id,
          goalId: id,
          date: e.date,
          label: e.label,
          value: e.value,
          createdAt: e.createdAt
        })
      )
  }

  for (const h of rows(data.habits)) {
    const id = String(h.id)
    out.push(
      record('habit', id, {
        id,
        name: h.name,
        color: h.color,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt
      })
    )
    for (const date of sortedSet(h.completions))
      out.push(record('habit_completion', `${id}:${date}`, { habitId: id, date }))
  }

  for (const fp of rows(data.financialProfiles))
    out.push(
      record('financial_profile', String(fp.id), {
        id: fp.id,
        name: fp.name,
        createdAt: fp.createdAt,
        updatedAt: fp.updatedAt,
        customCategories: fp.customCategories,
        savedSources: fp.savedSources,
        savedCounterparties: fp.savedCounterparties
      })
    )

  for (const ft of rows(data.lists)) {
    const tableId = String(ft.id)
    out.push(
      record('financial_table', tableId, {
        id: tableId,
        name: ft.name,
        currency: ft.currency,
        createdAt: ft.createdAt,
        updatedAt: ft.updatedAt,
        profileId: ft.profileId,
        provider: ft.provider,
        actualBalance: optionalMoney(ft.actualBalance),
        actualBalanceUpdatedAt: ft.actualBalanceUpdatedAt,
        legacyFinancialMetadata: ft.legacyFinancialMetadata
      })
    )
    for (const d of rows(ft.debts))
      out.push(
        record('financial_debt', String(d.id), {
          id: d.id,
          tableId,
          name: d.name,
          originalAmount: moneyText(d.originalAmount),
          remainingAmount: moneyText(d.remainingAmount),
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          completedAt: d.completedAt
        })
      )
    for (const tx of rows(ft.transactions))
      out.push(
        record('transaction', String(tx.id), {
          id: tx.id,
          tableId,
          description: tx.description,
          amount: moneyText(tx.amount),
          type: tx.type,
          date: tx.date,
          category: tx.category,
          fromShopping: tx.fromShopping,
          linkedTransactionId: tx.linkedTransactionId,
          source: tx.source,
          details: transactionDetails(tx.details),
          receiptFileIds: tx.receiptFileIds,
          bankReference: tx.bankReference,
          counterparty: tx.counterparty,
          createdAt: tx.createdAt,
          updatedAt: tx.updatedAt,
          reconciledAt: tx.reconciledAt,
          audit: tx.audit,
          currencyTransferId: tx.currencyTransferId,
          currencyTransferFee: tx.currencyTransferFee,
          currencyTransferFeeCurrency: tx.currencyTransferFeeCurrency,
          debtId: tx.debtId
        })
      )
    for (const i of rows(ft.items))
      out.push(
        record('shopping_item', String(i.id), {
          id: i.id,
          tableId,
          name: i.name,
          qty: i.qty,
          price: optionalMoney(i.price),
          done: i.done,
          link: i.link,
          linkedTransactionId: i.linkedTransactionId
        })
      )
    for (const fg of rows(ft.goals))
      out.push(
        record('financial_goal', String(fg.id), {
          id: fg.id,
          tableId,
          name: fg.name,
          targetAmount: moneyText(fg.targetAmount),
          targetMonth: fg.targetMonth,
          targetYear: fg.targetYear,
          completedAt: fg.completedAt,
          completionNote: fg.completionNote
        })
      )
    for (const ys of rows(ft.yieldSources))
      out.push(
        record('yield_source', String(ys.id), {
          id: ys.id,
          tableId,
          name: ys.name,
          createdAt: ys.createdAt
        })
      )
    for (const ye of rows(ft.yieldEntries))
      out.push(
        record('yield_entry', String(ye.id), {
          id: ye.id,
          tableId,
          sourceId: ye.sourceId,
          date: ye.date,
          amount: moneyText(ye.amount),
          createdAt: ye.createdAt
        })
      )
  }

  for (const f of rows(data.files))
    out.push(
      record('file', String(f.id), {
        id: f.id,
        name: f.name,
        ext: f.ext,
        size: f.size,
        createdAt: f.createdAt,
        projectId: f.projectId
      })
    )

  for (const tb of rows(data.timeBlocks))
    out.push(
      record('time_block', String(tb.id), {
        id: tb.id,
        date: tb.date,
        startTime: tb.startTime,
        endTime: tb.endTime,
        title: tb.title,
        description: tb.description,
        taskId: tb.taskId,
        habitId: tb.habitId,
        type: tb.type,
        color: tb.color,
        borderStyle: borderStyle(tb.borderStyle),
        order: tb.order,
        createdAt: tb.createdAt,
        updatedAt: tb.updatedAt
      })
    )

  for (const r of rows(data.routines))
    out.push(
      record('routine', String(r.id), {
        id: r.id,
        title: r.title,
        description: r.description,
        startTime: r.startTime,
        endTime: r.endTime,
        daysOfWeek: r.daysOfWeek,
        color: r.color,
        borderStyle: borderStyle(r.borderStyle),
        active: r.active,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      })
    )

  return out
}

/** Access bookkeeping (count, last access) is per device and never versioned. */
export function extractMemoryRecords(memories: AiMemory[]): SyncRecord[] {
  return memories.map((m) =>
    record('memory', m.id, {
      id: m.id,
      projectId: m.projectId,
      type: m.type,
      title: m.title,
      body: m.body,
      tags: sortedSet(m.tags),
      pinned: m.pinned,
      source: m.source,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      archivedAt: m.archivedAt
    })
  )
}
