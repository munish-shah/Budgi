import { addDays, daysBetween } from './dates';
import { merchantKey } from './merchants';
import type { Category, Cents, ISODate, Transaction } from './types';
import { transactionTitle } from './categorize';

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

const CADENCES: Array<{ cadence: Cadence; days: number; tolerance: number }> = [
  { cadence: 'weekly', days: 7, tolerance: 1 },
  { cadence: 'biweekly', days: 14, tolerance: 2 },
  { cadence: 'monthly', days: 30.4, tolerance: 4 },
  { cadence: 'quarterly', days: 91, tolerance: 7 },
  { cadence: 'yearly', days: 365, tolerance: 12 },
];

export interface Recurring {
  key: string;
  name: string;
  categoryId: string;
  cadence: Cadence;
  /** Typical charge, positive = money out. */
  amount: Cents;
  lastDate: ISODate;
  nextDate: ISODate;
  count: number;
  /** False if a charge is overdue by more than one cycle (likely cancelled). */
  active: boolean;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Detect subscriptions and regular bills from transaction history. */
export function detectRecurring(
  transactions: Iterable<Transaction>,
  categories: Map<string, Category>,
  today: ISODate,
): Recurring[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amount >= 0 || t.pending) continue;
    const kind = categories.get(t.categoryId)?.kind;
    if (kind === 'transfer' || kind === 'income') continue;
    const key = merchantKey(transactionTitle(t));
    if (!key) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(t);
  }

  const results: Recurring[] = [];
  for (const [key, txns] of groups) {
    if (txns.length < 2) continue;
    txns.sort((a, b) => a.date.localeCompare(b.date));
    // Collapse same-day duplicates (split shipments etc.)
    const series = txns.filter((t, i) => i === 0 || t.date !== txns[i - 1]!.date);
    if (series.length < 2) continue;

    const intervals: number[] = [];
    for (let i = 1; i < series.length; i++) intervals.push(daysBetween(series[i - 1]!.date, series[i]!.date));
    const typical = median(intervals);
    const match = CADENCES.find((c) => Math.abs(typical - c.days) <= c.tolerance);
    if (!match) continue;

    const consistent = intervals.filter((d) => Math.abs(d - match.days) <= match.tolerance * 1.5).length;
    if (consistent / intervals.length < 0.7) continue;

    const amounts = series.map((t) => -t.amount);
    const typicalAmount = median(amounts);
    const spread = amounts.filter((a) => Math.abs(a - typicalAmount) <= Math.max(typicalAmount * 0.25, 200)).length;
    if (spread / amounts.length < 0.7) continue;

    // Two data points are only convincing if the amounts are identical.
    if (series.length === 2 && amounts[0] !== amounts[1]) continue;
    // Weekly frequent purchases (coffee!) aren't subscriptions unless steady in amount.
    if (match.cadence === 'weekly' && series.length < 4) continue;

    const last = series[series.length - 1]!;
    const nextDate = addDays(last.date, Math.round(match.days));
    const overdue = daysBetween(nextDate, today);
    results.push({
      key,
      name: transactionTitle(last),
      categoryId: last.categoryId,
      cadence: match.cadence,
      amount: Math.round(typicalAmount),
      lastDate: last.date,
      nextDate,
      count: series.length,
      active: overdue <= Math.max(7, match.days * 0.5),
    });
  }
  return results.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

/** Monthly-equivalent cost of a recurring charge. */
export function monthlyCost(r: Pick<Recurring, 'amount' | 'cadence'>): Cents {
  const perMonth: Record<Cadence, number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
  return Math.round(r.amount * perMonth[r.cadence]);
}
