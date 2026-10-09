import { addMonths, monthKey, summarizeMonth, suggestBudget, type Category, type Transaction } from '@budgi/core';

/** Suggest budgets from the median of the last three full months. */
export function budgetSuggestions(txns: Transaction[], categories: Map<string, Category>, today: string): Map<string, number> {
  const thisMonth = monthKey(today);
  const months = [1, 2, 3].map((n) => summarizeMonth(txns, addMonths(thisMonth, -n), categories, today));
  const out = new Map<string, number>();
  for (const cat of categories.values()) {
    if (cat.kind !== 'expense' || cat.id === 'uncategorized') continue;
    const spends = months.map((m) => m.byCategory.find((c) => c.categoryId === cat.id)?.spent ?? 0);
    const s = suggestBudget(spends);
    if (s > 0) out.set(cat.id, s);
  }
  return out;
}
