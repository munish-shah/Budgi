import { describe, expect, it } from 'vitest';
import { compileRegex, evaluateRules, ruleMatches, sortRules, suggestRuleFor, validateRule, describeCondition } from '../src/rules';
import { rule, txn } from './helpers';

describe('rules', () => {
  const t = txn({ description: 'SQ *BLUE BOTTLE COFFE 0123 OAKLAND CA', amount: -650, accountId: 'card' });

  it('matches text fields case/punctuation-insensitively', () => {
    expect(ruleMatches(rule({ conditions: [{ field: 'description', op: 'contains', value: 'blue-bottle' }], actions: { categoryId: 'coffee' } }), t)).toBe(true);
    expect(ruleMatches(rule({ conditions: [{ field: 'merchant', op: 'startsWith', value: 'Blue' }], actions: { categoryId: 'coffee' } }), t)).toBe(true);
    expect(ruleMatches(rule({ conditions: [{ field: 'merchant', op: 'equals', value: 'blue' }], actions: { categoryId: 'coffee' } }), t)).toBe(false);
  });

  it('supports amount, direction, account and any/all', () => {
    const over5 = { field: 'amount', op: 'gt', value: 500 } as const;
    const income = { field: 'direction', op: 'is', value: 'income' } as const;
    expect(ruleMatches(rule({ conditions: [over5, income], actions: { categoryId: 'x' } }), t)).toBe(false);
    expect(ruleMatches(rule({ match: 'any', conditions: [over5, income], actions: { categoryId: 'x' } }), t)).toBe(true);
    expect(ruleMatches(rule({ conditions: [{ field: 'amount', op: 'between', value: 600, value2: 700 }], actions: {} }), t)).toBe(true);
    expect(ruleMatches(rule({ conditions: [{ field: 'account', op: 'isNot', value: 'card' }], actions: {} }), t)).toBe(false);
  });

  it('ignores disabled rules', () => {
    expect(ruleMatches(rule({ enabled: false, conditions: [{ field: 'merchant', op: 'contains', value: 'blue' }], actions: {} }), t)).toBe(false);
  });

  it('earlier rules win each action independently', () => {
    const rules = sortRules([
      rule({ priority: 2, conditions: [{ field: 'merchant', op: 'contains', value: 'blue' }], actions: { categoryId: 'dining', rename: 'Blue Bottle' } }),
      rule({ priority: 1, conditions: [{ field: 'amount', op: 'lt', value: 1000 }], actions: { categoryId: 'coffee' } }),
    ]);
    const res = evaluateRules(rules, t);
    expect(res.actions).toEqual({ categoryId: 'coffee', rename: 'Blue Bottle' });
    expect(res.matched).toHaveLength(2);
  });

  it('rejects unsafe or invalid regexes', () => {
    expect(compileRegex('(a+)+$')).toBeNull();
    expect(compileRegex('[')).toBeNull();
    expect(compileRegex('x'.repeat(500))).toBeNull();
    expect(compileRegex('^uber (eats|trip)')).toBeInstanceOf(RegExp);
  });

  it('validates', () => {
    expect(validateRule({ conditions: [], actions: { categoryId: 'x' } })).toBeDefined();
    expect(validateRule({ conditions: [{ field: 'merchant', op: 'contains', value: 'a' }], actions: {} })).toBeDefined();
    expect(validateRule({ conditions: [{ field: 'merchant', op: 'contains', value: 'a' }], actions: { categoryId: 'x' } })).toBeUndefined();
  });

  it('suggests a merchant rule from a correction', () => {
    const s = suggestRuleFor(t, 'coffee');
    expect(s.conditions[0]).toEqual({ field: 'merchant', op: 'contains', value: 'blue bottle coffe' });
    expect(s.actions.categoryId).toBe('coffee');
  });

  it('describes conditions', () => {
    expect(describeCondition({ field: 'amount', op: 'between', value: 1000, value2: 2550 })).toBe('Amount between $10 and $25.50');
  });
});
