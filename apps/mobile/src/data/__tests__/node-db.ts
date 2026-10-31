// Test-only SqlDb over node:sqlite, so the phone's data layer runs under Jest
// with real SQL (and FTS5). Never imported by app code.
import { savepointTx, type SqlDb, type SqlParams } from '../sql'

interface NodeStatement {
  run(...params: SqlParams): { changes: number | bigint }
  all(...params: SqlParams): unknown[]
  get(...params: SqlParams): unknown
}
interface NodeDatabase {
  exec(sql: string): void
  prepare(sql: string): NodeStatement
}

// Plain objects: node:sqlite returns rows with a null prototype, which
// toEqual() treats as different from {}.
const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T

export function openNodeDb(path = ':memory:'): SqlDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => NodeDatabase
  }
  const db = new DatabaseSync(path)
  const exec = (sql: string): void => db.exec(sql)
  return {
    exec,
    run: (sql, params = []) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
    all: <T>(sql: string, params: SqlParams = []) =>
      db
        .prepare(sql)
        .all(...params)
        .map((r) => plain<T>(r)),
    get: <T>(sql: string, params: SqlParams = []) => {
      const row = db.prepare(sql).get(...params)
      return row === undefined ? undefined : plain<T>(row)
    },
    tx: savepointTx(exec)
  }
}
