import { describe, expect, it } from 'vitest';
import { budgetPace, monthPace, summarizeMonth, suggestBudget } from '../src/budgets';
import { categoryMap, DEFAULT_CATEGORIES } from '../src/categories';
import { detectRecurring, monthlyCost } from '../src/recurring';
import { txn } from './helpers';

const cats = categoryMap(DEFAULT_CATEGORIES.map((c) => (c.id === 'dining' ? { ...c, budget: 30_000 } : c)));

describe('summarizeMonth', () => {
  const txns = [
    txn({ description: 'a', amount: -10_000, date: '2026-10-02', categoryId: 'dining' }),
    txn({ description: 'b', amount: 2_000, date: '2026-10-03', categoryId: 'dining' }), // refund
    txn({ description: 'c', amount: -5_000, date: '2026-10-03', categoryId: 'transfer' }),
    txn({ description: 'd', amount: -7_000, date: '2026-10-05', categoryId: 'groceries', excluded: true }),
    txn({ description: 'e', amount: 300_000, date: '2026-10-01', categoryId: 'income' }),
    txn({ description: 'f', amount: -999, date: '2026-09-30', categoryId: 'dining' }),
  ];
  const s = summarizeMonth(txns, '2026-10', cats, '2026-10-09');

  it('nets refunds and ignores transfers / excluded', () => {
    expect(s.spent).toBe(8_000);
    expect(s.income).toBe(300_000);
    expect(s.byCategory.find((c) => c.categoryId === 'dining')).toMatchObject({ spent: 8_000, budget: 30_000, count: 2 });
  });
  it('builds a cumulative series', () => {
    expect(s.cumulative).toHaveLength(31);
    expect(s.cumulative[0]).toBe(0);
    expect(s.cumulative[1]).toBe(10_000);
    expect(s.cumulative[2]).toBe(8_000);
    expect(s.daysElapsed).toBe(9);
  });
});

describe('pace', () => {
  it('flags overspending relative to time elapsed', () => {
    expect(budgetPace(20_000, 30_000, 10, 30).status).toBe('over');
    expect(budgetPace(10_000, 30_000, 10, 30).status).toBe('onTrack');
    expect(budgetPace(2_000, 30_000, 10, 30).status).toBe('under');
    expect(budgetPace(31_000, 30_000, 10, 30).status).toBe('exceeded');
    expect(budgetPace(10_000, 30_000, 10, 30).perDayLeft).toBe(Math.floor(20_000 / 21));
  });
  it('suggests friendly budgets', () => {
    expect(suggestBudget([41_200, 38_000, 52_000])).toBe(42_500);
    expect(suggestBudget([])).toBe(0);
  });
});

describe('detectRecurring', () => {
  it('finds monthly subscriptions and ignores frequent coffee', () => {
    const history = [
      ...['2026-06-03', '2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03'].map((date) =>
        txn({ description: 'NETFLIX.COM', displayName: 'Netflix', amount: -1549, date, categoryId: 'subscriptions' }),
      ),
      ...['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-06', '2026-10-07'].map((date, i) =>
        txn({ description: 'STARBUCKS', displayName: 'Starbucks', amount: -500 - i * 37, date, categoryId: 'coffee' }),
      ),
    ];
    const r = detectRecurring(history, cats, '2026-10-09');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'Netflix', cadence: 'monthly', amount: 1549, nextDate: '2026-11-02', active: true });
    expect(monthlyCost({ amount: 1200, cadence: 'yearly' })).toBe(100);
  });
  it('marks lapsed subscriptions inactive', () => {
    const history = ['2026-01-10', '2026-02-10', '2026-03-10'].map((date) =>
      txn({ description: 'GYM', displayName: 'Gym', amount: -5000, date, categoryId: 'fitness' }),
    );
    expect(detectRecurring(history, cats, '2026-10-09')[0]?.active).toBe(false);
  });
});

describe('monthPace', () => {
  it('treats fixed costs as expected up front', () => {
    const budgets = categoryMap(
      DEFAULT_CATEGORIES.map((c) => (c.id === 'housing' ? { ...c, budget: 200_000 } : c.id === 'dining' ? { ...c, budget: 30_000 } : c)),
    );
    const txns = [
      txn({ description: 'rent', amount: -200_000, date: '2026-10-01', categoryId: 'housing' }),
      txn({ description: 'food', amount: -9_000, date: '2026-10-05', categoryId: 'dining' }),
    ];
    const s = summarizeMonth(txns, '2026-10', budgets, '2026-10-10');
    const p = monthPace(s, budgets)!;
    // Rent fully expected + dining 10/31 of 300
    expect(p.expected).toBe(200_000 + Math.round((30_000 * 10) / 31));
    expect(p.status).toBe('onTrack');
    // Only flexible money counts toward per-day: (300 - 90) / 22 days left
    expect(p.perDayLeft).toBe(Math.floor(21_000 / 22));
    expect(budgetPace(200_000, 200_000, 1, 31, true).status).toBe('onTrack');
  });
  it('returns null without budgets', () => {
    const plain = categoryMap(DEFAULT_CATEGORIES);
    expect(monthPace(summarizeMonth([], '2026-10', plain, '2026-10-10'), plain)).toBeNull();
  });
});
