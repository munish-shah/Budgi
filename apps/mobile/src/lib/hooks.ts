import {
  addMonths,
  categoryMap,
  detectRecurring,
  monthKey,
  summarizeMonth,
  toISODate,
  type Category,
  type MonthKey,
  type Transaction,
} from '@budgi/core';
import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useStore } from './store';

/** Today's date, refreshed when the app comes back to the foreground. */
export function useToday(): string {
  const [today, setToday] = useState(() => toISODate(new Date()));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setToday(toISODate(new Date())));
    return () => sub.remove();
  }, []);
  return today;
}

export function useTxnList(): Transaction[] {
  const txns = useStore((s) => s.txns);
  return useMemo(
    () => Object.values(txns).sort((a, b) => b.date.localeCompare(a.date) || Number(b.pending) - Number(a.pending) || a.id.localeCompare(b.id)),
    [txns],
  );
}

export function useCategories(): { list: Category[]; map: Map<string, Category> } {
  const categories = useStore((s) => s.categories);
  return useMemo(() => ({ list: categories.filter((c) => !c.archived), map: categoryMap(categories) }), [categories]);
}

export function useMonthSummary(month?: MonthKey) {
  const txns = useStore((s) => s.txns);
  const { map } = useCategories();
  const today = useToday();
  const m = month ?? monthKey(today);
  return useMemo(() => {
    const list = Object.values(txns);
    return {
      current: summarizeMonth(list, m, map, today),
      previous: summarizeMonth(list, addMonths(m, -1), map, today),
    };
  }, [txns, map, m, today]);
}

export function useRecurring() {
  const txns = useStore((s) => s.txns);
  const { map } = useCategories();
  const today = useToday();
  return useMemo(() => detectRecurring(Object.values(txns), map, today), [txns, map, today]);
}

export function useReviewQueue(): Transaction[] {
  const list = useTxnList();
  return useMemo(
    () => list.filter((t) => !t.reviewed).sort((a, b) => a.confidence - b.confidence || b.date.localeCompare(a.date)),
    [list],
  );
}

export function useAccounts() {
  const accounts = useStore((s) => s.accounts);
  return useMemo(() => {
    const list = Object.values(accounts).sort((a, b) => a.type.localeCompare(b.type) || b.balance - a.balance);
    let assets = 0;
    let debts = 0;
    for (const a of list) {
      if (a.hidden) continue;
      if (a.type === 'credit' || a.type === 'loan') debts += a.balance;
      else assets += a.balance;
    }
    return { list, assets, debts, netWorth: assets - debts };
  }, [accounts]);
}
