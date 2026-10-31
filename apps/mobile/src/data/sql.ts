import { openDatabaseSync } from 'expo-sqlite'

export type SqlValue = string | number | null
export type SqlParams = SqlValue[]

/**
 * The SQLite surface the phone's data layer uses. On the device it wraps
 * expo-sqlite; the tests run the same code over node:sqlite.
 */
export interface SqlDb {
  exec(sql: string): void
  run(sql: string, params?: SqlParams): { changes: number }
  all<T>(sql: string, params?: SqlParams): T[]
  get<T>(sql: string, params?: SqlParams): T | undefined
  /** Runs `fn` atomically; nested calls become savepoints. */
  tx<R>(fn: () => R): R
}

/** Savepoint-based transactions shared by both adapters (nesting-safe). */
export function savepointTx(exec: (sql: string) => void): <R>(fn: () => R) => R {
  let depth = 0
  return <R>(fn: () => R): R => {
    const name = `sp${depth}`
    depth += 1
    exec(`SAVEPOINT ${name}`)
    try {
      const result = fn()
      exec(`RELEASE ${name}`)
      return result
    } catch (err) {
      exec(`ROLLBACK TO ${name}`)
      exec(`RELEASE ${name}`)
      throw err
    } finally {
      depth -= 1
    }
  }
}

export const DB_NAME = 'sagyou.db'

export function openExpoDb(name = DB_NAME): SqlDb {
  const db = openDatabaseSync(name)
  db.execSync('PRAGMA journal_mode = WAL')
  const exec = (sql: string): void => db.execSync(sql)
  return {
    exec,
    run: (sql, params = []) => ({ changes: db.runSync(sql, params).changes }),
    all: <T>(sql: string, params: SqlParams = []) => db.getAllSync<T>(sql, params),
    get: <T>(sql: string, params: SqlParams = []) => db.getFirstSync<T>(sql, params) ?? undefined,
    tx: savepointTx(exec)
  }
}
