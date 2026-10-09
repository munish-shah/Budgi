import type { Account, Transaction } from '@budgi/core';
import type { Database, Snapshot } from './db.types';
import { getAll, putMany, requestPersistence, wipeVault } from './web-vault';

export type { Database, Snapshot } from './db.types';

/**
 * Web/PWA store: IndexedDB with every record encrypted (see web-vault.ts).
 * Same interface as the native SQLCipher store.
 */
export async function openDatabase(): Promise<Database> {
  void requestPersistence();
  return {
    encrypted: true,
    async load(): Promise<Snapshot> {
      const [accounts, transactions, kv] = await Promise.all([
        getAll<Account>('accounts'),
        getAll<Transaction>('transactions'),
        getAll<unknown>('kv'),
      ]);
      return {
        accounts: accounts.map((r) => r.value),
        transactions: transactions.map((r) => r.value).sort((a, b) => b.date.localeCompare(a.date)),
        kv: Object.fromEntries(kv.map((r) => [r.key, r.value])),
      };
    },
    saveTransactions: (upserts, deletes = []) => putMany('transactions', upserts.map((t) => [t.id, t]), deletes),
    saveAccounts: (upserts, deletes = []) => putMany('accounts', upserts.map((a) => [a.id, a]), deletes),
    setKV: (key, value) => putMany('kv', [[key, value]]),
    wipe: wipeVault,
  };
}
