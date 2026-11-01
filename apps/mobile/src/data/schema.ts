import type { SqlDb } from './sql'

/**
 * Versioned by PRAGMA user_version. Each step runs once and in order, so an
 * install that skipped app versions still lands on the current schema.
 *
 * `records` holds every synced record exactly as its payload (kind, id): the
 * phone has no table per entity, so a field it does not show is never lost.
 * The sync_* tables mirror the desktop's (apps/desktop/src/main/store.ts).
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE records (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    payload TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (kind, id)
  );
  CREATE TABLE sync_records (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    hlc TEXT NOT NULL,
    device_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    seq INTEGER NOT NULL,
    base_hlc TEXT,
    server_seq INTEGER,
    PRIMARY KEY (kind, id)
  );
  CREATE INDEX idx_sync_records_seq ON sync_records(seq);
  CREATE INDEX idx_sync_records_hlc ON sync_records(hlc);
  CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE sync_conflicts (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    record_id TEXT NOT NULL,
    type TEXT NOT NULL,
    loser_cipher TEXT NOT NULL,
    winner_hlc TEXT,
    loser_hlc TEXT NOT NULL,
    loser_device TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX idx_sync_conflicts_open ON sync_conflicts(resolved_at);
  CREATE TABLE sync_pending (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    record_cipher TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    PRIMARY KEY (kind, id)
  );
  CREATE VIRTUAL TABLE search_fts USING fts5(
    kind UNINDEXED, id UNINDEXED, profile_id UNINDEXED, archived UNINDEXED, title, body,
    parent UNINDEXED
  );
  CREATE TABLE prefs (key TEXT PRIMARY KEY, value TEXT);
  `
]

export const SCHEMA_VERSION = MIGRATIONS.length

export function migrate(db: SqlDb): void {
  const row = db.get<{ user_version: number }>('PRAGMA user_version')
  let version = row?.user_version ?? 0
  while (version < MIGRATIONS.length) {
    const step = MIGRATIONS[version]
    db.tx(() => {
      db.exec(step)
      db.exec(`PRAGMA user_version = ${version + 1}`)
    })
    version += 1
  }
}
