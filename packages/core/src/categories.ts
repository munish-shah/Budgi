import type { Category } from './types';

export const UNCATEGORIZED = 'uncategorized';
export const TRANSFER = 'transfer';
export const INCOME = 'income';

/**
 * A deliberately small default set. Too many categories is the #1 reason
 * people abandon budgeting apps; you can add more in Settings.
 */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'income', name: 'Income', icon: 'arrow.down.circle.fill', emoji: '💰', color: '#34C77B', kind: 'income' },
  { id: 'groceries', name: 'Groceries', icon: 'cart.fill', emoji: '🛒', color: '#4CC38A', kind: 'expense' },
  { id: 'dining', name: 'Dining', icon: 'fork.knife', emoji: '🍽️', color: '#FF8A4C', kind: 'expense' },
  { id: 'coffee', name: 'Coffee', icon: 'cup.and.saucer.fill', emoji: '☕️', color: '#C08457', kind: 'expense' },
  { id: 'transport', name: 'Transport', icon: 'car.fill', emoji: '🚗', color: '#5B8DEF', kind: 'expense' },
  { id: 'gas', name: 'Gas', icon: 'fuelpump.fill', emoji: '⛽️', color: '#3FA7D6', kind: 'expense' },
  { id: 'shopping', name: 'Shopping', icon: 'bag.fill', emoji: '🛍️', color: '#E25FA4', kind: 'expense' },
  { id: 'entertainment', name: 'Entertainment', icon: 'popcorn.fill', emoji: '🍿', color: '#9B6CF0', kind: 'expense' },
  { id: 'subscriptions', fixed: true, name: 'Subscriptions', icon: 'repeat.circle.fill', emoji: '🔁', color: '#7C7FF5', kind: 'expense' },
  { id: 'bills', fixed: true, name: 'Bills & Utilities', icon: 'bolt.fill', emoji: '💡', color: '#F2B53C', kind: 'expense' },
  { id: 'housing', fixed: true, name: 'Housing', icon: 'house.fill', emoji: '🏠', color: '#D9785B', kind: 'expense' },
  { id: 'health', name: 'Health', icon: 'heart.fill', emoji: '🩺', color: '#F0596B', kind: 'expense' },
  { id: 'fitness', name: 'Fitness', icon: 'figure.run', emoji: '🏃', color: '#2EC4B6', kind: 'expense' },
  { id: 'travel', name: 'Travel', icon: 'airplane', emoji: '✈️', color: '#3DB2FF', kind: 'expense' },
  { id: 'personal', name: 'Personal Care', icon: 'sparkles', emoji: '💅', color: '#F28FB7', kind: 'expense' },
  { id: 'education', name: 'Education', icon: 'graduationcap.fill', emoji: '🎓', color: '#6A8CAF', kind: 'expense' },
  { id: 'gifts', name: 'Gifts & Giving', icon: 'gift.fill', emoji: '🎁', color: '#E0607E', kind: 'expense' },
  { id: 'pets', name: 'Pets', icon: 'pawprint.fill', emoji: '🐾', color: '#B98B5E', kind: 'expense' },
  { id: 'insurance', fixed: true, name: 'Insurance', icon: 'checkmark.shield.fill', emoji: '🛡️', color: '#5E9C8F', kind: 'expense' },
  { id: 'fees', name: 'Fees & Interest', icon: 'percent', emoji: '🧾', color: '#A1A1AA', kind: 'expense' },
  { id: 'cash', name: 'Cash & ATM', icon: 'banknote.fill', emoji: '💵', color: '#8FBF5A', kind: 'expense' },
  { id: 'transfer', name: 'Transfers', icon: 'arrow.left.arrow.right', emoji: '🔄', color: '#8E8E93', kind: 'transfer' },
  { id: 'uncategorized', name: 'Uncategorized', icon: 'questionmark.circle.fill', emoji: '❔', color: '#636366', kind: 'expense' },
];

export function categoryMap(categories: Category[]): Map<string, Category> {
  return new Map(categories.map((c) => [c.id, c]));
}

/** Categories whose transactions never count as spending. */
export function isNonSpending(category: Category | undefined): boolean {
  return category?.kind === 'transfer' || category?.kind === 'income';
}
