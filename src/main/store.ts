import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { normalizeMemory, type AiMemory, type MemoryType } from './memory'
import { decodeDataUrl } from './chat-images'

// ── Inline types (mirrors src/renderer/src/types/index.ts) ──────────────────

type Priority = 'low' | 'medium' | 'high' | 'urgent'

interface Column {
  id: string
  name: string
  order: number
  color?: string
}
interface ProjectLink {
  id: string
  label: string
  url: string
}
interface CodePath {
  id: string
  label?: string
  path: string
}
interface Project {
  id: string
  name: string
  description?: string
  color: string
  columns: Column[]
  links?: ProjectLink[]
  // activeCodePathIds is the selection; activeCodePathId is the legacy singular
  // form, still read so pre-multi-select databases and backups keep working.
  codePaths?: CodePath[]
  activeCodePathIds?: string[]
  activeCodePathId?: string
  order?: number
  archivedAt?: string
  createdAt: string
  updatedAt: string
}
interface TaskImage {
  id: string
  name: string
  ext: string
  size: number
  addedAt: string
}
interface Task {
  id: string
  projectId: string
  columnId: string
  title: string
  description?: string
  priority: Priority
  dueDate?: string
  tags: string[]
  sprintId?: string
  images?: TaskImage[]
  timeSpent?: number
  order: number
  createdAt: string
  updatedAt: string
  completedAt?: string
}
interface Sprint {
  id: string
  projectId: string
  name: string
  createdAt: string
  closedAt?: string
}
interface Tombstone {
  id: string
  type: 'project' | 'task' | 'sprint'
  deletedAt: string
}
interface StickyNote {
  id: string
  projectId: string
  content: string
  color: string
  x: number
  y: number
  width: number
  height: number
  taskId?: string
  taskIds?: string[]
  goalIds?: string[]
  connections?: string[]
  createdAt: string
  updatedAt: string
  fontSize?: string
  type?: 'note' | 'text'
  completedAt?: string
}
interface GoalEntry {
  id: string
  date: string
  label?: string
  value: number
  createdAt: string
}
interface Goal {
  id: string
  title: string
  entries: GoalEntry[]
  target: number
  unit: string
  color: string
  projectId?: string
  createdAt: string
  updatedAt: string
}
interface Habit {
  id: string
  name: string
  color: string
  completions: string[]
  createdAt: string
  updatedAt: string
}
// Monetary fields accept number (legacy JSON) or string (current renderer schema);
// they are coerced to canonical decimal strings via moneyText() on insert.
interface ShoppingItem {
  id: string
  name: string
  qty: number
  price?: number | string
  done: boolean
  link?: string
  linkedTransactionId?: string
}
interface FinancialTransaction {
  id: string
  description: string
  amount: number | string
  type: 'income' | 'expense'
  date: string
  category?: string
  fromShopping?: boolean
  linkedTransactionId?: string
  source?: string
  details?: FinancialTransactionDetail[]
}
interface FinancialTransactionDetail {
  id: string
  description: string
  amount: number | string
  category?: string
  date?: string
  linkedTransactionId?: string
}
interface FinancialGoal {
  id: string
  name: string
  targetAmount: number | string
  targetMonth: number
  targetYear: number
  completedAt?: string
  completionNote?: string
}
interface YieldSource {
  id: string
  name: string
  createdAt: string
}
interface YieldEntry {
  id: string
  sourceId: string
  date: string
  amount: number | string
  createdAt: string
}
interface FinancialProfile {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}
interface FinancialTable {
  id: string
  name: string
  currency: string
  profileId?: string
  items: ShoppingItem[]
  transactions: FinancialTransaction[]
  goals: FinancialGoal[]
  yieldSources?: YieldSource[]
  yieldEntries?: YieldEntry[]
  provider?: string
  actualBalance?: number | string
  actualBalanceUpdatedAt?: string
  budgets?: { category: string; limit: number | string }[]
  recurringTransactions?: {
    id: string
    description: string
    amount: number | string
    type: 'income' | 'expense'
    dayOfMonth: number
    category?: string
    source?: string
    active: boolean
    lastGeneratedMonth?: string
  }[]
  createdAt: string
  updatedAt: string
}
interface StoredFile {
  id: string
  name: string
  ext: string
  size: number
  createdAt: string
  projectId?: string
}

interface EntityEvent {
  id: string
  entityType: string
  entityId: string
  action: 'created' | 'updated' | 'deleted'
  summary: string
  source: 'user' | 'ai'
  toolName?: string
  convId?: string
  timestamp: string
}

interface TimeBlock {
  id: string
  date: string
  startTime: string
  endTime: string
  title: string
  description?: string
  taskId?: string
  habitId?: string
  type: string
  color?: string
  borderStyle?: 'solid' | 'dashed'
  order: number
  createdAt: string
  updatedAt: string
}
interface Routine {
  id: string
  title: string
  description?: string
  startTime: string
  endTime: string
  daysOfWeek: number[]
  color?: string
  active: boolean
  createdAt: string
  updatedAt: string
}

interface SaveData {
  projects: Project[]
  tasks: Task[]
  sprints: Sprint[]
  tombstones: Tombstone[]
  notes: StickyNote[]
  goals: Goal[]
  habits: Habit[]
  lists: FinancialTable[]
  financialProfiles?: FinancialProfile[]
  activeFinancialProfileId?: string
  files: StoredFile[]
  timeBlocks?: TimeBlock[]
  routines?: Routine[]
  activeTimers?: { taskId: string; startedAt: number }[]
  // Legacy single-timer mirror; still written so an older app version reading
  // this DB resolves one timer. New code reads/writes `activeTimers`.
  activeTimer?: { taskId: string; startedAt: number } | null
  // Entity events to append (set by the AI tool layer; absent on user saves).
  entityEvents?: EntityEvent[]
}

// ── DB paths ─────────────────────────────────────────────────────────────────

const DB_PATH = join(app.getPath('userData'), is.dev ? 'kanban-dev.db' : 'kanban.db')
const LEGACY_PATH = join(
  app.getPath('userData'),
  is.dev ? 'kanban-data.dev.json' : 'kanban-data.json'
)

let _db: Database.Database | null = null

function getDb(): Database.Database {
  if (_db) return _db
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  initSchema(_db)
  migrateMoneyColumnsToText(_db)
  migrateTransactionsLinkedColumn(_db)
  migrateFinancialPlanningColumns(_db)
  migrateTransactionDetailsColumn(_db)
  migrateProjectsArchivedColumn(_db)
  migrateTimeBlockBorderStyleColumn(_db)
  migrateMemoryDropProjectFk(_db)
  migrateMemoryProvenanceColumn(_db)
  ensureMemorySearch(_db)
  migrateTaskImagesToDisk(_db)
  migrateNotesTaskIdsGoalIds(_db)
  migrateFromJson(_db)
  trimEventLog(_db)
  return _db
}

// Coerce a monetary value (legacy number or current string) to a canonical
// decimal string for storage in the TEXT columns.
function moneyText(v: unknown): string {
  if (typeof v === 'number' && isFinite(v)) return String(v)
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (trimmed === '') return '0'
    const n = Number(trimmed)
    return isFinite(n) ? String(n) : '0'
  }
  return '0'
}

function financialMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const DEFAULT_FINANCIAL_PROFILE_ID = 'personal'

function defaultFinancialProfiles(): FinancialProfile[] {
  return [
    {
      id: DEFAULT_FINANCIAL_PROFILE_ID,
      name: 'Minhas finanças',
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z'
    }
  ]
}

function parseFinancialProfiles(value: unknown): FinancialProfile[] {
  if (!Array.isArray(value)) return defaultFinancialProfiles()
  const profiles = value.filter(
    (profile): profile is FinancialProfile =>
      !!profile &&
      typeof profile === 'object' &&
      typeof (profile as FinancialProfile).id === 'string' &&
      typeof (profile as FinancialProfile).name === 'string' &&
      typeof (profile as FinancialProfile).createdAt === 'string' &&
      typeof (profile as FinancialProfile).updatedAt === 'string'
  )
  return profiles.length ? profiles : defaultFinancialProfiles()
}

function transactionDetails(value: unknown): FinancialTransactionDetail[] {
  const parsed =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value)
          } catch {
            return []
          }
        })()
      : value
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((detail) => {
    if (!detail || typeof detail !== 'object') return []
    const item = detail as Partial<FinancialTransactionDetail>
    if (typeof item.id !== 'string' || typeof item.description !== 'string') return []
    return [
      {
        id: item.id,
        description: item.description,
        amount: moneyText(item.amount),
        ...(typeof item.category === 'string' && item.category.trim()
          ? { category: item.category.trim() }
          : {}),
        ...(typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
          ? { date: item.date }
          : {}),
        ...(typeof item.linkedTransactionId === 'string' && item.linkedTransactionId
          ? { linkedTransactionId: item.linkedTransactionId }
          : {})
      }
    ]
  })
}

// One-time migration for existing DBs: the money columns (price, amount,
// target_amount) were originally declared REAL. Rebuild those tables with TEXT
// columns so amounts are stored as decimal strings on disk, matching the
// in-memory schema. Idempotent — skips tables already migrated to TEXT.
function migrateMoneyColumnsToText(db: Database.Database): void {
  const columnType = (table: string, col: string): string | null => {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string }[]
    const c = info.find((r) => r.name === col)
    return c ? String(c.type).toUpperCase() : null
  }

  const rebuilds = [
    {
      table: 'shopping_items',
      column: 'price',
      createNew: `CREATE TABLE shopping_items_new (
        id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL REFERENCES financial_tables(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        qty REAL NOT NULL,
        price TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        link TEXT,
        linked_transaction_id TEXT
      )`,
      copy: `INSERT INTO shopping_items_new (id,table_id,name,qty,price,done,link,linked_transaction_id)
        SELECT id,table_id,name,qty,
          CASE WHEN price IS NULL THEN NULL ELSE CAST(price AS TEXT) END,
          done,link,linked_transaction_id FROM shopping_items`
    },
    {
      table: 'transactions',
      column: 'amount',
      createNew: `CREATE TABLE transactions_new (
        id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL REFERENCES financial_tables(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        amount TEXT NOT NULL,
        type TEXT NOT NULL,
        date TEXT NOT NULL,
        category TEXT,
        from_shopping INTEGER DEFAULT 0,
        linked_transaction_id TEXT
      )`,
      copy: `INSERT INTO transactions_new (id,table_id,description,amount,type,date,category,from_shopping,linked_transaction_id)
        SELECT id,table_id,description,CAST(amount AS TEXT),type,date,category,from_shopping,linked_transaction_id FROM transactions`
    },
    {
      table: 'financial_goals',
      column: 'target_amount',
      createNew: `CREATE TABLE financial_goals_new (
        id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL REFERENCES financial_tables(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        target_amount TEXT NOT NULL,
        target_month INTEGER NOT NULL,
        target_year INTEGER NOT NULL,
        completed_at TEXT,
        completion_note TEXT
      )`,
      copy: `INSERT INTO financial_goals_new (id,table_id,name,target_amount,target_month,target_year,completed_at,completion_note)
        SELECT id,table_id,name,CAST(target_amount AS TEXT),target_month,target_year,completed_at,completion_note FROM financial_goals`
    },
    {
      table: 'yield_entries',
      column: 'amount',
      createNew: `CREATE TABLE yield_entries_new (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES yield_sources(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      copy: `INSERT INTO yield_entries_new (id,source_id,date,amount,created_at)
        SELECT id,source_id,date,CAST(amount AS TEXT),created_at FROM yield_entries`
    }
  ]

  const pending = rebuilds.filter((r) => columnType(r.table, r.column) === 'REAL')
  if (pending.length === 0) return

  // foreign_keys cannot be toggled inside a transaction; disable around the rebuild.
  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      for (const r of pending) {
        db.exec(r.createNew)
        db.exec(r.copy)
        db.exec(`DROP TABLE ${r.table}`)
        db.exec(`ALTER TABLE ${r.table}_new RENAME TO ${r.table}`)
      }
    })()
    console.log(`[store] Migrated money columns to TEXT: ${pending.map((r) => r.table).join(', ')}`)
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

// One-time migration for existing DBs: add linked_transaction_id column to
// the transactions table. Uses ALTER TABLE ADD COLUMN (safe, idempotent).
function migrateTransactionsLinkedColumn(db: Database.Database): void {
  const colExists = (table: string, col: string): boolean => {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    return info.some((r) => r.name === col)
  }
  if (!colExists('transactions', 'linked_transaction_id')) {
    db.prepare('ALTER TABLE transactions ADD COLUMN linked_transaction_id TEXT').run()
    console.log('[store] Added linked_transaction_id column to transactions')
  }
}

// One-time migration for the optional financial planning metadata and transaction source.
function migrateFinancialPlanningColumns(db: Database.Database): void {
  const has = (table: string, column: string): boolean =>
    (db.prepare('PRAGMA table_info(' + table + ')').all() as { name: string }[]).some(
      (row) => row.name === column
    )
  if (!has('financial_tables', 'metadata'))
    db.prepare('ALTER TABLE financial_tables ADD COLUMN metadata TEXT').run()
  if (!has('transactions', 'source'))
    db.prepare('ALTER TABLE transactions ADD COLUMN source TEXT').run()
}

function migrateTransactionDetailsColumn(db: Database.Database): void {
  const has = (db.prepare('PRAGMA table_info(transactions)').all() as { name: string }[]).some(
    (row) => row.name === 'details'
  )
  if (!has) db.prepare('ALTER TABLE transactions ADD COLUMN details TEXT').run()
}

// One-time migration for existing DBs: add archived_at column to projects table.
function migrateProjectsArchivedColumn(db: Database.Database): void {
  const colExists = (table: string, col: string): boolean => {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    return info.some((r) => r.name === col)
  }
  if (!colExists('projects', 'archived_at')) {
    db.prepare('ALTER TABLE projects ADD COLUMN archived_at TEXT').run()
    console.log('[store] Added archived_at column to projects')
  }
}

function migrateTimeBlockBorderStyleColumn(db: Database.Database): void {
  const has = (db.prepare('PRAGMA table_info(time_blocks)').all() as { name: string }[]).some(
    (column) => column.name === 'border_style'
  )
  if (!has) db.prepare('ALTER TABLE time_blocks ADD COLUMN border_style TEXT').run()
}

// One-time migration for existing DBs: the `memory` table originally declared
// `project_id TEXT REFERENCES projects(id) ON DELETE CASCADE`. That cascade was
// a data-loss bug — persistAll (first save of a session) and persistDiff (any
// project edit) delete-and-reinsert the project row, and the cascade hard-deleted
// every project-scoped memory (pinned included, never archived) while the
// re-insert path never restored them, since memory is written outside persistAll.
// Rebuild the table with a plain TEXT project_id (like tasks/notes) so a project
// re-insert no longer touches memory; a genuinely deleted project just leaves its
// memories orphaned. Idempotent — skips a table that already has no FK.
function migrateMemoryDropProjectFk(db: Database.Database): void {
  const fks = db.prepare(`PRAGMA foreign_key_list(memory)`).all() as { table: string }[]
  const hasProjectFk = fks.some((r) => r.table === 'projects')
  if (!hasProjectFk) return

  // foreign_keys cannot be toggled inside a transaction; disable around the rebuild.
  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE memory_new (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        pinned INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT
      )`)
      db.exec(`INSERT INTO memory_new
        (id,project_id,type,title,body,tags,pinned,source,created_at,updated_at,last_accessed_at,access_count,archived_at)
        SELECT id,project_id,type,title,body,tags,pinned,source,created_at,updated_at,last_accessed_at,access_count,archived_at FROM memory`)
      db.exec(`DROP TABLE memory`)
      db.exec(`ALTER TABLE memory_new RENAME TO memory`)
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_memory_project ON memory(project_id) WHERE archived_at IS NULL`
      )
    })()
    console.log('[store] Migrated memory table: dropped project_id ON DELETE CASCADE')
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

/** Additive provenance migration: old memories remain valid, just unlinked. */
function migrateMemoryProvenanceColumn(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(memory)').all() as { name: string }[]
  if (!columns.some((column) => column.name === 'source_conversation_id')) {
    db.prepare('ALTER TABLE memory ADD COLUMN source_conversation_id TEXT').run()
  }
}

/**
 * Search is derived data, never another source of truth: FTS indexes the
 * satellite table and is rebuilt on startup, including after the old FK-table
 * migration above. FTS5 handles accent-insensitive token lookup much better
 * than pulling every memory into the renderer and doing a substring scan.
 */
function ensureMemorySearch(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      title, body, tags,
      content='memory', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memory BEGIN
      INSERT INTO memory_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, title, body, tags)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON memory BEGIN
      INSERT INTO memory_fts(memory_fts, rowid, title, body, tags)
      VALUES ('delete', old.rowid, old.title, old.body, old.tags);
      INSERT INTO memory_fts(rowid, title, body, tags) VALUES (new.rowid, new.title, new.body, new.tags);
    END;
  `)
  // The table is small (capped at 500 active rows); rebuilding gives existing
  // installs an index and repairs an interrupted external-content sync safely.
  db.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')")
}

// One-time migration for existing DBs: task images used to store their bytes as
// base64 in `task_images.data_url`, which bloated the DB (loaded whole into the
// renderer store, reserialized on every save). Move each blob to a file at
// task-images/<id><ext> — matching chat images and file attachments — and
// rebuild the table with an `ext` column and no `data_url`. Idempotent: skips a
// table already migrated (no `data_url` column). A row whose data_url won't
// decode is dropped from disk but keeps its metadata row (a broken thumbnail,
// no worse than the un-writable case), so one bad blob can't abort the boot.
function migrateTaskImagesToDisk(db: Database.Database): void {
  const info = db.prepare(`PRAGMA table_info(task_images)`).all() as { name: string }[]
  if (!info.some((c) => c.name === 'data_url')) return

  const dir = join(app.getPath('userData'), 'task-images')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  // Write the blobs to disk first (outside the schema transaction — file IO
  // can't roll back with SQL anyway), collecting the ext each row should carry.
  const rows = db.prepare('SELECT id, data_url FROM task_images').all() as {
    id: string
    data_url: string
  }[]
  const extById = new Map<string, string>()
  for (const r of rows) {
    const decoded = decodeDataUrl(r.data_url)
    if ('error' in decoded) continue // undecodable blob → metadata stays, no file
    const ext = `.${decoded.ext}`
    try {
      writeFileSync(join(dir, `${r.id}${ext}`), decoded.bytes)
      extById.set(r.id, ext)
    } catch {
      /* unwritable blob is skipped; the row keeps a blank ext */
    }
  }

  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE task_images_new (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        ext TEXT NOT NULL DEFAULT '',
        size INTEGER NOT NULL,
        added_at TEXT NOT NULL
      )`)
      const insert = db.prepare(
        'INSERT INTO task_images_new (id,task_id,name,ext,size,added_at) SELECT id,task_id,name,?,size,added_at FROM task_images WHERE id=?'
      )
      for (const r of rows) insert.run(extById.get(r.id) ?? '', r.id)
      db.exec(`DROP TABLE task_images`)
      db.exec(`ALTER TABLE task_images_new RENAME TO task_images`)
    })()
    console.log(`[store] Migrated ${extById.size}/${rows.length} task images to disk`)
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

// ── migrateNotesTaskIdsGoalIds ────────────────────────────────────────────
// Adds task_ids and goal_ids TEXT columns to notes (JSON arrays). Idempotent.

function migrateNotesTaskIdsGoalIds(db: Database.Database): void {
  const colExists = (table: string, col: string): boolean => {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    return info.some((r) => r.name === col)
  }
  if (!colExists('notes', 'task_ids')) {
    db.prepare('ALTER TABLE notes ADD COLUMN task_ids TEXT').run()
    console.log('[store] Added task_ids column to notes')
  }
  if (!colExists('notes', 'goal_ids')) {
    db.prepare('ALTER TABLE notes ADD COLUMN goal_ids TEXT').run()
    console.log('[store] Added goal_ids column to notes')
  }
}

// ── Schema ───────────────────────────────────────────────────────────────────

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT NOT NULL,
      ord INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_columns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      ord INTEGER NOT NULL,
      color TEXT
    );
    CREATE TABLE IF NOT EXISTS project_links (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      url TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_code_paths (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label TEXT,
      path TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      column_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT NOT NULL,
      due_date TEXT,
      sprint_id TEXT,
      time_spent INTEGER,
      ord INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS task_tags (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (task_id, tag)
    );
    -- Task images keep only metadata here; the bytes live on disk at
    -- task-images/<id><ext> (like chat images and file attachments), so a big
    -- photo no longer bloats the DB that's loaded whole into the renderer store
    -- and reserialized on every save. migrateTaskImagesToDisk moves legacy
    -- data_url rows out; a fresh DB starts with ext and no data_url.
    CREATE TABLE IF NOT EXISTS task_images (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      ext TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sprints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS tombstones (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      deleted_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      content TEXT NOT NULL,
      color TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      task_id TEXT,
      font_size TEXT,
      type TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS note_connections (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      connected_note_id TEXT NOT NULL,
      PRIMARY KEY (note_id, connected_note_id)
    );
    -- v3.x migration moved to migrateNotesTaskIdsGoalIds() for idempotency
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      target REAL NOT NULL,
      unit TEXT NOT NULL,
      color TEXT NOT NULL,
      project_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS goal_entries (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      label TEXT,
      value REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS habit_completions (
      habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      PRIMARY KEY (habit_id, date)
    );
    CREATE TABLE IF NOT EXISTS financial_tables (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT
    );
    CREATE TABLE IF NOT EXISTS shopping_items (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES financial_tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      qty REAL NOT NULL,
      price TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      link TEXT,
      linked_transaction_id TEXT
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES financial_tables(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount TEXT NOT NULL,
      type TEXT NOT NULL,
      date TEXT NOT NULL,
      category TEXT,
      from_shopping INTEGER DEFAULT 0,
      linked_transaction_id TEXT,
      source TEXT,
      details TEXT
    );
    CREATE TABLE IF NOT EXISTS financial_goals (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES financial_tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target_amount TEXT NOT NULL,
      target_month INTEGER NOT NULL,
      target_year INTEGER NOT NULL,
      completed_at TEXT,
      completion_note TEXT
    );
    CREATE TABLE IF NOT EXISTS yield_sources (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES financial_tables(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS yield_entries (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES yield_sources(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      amount TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      project_id TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    -- AI memory: durable facts the assistant carries across conversations. A
    -- satellite table written OUTSIDE persistAll (see the Memory section below):
    -- the access counters are bumped on every read, and routing that through the
    -- store's full-replace save would rewrite the whole DB per touch.
    -- project_id is a PLAIN TEXT reference (like tasks/notes), NOT an FK with
    -- ON DELETE CASCADE. It must not cascade: persistAll (first save of a session)
    -- and persistDiff (any project edit) delete-and-reinsert the project row, and
    -- a cascade would hard-delete this satellite's rows on every such save while
    -- the re-insert path never restores them — silent, unrecoverable data loss
    -- (pinned included, never archived). project_id NULL = global; a memory whose
    -- project was deleted survives as an orphan (reads as "projeto removido") and
    -- decays on its own if unused. migrateMemoryDropProjectFk drops the old FK.
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      pinned INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      source_conversation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memory_project ON memory(project_id) WHERE archived_at IS NULL;
    -- Entity event log: append-only audit trail of every mutation. Purely additive
    -- (no updates, no deletes), so it can serve as a source of truth for lineage
    -- and reproducibility without touching the existing save path.
    CREATE TABLE IF NOT EXISTS entity_events (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'user',
      tool_name TEXT,
      conv_id TEXT,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entity_events_entity ON entity_events(entity_type, entity_id);
    CREATE TABLE IF NOT EXISTS time_blocks (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      task_id TEXT,
      habit_id TEXT,
      type TEXT NOT NULL,
      color TEXT,
      border_style TEXT,
      ord INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_time_blocks_date ON time_blocks(date);
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      days_of_week TEXT NOT NULL,
      color TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

// ── JSON migration ────────────────────────────────────────────────────────────

function migrateFromJson(db: Database.Database): void {
  if (!existsSync(LEGACY_PATH)) return
  const { c } = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number }
  if (c > 0) return
  try {
    const data = JSON.parse(readFileSync(LEGACY_PATH, 'utf-8')) as SaveData
    db.transaction(() => persistAll(db, data))()
    renameSync(LEGACY_PATH, LEGACY_PATH + '.migrated')
    console.log('[store] Migrated from JSON to SQLite')
  } catch (err) {
    console.error('[store] JSON migration failed:', err)
  }
}

// ── Write (granular diff vs. last snapshot; full rewrite on the first save) ──

// The last full state persisted this session, kept in memory so the next save
// can be a granular diff instead of wiping all 17 tables and reinserting. Null
// until the first save (or after a failed one), where a full rewrite runs and
// sets it; from then on each save only touches the entities that actually
// changed — a renamed task is one row rewritten, not a flush of the whole DB.
let lastSnapshot: SaveData | null = null

// Prepared statements plus one writer per top-level entity (row + its children),
// shared by the full rewrite and the granular diff. Every child table has
// ON DELETE CASCADE, so deleting a parent row clears its children and "changed"
// is just delete-then-write — no per-child diffing needed. Same set of INSERTs
// persistAll always used; the delete-by-id and timer helpers are what the diff
// adds. better-sqlite3 caches compiled statements by SQL, so re-preparing per
// save is as cheap as the old inline `ins` object was.
function prepareWrite(db: Database.Database) {
  const ins = {
    project: db.prepare(
      'INSERT INTO projects (id,name,description,color,ord,created_at,updated_at,archived_at) VALUES (?,?,?,?,?,?,?,?)'
    ),
    column: db.prepare(
      'INSERT INTO project_columns (id,project_id,name,ord,color) VALUES (?,?,?,?,?)'
    ),
    link: db.prepare('INSERT INTO project_links (id,project_id,label,url) VALUES (?,?,?,?)'),
    codePath: db.prepare(
      'INSERT INTO project_code_paths (id,project_id,label,path,active) VALUES (?,?,?,?,?)'
    ),
    task: db.prepare(
      'INSERT INTO tasks (id,project_id,column_id,title,description,priority,due_date,sprint_id,time_spent,ord,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ),
    tag: db.prepare('INSERT OR IGNORE INTO task_tags (task_id,tag) VALUES (?,?)'),
    image: db.prepare(
      'INSERT INTO task_images (id,task_id,name,ext,size,added_at) VALUES (?,?,?,?,?,?)'
    ),
    sprint: db.prepare(
      'INSERT INTO sprints (id,project_id,name,created_at,closed_at) VALUES (?,?,?,?,?)'
    ),
    tomb: db.prepare('INSERT INTO tombstones (id,type,deleted_at) VALUES (?,?,?)'),
    note: db.prepare(
      'INSERT INTO notes (id,project_id,content,color,x,y,width,height,task_id,task_ids,goal_ids,font_size,type,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ),
    conn: db.prepare(
      'INSERT OR IGNORE INTO note_connections (note_id,connected_note_id) VALUES (?,?)'
    ),
    goal: db.prepare(
      'INSERT INTO goals (id,title,target,unit,color,project_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)'
    ),
    entry: db.prepare(
      'INSERT INTO goal_entries (id,goal_id,date,label,value,created_at) VALUES (?,?,?,?,?,?)'
    ),
    habit: db.prepare(
      'INSERT INTO habits (id,name,color,created_at,updated_at) VALUES (?,?,?,?,?)'
    ),
    compl: db.prepare('INSERT OR IGNORE INTO habit_completions (habit_id,date) VALUES (?,?)'),
    ftable: db.prepare(
      'INSERT INTO financial_tables (id,name,currency,created_at,updated_at,metadata) VALUES (?,?,?,?,?,?)'
    ),
    item: db.prepare(
      'INSERT INTO shopping_items (id,table_id,name,qty,price,done,link,linked_transaction_id) VALUES (?,?,?,?,?,?,?,?)'
    ),
    tx: db.prepare(
      'INSERT INTO transactions (id,table_id,description,amount,type,date,category,from_shopping,linked_transaction_id,source,details) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ),
    fg: db.prepare(
      'INSERT INTO financial_goals (id,table_id,name,target_amount,target_month,target_year,completed_at,completion_note) VALUES (?,?,?,?,?,?,?,?)'
    ),
    ysrc: db.prepare('INSERT INTO yield_sources (id,table_id,name,created_at) VALUES (?,?,?,?)'),
    yentry: db.prepare(
      'INSERT INTO yield_entries (id,source_id,date,amount,created_at) VALUES (?,?,?,?,?)'
    ),
    file: db.prepare(
      'INSERT INTO files (id,name,ext,size,created_at,project_id) VALUES (?,?,?,?,?,?)'
    ),
    setting: db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)'),
    timeBlock: db.prepare(
      'INSERT INTO time_blocks (id,date,start_time,end_time,title,description,task_id,habit_id,type,color,border_style,ord,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ),
    routine: db.prepare(
      'INSERT INTO routines (id,title,description,start_time,end_time,days_of_week,color,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
    )
  }

  // Delete a top-level row by id; its children go with it via ON DELETE CASCADE.
  const del = {
    project: db.prepare('DELETE FROM projects WHERE id=?'),
    task: db.prepare('DELETE FROM tasks WHERE id=?'),
    sprint: db.prepare('DELETE FROM sprints WHERE id=?'),
    tomb: db.prepare('DELETE FROM tombstones WHERE id=?'),
    note: db.prepare('DELETE FROM notes WHERE id=?'),
    goal: db.prepare('DELETE FROM goals WHERE id=?'),
    habit: db.prepare('DELETE FROM habits WHERE id=?'),
    ftable: db.prepare('DELETE FROM financial_tables WHERE id=?'),
    file: db.prepare('DELETE FROM files WHERE id=?'),
    setting: db.prepare('DELETE FROM settings WHERE key=?'),
    timeBlock: db.prepare('DELETE FROM time_blocks WHERE id=?'),
    routine: db.prepare('DELETE FROM routines WHERE id=?')
  }

  const insert = {
    project: (p: Project): void => {
      ins.project.run(
        p.id,
        p.name,
        p.description ?? null,
        p.color,
        p.order ?? null,
        p.createdAt,
        p.updatedAt,
        p.archivedAt ?? null
      )
      for (const c of p.columns ?? []) ins.column.run(c.id, p.id, c.name, c.order, c.color ?? null)
      for (const l of p.links ?? []) ins.link.run(l.id, p.id, l.label, l.url)
      const active = new Set(
        p.activeCodePathIds ?? (p.activeCodePathId ? [p.activeCodePathId] : [])
      )
      for (const cp of p.codePaths ?? [])
        ins.codePath.run(cp.id, p.id, cp.label ?? null, cp.path, active.has(cp.id) ? 1 : 0)
    },
    task: (t: Task): void => {
      ins.task.run(
        t.id,
        t.projectId,
        t.columnId,
        t.title,
        t.description ?? null,
        t.priority,
        t.dueDate ?? null,
        t.sprintId ?? null,
        t.timeSpent ?? null,
        t.order,
        t.createdAt,
        t.updatedAt,
        t.completedAt ?? null
      )
      for (const tag of t.tags ?? []) ins.tag.run(t.id, tag)
      for (const img of t.images ?? [])
        ins.image.run(img.id, t.id, img.name, img.ext ?? '', img.size, img.addedAt)
    },
    sprint: (s: Sprint): void => {
      ins.sprint.run(s.id, s.projectId, s.name, s.createdAt, s.closedAt ?? null)
    },
    tombstone: (t: Tombstone): void => {
      ins.tomb.run(t.id, t.type, t.deletedAt)
    },
    note: (n: StickyNote): void => {
      ins.note.run(
        n.id,
        n.projectId,
        n.content,
        n.color,
        n.x,
        n.y,
        n.width,
        n.height,
        n.taskId ?? null,
        n.taskIds?.length ? JSON.stringify(n.taskIds) : null,
        n.goalIds?.length ? JSON.stringify(n.goalIds) : null,
        n.fontSize ?? null,
        n.type ?? null,
        n.completedAt ?? null,
        n.createdAt,
        n.updatedAt
      )
      for (const c of n.connections ?? []) ins.conn.run(n.id, c)
    },
    goal: (g: Goal): void => {
      ins.goal.run(
        g.id,
        g.title,
        g.target,
        g.unit,
        g.color,
        g.projectId ?? null,
        g.createdAt,
        g.updatedAt
      )
      for (const e of g.entries ?? [])
        ins.entry.run(e.id, g.id, e.date, e.label ?? null, e.value, e.createdAt)
    },
    habit: (h: Habit): void => {
      ins.habit.run(h.id, h.name, h.color, h.createdAt, h.updatedAt)
      for (const d of h.completions ?? []) ins.compl.run(h.id, d)
    },
    ftable: (ft: FinancialTable): void => {
      const metadata = JSON.stringify({
        provider: ft.provider,
        actualBalance: ft.actualBalance,
        actualBalanceUpdatedAt: ft.actualBalanceUpdatedAt,
        budgets: ft.budgets,
        recurringTransactions: ft.recurringTransactions,
        profileId: ft.profileId
      })
      ins.ftable.run(ft.id, ft.name, ft.currency, ft.createdAt, ft.updatedAt, metadata)
      for (const i of ft.items ?? [])
        ins.item.run(
          i.id,
          ft.id,
          i.name,
          i.qty,
          i.price != null ? moneyText(i.price) : null,
          i.done ? 1 : 0,
          i.link ?? null,
          i.linkedTransactionId ?? null
        )
      for (const tx of ft.transactions ?? [])
        ins.tx.run(
          tx.id,
          ft.id,
          tx.description,
          moneyText(tx.amount),
          tx.type,
          tx.date,
          tx.category ?? null,
          tx.fromShopping ? 1 : 0,
          tx.linkedTransactionId ?? null,
          tx.source ?? null,
          JSON.stringify(transactionDetails(tx.details))
        )
      for (const fg of ft.goals ?? [])
        ins.fg.run(
          fg.id,
          ft.id,
          fg.name,
          moneyText(fg.targetAmount),
          fg.targetMonth,
          fg.targetYear,
          fg.completedAt ?? null,
          fg.completionNote ?? null
        )
      for (const ys of ft.yieldSources ?? []) ins.ysrc.run(ys.id, ft.id, ys.name, ys.createdAt)
      for (const ye of ft.yieldEntries ?? [])
        ins.yentry.run(ye.id, ye.sourceId, ye.date, moneyText(ye.amount), ye.createdAt)
    },
    file: (f: StoredFile): void => {
      ins.file.run(f.id, f.name, f.ext, f.size, f.createdAt, f.projectId ?? null)
    },
    timeBlock: (tb: TimeBlock): void => {
      ins.timeBlock.run(
        tb.id,
        tb.date,
        tb.startTime,
        tb.endTime,
        tb.title,
        tb.description ?? null,
        tb.taskId ?? null,
        tb.habitId ?? null,
        tb.type,
        tb.color ?? null,
        tb.borderStyle ?? null,
        tb.order,
        tb.createdAt,
        tb.updatedAt
      )
    },
    routine: (r: Routine): void => {
      ins.routine.run(
        r.id,
        r.title,
        r.description ?? null,
        r.startTime,
        r.endTime,
        JSON.stringify(r.daysOfWeek ?? []),
        r.color ?? null,
        r.active ? 1 : 0,
        r.createdAt,
        r.updatedAt
      )
    }
  }

  const setTimer = (v: unknown): void => {
    ins.setting.run('activeTimer', JSON.stringify(v))
  }
  const clearTimer = (): void => {
    del.setting.run('activeTimer')
  }
  const setTimers = (v: unknown): void => {
    ins.setting.run('activeTimers', JSON.stringify(v))
  }
  const setSetting = (key: string, value: unknown): void => {
    ins.setting.run(key, JSON.stringify(value))
  }
  const clearTimers = (): void => {
    del.setting.run('activeTimers')
  }

  return { insert, del, setTimer, clearTimer, setTimers, clearTimers, setSetting }
}

/**
 * Write the running-timer settings: the `activeTimers` array plus the legacy
 * `activeTimer` mirror (first, or null). One place so persistAll and persistDiff
 * agree. An empty array clears both keys, so a stopped timer never lingers to
 * the next boot.
 */
function writeFinancialProfiles(
  w: ReturnType<typeof prepareWrite>,
  profiles: FinancialProfile[] | undefined,
  activeProfileId: string | undefined
): void {
  const normalized = parseFinancialProfiles(profiles)
  const ids = new Set(normalized.map((profile) => profile.id))
  w.setSetting('financialProfiles', normalized)
  w.setSetting(
    'activeFinancialProfileId',
    ids.has(activeProfileId ?? '') ? activeProfileId : DEFAULT_FINANCIAL_PROFILE_ID
  )
}

function writeTimers(
  w: ReturnType<typeof prepareWrite>,
  timers: { taskId: string; startedAt: number }[] | undefined,
  legacy: { taskId: string; startedAt: number } | null | undefined
): void {
  const list = timers ?? (legacy ? [legacy] : [])
  if (list.length > 0) w.setTimers(list)
  else w.clearTimers()
  const first = list[0] ?? null
  if (first) w.setTimer(first)
  else w.clearTimer()
}

/**
 * Upsert changed/new entities and delete removed ones, comparing each by a
 * stable JSON string.
 *
 * Safe by construction: a JSON mismatch that isn't a real change (reordered
 * keys, say) costs only a redundant-but-correct rewrite, while two genuinely
 * different states never serialize identically — so a real change is never
 * missed. The failure mode is a wasted write, never silent data loss.
 */
export function diffEntities<T extends { id: string }>(
  prev: T[] | undefined,
  next: T[] | undefined,
  del: { run: (id: string) => unknown },
  write: (e: T) => void
): void {
  const prevJson = new Map<string, string>()
  for (const e of prev ?? []) prevJson.set(e.id, JSON.stringify(e))
  const liveIds = new Set<string>()
  for (const e of next ?? []) {
    liveIds.add(e.id)
    const before = prevJson.get(e.id)
    if (before === JSON.stringify(e)) continue // unchanged — skip entirely
    if (before !== undefined) del.run(e.id) // changed: drop old row + children (cascade)
    write(e) // insert (new) or reinsert (changed)
  }
  for (const e of prev ?? []) if (!liveIds.has(e.id)) del.run(e.id) // removed
}

// Persist only what changed against the last snapshot, entity by entity. Order
// doesn't matter for FKs — no top-level table references another (tasks carry
// project_id/column_id/sprint_id as plain TEXT), so each collection is independent.
function persistDiff(db: Database.Database, prev: SaveData, next: SaveData): void {
  const w = prepareWrite(db)
  diffEntities(prev.projects, next.projects, w.del.project, w.insert.project)
  diffEntities(prev.tasks, next.tasks, w.del.task, w.insert.task)
  diffEntities(prev.sprints, next.sprints, w.del.sprint, w.insert.sprint)
  diffEntities(prev.tombstones, next.tombstones, w.del.tomb, w.insert.tombstone)
  diffEntities(prev.notes, next.notes, w.del.note, w.insert.note)
  diffEntities(prev.goals, next.goals, w.del.goal, w.insert.goal)
  diffEntities(prev.habits, next.habits, w.del.habit, w.insert.habit)
  diffEntities(prev.lists, next.lists, w.del.ftable, w.insert.ftable)
  if (
    JSON.stringify(prev.financialProfiles ?? []) !== JSON.stringify(next.financialProfiles ?? []) ||
    prev.activeFinancialProfileId !== next.activeFinancialProfileId
  ) {
    writeFinancialProfiles(w, next.financialProfiles, next.activeFinancialProfileId)
  }
  diffEntities(prev.files, next.files, w.del.file, w.insert.file)
  diffEntities(prev.timeBlocks ?? [], next.timeBlocks ?? [], w.del.timeBlock, w.insert.timeBlock)
  diffEntities(prev.routines ?? [], next.routines ?? [], w.del.routine, w.insert.routine)
  // Timers live in settings (activeTimers + legacy activeTimer mirror). Rewrite
  // when either the array or the legacy field changes, so a stopped timer
  // doesn't linger to the next boot.
  const timersChanged =
    JSON.stringify(prev.activeTimers ?? null) !== JSON.stringify(next.activeTimers ?? null) ||
    JSON.stringify(prev.activeTimer ?? null) !== JSON.stringify(next.activeTimer ?? null)
  if (timersChanged) writeTimers(w, next.activeTimers, next.activeTimer)
}

function persistAll(db: Database.Database, data: SaveData): void {
  // Delete in FK-safe order (children before parents)
  db.exec(`
    DELETE FROM settings;
    DELETE FROM files;
    DELETE FROM routines;
    DELETE FROM time_blocks;
    DELETE FROM yield_entries;
    DELETE FROM yield_sources;
    DELETE FROM financial_goals;
    DELETE FROM transactions;
    DELETE FROM shopping_items;
    DELETE FROM financial_tables;
    DELETE FROM habit_completions;
    DELETE FROM habits;
    DELETE FROM goal_entries;
    DELETE FROM goals;
    DELETE FROM note_connections;
    DELETE FROM notes;
    DELETE FROM tombstones;
    DELETE FROM sprints;
    DELETE FROM task_images;
    DELETE FROM task_tags;
    DELETE FROM tasks;
    DELETE FROM project_links;
    DELETE FROM project_code_paths;
    DELETE FROM project_columns;
    DELETE FROM projects;
  `)

  const w = prepareWrite(db)
  for (const p of data.projects ?? []) w.insert.project(p)
  for (const t of data.tasks ?? []) w.insert.task(t)
  for (const s of data.sprints ?? []) w.insert.sprint(s)
  for (const t of data.tombstones ?? []) w.insert.tombstone(t)
  for (const n of data.notes ?? []) w.insert.note(n)
  for (const g of data.goals ?? []) w.insert.goal(g)
  for (const h of data.habits ?? []) w.insert.habit(h)
  for (const ft of data.lists ?? []) w.insert.ftable(ft)
  writeFinancialProfiles(w, data.financialProfiles, data.activeFinancialProfileId)
  for (const f of data.files ?? []) w.insert.file(f)
  for (const tb of data.timeBlocks ?? []) w.insert.timeBlock(tb)
  for (const r of data.routines ?? []) w.insert.routine(r)
  // settings aren't cleared by the DELETE above, so writeTimers must clear the
  // keys when no timer is running, not only set them.
  writeTimers(w, data.activeTimers, data.activeTimer)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Bucket rows by a foreign-key column, preserving row order within each bucket.
 *
 * This is what keeps loadData off the N+1 path: instead of one child query per
 * parent (hundreds of round-trips to SQLite for a real board — tasks alone fire
 * two each), every child table is read once and grouped here in memory. Row
 * order is preserved, so a `SELECT ... ORDER BY ord` still lands ordered inside
 * its bucket.
 */
export function groupByKey<T extends Record<string, any>>(rows: T[], key: string): Map<any, T[]> {
  const m = new Map<any, T[]>()
  for (const r of rows) {
    const bucket = m.get(r[key])
    if (bucket) bucket.push(r)
    else m.set(r[key], [r])
  }
  return m
}

export function loadData(): SaveData {
  const db = getDb()

  // Read every child table once and group by parent id, rather than per-parent.
  const all = (sql: string): any[] => db.prepare(sql).all() as any[]
  const columnsByProject = groupByKey(
    all('SELECT * FROM project_columns ORDER BY ord'),
    'project_id'
  )
  const linksByProject = groupByKey(all('SELECT * FROM project_links'), 'project_id')
  const codePathsByProject = groupByKey(all('SELECT * FROM project_code_paths'), 'project_id')
  const tagsByTask = groupByKey(all('SELECT * FROM task_tags'), 'task_id')
  const imagesByTask = groupByKey(all('SELECT * FROM task_images'), 'task_id')
  const connsByNote = groupByKey(all('SELECT * FROM note_connections'), 'note_id')
  const entriesByGoal = groupByKey(all('SELECT * FROM goal_entries'), 'goal_id')
  const complByHabit = groupByKey(all('SELECT * FROM habit_completions'), 'habit_id')
  const itemsByTable = groupByKey(all('SELECT * FROM shopping_items'), 'table_id')
  const txByTable = groupByKey(all('SELECT * FROM transactions'), 'table_id')
  const fgByTable = groupByKey(all('SELECT * FROM financial_goals'), 'table_id')
  const ysrcByTable = groupByKey(all('SELECT * FROM yield_sources'), 'table_id')
  const yentryBySource = groupByKey(all('SELECT * FROM yield_entries'), 'source_id')

  const projects = all('SELECT * FROM projects ORDER BY ord').map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    ...(p.description != null ? { description: p.description } : {}),
    columns: (columnsByProject.get(p.id) ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      order: c.ord,
      ...(c.color != null ? { color: c.color } : {})
    })),
    ...(() => {
      const ls = (linksByProject.get(p.id) ?? []).map((l) => ({
        id: l.id,
        label: l.label,
        url: l.url
      }))
      return ls.length ? { links: ls } : {}
    })(),
    ...(() => {
      const rows = codePathsByProject.get(p.id) ?? []
      if (!rows.length) return {}
      const codePaths = rows.map((c) => ({
        id: c.id,
        path: c.path,
        ...(c.label != null ? { label: c.label } : {})
      }))
      const activeCodePathIds = rows.filter((c) => c.active).map((c) => c.id as string)
      if (!activeCodePathIds.length) return { codePaths }
      // activeCodePathId mirrors the first selection for older readers.
      return { codePaths, activeCodePathIds, activeCodePathId: activeCodePathIds[0] }
    })(),
    ...(p.ord != null ? { order: p.ord } : {}),
    ...(p.archived_at != null ? { archivedAt: String(p.archived_at) } : {}),
    createdAt: p.created_at,
    updatedAt: p.updated_at
  }))

  const tasks = all('SELECT * FROM tasks').map((t) => ({
    id: t.id,
    projectId: t.project_id,
    columnId: t.column_id,
    title: t.title,
    priority: t.priority,
    tags: (tagsByTask.get(t.id) ?? []).map((r) => r.tag),
    order: t.ord,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    ...(t.description != null ? { description: t.description } : {}),
    ...(t.due_date != null ? { dueDate: t.due_date } : {}),
    ...(t.sprint_id != null ? { sprintId: t.sprint_id } : {}),
    ...(t.time_spent != null ? { timeSpent: t.time_spent } : {}),
    ...(t.completed_at != null ? { completedAt: t.completed_at } : {}),
    ...(() => {
      const imgs = (imagesByTask.get(t.id) ?? []).map((i) => ({
        id: i.id,
        name: i.name,
        ext: i.ext ?? '',
        size: i.size,
        addedAt: i.added_at
      }))
      return imgs.length ? { images: imgs } : {}
    })()
  }))

  const sprints = all('SELECT * FROM sprints').map((s) => ({
    id: s.id,
    projectId: s.project_id,
    name: s.name,
    createdAt: s.created_at,
    ...(s.closed_at != null ? { closedAt: s.closed_at } : {})
  }))

  const tombstones = all('SELECT * FROM tombstones').map((t) => ({
    id: t.id,
    type: t.type,
    deletedAt: t.deleted_at
  }))

  const notes = all('SELECT * FROM notes').map((n) => ({
    id: n.id,
    projectId: n.project_id,
    content: n.content,
    color: n.color,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    ...(n.task_id != null ? { taskId: n.task_id } : {}),
    ...(n.task_ids != null ? { taskIds: JSON.parse(n.task_ids) } : {}),
    ...(n.goal_ids != null ? { goalIds: JSON.parse(n.goal_ids) } : {}),
    ...(n.font_size != null ? { fontSize: n.font_size } : {}),
    ...(n.type != null ? { type: n.type } : {}),
    ...(n.completed_at != null ? { completedAt: n.completed_at } : {}),
    ...(() => {
      const cs = (connsByNote.get(n.id) ?? []).map((r) => r.connected_note_id)
      return cs.length ? { connections: cs } : {}
    })()
  }))

  const goals = all('SELECT * FROM goals').map((g) => ({
    id: g.id,
    title: g.title,
    target: g.target,
    unit: g.unit,
    color: g.color,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    ...(g.project_id != null ? { projectId: g.project_id } : {}),
    entries: (entriesByGoal.get(g.id) ?? []).map((e) => ({
      id: e.id,
      date: e.date,
      value: e.value,
      createdAt: e.created_at,
      ...(e.label != null ? { label: e.label } : {})
    }))
  }))

  const habits = all('SELECT * FROM habits').map((h) => ({
    id: h.id,
    name: h.name,
    color: h.color,
    createdAt: h.created_at,
    updatedAt: h.updated_at,
    completions: (complByHabit.get(h.id) ?? []).map((r) => r.date)
  }))

  const lists = all('SELECT * FROM financial_tables').map((ft) => ({
    id: ft.id,
    name: ft.name,
    currency: ft.currency,
    createdAt: ft.created_at,
    updatedAt: ft.updated_at,
    ...(() => {
      const meta = financialMetadata(ft.metadata)
      return {
        ...(typeof meta.provider === 'string' ? { provider: meta.provider } : {}),
        ...(meta.actualBalance != null ? { actualBalance: String(meta.actualBalance) } : {}),
        ...(typeof meta.actualBalanceUpdatedAt === 'string'
          ? { actualBalanceUpdatedAt: meta.actualBalanceUpdatedAt }
          : {}),
        ...(Array.isArray(meta.budgets) ? { budgets: meta.budgets } : {}),
        ...(Array.isArray(meta.recurringTransactions)
          ? { recurringTransactions: meta.recurringTransactions }
          : {}),
        ...(typeof meta.profileId === 'string' ? { profileId: meta.profileId } : {})
      }
    })(),
    items: (itemsByTable.get(ft.id) ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      qty: i.qty,
      done: i.done === 1,
      ...(i.price != null ? { price: String(i.price) } : {}),
      ...(i.link != null ? { link: i.link } : {}),
      ...(i.linked_transaction_id != null ? { linkedTransactionId: i.linked_transaction_id } : {})
    })),
    transactions: (txByTable.get(ft.id) ?? []).map((tx) => ({
      id: tx.id,
      description: tx.description,
      amount: String(tx.amount),
      type: tx.type,
      date: tx.date,
      ...(tx.category != null ? { category: tx.category } : {}),
      ...(tx.from_shopping ? { fromShopping: true } : {}),
      ...(tx.linked_transaction_id != null
        ? { linkedTransactionId: tx.linked_transaction_id }
        : {}),
      ...(tx.source != null ? { source: tx.source } : {}),
      ...(transactionDetails(tx.details).length ? { details: transactionDetails(tx.details) } : {})
    })),
    goals: (fgByTable.get(ft.id) ?? []).map((fg) => ({
      id: fg.id,
      name: fg.name,
      targetAmount: String(fg.target_amount),
      targetMonth: fg.target_month,
      targetYear: fg.target_year,
      ...(fg.completed_at != null ? { completedAt: fg.completed_at } : {}),
      ...(fg.completion_note != null ? { completionNote: fg.completion_note } : {})
    })),
    yieldSources: (ysrcByTable.get(ft.id) ?? []).map((ys) => ({
      id: ys.id,
      name: ys.name,
      createdAt: ys.created_at
    })),
    yieldEntries: (() => {
      const sources = ysrcByTable.get(ft.id) ?? []
      const entries: YieldEntry[] = []
      for (const src of sources) {
        for (const ye of yentryBySource.get(src.id) ?? []) {
          entries.push({
            id: ye.id,
            sourceId: ye.source_id,
            date: ye.date,
            amount: String(ye.amount),
            createdAt: ye.created_at
          })
        }
      }
      return entries
    })()
  }))

  const files = (db.prepare('SELECT * FROM files').all() as any[]).map((f) => ({
    id: f.id,
    name: f.name,
    ext: f.ext,
    size: f.size,
    createdAt: f.created_at,
    ...(f.project_id != null ? { projectId: f.project_id } : {})
  }))

  const timeBlocks = (
    db.prepare('SELECT * FROM time_blocks ORDER BY date, ord').all() as any[]
  ).map((tb) => ({
    id: tb.id,
    date: tb.date,
    startTime: tb.start_time,
    endTime: tb.end_time,
    title: tb.title,
    type: tb.type,
    ...(tb.description != null ? { description: tb.description } : {}),
    ...(tb.task_id != null ? { taskId: tb.task_id } : {}),
    ...(tb.habit_id != null ? { habitId: tb.habit_id } : {}),
    ...(tb.color != null ? { color: tb.color } : {}),
    ...(tb.border_style === 'solid' || tb.border_style === 'dashed'
      ? { borderStyle: tb.border_style }
      : {}),
    order: tb.ord,
    createdAt: tb.created_at,
    updatedAt: tb.updated_at
  }))

  const routines = (db.prepare('SELECT * FROM routines').all() as any[]).map((r) => {
    let days: number[] = []
    try {
      const p = JSON.parse(String(r.days_of_week ?? '[]'))
      if (Array.isArray(p)) days = p.filter((d): d is number => typeof d === 'number')
    } catch {
      /* malformed JSON → empty list */
    }
    return {
      id: r.id,
      title: r.title,
      startTime: r.start_time,
      endTime: r.end_time,
      daysOfWeek: days,
      ...(r.description != null ? { description: r.description } : {}),
      ...(r.color != null ? { color: r.color } : {}),
      active: r.active === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }
  })

  // Prefer the new `activeTimers` array; fall back to the legacy single
  // `activeTimer` (wrapped) so a DB written by an older app version still
  // resolves its running timer. The renderer migrates the legacy field too.
  const getSetting = (key: string): unknown => {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as
      | { value: string }
      | undefined
    return row ? JSON.parse(row.value) : null
  }
  const financialProfiles = parseFinancialProfiles(getSetting('financialProfiles'))
  const financialProfileIds = new Set(financialProfiles.map((profile) => profile.id))
  const configuredActiveFinancialProfileId = getSetting('activeFinancialProfileId')
  const activeFinancialProfileId =
    typeof configuredActiveFinancialProfileId === 'string' &&
    financialProfileIds.has(configuredActiveFinancialProfileId)
      ? configuredActiveFinancialProfileId
      : DEFAULT_FINANCIAL_PROFILE_ID
  const legacyTimer = getSetting('activeTimer')
  const timersRaw = getSetting('activeTimers')
  const activeTimers = Array.isArray(timersRaw) ? timersRaw : legacyTimer ? [legacyTimer] : []

  return {
    projects,
    tasks,
    sprints,
    tombstones,
    notes,
    goals,
    habits,
    lists: lists.map((list) => ({
      ...list,
      profileId: financialProfileIds.has(list.profileId ?? '')
        ? list.profileId
        : DEFAULT_FINANCIAL_PROFILE_ID
    })),
    financialProfiles,
    activeFinancialProfileId,
    files,
    timeBlocks,
    routines,
    activeTimers,
    // Legacy field, still returned for any consumer that reads it directly.
    activeTimer: legacyTimer ?? activeTimers[0] ?? null
  }
}

export function saveData(data: unknown): void {
  const db = getDb()
  const next = data as SaveData
  const prev = lastSnapshot
  // Events the AI tool layer explicitly asked to log (lineage). These ride
  // alongside the save payload without altering the existing persist path.
  const aiEvents = next.entityEvents ?? []
  db.transaction(() => {
    if (prev) persistDiff(db, prev, next)
    else persistAll(db, next)
    // Generate entity events from the diff between prev and next. The source
    // is 'user' for auto-generated events (the renderer doesn't tag saves by
    // origin); AI events ride on `entityEvents` and are appended separately.
    const now = new Date().toISOString()
    const autoEvents = diffEvents(prev, next, now)
    appendEventRows(db, [...autoEvents, ...aiEvents])
  })()
  // Reached only if the transaction committed. On a throw it rolls back and this
  // line is skipped, so the snapshot keeps matching what's actually on disk —
  // the next save then re-diffs (or rewrites) from a truthful base.
  lastSnapshot = structuredClone(next)
}

// ── Entity Event Log ─────────────────────────────────────────────────────────
//
// Purely append-only audit trail. Events are generated automatically from the
// diff between the last snapshot and the current save (source=user), plus any
// events the AI tool layer explicitly attaches (source=ai). Never pruned within
// a session; capped to EVENT_LOG_MAX rows on boot via a lazy DELETE outside the
// save transaction (so it never blocks the save path).

const EVENT_LOG_MAX = 50_000

type EntityWithTitle = { id: string; title?: string; name?: string; description?: string }

function entityLabel(e: EntityWithTitle | undefined): string {
  if (!e) return '(removido)'
  const t = e.title ?? e.name ?? e.description ?? ''
  return t ? `"${t.slice(0, 60)}"` : `#${e.id.slice(0, 8)}`
}

function entityTypeLabel(type: string): string {
  const map: Record<string, string> = {
    project: 'projeto',
    task: 'task',
    sprint: 'sprint',
    note: 'nota',
    goal: 'meta',
    habit: 'hábito',
    financial_table: 'tabela financeira',
    file: 'arquivo'
  }
  return map[type] ?? type
}

/**
 * Compare two snapshots and produce an event for every created, updated, or
 * deleted top-level entity. Events are stable-ordered within a save batch.
 */
function diffEvents(prev: SaveData | null, next: SaveData, timestamp: string): EntityEvent[] {
  const events: EntityEvent[] = []
  const emit = (type: string, id: string, action: EntityEvent['action'], label: string): void => {
    const article =
      action === 'created' ? 'criado' : action === 'updated' ? 'atualizado' : 'removido'
    events.push({
      id: randomUUID(),
      entityType: type,
      entityId: id,
      action,
      summary: `${entityTypeLabel(type)} ${label} ${article}`,
      source: 'user',
      timestamp
    })
  }

  // Helper: diff a collection by id, returning creates/updates/deletes.
  const diff = <T extends { id: string }>(
    type: string,
    prevArr: T[] | undefined,
    nextArr: T[] | undefined
  ): void => {
    const prevMap = new Map((prevArr ?? []).map((e) => [e.id, e]))
    const nextIds = new Set((nextArr ?? []).map((e) => e.id))
    for (const e of nextArr ?? []) {
      if (!prevMap.has(e.id))
        emit(type, e.id, 'created', entityLabel(e as unknown as EntityWithTitle))
      else if (JSON.stringify(prevMap.get(e.id)) !== JSON.stringify(e))
        emit(type, e.id, 'updated', entityLabel(e as unknown as EntityWithTitle))
    }
    for (const e of prevArr ?? [])
      if (!nextIds.has(e.id))
        emit(type, e.id, 'deleted', entityLabel(e as unknown as EntityWithTitle))
  }

  if (prev) {
    diff('project', prev.projects, next.projects)
    diff('task', prev.tasks, next.tasks)
    diff('sprint', prev.sprints, next.sprints)
    diff('note', prev.notes, next.notes)
    diff('goal', prev.goals, next.goals)
    diff('habit', prev.habits, next.habits)
    diff('financial_table', prev.lists, next.lists)
    diff('file', prev.files, next.files)
  } else {
    for (const e of next.projects ?? []) emit('project', e.id, 'created', entityLabel(e))
    for (const e of next.tasks ?? []) emit('task', e.id, 'created', entityLabel(e))
    for (const e of next.sprints ?? []) emit('sprint', e.id, 'created', entityLabel(e))
    for (const e of next.notes ?? [])
      emit('note', e.id, 'created', entityLabel(e as unknown as EntityWithTitle))
    for (const e of next.goals ?? []) emit('goal', e.id, 'created', entityLabel(e))
    for (const e of next.habits ?? []) emit('habit', e.id, 'created', entityLabel(e))
    for (const e of next.lists ?? [])
      emit('financial_table', e.id, 'created', entityLabel(e as unknown as EntityWithTitle))
    for (const e of next.files ?? [])
      emit('file', e.id, 'created', entityLabel(e as unknown as EntityWithTitle))
  }
  return events
}

function appendEventRows(db: Database.Database, events: EntityEvent[]): void {
  if (!events.length) return
  const stmt = db.prepare(
    `INSERT INTO entity_events (id, entity_type, entity_id, action, summary, source, tool_name, conv_id, timestamp)
     VALUES (@id, @entity_type, @entity_id, @action, @summary, @source, @tool_name, @conv_id, @timestamp)`
  )
  for (const e of events)
    stmt.run({
      id: e.id,
      entity_type: e.entityType,
      entity_id: e.entityId,
      action: e.action,
      summary: e.summary,
      source: e.source,
      tool_name: e.toolName ?? null,
      conv_id: e.convId ?? null,
      timestamp: e.timestamp
    })
}

/** Query the event log for one entity, newest first. */
export function eventsForEntity(entityType: string, entityId: string): EntityEvent[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT * FROM entity_events WHERE entity_type=? AND entity_id=? ORDER BY timestamp DESC LIMIT 200`
    )
    .all(entityType, entityId) as EntityEvent[]
}

/** Lazy cap of the event log — best-effort, outside the save transaction. */
function trimEventLog(db: Database.Database): void {
  const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM entity_events').get() as { cnt: number }
  if (cnt > EVENT_LOG_MAX) {
    const excess = cnt - EVENT_LOG_MAX + 1000
    db.prepare(
      `DELETE FROM entity_events WHERE id IN (SELECT id FROM entity_events ORDER BY timestamp ASC LIMIT ?)`
    ).run(excess)
  }
}

// ── Memory (satellite table; deliberately OUTSIDE persistAll) ────────────────
//
// These read/write the `memory` table directly and never touch lastSnapshot or
// the SaveData graph. The reason is the touch path: `access_count` is bumped on
// every read, and routing that through saveData's full-replace would rewrite
// all 17 tables per bump. So memory gets its own targeted statements — an
// UPDATE by id for a touch, not a flush. Pure rules (validation, decay, lint)
// live in ./memory; this is only the SQL.

function memRowToMemory(r: Record<string, unknown>): AiMemory {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(String(r.tags ?? '[]'))
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string')
  } catch {
    /* malformed tags degrade to none rather than throwing on load */
  }
  return {
    id: String(r.id),
    projectId: r.project_id == null ? null : String(r.project_id),
    type: r.type as AiMemory['type'],
    title: String(r.title),
    body: String(r.body),
    tags,
    pinned: r.pinned === 1,
    source: r.source as AiMemory['source'],
    sourceConversationId:
      r.source_conversation_id == null ? null : String(r.source_conversation_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    lastAccessedAt: String(r.last_accessed_at),
    accessCount: typeof r.access_count === 'number' ? r.access_count : 0,
    archivedAt: r.archived_at == null ? null : String(r.archived_at)
  }
}

export interface ListMemoriesOpts {
  projectId?: string | null
  includeArchived?: boolean
}

export interface SearchMemoriesOpts {
  projectId: string | null
  term?: string
  type?: MemoryType
  includeArchived?: boolean
  limit?: number
}

export interface MemorySearchHit {
  memory: AiMemory
  /** Why a concise result was returned; full body comes from exact-id recall. */
  snippet: string
}

function memorySnippet(memory: AiMemory, term: string): string {
  const compact = memory.body.replace(/\s+/g, ' ').trim()
  const needle = term.trim().toLocaleLowerCase('pt-BR')
  const at = compact.toLocaleLowerCase('pt-BR').indexOf(needle)
  if (at < 0) return compact.slice(0, 220) + (compact.length > 220 ? '…' : '')
  const from = Math.max(0, at - 80)
  const to = Math.min(compact.length, at + Math.max(needle.length, 1) + 140)
  return `${from > 0 ? '…' : ''}${compact.slice(from, to)}${to < compact.length ? '…' : ''}`
}

/**
 * Ranked project + global recall. FTS is deliberately main-process only: the
 * renderer gets bounded snippets instead of loading the whole corpus into every
 * agent run. Exact-id recall still uses getMemory/list for the full body.
 */
export function searchMemories(opts: SearchMemoriesOpts): MemorySearchHit[] {
  const db = getDb()
  const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? 8), 30))
  const term = typeof opts.term === 'string' ? opts.term.trim() : ''
  const where = ['m.archived_at IS NULL']
  const params: unknown[] = []
  if (opts.includeArchived) where[0] = '1=1'
  if (opts.projectId) {
    where.push('(m.project_id=? OR m.project_id IS NULL)')
    params.push(opts.projectId)
  } else where.push('m.project_id IS NULL')
  if (opts.type) {
    where.push('m.type=?')
    params.push(opts.type)
  }

  if (!term) {
    const rows = db
      .prepare(
        `SELECT m.* FROM memory m WHERE ${where.join(' AND ')}
         ORDER BY m.pinned DESC, m.last_accessed_at DESC LIMIT ?`
      )
      .all(...params, limit) as Record<string, unknown>[]
    return rows.map((row) => {
      const memory = memRowToMemory(row)
      return { memory, snippet: memorySnippet(memory, '') }
    })
  }

  const tokens = term
    .match(/[\p{L}\p{N}]+/gu)
    ?.map((token) => `\"${token.replace(/\"/g, '')}\"`)
    .filter(Boolean)
  if (!tokens?.length) return []
  const rows = db
    .prepare(
      `SELECT m.*, bm25(memory_fts, 8.0, 2.0, 1.0) AS relevance
       FROM memory_fts
       JOIN memory m ON m.rowid=memory_fts.rowid
       WHERE memory_fts MATCH ? AND ${where.join(' AND ')}
       ORDER BY m.pinned DESC, relevance ASC, m.last_accessed_at DESC LIMIT ?`
    )
    .all(tokens.join(' AND '), ...params, limit) as Record<string, unknown>[]
  return rows.map((row) => {
    const memory = memRowToMemory(row)
    return { memory, snippet: memorySnippet(memory, term) }
  })
}

/** All memories, newest-touched first, pinned on top. Active only unless asked. */
export function listMemories(opts: ListMemoriesOpts = {}): AiMemory[] {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []
  if (!opts.includeArchived) where.push('archived_at IS NULL')
  if (opts.projectId !== undefined) {
    if (opts.projectId === null) where.push('project_id IS NULL')
    else {
      where.push('project_id = ?')
      params.push(opts.projectId)
    }
  }
  const sql =
    'SELECT * FROM memory' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY pinned DESC, last_accessed_at DESC'
  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(memRowToMemory)
}

/** The briefing set for a run: this project's active memories plus the globals. */
export function memoriesForContext(projectId: string | null): AiMemory[] {
  const project = projectId ? listMemories({ projectId }) : []
  const global = listMemories({ projectId: null })
  return [...project, ...global]
}

export function getMemory(id: string): AiMemory | null {
  const r = getDb().prepare('SELECT * FROM memory WHERE id=?').get(id) as
    | Record<string, unknown>
    | undefined
  return r ? memRowToMemory(r) : null
}

/** Insert or replace a memory row from a fully-formed AiMemory (built in ./memory). */
export function upsertMemory(m: AiMemory): void {
  getDb()
    .prepare(
      `INSERT INTO memory
         (id,project_id,type,title,body,tags,pinned,source,source_conversation_id,created_at,updated_at,last_accessed_at,access_count,archived_at)
       VALUES (@id,@project_id,@type,@title,@body,@tags,@pinned,@source,@source_conversation_id,@created_at,@updated_at,@last_accessed_at,@access_count,@archived_at)
       ON CONFLICT(id) DO UPDATE SET
         project_id=@project_id, type=@type, title=@title, body=@body, tags=@tags,
         pinned=@pinned, source=@source, source_conversation_id=@source_conversation_id, updated_at=@updated_at,
         last_accessed_at=@last_accessed_at, access_count=@access_count, archived_at=@archived_at`
    )
    .run({
      id: m.id,
      project_id: m.projectId,
      type: m.type,
      title: m.title,
      body: m.body,
      tags: JSON.stringify(m.tags),
      pinned: m.pinned ? 1 : 0,
      source: m.source,
      source_conversation_id: m.sourceConversationId,
      created_at: m.createdAt,
      updated_at: m.updatedAt,
      last_accessed_at: m.lastAccessedAt,
      access_count: m.accessCount,
      archived_at: m.archivedAt
    })
}

/** Bump last-accessed + count for the given ids — the cheap write decay reads. */
export function touchMemories(ids: string[], nowIso: string): void {
  if (!ids.length) return
  const db = getDb()
  // A broad query can return several coincidental matches. Count each page at
  // most once per hour so recall reinforcement reflects use, not query volume.
  const threshold = new Date(Date.parse(nowIso) - 3_600_000).toISOString()
  const stmt = db.prepare(
    'UPDATE memory SET last_accessed_at=?, access_count=access_count+1 WHERE id=? AND archived_at IS NULL AND last_accessed_at<?'
  )
  db.transaction((list: string[]) => {
    for (const id of list) stmt.run(nowIso, id, threshold)
  })(ids)
}

/** Retire memories by setting archived_at (never a hard delete — reversible). */
export function archiveMemories(ids: string[], nowIso: string): void {
  if (!ids.length) return
  const db = getDb()
  const stmt = db.prepare(
    'UPDATE memory SET archived_at=?, updated_at=? WHERE id=? AND archived_at IS NULL'
  )
  db.transaction((list: string[]) => {
    for (const id of list) stmt.run(nowIso, nowIso, id)
  })(ids)
}

/** Hard delete one memory (the explicit user action; decay uses archive instead). */
export function deleteMemory(id: string): void {
  getDb().prepare('DELETE FROM memory WHERE id=?').run(id)
}

/**
 * Wholesale-replace the memory table from a backup (like conversations on
 * import). FK-safe: a memory whose `project_id` no longer resolves is stored as
 * global (null) rather than dropped or left to violate the foreign key — the
 * projects are imported before this runs, so a valid backup keeps its scoping,
 * and a memory orphaned by a partial restore survives as a global fact.
 */
export function replaceMemories(memories: AiMemory[]): void {
  const db = getDb()
  const now = new Date().toISOString()
  const projectIds = new Set(
    (db.prepare('SELECT id FROM projects').all() as { id: string }[]).map((r) => r.id)
  )
  db.transaction(() => {
    db.prepare('DELETE FROM memory').run()
    for (const raw of memories ?? []) {
      if (!raw || typeof raw.id !== 'string') continue
      const m = normalizeMemory(raw, now)
      if (m.projectId && !projectIds.has(m.projectId)) m.projectId = null
      upsertMemory(m)
    }
  })()
}
