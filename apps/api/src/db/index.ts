import { DatabaseSync } from 'node:sqlite';
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from './migrations.js';

export type DB = DatabaseSync;

export function openDatabase(file: string, opts: { migrateTo?: number } = {}): DB {
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, opts.migrateTo ?? CURRENT_SCHEMA_VERSION);
  return db;
}

export function schemaVersion(db: DB): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}

export function migrate(db: DB, target: number = CURRENT_SCHEMA_VERSION) {
  const current = schemaVersion(db);
  if (current > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This data directory uses schema version ${current}, but this build of Appfolio only knows up to ${CURRENT_SCHEMA_VERSION}. Update Appfolio before opening it.`,
    );
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current || m.version > target) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString());
    });
  }
}

const depths = new WeakMap<DB, number>();
/** Run fn inside a transaction (nested calls use savepoints). fn must be synchronous. */
export function transaction<T>(db: DB, fn: () => T): T {
  const depth = depths.get(db) ?? 0;
  const sp = `sp_${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depths.set(db, depth + 1);
  try {
    const result = fn();
    depths.set(db, depth);
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return result;
  } catch (err) {
    depths.set(db, depth);
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw err;
  }
}
