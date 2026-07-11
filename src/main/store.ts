import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, renameSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import Database from 'better-sqlite3'

// ── Inline types (mirrors src/renderer/src/types/index.ts) ──────────────────

type Priority = 'low' | 'medium' | 'high' | 'urgent'

interface Column { id: string; name: string; order: number; color?: string }
interface ProjectLink { id: string; label: string; url: string }
interface Project {
  id: string; name: string; description?: string; color: string
  columns: Column[]; links?: ProjectLink[]; order?: number
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

// ── Write (full replace inside a transaction) ─────────────────────────────────

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
    DELETE FROM project_columns;
    DELETE FROM projects;
  `)

  const ins = {
    project: db.prepare('INSERT INTO projects (id,name,description,color,ord,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'),
    column:  db.prepare('INSERT INTO project_columns (id,project_id,name,ord,color) VALUES (?,?,?,?,?)'),
    link:    db.prepare('INSERT INTO project_links (id,project_id,label,url) VALUES (?,?,?,?)'),
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

  for (const p of data.projects ?? []) {
    ins.project.run(p.id, p.name, p.description ?? null, p.color, p.order ?? null, p.createdAt, p.updatedAt)
    for (const c of p.columns ?? []) ins.column.run(c.id, p.id, c.name, c.order, c.color ?? null)
    for (const l of p.links ?? []) ins.link.run(l.id, p.id, l.label, l.url)
  }

  for (const t of data.tasks ?? []) {
    ins.task.run(t.id, t.projectId, t.columnId, t.title, t.description ?? null, t.priority,
      t.dueDate ?? null, t.sprintId ?? null, t.timeSpent ?? null, t.order,
      t.createdAt, t.updatedAt, t.completedAt ?? null)
    for (const tag of t.tags ?? []) ins.tag.run(t.id, tag)
    for (const img of t.images ?? []) ins.image.run(img.id, t.id, img.name, img.dataUrl, img.size, img.addedAt)
  }

  for (const s of data.sprints ?? []) ins.sprint.run(s.id, s.projectId, s.name, s.createdAt, s.closedAt ?? null)

  for (const t of data.tombstones ?? []) ins.tomb.run(t.id, t.type, t.deletedAt)

  for (const n of data.notes ?? []) {
    ins.note.run(n.id, n.projectId, n.content, n.color, n.x, n.y, n.width, n.height,
      n.taskId ?? null, n.fontSize ?? null, n.type ?? null, n.completedAt ?? null,
      n.createdAt, n.updatedAt)
    for (const c of n.connections ?? []) ins.conn.run(n.id, c)
  }

  for (const g of data.goals ?? []) {
    ins.goal.run(g.id, g.title, g.target, g.unit, g.color, g.projectId ?? null, g.createdAt, g.updatedAt)
    for (const e of g.entries ?? []) ins.entry.run(e.id, g.id, e.date, e.label ?? null, e.value, e.createdAt)
  }

  for (const h of data.habits ?? []) {
    ins.habit.run(h.id, h.name, h.color, h.createdAt, h.updatedAt)
    for (const d of h.completions ?? []) ins.compl.run(h.id, d)
  }

  for (const ft of data.lists ?? []) {
    ins.ftable.run(ft.id, ft.name, ft.currency, ft.createdAt, ft.updatedAt)
    for (const i of ft.items ?? []) ins.item.run(i.id, ft.id, i.name, i.qty, i.price != null ? moneyText(i.price) : null, i.done ? 1 : 0, i.link ?? null, i.linkedTransactionId ?? null)
    for (const tx of ft.transactions ?? []) ins.tx.run(tx.id, ft.id, tx.description, moneyText(tx.amount), tx.type, tx.date, tx.category ?? null, tx.fromShopping ? 1 : 0)
    for (const fg of ft.goals ?? []) ins.fg.run(fg.id, ft.id, fg.name, moneyText(fg.targetAmount), fg.targetMonth, fg.targetYear, fg.completedAt ?? null, fg.completionNote ?? null)
  }

  for (const f of data.files ?? []) ins.file.run(f.id, f.name, f.ext, f.size, f.createdAt, f.projectId ?? null)

  if (data.activeTimer) ins.setting.run('activeTimer', JSON.stringify(data.activeTimer))
}

// ── Public API ────────────────────────────────────────────────────────────────

export function loadData(): SaveData {
  const db = getDb()

  const projects = (db.prepare('SELECT * FROM projects ORDER BY ord').all() as any[]).map((p) => ({
    id: p.id, name: p.name, color: p.color,
    ...(p.description != null ? { description: p.description } : {}),
    columns: (db.prepare('SELECT * FROM project_columns WHERE project_id=? ORDER BY ord').all(p.id) as any[])
      .map((c) => ({ id: c.id, name: c.name, order: c.ord, ...(c.color != null ? { color: c.color } : {}) })),
    ...(() => {
      const ls = (db.prepare('SELECT * FROM project_links WHERE project_id=?').all(p.id) as any[])
        .map((l) => ({ id: l.id, label: l.label, url: l.url }))
      return ls.length ? { links: ls } : {}
    })(),
    ...(p.ord != null ? { order: p.ord } : {}),
    createdAt: p.created_at, updatedAt: p.updated_at,
  }))

  const tasks = (db.prepare('SELECT * FROM tasks').all() as any[]).map((t) => ({
    id: t.id, projectId: t.project_id, columnId: t.column_id, title: t.title, priority: t.priority,
    tags: (db.prepare('SELECT tag FROM task_tags WHERE task_id=?').all(t.id) as any[]).map((r) => r.tag),
    order: t.ord, createdAt: t.created_at, updatedAt: t.updated_at,
    ...(t.description != null ? { description: t.description } : {}),
    ...(t.due_date != null ? { dueDate: t.due_date } : {}),
    ...(t.sprint_id != null ? { sprintId: t.sprint_id } : {}),
    ...(t.time_spent != null ? { timeSpent: t.time_spent } : {}),
    ...(t.completed_at != null ? { completedAt: t.completed_at } : {}),
    ...(() => {
      const imgs = (db.prepare('SELECT * FROM task_images WHERE task_id=?').all(t.id) as any[])
        .map((i) => ({ id: i.id, name: i.name, dataUrl: i.data_url, size: i.size, addedAt: i.added_at }))
      return imgs.length ? { images: imgs } : {}
    })(),
  }))

  const sprints = (db.prepare('SELECT * FROM sprints').all() as any[])
    .map((s) => ({ id: s.id, projectId: s.project_id, name: s.name, createdAt: s.created_at, ...(s.closed_at != null ? { closedAt: s.closed_at } : {}) }))

  const tombstones = (db.prepare('SELECT * FROM tombstones').all() as any[])
    .map((t) => ({ id: t.id, type: t.type, deletedAt: t.deleted_at }))

  const notes = (db.prepare('SELECT * FROM notes').all() as any[]).map((n) => ({
    id: n.id, projectId: n.project_id, content: n.content, color: n.color,
    x: n.x, y: n.y, width: n.width, height: n.height,
    createdAt: n.created_at, updatedAt: n.updated_at,
    ...(n.task_id != null ? { taskId: n.task_id } : {}),
    ...(n.font_size != null ? { fontSize: n.font_size } : {}),
    ...(n.type != null ? { type: n.type } : {}),
    ...(n.completed_at != null ? { completedAt: n.completed_at } : {}),
    ...(() => {
      const cs = (db.prepare('SELECT connected_note_id FROM note_connections WHERE note_id=?').all(n.id) as any[])
        .map((r) => r.connected_note_id)
      return cs.length ? { connections: cs } : {}
    })(),
  }))

  const goals = (db.prepare('SELECT * FROM goals').all() as any[]).map((g) => ({
    id: g.id, title: g.title, target: g.target, unit: g.unit, color: g.color,
    createdAt: g.created_at, updatedAt: g.updated_at,
    ...(g.project_id != null ? { projectId: g.project_id } : {}),
    entries: (db.prepare('SELECT * FROM goal_entries WHERE goal_id=?').all(g.id) as any[])
      .map((e) => ({ id: e.id, date: e.date, value: e.value, createdAt: e.created_at, ...(e.label != null ? { label: e.label } : {}) })),
  }))

  const habits = (db.prepare('SELECT * FROM habits').all() as any[]).map((h) => ({
    id: h.id, name: h.name, color: h.color, createdAt: h.created_at, updatedAt: h.updated_at,
    completions: (db.prepare('SELECT date FROM habit_completions WHERE habit_id=?').all(h.id) as any[]).map((r) => r.date),
  }))

  const lists = (db.prepare('SELECT * FROM financial_tables').all() as any[]).map((ft) => ({
    id: ft.id, name: ft.name, currency: ft.currency, createdAt: ft.created_at, updatedAt: ft.updated_at,
    items: (db.prepare('SELECT * FROM shopping_items WHERE table_id=?').all(ft.id) as any[]).map((i) => ({
      id: i.id, name: i.name, qty: i.qty, done: i.done === 1,
      ...(i.price != null ? { price: String(i.price) } : {}),
      ...(i.link != null ? { link: i.link } : {}),
      ...(i.linked_transaction_id != null ? { linkedTransactionId: i.linked_transaction_id } : {}),
    })),
    transactions: (db.prepare('SELECT * FROM transactions WHERE table_id=?').all(ft.id) as any[]).map((tx) => ({
      id: tx.id, description: tx.description, amount: String(tx.amount), type: tx.type, date: tx.date,
      ...(tx.category != null ? { category: tx.category } : {}),
      ...(tx.from_shopping ? { fromShopping: true } : {}),
    })),
    goals: (db.prepare('SELECT * FROM financial_goals WHERE table_id=?').all(ft.id) as any[]).map((fg) => ({
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
  db.transaction(() => persistAll(db, data as SaveData))()
}
