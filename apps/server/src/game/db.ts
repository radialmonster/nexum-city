import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.js';
import type { Migration } from './migrations.js';

/** Opens (creating if needed) the database in WAL mode and applies pending migrations. */
export function openDatabase(
  file: string,
  now: () => number = Date.now,
  list: readonly Migration[] = migrations,
): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  // FULL: an accepted order is fsynced before the client hears "ok".
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db, now, list);
  return db;
}

export function migrate(db: DatabaseSync, now: () => number, list: readonly Migration[]): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_ms INTEGER NOT NULL
  )`);
  const done = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id),
  );
  const applied: number[] = [];
  for (const m of [...list].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_ms) VALUES (?, ?, ?)').run(
        m.id,
        m.name,
        now(),
      );
    });
    applied.push(m.id);
  }
  return applied;
}

/** Runs `fn` in a transaction; rolls back and rethrows on error. Not re-entrant. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
