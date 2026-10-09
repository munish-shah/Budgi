import type { Account, Transaction } from '@budgi/core';
import * as SQLite from 'expo-sqlite';
import type { Database, Snapshot } from './db.types';
import { randomHex } from './random';
import { deleteSecret, getSecret, SecretKeys, setSecret } from './secure';

export type { Database, Snapshot } from './db.types';

const DB_NAME = 'budgi.db';

/**
 * On-device store. The SQLite file is encrypted with SQLCipher (AES-256)
 * using a random 256-bit key that lives only in the Keychain. Data is kept
 * as JSON documents — simple, fast for tens of thousands of rows, and easy
 * to migrate.
 */
export async function openDatabase(): Promise<Database> {
  let key = await getSecret(SecretKeys.dbKey);
  if (!key) {
    key = randomHex(32);
    await setSecret(SecretKeys.dbKey, key);
  }
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // Raw-key form skips PBKDF2 since the key is already full-entropy. Must be first.
  await db.execAsync(`PRAGMA key = "x'${key}'"`);
  const cipher = await db.getFirstAsync<{ cipher_version?: string }>('PRAGMA cipher_version').catch(() => null);
  const encrypted = !!cipher?.cipher_version;
  if (!encrypted && __DEV__) console.warn('[budgi] SQLCipher unavailable (Expo Go?). Use a development build for encryption at rest.');

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY NOT NULL, doc TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY NOT NULL, date TEXT NOT NULL, doc TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS transactions_date ON transactions(date);
  `);

  // Serialize writes so rapid edits can't interleave transactions.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  return {
    encrypted,
    async load(): Promise<Snapshot> {
      const [acc, txns, kv] = await Promise.all([
        db.getAllAsync<{ doc: string }>('SELECT doc FROM accounts'),
        db.getAllAsync<{ doc: string }>('SELECT doc FROM transactions ORDER BY date DESC'),
        db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM kv'),
      ]);
      return {
        accounts: acc.map((r) => JSON.parse(r.doc) as Account),
        transactions: txns.map((r) => JSON.parse(r.doc) as Transaction),
        kv: Object.fromEntries(kv.map((r) => [r.key, JSON.parse(r.value)])),
      };
    },
    saveTransactions(upserts, deletes = []) {
      if (!upserts.length && !deletes.length) return Promise.resolve();
      return enqueue(() =>
        db.withExclusiveTransactionAsync(async (tx) => {
          const ins = await tx.prepareAsync('INSERT OR REPLACE INTO transactions (id, date, doc) VALUES (?, ?, ?)');
          const del = await tx.prepareAsync('DELETE FROM transactions WHERE id = ?');
          try {
            for (const t of upserts) await ins.executeAsync([t.id, t.date, JSON.stringify(t)]);
            for (const id of deletes) await del.executeAsync([id]);
          } finally {
            await ins.finalizeAsync();
            await del.finalizeAsync();
          }
        }),
      );
    },
    saveAccounts(upserts, deletes = []) {
      if (!upserts.length && !deletes.length) return Promise.resolve();
      return enqueue(() =>
        db.withExclusiveTransactionAsync(async (tx) => {
          for (const a of upserts) await tx.runAsync('INSERT OR REPLACE INTO accounts (id, doc) VALUES (?, ?)', [a.id, JSON.stringify(a)]);
          for (const id of deletes) await tx.runAsync('DELETE FROM accounts WHERE id = ?', [id]);
        }),
      );
    },
    setKV(key, value) {
      return enqueue(async () => {
        await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
      });
    },
    async wipe() {
      await enqueue(async () => {
        await db.closeAsync();
        await SQLite.deleteDatabaseAsync(DB_NAME);
      });
      await deleteSecret(SecretKeys.dbKey);
    },
  };
}
