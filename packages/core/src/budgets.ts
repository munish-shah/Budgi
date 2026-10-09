import { daysInMonth, monthKey, type MonthKey } from './dates';
import type { Category, Cents, ISODate, Transaction } from './types';

export interface CategorySpend {
  categoryId: string;
  /** Net spend (refunds subtract), positive = money out. */
  spent: Cents;
  budget?: Cents;
  count: number;
}

export interface MonthSummary {
  month: MonthKey;
  /** Net spending on expense categories. */
  spent: Cents;
  income: Cents;
  /** Sum of all category budgets. */
  budgeted: Cents;
  /** Spending only in categories that have a budget. */
  budgetedSpent: Cents;
  byCategory: CategorySpend[];
  /** Cumulative spend at the end of each day (index 0 = day 1). */
  cumulative: Cents[];
  /** Number of days elapsed (full month for past months). */
  daysElapsed: number;
  daysTotal: number;
}

/** Does this transaction count as spending? */
export function isSpending(t: Transaction, categories: Map<string, Category>): boolean {
  if (t.excluded) return false;
  const kind = categories.get(t.categoryId)?.kind ?? 'expense';
  return kind === 'expense';
}

export function isIncome(t: Transaction, categories: Map<string, Category>): boolean {
  if (t.excluded) return false;
  return categories.get(t.categoryId)?.kind === 'income';
}

export function summarizeMonth(
  transactions: Iterable<Transaction>,
  month: MonthKey,
  categories: Map<string, Category>,
  today: ISODate,
): MonthSummary {
  const total = daysInMonth(month);
  const currentMonth = monthKey(today);
  const daysElapsed = month < currentMonth ? total : month > currentMonth ? 0 : Number(today.slice(8, 10));

  const daily = new Array<number>(total).fill(0);
  const byCat = new Map<string, CategorySpend>();
  let spent = 0;
  let income = 0;

  for (const t of transactions) {
    if (t.date.slice(0, 7) !== month) continue;
    if (isSpending(t, categories)) {
      const out = -t.amount;
      spent += out;
      const day = Number(t.date.slice(8, 10)) - 1;
      if (day >= 0 && day < total) daily[day]! += out;
      let c = byCat.get(t.categoryId);
      if (!c) byCat.set(t.categoryId, (c = { categoryId: t.categoryId, spent: 0, count: 0 }));
      c.spent += out;
      c.count += 1;
    } else if (isIncome(t, categories)) {
      income += t.amount;
    }
  }

  let budgeted = 0;
  let budgetedSpent = 0;
  for (const cat of categories.values()) {
    if (cat.kind !== 'expense' || cat.archived || !cat.budget) continue;
    budgeted += cat.budget;
    let c = byCat.get(cat.id);
    if (!c) byCat.set(cat.id, (c = { categoryId: cat.id, spent: 0, count: 0 }));
    c.budget = cat.budget;
    budgetedSpent += Math.max(0, c.spent);
  }

  const cumulative: number[] = [];
  let running = 0;
  for (let i = 0; i < total; i++) {
    running += daily[i]!;
    cumulative.push(running);
  }

  const byCategory = [...byCat.values()].sort((a, b) => b.spent - a.spent);
  return { month, spent, income, budgeted, budgetedSpent, byCategory, cumulative, daysElapsed, daysTotal: total };
}

export type PaceStatus = 'under' | 'onTrack' | 'over' | 'exceeded';

export interface Pace {
  /** What you'd have spent by today at an even pace (fixed costs count in full). */
  expected: Cents;
  /** expected / budget — where the "you should be here" marker goes. */
  expectedProgress: number;
  /** spent / budget, 0..∞ */
  progress: number;
  /** Fraction of the month elapsed, 0..1 */
  timeProgress: number;
  status: PaceStatus;
  /** How much you can spend per remaining day to stay on budget. */
  perDayLeft: Cents;
  remaining: Cents;
}

function paceStatus(spent: Cents, budget: Cents, expected: Cents): PaceStatus {
  if (spent > budget) return 'exceeded';
  if (spent > expected * 1.1 && spent - expected > 1000) return 'over';
  if (spent < expected * 0.85) return 'under';
  return 'onTrack';
}

export function budgetPace(spent: Cents, budget: Cents, daysElapsed: number, daysTotal: number, fixed = false): Pace {
  const timeProgress = daysTotal ? Math.min(1, daysElapsed / daysTotal) : 1;
  const expected = fixed ? budget : Math.round(budget * timeProgress);
  const remaining = budget - spent;
  const daysLeft = Math.max(1, daysTotal - daysElapsed + 1);
  const progress = budget > 0 ? spent / budget : spent > 0 ? Infinity : 0;
  return {
    expected,
    expectedProgress: budget > 0 ? Math.min(1, expected / budget) : 0,
    progress,
    timeProgress,
    status: paceStatus(spent, budget, expected),
    perDayLeft: fixed ? 0 : Math.max(0, Math.floor(remaining / daysLeft)),
    remaining,
  };
}

/**
 * Pace across all budgeted categories. Fixed costs count as expected in full
 * (rent on the 1st isn't "overspending"), and the per-day allowance only
 * includes flexible categories — what you can actually still choose to spend.
 */
export function monthPace(summary: MonthSummary, categories: Map<string, Category>): Pace | null {
  if (!summary.budgeted) return null;
  const { daysElapsed, daysTotal } = summary;
  const timeProgress = daysTotal ? Math.min(1, daysElapsed / daysTotal) : 1;
  const daysLeft = Math.max(1, daysTotal - daysElapsed + 1);
  let expected = 0;
  let flexibleLeft = 0;
  for (const c of summary.byCategory) {
    if (!c.budget) continue;
    const fixed = !!categories.get(c.categoryId)?.fixed;
    expected += fixed ? c.budget : c.budget * timeProgress;
    if (!fixed) flexibleLeft += Math.max(0, c.budget - Math.max(0, c.spent));
  }
  const spent = summary.budgetedSpent;
  const budget = summary.budgeted;
  return {
    expected: Math.round(expected),
    expectedProgress: Math.min(1, expected / budget),
    progress: spent / budget,
    timeProgress,
    status: paceStatus(spent, budget, expected),
    perDayLeft: Math.floor(flexibleLeft / daysLeft),
    remaining: budget - spent,
  };
}

/**
 * Suggest a monthly budget for a category from history: the median of the
 * last N full months, rounded up to a friendly number.
 */
export function suggestBudget(monthlySpends: Cents[]): Cents {
  const vals = monthlySpends.filter((v) => v > 0).sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid]! : (vals[mid - 1]! + vals[mid]!) / 2;
  const step = median > 100_000 ? 5_000 : median > 20_000 ? 2_500 : 1_000;
  return Math.ceil(median / step) * step;
}
