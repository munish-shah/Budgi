import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlDatabase, SqlStatement } from './store';

/** Adapts node:sqlite (synchronous) to the D1-style async API used by Store. */
export function openNodeDatabase(path: string): SqlDatabase & { close(): void; raw: DatabaseSync } {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;');

  const statement = (sql: string, params: unknown[] = []): SqlStatement => ({
    bind: (...values) => statement(sql, values),
    first: async <T,>() => (db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined) ?? null,
    all: async <T,>() => ({ results: db.prepare(sql).all(...(params as SQLInputValue[])) as T[] }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(params as SQLInputValue[])).changes) } }),
  });

  return {
    raw: db,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        for (const s of statements) await s.run();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => db.close(),
  };
}
