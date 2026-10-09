import { merchantKey } from './merchants';
import type { Rule, RuleActions, RuleCondition, Transaction } from './types';

const MAX_REGEX_LENGTH = 200;
const regexCache = new Map<string, RegExp | null>();

/**
 * Compile a user regex defensively: bounded length, case-insensitive, and
 * rejects patterns with nested quantifiers that are classic ReDoS shapes.
 */
export function compileRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!;
  let re: RegExp | null = null;
  if (pattern.length > 0 && pattern.length <= MAX_REGEX_LENGTH && !/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) {
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      re = null;
    }
  }
  regexCache.set(pattern, re);
  return re;
}

export function validateCondition(c: RuleCondition): string | undefined {
  switch (c.field) {
    case 'description':
    case 'merchant':
      if (!c.value.trim()) return 'Enter some text to match';
      if (c.op === 'regex' && !compileRegex(c.value)) return 'Invalid or unsafe pattern';
      return undefined;
    case 'amount':
      if (!Number.isFinite(c.value) || c.value < 0) return 'Enter a positive amount';
      if (c.op === 'between' && (c.value2 === undefined || c.value2 < c.value)) return 'Enter a valid range';
      return undefined;
    case 'account':
    case 'direction':
      return c.value ? undefined : 'Choose a value';
    case 'providerCategory':
      return c.value.trim() ? undefined : 'Enter a category';
  }
}

export function validateRule(rule: Pick<Rule, 'conditions' | 'actions'>): string | undefined {
  if (rule.conditions.length === 0) return 'Add at least one condition';
  for (const c of rule.conditions) {
    const err = validateCondition(c);
    if (err) return err;
  }
  const a = rule.actions;
  if (!a.categoryId && !a.rename?.trim() && a.exclude === undefined && !a.markReviewed) {
    return 'Choose at least one action';
  }
  return undefined;
}

function textMatches(haystack: string, op: string, needle: string): boolean {
  if (op === 'regex') return compileRegex(needle)?.test(haystack) ?? false;
  const h = merchantKey(haystack);
  const n = merchantKey(needle);
  if (!n) return false;
  switch (op) {
    case 'contains':
      return h.includes(n);
    case 'equals':
      return h === n;
    case 'startsWith':
      return h.startsWith(n);
    case 'endsWith':
      return h.endsWith(n);
    default:
      return false;
  }
}

export function conditionMatches(c: RuleCondition, t: Transaction): boolean {
  switch (c.field) {
    case 'description':
      return textMatches(t.description, c.op, c.value);
    case 'merchant': {
      // Match against every name we know for the merchant.
      const names = [t.displayName, t.merchantName, t.renamed].filter((v): v is string => !!v);
      return names.some((n) => textMatches(n, c.op, c.value));
    }
    case 'amount': {
      const abs = Math.abs(t.amount);
      switch (c.op) {
        case 'gt':
          return abs > c.value;
        case 'lt':
          return abs < c.value;
        case 'eq':
          return abs === c.value;
        case 'between':
          return abs >= c.value && abs <= (c.value2 ?? c.value);
      }
      return false;
    }
    case 'direction':
      return c.value === 'expense' ? t.amount < 0 : t.amount > 0;
    case 'account':
      return c.op === 'is' ? t.accountId === c.value : t.accountId !== c.value;
    case 'providerCategory':
      return !!t.providerCategory && t.providerCategory.toUpperCase().includes(c.value.toUpperCase());
  }
}

export function ruleMatches(rule: Rule, t: Transaction): boolean {
  if (!rule.enabled || rule.conditions.length === 0) return false;
  return rule.match === 'all'
    ? rule.conditions.every((c) => conditionMatches(c, t))
    : rule.conditions.some((c) => conditionMatches(c, t));
}

export function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
}

export interface RuleResult {
  actions: RuleActions;
  /** Rule that set the category, if any. */
  categoryRuleId?: string;
  /** Every rule that matched. */
  matched: string[];
}

/**
 * Evaluate all rules against a transaction. Rules run top to bottom; for each
 * action (category, rename, exclude, review) the first rule that sets it wins,
 * so a broad rule lower down can still rename what a specific rule categorized.
 */
export function evaluateRules(sortedRules: Rule[], t: Transaction): RuleResult {
  const actions: RuleActions = {};
  const matched: string[] = [];
  let categoryRuleId: string | undefined;
  for (const rule of sortedRules) {
    if (!ruleMatches(rule, t)) continue;
    matched.push(rule.id);
    const a = rule.actions;
    if (a.categoryId && !actions.categoryId) {
      actions.categoryId = a.categoryId;
      categoryRuleId = rule.id;
    }
    if (a.rename?.trim() && !actions.rename) actions.rename = a.rename.trim();
    if (a.exclude !== undefined && actions.exclude === undefined) actions.exclude = a.exclude;
    if (a.markReviewed && !actions.markReviewed) actions.markReviewed = true;
  }
  return { actions, categoryRuleId, matched };
}

/** Human-readable summary of a condition, e.g. `Merchant contains "uber"`. */
export function describeCondition(c: RuleCondition, accountName?: (id: string) => string): string {
  const opText: Record<string, string> = {
    contains: 'contains',
    equals: 'is',
    startsWith: 'starts with',
    endsWith: 'ends with',
    regex: 'matches',
    gt: 'over',
    lt: 'under',
    eq: 'exactly',
    between: 'between',
    is: 'is',
    isNot: 'is not',
  };
  const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  switch (c.field) {
    case 'description':
      return `Description ${opText[c.op]} “${c.value}”`;
    case 'merchant':
      return `Merchant ${opText[c.op]} “${c.value}”`;
    case 'amount':
      return c.op === 'between'
        ? `Amount between ${money(c.value)} and ${money(c.value2 ?? c.value)}`
        : `Amount ${opText[c.op]} ${money(c.value)}`;
    case 'direction':
      return c.value === 'expense' ? 'Money out' : 'Money in';
    case 'account':
      return `Account ${opText[c.op]} ${accountName ? accountName(c.value) : c.value}`;
    case 'providerCategory':
      return `Bank category contains “${c.value}”`;
  }
}

/**
 * Suggest a rule after you recategorize a transaction — the "always do this
 * for this merchant?" prompt. Uses the cleaned merchant key, which is robust
 * to store numbers and locations in the raw descriptor.
 */
export function suggestRuleFor(t: Transaction, categoryId: string): Omit<Rule, 'id' | 'createdAt' | 'priority'> {
  const name = t.renamed || t.displayName;
  return {
    name: `${name}`,
    enabled: true,
    match: 'all',
    conditions: [{ field: 'merchant', op: 'contains', value: merchantKey(name) }],
    actions: { categoryId },
  };
}
