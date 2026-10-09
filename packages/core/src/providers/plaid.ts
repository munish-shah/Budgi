/**
 * Minimal Plaid response shapes and mapping onto Budgi types. Only the fields
 * Budgi uses are declared; everything else Plaid sends is dropped on the
 * server before it reaches your phone.
 */
import { UNCATEGORIZED } from '../categories';
import { toCents } from '../money';
import { cleanDescription } from '../merchants';
import type { Account, AccountType, Transaction } from '../types';

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code: string | null;
  unofficial_currency_code?: string | null;
  date: string;
  authorized_date?: string | null;
  name: string;
  merchant_name?: string | null;
  original_description?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
  personal_finance_category?: { primary: string; detailed: string; confidence_level?: string } | null;
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances: {
    current: number | null;
    available: number | null;
    iso_currency_code: string | null;
    unofficial_currency_code?: string | null;
  };
}

export const plaidTxnId = (id: string) => `plaid_${id}`;
export const plaidAccountId = (id: string) => `plaid_${id}`;

const ACCOUNT_TYPES: Record<string, AccountType> = {
  depository: 'depository',
  credit: 'credit',
  loan: 'loan',
  investment: 'investment',
  brokerage: 'investment',
};

export function mapPlaidAccount(a: PlaidAccount, itemId: string, institution?: string): Account {
  return {
    id: plaidAccountId(a.account_id),
    provider: 'plaid',
    connectionId: itemId,
    name: a.name,
    officialName: a.official_name ?? undefined,
    mask: a.mask ?? undefined,
    type: ACCOUNT_TYPES[a.type] ?? 'other',
    subtype: a.subtype ?? undefined,
    institution,
    balance: toCents(a.balances.current ?? 0),
    available: a.balances.available == null ? undefined : toCents(a.balances.available),
    currency: a.balances.iso_currency_code ?? a.balances.unofficial_currency_code ?? 'USD',
    updatedAt: new Date().toISOString(),
  };
}

export function mapPlaidTransaction(t: PlaidTransaction): Transaction {
  const description = t.original_description || t.name;
  const merchantName = t.merchant_name ?? undefined;
  return {
    id: plaidTxnId(t.transaction_id),
    accountId: plaidAccountId(t.account_id),
    provider: 'plaid',
    date: t.date,
    authorizedDate: t.authorized_date ?? undefined,
    // Plaid: positive = money out. Budgi: negative = money out.
    amount: -toCents(t.amount),
    currency: t.iso_currency_code ?? t.unofficial_currency_code ?? 'USD',
    description,
    merchantName,
    displayName: merchantName ?? cleanDescription(t.name || description),
    providerCategory: t.personal_finance_category?.detailed ?? t.personal_finance_category?.primary,
    pending: t.pending,
    pendingTransactionId: t.pending_transaction_id ? plaidTxnId(t.pending_transaction_id) : undefined,
    categoryId: UNCATEGORIZED,
    categorySource: 'none',
    confidence: 0,
    excluded: false,
    reviewed: false,
  };
}
