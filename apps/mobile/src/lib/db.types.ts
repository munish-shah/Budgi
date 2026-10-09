import type { Account, Transaction } from '@budgi/core';

export interface Snapshot {
  accounts: Account[];
  transactions: Transaction[];
  kv: Record<string, unknown>;
}

export interface Database {
  /** True when the file is encrypted with SQLCipher. */
  readonly encrypted: boolean;
  load(): Promise<Snapshot>;
  saveTransactions(upserts: Transaction[], deletes?: string[]): Promise<void>;
  saveAccounts(upserts: Account[], deletes?: string[]): Promise<void>;
  setKV(key: string, value: unknown): Promise<void>;
  /** Irreversibly delete everything stored on this device. */
  wipe(): Promise<void>;
}
