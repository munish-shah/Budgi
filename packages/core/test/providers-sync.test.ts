import { describe, expect, it } from 'vitest';
import { mapPlaidTransaction, mapPlaidAccount } from '../src/providers/plaid';
import { decodeSetupToken, mapSimpleFinAccount, mapSimpleFinTransaction, parseAccessUrl, simplefinAccountsUrl, simplefinErrors } from '../src/providers/simplefin';
import { mergeDelta, stalePendingIds } from '../src/sync';
import { demoTransactions, demoAccounts } from '../src/demo';
import { categorizeAll } from '../src/categorize';
import { ctx, txn } from './helpers';

describe('plaid mapping', () => {
  it('flips the sign and namespaces ids', () => {
    const t = mapPlaidTransaction({
      transaction_id: 'abc', account_id: 'acc', amount: 12.34, iso_currency_code: 'USD', date: '2026-10-01',
      name: 'Starbucks', merchant_name: 'Starbucks', pending: false, pending_transaction_id: 'pend',
      personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' },
    });
    expect(t).toMatchObject({ id: 'plaid_abc', accountId: 'plaid_acc', amount: -1234, pendingTransactionId: 'plaid_pend', providerCategory: 'FOOD_AND_DRINK_COFFEE' });
    const a = mapPlaidAccount({ account_id: 'acc', name: 'Card', type: 'credit', balances: { current: 100.5, available: null, iso_currency_code: 'USD' } }, 'item1', 'Bank');
    expect(a).toMatchObject({ id: 'plaid_acc', type: 'credit', balance: 10050, connectionId: 'item1' });
  });
});

describe('simplefin', () => {
  it('decodes setup tokens and access URLs', () => {
    const token = btoa('https://bridge.simplefin.org/simplefin/claim/DEMO');
    expect(decodeSetupToken(token)).toBe('https://bridge.simplefin.org/simplefin/claim/DEMO');
    expect(() => decodeSetupToken(btoa('http://insecure.example/claim'))).toThrow();
    const creds = parseAccessUrl('https://user:p%40ss@bridge.simplefin.org/simplefin');
    expect(creds.baseUrl).toBe('https://bridge.simplefin.org/simplefin');
    expect(creds.authorization).toBe(`Basic ${btoa('user:p@ss')}`);
    expect(() => parseAccessUrl('http://u:p@x.com')).toThrow();
    expect(simplefinAccountsUrl(creds.baseUrl, new Date(1_000_000_000_000))).toBe(
      'https://bridge.simplefin.org/simplefin/accounts?start-date=1000000000&pending=1',
    );
  });
  it('maps accounts and transactions', () => {
    const acct = { id: 'A1', name: 'Sapphire Card', currency: 'USD', balance: '-450.10', 'balance-date': 1_760_000_000, org: { name: 'Chase' } };
    expect(mapSimpleFinAccount(acct, 'conn')).toMatchObject({ id: 'sf_A1', type: 'credit', balance: 45010, institution: 'Chase' });
    const t = mapSimpleFinTransaction({ id: 'T1', posted: 0, amount: '-4.50', description: 'BLUE BOTTLE', payee: 'Blue Bottle' }, acct);
    expect(t).toMatchObject({ id: 'sf_A1_T1', amount: -450, pending: true, displayName: 'Blue Bottle' });
    expect(simplefinErrors({ errors: ['a'], errlist: [{ msg: 'b' }], accounts: [] })).toEqual(['a', 'b']);
  });
});

describe('mergeDelta', () => {
  it('keeps user edits on modified transactions', () => {
    const mine = txn({ id: 'x', description: 'A', amount: -100, categoryId: 'gifts', categorySource: 'user', note: 'bday' });
    const { upserts } = mergeDelta(new Map([[mine.id, mine]]), { added: [], modified: [{ ...mine, amount: -120, categoryId: 'uncategorized', categorySource: 'none', note: undefined }], removed: [] });
    expect(upserts[0]).toMatchObject({ amount: -120, categoryId: 'gifts', note: 'bday' });
  });

  it('carries edits from pending to posted (linked)', () => {
    const pending = txn({ id: 'p', description: 'RESTAURANT', amount: -5000, pending: true, categoryId: 'gifts', categorySource: 'user' });
    const posted = txn({ id: 'q', description: 'RESTAURANT', amount: -6000, pendingTransactionId: 'p' });
    const res = mergeDelta(new Map([[pending.id, pending]]), { added: [posted], modified: [], removed: ['p'] });
    expect(res.upserts[0]).toMatchObject({ id: 'q', amount: -6000, categoryId: 'gifts', pending: false });
    expect(res.deletes).toEqual(['p']);
  });

  it('matches unlinked pending transactions heuristically', () => {
    const pending = txn({ id: 'p', description: 'SQ *TACOS', amount: -1000, pending: true, date: '2026-10-01', note: 'lunch' });
    const other = txn({ id: 'o', description: 'SQ *TACOS', amount: -1000, pending: true, date: '2026-10-02' });
    const posted = txn({ id: 'q', description: 'SQ *TACOS', amount: -1200, date: '2026-10-03' });
    // "o" is still reported as pending, so only "p" can be the match.
    const res = mergeDelta(new Map([[pending.id, pending], [other.id, other]]), { added: [posted, other], modified: [], removed: [] });
    expect(res.deletes).toEqual(['p']);
    expect(res.upserts.find((t) => t.id === 'q')?.note).toBe('lunch');
  });

  it('finds stale pending transactions', () => {
    const p = txn({ id: 'p', description: 'x', amount: -1, pending: true, date: '2026-10-05', accountId: 'a' });
    expect(stalePendingIds([p], new Set(), new Set(['a']), '2026-10-01')).toEqual(['p']);
    expect(stalePendingIds([p], new Set(['p']), new Set(['a']), '2026-10-01')).toEqual([]);
  });
});

describe('demo data', () => {
  it('is deterministic and mostly auto-categorized', () => {
    const a = demoTransactions('2026-10-09');
    const b = demoTransactions('2026-10-09');
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(300);
    expect(demoAccounts()).toHaveLength(4);
    const categorized = categorizeAll(a, ctx());
    const unknown = categorized.filter((t) => t.categoryId === 'uncategorized');
    expect(unknown.length / categorized.length).toBeLessThan(0.05);
  });
});
