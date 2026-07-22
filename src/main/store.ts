import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, renameSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'
import { normalizeMemory, type AiMemory } from './memory'

// ── Inline types (mirrors src/renderer/src/types/index.ts) ──────────────────

type Priority = 'low' | 'medium' | 'high' | 'urgent'

interface Column { id: string; name: string; order: number; color?: string }
interface ProjectLink { id: string; label: string; url: string }
interface CodePath { id: string; label?: string; path: string }
interface Project {
  id: string; name: string; description?: string; color: string
  columns: Column[]; links?: ProjectLink[]
  // activeCodePathIds is the selection; activeCodePathId is the legacy singular
  // form, still read so pre-multi-select databases and backups keep working.
  codePaths?: CodePath[]; activeCodePathIds?: string[]; activeCodePathId?: string
  order?: number
  createdAt: string; updatedAt: string
}
interface TaskImage { id: string; name: string; dataUrl: string; size: number; addedAt: string }
interface Task {
  id: string; projectId: string; columnId: string; title: string; description?: string
  priority: Priority; dueDate?: string; tags: string[]; sprintId?: string
  images?: TaskImage[]; timeSpent?: number; order: number
  createdAt: string; updatedAt: string; completedAt?: string
}
interface Sprint { id: string; projectId: string; name: string; createdAt: string; closedAt?: string }
interface Tombstone { id: string; type: 'project' | 'task' | 'sprint'; deletedAt: string }
interface StickyNote {
  id: string; projectId: string; content: string; color: string
  x: number; y: number; width: number; height: number; taskId?: string
  connections?: string[]; createdAt: string; updatedAt: string
  fontSize?: string; type?: 'note' | 'text'; completedAt?: string
}
interface GoalEntry { id: string; date: string; label?: string; value: number; createdAt: string }
interface Goal {
  id: string; title: string; entries: GoalEntry[]; target: number; unit: string
  color: string; projectId?: string; createdAt: string; updatedAt: string
}
interface Habit { id: string; name: string; color: string; completions: string[]; createdAt: string; updatedAt: string }
// Monetary fields accept number (legacy JSON) or string (current renderer schema);
// they are coerced to canonical decimal strings via moneyText() on insert.
interface ShoppingItem { id: string; name: string; qty: number; price?: number | string; done: boolean; link?: string; linkedTransactionId?: string }
interface FinancialTransaction { id: string; description: string; amount: number | string; type: 'income' | 'expense'; date: string; category?: string; fromShopping?: boolean }
interface FinancialGoal { id: string; name: string; targetAmount: number | string; targetMonth: number; targetYear: number; completedAt?: string; completionNote?: string }
interface FinancialTable {
  id: string; name: string; currency: string
  items: ShoppingItem[]; transactions: FinancialTransaction[]; goals: FinancialGoal[]
  createdAt: string; updatedAt: string
}
interface StoredFile { id: string; name: string; ext: string; size: number; createdAt: string; projectId?: string }

interface SaveData {
  projects: Project[]
  tasks: Task[]
  sprints: Sprint[]
  tombstones: Tombstone[]
  notes: StickyNote[]
  goals: Goal[]
  habits: Habit[]
  lists: FinancialTable[]
  files: StoredFile[]
  activeTimer?: { taskId: string; startedAt: number } | null
}

// ── DB paths ─────────────────────────────────────────────────────────────────

const DB_PATH = join(app.getPath('userData'), is.dev ? 'kanban-dev.db' : 'kanban.db')
const LEGACY_PATH = join(app.getPath('userData'), is.dev ? 'kanban-data.dev.json' : 'kanban-data.json')

let _db: Database.Database | null = null

function getDb(): Database.Database {
  if (_db) return _db
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  initSchema(_db)
  migrateMoneyColumnsToText(_db)
  migrateMemoryDropProjectFk(_db)
  migrateFromJson(_db)
  return _db
}

// Coerce a monetary value (legacy number or current string) to a canonical
// decimal string for storage in the TEXT columns.
function moneyText(v: unknown): string {
  if (typeof v === 'number' && isFinite(v)) return String(v)
  if (typeof v === 'string' && v.trim() !== '') return v
  return '0'
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
        from_shopping INTEGER DEFAULT 0
      )`,
      copy: `INSERT INTO transactions_new (id,table_id,description,amount,type,date,category,from_shopping)
        SELECT id,table_id,description,CAST(amount AS TEXT),type,date,category,from_shopping FROM transactions`
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
      db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_project ON memory(project_id) WHERE archived_at IS NULL`)
    })()
    console.log('[store] Migrated memory table: dropped project_id ON DELETE CASCADE')
  } finally {
    db.pragma('foreign_keys = ON')
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
      updated_at TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS task_images (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      data_url TEXT NOT NULL,
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
      updated_at TEXT NOT NULL
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
      from_shopping INTEGER DEFAULT 0
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memory_project ON memory(project_id) WHERE archived_at IS NULL;
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
    project: db.prepare('INSERT INTO projects (id,name,description,color,ord,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'),
    column:  db.prepare('INSERT INTO project_columns (id,project_id,name,ord,color) VALUES (?,?,?,?,?)'),
    link:    db.prepare('INSERT INTO project_links (id,project_id,label,url) VALUES (?,?,?,?)'),
    codePath: db.prepare('INSERT INTO project_code_paths (id,project_id,label,path,active) VALUES (?,?,?,?,?)'),
    task:    db.prepare('INSERT INTO tasks (id,project_id,column_id,title,description,priority,due_date,sprint_id,time_spent,ord,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    tag:     db.prepare('INSERT OR IGNORE INTO task_tags (task_id,tag) VALUES (?,?)'),
    image:   db.prepare('INSERT INTO task_images (id,task_id,name,data_url,size,added_at) VALUES (?,?,?,?,?,?)'),
    sprint:  db.prepare('INSERT INTO sprints (id,project_id,name,created_at,closed_at) VALUES (?,?,?,?,?)'),
    tomb:    db.prepare('INSERT INTO tombstones (id,type,deleted_at) VALUES (?,?,?)'),
    note:    db.prepare('INSERT INTO notes (id,project_id,content,color,x,y,width,height,task_id,font_size,type,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    conn:    db.prepare('INSERT OR IGNORE INTO note_connections (note_id,connected_note_id) VALUES (?,?)'),
    goal:    db.prepare('INSERT INTO goals (id,title,target,unit,color,project_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)'),
    entry:   db.prepare('INSERT INTO goal_entries (id,goal_id,date,label,value,created_at) VALUES (?,?,?,?,?,?)'),
    habit:   db.prepare('INSERT INTO habits (id,name,color,created_at,updated_at) VALUES (?,?,?,?,?)'),
    compl:   db.prepare('INSERT OR IGNORE INTO habit_completions (habit_id,date) VALUES (?,?)'),
    ftable:  db.prepare('INSERT INTO financial_tables (id,name,currency,created_at,updated_at) VALUES (?,?,?,?,?)'),
    item:    db.prepare('INSERT INTO shopping_items (id,table_id,name,qty,price,done,link,linked_transaction_id) VALUES (?,?,?,?,?,?,?,?)'),
    tx:      db.prepare('INSERT INTO transactions (id,table_id,description,amount,type,date,category,from_shopping) VALUES (?,?,?,?,?,?,?,?)'),
    fg:      db.prepare('INSERT INTO financial_goals (id,table_id,name,target_amount,target_month,target_year,completed_at,completion_note) VALUES (?,?,?,?,?,?,?,?)'),
    file:    db.prepare('INSERT INTO files (id,name,ext,size,created_at,project_id) VALUES (?,?,?,?,?,?)'),
    setting: db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)'),
  }

  // Delete a top-level row by id; its children go with it via ON DELETE CASCADE.
  const del = {
    project: db.prepare('DELETE FROM projects WHERE id=?'),
    task:    db.prepare('DELETE FROM tasks WHERE id=?'),
    sprint:  db.prepare('DELETE FROM sprints WHERE id=?'),
    tomb:    db.prepare('DELETE FROM tombstones WHERE id=?'),
    note:    db.prepare('DELETE FROM notes WHERE id=?'),
    goal:    db.prepare('DELETE FROM goals WHERE id=?'),
    habit:   db.prepare('DELETE FROM habits WHERE id=?'),
    ftable:  db.prepare('DELETE FROM financial_tables WHERE id=?'),
    file:    db.prepare('DELETE FROM files WHERE id=?'),
    setting: db.prepare('DELETE FROM settings WHERE key=?'),
  }

  const insert = {
    project: (p: Project): void => {
      ins.project.run(p.id, p.name, p.description ?? null, p.color, p.order ?? null, p.createdAt, p.updatedAt)
      for (const c of p.columns ?? []) ins.column.run(c.id, p.id, c.name, c.order, c.color ?? null)
      for (const l of p.links ?? []) ins.link.run(l.id, p.id, l.label, l.url)
      const active = new Set(p.activeCodePathIds ?? (p.activeCodePathId ? [p.activeCodePathId] : []))
      for (const cp of p.codePaths ?? [])
        ins.codePath.run(cp.id, p.id, cp.label ?? null, cp.path, active.has(cp.id) ? 1 : 0)
    },
    task: (t: Task): void => {
      ins.task.run(t.id, t.projectId, t.columnId, t.title, t.description ?? null, t.priority,
        t.dueDate ?? null, t.sprintId ?? null, t.timeSpent ?? null, t.order,
        t.createdAt, t.updatedAt, t.completedAt ?? null)
      for (const tag of t.tags ?? []) ins.tag.run(t.id, tag)
      for (const img of t.images ?? []) ins.image.run(img.id, t.id, img.name, img.dataUrl, img.size, img.addedAt)
    },
    sprint: (s: Sprint): void => {
      ins.sprint.run(s.id, s.projectId, s.name, s.createdAt, s.closedAt ?? null)
    },
    tombstone: (t: Tombstone): void => {
      ins.tomb.run(t.id, t.type, t.deletedAt)
    },
    note: (n: StickyNote): void => {
      ins.note.run(n.id, n.projectId, n.content, n.color, n.x, n.y, n.width, n.height,
        n.taskId ?? null, n.fontSize ?? null, n.type ?? null, n.completedAt ?? null,
        n.createdAt, n.updatedAt)
      for (const c of n.connections ?? []) ins.conn.run(n.id, c)
    },
    goal: (g: Goal): void => {
      ins.goal.run(g.id, g.title, g.target, g.unit, g.color, g.projectId ?? null, g.createdAt, g.updatedAt)
      for (const e of g.entries ?? []) ins.entry.run(e.id, g.id, e.date, e.label ?? null, e.value, e.createdAt)
    },
    habit: (h: Habit): void => {
      ins.habit.run(h.id, h.name, h.color, h.createdAt, h.updatedAt)
      for (const d of h.completions ?? []) ins.compl.run(h.id, d)
    },
    ftable: (ft: FinancialTable): void => {
      ins.ftable.run(ft.id, ft.name, ft.currency, ft.createdAt, ft.updatedAt)
      for (const i of ft.items ?? []) ins.item.run(i.id, ft.id, i.name, i.qty, i.price != null ? moneyText(i.price) : null, i.done ? 1 : 0, i.link ?? null, i.linkedTransactionId ?? null)
      for (const tx of ft.transactions ?? []) ins.tx.run(tx.id, ft.id, tx.description, moneyText(tx.amount), tx.type, tx.date, tx.category ?? null, tx.fromShopping ? 1 : 0)
      for (const fg of ft.goals ?? []) ins.fg.run(fg.id, ft.id, fg.name, moneyText(fg.targetAmount), fg.targetMonth, fg.targetYear, fg.completedAt ?? null, fg.completionNote ?? null)
    },
    file: (f: StoredFile): void => {
      ins.file.run(f.id, f.name, f.ext, f.size, f.createdAt, f.projectId ?? null)
    },
  }

  const setTimer = (v: unknown): void => { ins.setting.run('activeTimer', JSON.stringify(v)) }
  const clearTimer = (): void => { del.setting.run('activeTimer') }

  return { insert, del, setTimer, clearTimer }
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
  diffEntities(prev.files, next.files, w.del.file, w.insert.file)
  // activeTimer lives in settings; mirror persistAll — set when present, and
  // clear when it goes away, so a stopped timer doesn't linger to the next boot.
  if (JSON.stringify(prev.activeTimer ?? null) !== JSON.stringify(next.activeTimer ?? null)) {
    if (next.activeTimer) w.setTimer(next.activeTimer)
    else w.clearTimer()
  }
}

function persistAll(db: Database.Database, data: SaveData): void {
  // Delete in FK-safe order (children before parents)
  db.exec(`
    DELETE FROM settings;
    DELETE FROM files;
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
  for (const f of data.files ?? []) w.insert.file(f)
  if (data.activeTimer) w.setTimer(data.activeTimer)
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
  const columnsByProject = groupByKey(all('SELECT * FROM project_columns ORDER BY ord'), 'project_id')
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

  const projects = (all('SELECT * FROM projects ORDER BY ord')).map((p) => ({
    id: p.id, name: p.name, color: p.color,
    ...(p.description != null ? { description: p.description } : {}),
    columns: (columnsByProject.get(p.id) ?? [])
      .map((c) => ({ id: c.id, name: c.name, order: c.ord, ...(c.color != null ? { color: c.color } : {}) })),
    ...(() => {
      const ls = (linksByProject.get(p.id) ?? [])
        .map((l) => ({ id: l.id, label: l.label, url: l.url }))
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
    createdAt: p.created_at, updatedAt: p.updated_at,
  }))

  const tasks = (all('SELECT * FROM tasks')).map((t) => ({
    id: t.id, projectId: t.project_id, columnId: t.column_id, title: t.title, priority: t.priority,
    tags: (tagsByTask.get(t.id) ?? []).map((r) => r.tag),
    order: t.ord, createdAt: t.created_at, updatedAt: t.updated_at,
    ...(t.description != null ? { description: t.description } : {}),
    ...(t.due_date != null ? { dueDate: t.due_date } : {}),
    ...(t.sprint_id != null ? { sprintId: t.sprint_id } : {}),
    ...(t.time_spent != null ? { timeSpent: t.time_spent } : {}),
    ...(t.completed_at != null ? { completedAt: t.completed_at } : {}),
    ...(() => {
      const imgs = (imagesByTask.get(t.id) ?? [])
        .map((i) => ({ id: i.id, name: i.name, dataUrl: i.data_url, size: i.size, addedAt: i.added_at }))
      return imgs.length ? { images: imgs } : {}
    })(),
  }))

  const sprints = (all('SELECT * FROM sprints'))
    .map((s) => ({ id: s.id, projectId: s.project_id, name: s.name, createdAt: s.created_at, ...(s.closed_at != null ? { closedAt: s.closed_at } : {}) }))

  const tombstones = (all('SELECT * FROM tombstones'))
    .map((t) => ({ id: t.id, type: t.type, deletedAt: t.deleted_at }))

  const notes = (all('SELECT * FROM notes')).map((n) => ({
    id: n.id, projectId: n.project_id, content: n.content, color: n.color,
    x: n.x, y: n.y, width: n.width, height: n.height,
    createdAt: n.created_at, updatedAt: n.updated_at,
    ...(n.task_id != null ? { taskId: n.task_id } : {}),
    ...(n.font_size != null ? { fontSize: n.font_size } : {}),
    ...(n.type != null ? { type: n.type } : {}),
    ...(n.completed_at != null ? { completedAt: n.completed_at } : {}),
    ...(() => {
      const cs = (connsByNote.get(n.id) ?? []).map((r) => r.connected_note_id)
      return cs.length ? { connections: cs } : {}
    })(),
  }))

  const goals = (all('SELECT * FROM goals')).map((g) => ({
    id: g.id, title: g.title, target: g.target, unit: g.unit, color: g.color,
    createdAt: g.created_at, updatedAt: g.updated_at,
    ...(g.project_id != null ? { projectId: g.project_id } : {}),
    entries: (entriesByGoal.get(g.id) ?? [])
      .map((e) => ({ id: e.id, date: e.date, value: e.value, createdAt: e.created_at, ...(e.label != null ? { label: e.label } : {}) })),
  }))

  const habits = (all('SELECT * FROM habits')).map((h) => ({
    id: h.id, name: h.name, color: h.color, createdAt: h.created_at, updatedAt: h.updated_at,
    completions: (complByHabit.get(h.id) ?? []).map((r) => r.date),
  }))

  const lists = (all('SELECT * FROM financial_tables')).map((ft) => ({
    id: ft.id, name: ft.name, currency: ft.currency, createdAt: ft.created_at, updatedAt: ft.updated_at,
    items: (itemsByTable.get(ft.id) ?? []).map((i) => ({
      id: i.id, name: i.name, qty: i.qty, done: i.done === 1,
      ...(i.price != null ? { price: String(i.price) } : {}),
      ...(i.link != null ? { link: i.link } : {}),
      ...(i.linked_transaction_id != null ? { linkedTransactionId: i.linked_transaction_id } : {}),
    })),
    transactions: (txByTable.get(ft.id) ?? []).map((tx) => ({
      id: tx.id, description: tx.description, amount: String(tx.amount), type: tx.type, date: tx.date,
      ...(tx.category != null ? { category: tx.category } : {}),
      ...(tx.from_shopping ? { fromShopping: true } : {}),
    })),
    goals: (fgByTable.get(ft.id) ?? []).map((fg) => ({
      id: fg.id, name: fg.name, targetAmount: String(fg.target_amount), targetMonth: fg.target_month, targetYear: fg.target_year,
      ...(fg.completed_at != null ? { completedAt: fg.completed_at } : {}),
      ...(fg.completion_note != null ? { completionNote: fg.completion_note } : {}),
    })),
  }))

  const files = (db.prepare('SELECT * FROM files').all() as any[]).map((f) => ({
    id: f.id, name: f.name, ext: f.ext, size: f.size, createdAt: f.created_at,
    ...(f.project_id != null ? { projectId: f.project_id } : {}),
  }))

  const timerRow = db.prepare('SELECT value FROM settings WHERE key=?').get('activeTimer') as { value: string } | undefined
  const activeTimer = timerRow ? JSON.parse(timerRow.value) : null

  return { projects, tasks, sprints, tombstones, notes, goals, habits, lists, files, activeTimer }
}

export function saveData(data: unknown): void {
  const db = getDb()
  const next = data as SaveData
  const prev = lastSnapshot
  // First save of the session (or after a failed one) has nothing to diff
  // against, so it rewrites everything; every save after that only touches what
  // changed since the last snapshot.
  db.transaction(() => {
    if (prev) persistDiff(db, prev, next)
    else persistAll(db, next)
  })()
  // Reached only if the transaction committed. On a throw it rolls back and this
  // line is skipped, so the snapshot keeps matching what's actually on disk —
  // the next save then re-diffs (or rewrites) from a truthful base.
  lastSnapshot = structuredClone(next)
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
         (id,project_id,type,title,body,tags,pinned,source,created_at,updated_at,last_accessed_at,access_count,archived_at)
       VALUES (@id,@project_id,@type,@title,@body,@tags,@pinned,@source,@created_at,@updated_at,@last_accessed_at,@access_count,@archived_at)
       ON CONFLICT(id) DO UPDATE SET
         project_id=@project_id, type=@type, title=@title, body=@body, tags=@tags,
         pinned=@pinned, source=@source, updated_at=@updated_at,
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
  const stmt = db.prepare(
    'UPDATE memory SET last_accessed_at=?, access_count=access_count+1 WHERE id=? AND archived_at IS NULL'
  )
  db.transaction((list: string[]) => {
    for (const id of list) stmt.run(nowIso, id)
  })(ids)
}

/** Retire memories by setting archived_at (never a hard delete — reversible). */
export function archiveMemories(ids: string[], nowIso: string): void {
  if (!ids.length) return
  const db = getDb()
  const stmt = db.prepare('UPDATE memory SET archived_at=?, updated_at=? WHERE id=? AND archived_at IS NULL')
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
