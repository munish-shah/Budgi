import type { Account, Transaction } from '@budgi/core';
import type { Database, Snapshot } from './db.types';

export type { Database, Snapshot } from './db.types';

/**
 * Web preview store: in-memory only. The browser build exists to preview the
 * UI with demo data; real bank data is only ever handled by the iOS app.
 */
export async function openDatabase(): Promise<Database> {
  const accounts = new Map<string, Account>();
  const transactions = new Map<string, Transaction>();
  const kv = new Map<string, unknown>();
  return {
    encrypted: false,
    async load(): Promise<Snapshot> {
      return { accounts: [...accounts.values()], transactions: [...transactions.values()], kv: Object.fromEntries(kv) };
    },
    async saveTransactions(upserts, deletes = []) {
      for (const t of upserts) transactions.set(t.id, t);
      for (const id of deletes) transactions.delete(id);
    },
    async saveAccounts(upserts, deletes = []) {
      for (const a of upserts) accounts.set(a.id, a);
      for (const id of deletes) accounts.delete(id);
    },
    async setKV(key, value) {
      kv.set(key, value);
    },
    async wipe() {
      accounts.clear();
      transactions.clear();
      kv.clear();
    },
  };
}
