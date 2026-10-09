/**
 * SimpleFIN Bridge (https://beta-bridge.simplefin.org) — a read-only, user
 * controlled bank data protocol. No developer keys and no server needed: you
 * paste a one-time Setup Token, the app claims a private Access URL, and that
 * URL is stored only in the device Keychain.
 *
 * The parser accepts both the v1 (`errors: string[]`) and newer
 * (`errlist`, `connections`) response shapes.
 */
import { UNCATEGORIZED } from '../categories';
import { toISODate } from '../dates';
import { toCents } from '../money';
import { cleanDescription } from '../merchants';
import type { Account, AccountType, Transaction } from '../types';

export interface SimpleFinTransaction {
  id: string;
  posted: number;
  amount: string;
  description: string;
  payee?: string;
  memo?: string;
  transacted_at?: number;
  pending?: boolean;
}

export interface SimpleFinAccount {
  id: string;
  name: string;
  conn_id?: string;
  currency: string;
  balance: string;
  'available-balance'?: string;
  'balance-date': number;
  org?: { name?: string; domain?: string; id?: string };
  transactions?: SimpleFinTransaction[];
}

export interface SimpleFinAccountSet {
  errors?: string[];
  errlist?: Array<{ code?: string; msg?: string; conn_id?: string; account_id?: string }>;
  connections?: Array<{ conn_id: string; name?: string; org_id?: string }>;
  accounts: SimpleFinAccount[];
}

/** Decode a Setup Token (base64 of the claim URL) and validate it. */
export function decodeSetupToken(token: string): string {
  const trimmed = token.trim();
  let url: string;
  try {
    url = atob(trimmed.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    throw new Error('That doesn’t look like a SimpleFIN setup token.');
  }
  if (!/^https:\/\/[^\s]+$/.test(url)) throw new Error('Setup token must contain an https:// claim URL.');
  return url;
}

export interface SimpleFinCredentials {
  /** Access URL with credentials removed, e.g. https://bridge.simplefin.org/simplefin */
  baseUrl: string;
  /** `Basic …` header value. */
  authorization: string;
}

/** Split an Access URL (https://user:pass@host/path) into base URL + auth header. */
export function parseAccessUrl(accessUrl: string): SimpleFinCredentials {
  const m = /^https:\/\/([^:@/\s]+):([^@/\s]+)@([^\s]+?)\/?$/.exec(accessUrl.trim());
  if (!m) throw new Error('Invalid SimpleFIN access URL.');
  const [, user, pass, rest] = m;
  return {
    baseUrl: `https://${rest}`,
    authorization: `Basic ${btoa(`${decodeURIComponent(user!)}:${decodeURIComponent(pass!)}`)}`,
  };
}

export function simplefinAccountsUrl(baseUrl: string, startDate: Date, endDate?: Date): string {
  // Built by hand: React Native's URLSearchParams is incomplete.
  let query = `start-date=${Math.floor(startDate.getTime() / 1000)}&pending=1`;
  if (endDate) query += `&end-date=${Math.floor(endDate.getTime() / 1000)}`;
  return `${baseUrl.replace(/\/$/, '')}/accounts?${query}`;
}

export function simplefinErrors(set: SimpleFinAccountSet): string[] {
  const out = [...(set.errors ?? [])];
  for (const e of set.errlist ?? []) if (e.msg) out.push(e.msg);
  return out;
}

const CREDIT_RE = /\b(credit|card|visa|mastercard|amex|american express|discover|sapphire|freedom|venture|quicksilver)\b/i;
const LOAN_RE = /\b(loan|mortgage|heloc|auto loan|student)\b/i;
const INVEST_RE = /\b(brokerage|ira|401k|403b|roth|invest|retirement|hsa|individual)\b/i;

export function inferAccountType(name: string, balance: number): AccountType {
  if (LOAN_RE.test(name)) return 'loan';
  if (CREDIT_RE.test(name)) return 'credit';
  if (INVEST_RE.test(name)) return 'investment';
  return balance < 0 ? 'credit' : 'depository';
}

export const sfAccountId = (id: string) => `sf_${id}`;
export const sfTxnId = (accountId: string, id: string) => `sf_${accountId}_${id}`;

export function mapSimpleFinAccount(a: SimpleFinAccount, connectionId: string, connectionName?: string): Account {
  const raw = toCents(a.balance);
  const type = inferAccountType(a.name, raw);
  const owed = type === 'credit' || type === 'loan';
  const available = a['available-balance'];
  return {
    id: sfAccountId(a.id),
    provider: 'simplefin',
    connectionId,
    name: a.name,
    type,
    institution: a.org?.name ?? connectionName ?? a.org?.domain,
    // SimpleFIN reports debts as negative balances; Budgi stores amount owed as positive.
    balance: owed ? -raw : raw,
    available: available ? toCents(available) : undefined,
    currency: /^[A-Z]{3}$/.test(a.currency) ? a.currency : 'USD',
    updatedAt: new Date((a['balance-date'] || Date.now() / 1000) * 1000).toISOString(),
  };
}

export function mapSimpleFinTransaction(t: SimpleFinTransaction, account: SimpleFinAccount): Transaction {
  const when = t.transacted_at || t.posted || Date.now() / 1000;
  const pending = !!t.pending || t.posted === 0;
  const description = [t.description, t.memo].filter(Boolean).join(' ').trim() || t.payee || 'Transaction';
  const merchantName = t.payee?.trim() || undefined;
  return {
    id: sfTxnId(account.id, t.id),
    accountId: sfAccountId(account.id),
    provider: 'simplefin',
    date: toISODate(new Date(when * 1000)),
    amount: toCents(t.amount),
    currency: /^[A-Z]{3}$/.test(account.currency) ? account.currency : 'USD',
    description,
    merchantName,
    displayName: merchantName ?? cleanDescription(t.description || description),
    pending,
    categoryId: UNCATEGORIZED,
    categorySource: 'none',
    confidence: 0,
    excluded: false,
    reviewed: false,
  };
}
