import { describe, expect, it } from 'vitest';
import { categorize, mapProviderCategory, predictLearned, buildLearnedIndex } from '../src/categorize';
import { ctx, rule, txn } from './helpers';

describe('categorize pipeline', () => {
  it('uses the merchant knowledge base and cleans the name', () => {
    const t = categorize(txn({ description: 'UBER *EATS PENDING', amount: -2350 }), ctx());
    expect(t.categoryId).toBe('dining');
    expect(t.categorySource).toBe('merchant');
    expect(t.displayName).toBe('Uber Eats');
  });

  it('falls back to provider categories', () => {
    const t = categorize(txn({ description: 'OBSCURE LLC 99', amount: -1000, providerCategory: 'FOOD_AND_DRINK_COFFEE' }), ctx());
    expect(t.categoryId).toBe('coffee');
    expect(t.categorySource).toBe('provider');
  });

  it('then keyword heuristics, then income for unknown deposits', () => {
    expect(categorize(txn({ description: 'SQ *MOONLIGHT TAQUERIA', amount: -1500 }), ctx()).categoryId).toBe('dining');
    const deposit = categorize(txn({ description: 'MYSTERY CO', amount: 5000 }), ctx());
    expect(deposit.categoryId).toBe('income');
    expect(deposit.confidence).toBeLessThan(0.5);
    const unknown = categorize(txn({ description: 'ZXQW 1', amount: -500 }), ctx());
    expect(unknown.categoryId).toBe('uncategorized');
  });

  it('rules beat the knowledge base', () => {
    const r = rule({ conditions: [{ field: 'merchant', op: 'contains', value: 'starbucks' }], actions: { categoryId: 'dining', rename: 'Work coffee' } });
    const t = categorize(txn({ description: 'STARBUCKS STORE 1', amount: -500 }), ctx([r]));
    expect(t.categoryId).toBe('dining');
    expect(t.categorySource).toBe('rule');
    expect(t.ruleId).toBe(r.id);
    expect(t.renamed).toBe('Work coffee');
    expect(t.renamedBy).toBe('rule');
  });

  it('never overrides what you set by hand', () => {
    const r = rule({ conditions: [{ field: 'merchant', op: 'contains', value: 'starbucks' }], actions: { categoryId: 'dining' } });
    const mine = txn({ description: 'STARBUCKS', amount: -500, categoryId: 'gifts', categorySource: 'user', renamed: 'Gift card', renamedBy: 'user' });
    const t = categorize(mine, ctx([r]));
    expect(t.categoryId).toBe('gifts');
    expect(t.renamed).toBe('Gift card');
  });

  it('undoes rule effects when the rule goes away', () => {
    const r = rule({ conditions: [{ field: 'merchant', op: 'contains', value: 'venmo' }], actions: { exclude: true, rename: 'Rent split' } });
    const first = categorize(txn({ description: 'VENMO PAYMENT 123', amount: -5000 }), ctx([r]));
    expect(first.excluded).toBe(true);
    const second = categorize(first, ctx([]));
    expect(second.excluded).toBe(false);
    expect(second.renamed).toBeUndefined();
  });

  it('learns from your corrections', () => {
    const history = [
      txn({ description: 'SQ *MOONLIGHT TAQUERIA', amount: -1500, categoryId: 'entertainment', categorySource: 'user' }),
      txn({ description: 'SQ *MOONLIGHT TAQUERIA OAKLAND CA', amount: -1700, categoryId: 'entertainment', categorySource: 'user' }),
    ];
    const t = categorize(txn({ description: 'SQ *MOONLIGHT TAQUERIA 22', amount: -900 }), ctx([], history));
    expect(t.categoryId).toBe('entertainment');
    expect(t.categorySource).toBe('learned');
  });

  it('auto-reviews only confident results', () => {
    const c = ctx([], [], 0.85);
    expect(categorize(txn({ description: 'NETFLIX.COM', amount: -1549 }), c).reviewed).toBe(true);
    expect(categorize(txn({ description: 'SQ *MOONLIGHT TAQUERIA', amount: -1500 }), c).reviewed).toBe(false);
  });
});

describe('learning index', () => {
  it('requires a clear majority', () => {
    const idx = buildLearnedIndex([
      txn({ description: 'COSTCO', amount: -1, categoryId: 'groceries', categorySource: 'user' }),
      txn({ description: 'COSTCO', amount: -1, categoryId: 'shopping', categorySource: 'user' }),
    ]);
    expect(predictLearned(idx, { displayName: 'Costco' })).toBeUndefined();
  });
});

describe('provider mapping', () => {
  it('maps detailed and primary PFC values', () => {
    expect(mapProviderCategory('TRANSPORTATION_GAS')).toBe('gas');
    expect(mapProviderCategory('TRANSFER_IN_DEPOSIT')).toBe('transfer');
    expect(mapProviderCategory('FOOD_AND_DRINK_OTHER')).toBe('dining');
    expect(mapProviderCategory('LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')).toBe('transfer');
    expect(mapProviderCategory('NOPE')).toBeUndefined();
  });
});

describe('display names', () => {
  it('keeps the real merchant name for generic matches', () => {
    expect(categorize(txn({ description: 'EQUINOX #142 SAN FRANCISCO CA', amount: -24500 }), ctx()).displayName).toBe('Equinox');
    expect(categorize(txn({ description: 'NETFLIX.COM 866-579-7172 CA', amount: -1549 }), ctx()).displayName).toBe('Netflix');
  });
});
