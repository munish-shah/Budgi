import { DEFAULT_CATEGORIES } from '../src/categories';
import { buildLearnedIndex, type CategorizeContext } from '../src/categorize';
import { cleanDescription } from '../src/merchants';
import { sortRules } from '../src/rules';
import type { Rule, Transaction } from '../src/types';

let n = 0;
export function txn(partial: Partial<Transaction> & { description: string; amount: number }): Transaction {
  return {
    id: `t${n++}`,
    accountId: 'acct',
    provider: 'manual',
    date: '2026-10-01',
    currency: 'USD',
    displayName: cleanDescription(partial.description),
    pending: false,
    categoryId: 'uncategorized',
    categorySource: 'none',
    confidence: 0,
    excluded: false,
    reviewed: false,
    ...partial,
  };
}

export function ctx(rules: Rule[] = [], history: Transaction[] = [], autoReviewThreshold = 0): CategorizeContext {
  return {
    rules: sortRules(rules),
    learned: buildLearnedIndex(history),
    validCategories: new Set(DEFAULT_CATEGORIES.map((c) => c.id)),
    autoReviewThreshold,
  };
}

export function rule(partial: Partial<Rule> & Pick<Rule, 'conditions' | 'actions'>): Rule {
  return { id: `r${n++}`, name: 'rule', enabled: true, match: 'all', priority: 0, createdAt: '2026-01-01', ...partial };
}
