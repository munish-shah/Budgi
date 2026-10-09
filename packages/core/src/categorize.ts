import { UNCATEGORIZED } from './categories';
import { cleanDescription, heuristicCategory, lookupMerchant, merchantKey } from './merchants';
import { evaluateRules } from './rules';
import type { CategorySource, Rule, Transaction } from './types';

/**
 * Categorization pipeline (highest priority first):
 *
 *   1. user      – you set it by hand; automation never overrides it
 *   2. rule      – one of your rules matched
 *   3. learned   – you've categorized this merchant before
 *   4. merchant  – Budgi's built-in merchant knowledge base
 *   5. provider  – the bank/Plaid category, mapped onto Budgi categories
 *   6. heuristic – keyword guesses ("PIZZERIA" → Dining)
 *
 * Every automatic decision carries a confidence so the Review inbox can
 * surface the guesses most worth a second look.
 */

const CONFIDENCE: Record<CategorySource, number> = {
  user: 1,
  rule: 0.99,
  learned: 0.9,
  merchant: 0.9,
  provider: 0.75,
  heuristic: 0.5,
  none: 0,
};

// ---------- Learning from your corrections ----------

export interface LearnedIndex {
  /** merchantKey -> categoryId -> count */
  byMerchant: Map<string, Map<string, number>>;
}

function learnKey(t: Pick<Transaction, 'displayName' | 'merchantName'>): string {
  return merchantKey(t.merchantName || t.displayName);
}

export function buildLearnedIndex(transactions: Iterable<Transaction>): LearnedIndex {
  const byMerchant = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (t.categorySource !== 'user') continue;
    const key = learnKey(t);
    if (!key) continue;
    let counts = byMerchant.get(key);
    if (!counts) byMerchant.set(key, (counts = new Map()));
    counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  }
  return { byMerchant };
}

export function learnFrom(index: LearnedIndex, t: Transaction): void {
  const key = learnKey(t);
  if (!key) return;
  let counts = index.byMerchant.get(key);
  if (!counts) index.byMerchant.set(key, (counts = new Map()));
  counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
}

export function predictLearned(index: LearnedIndex, t: Pick<Transaction, 'displayName' | 'merchantName'>):
  | { categoryId: string; confidence: number }
  | undefined {
  const counts = index.byMerchant.get(learnKey(t));
  if (!counts) return undefined;
  let total = 0;
  let best: string | undefined;
  let bestCount = 0;
  for (const [cat, n] of counts) {
    total += n;
    if (n > bestCount) {
      best = cat;
      bestCount = n;
    }
  }
  const share = bestCount / total;
  if (!best || share < 0.6) return undefined;
  // One correction is a strong hint; three consistent ones is near-certain.
  const confidence = Math.min(0.97, 0.7 + 0.1 * Math.min(bestCount, 3)) * share;
  return { categoryId: best, confidence };
}

// ---------- Provider category mapping (Plaid personal_finance_category) ----------

const PFC_DETAILED: Record<string, string> = {
  FOOD_AND_DRINK_COFFEE: 'coffee',
  FOOD_AND_DRINK_GROCERIES: 'groceries',
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: 'groceries',
  FOOD_AND_DRINK_FAST_FOOD: 'dining',
  FOOD_AND_DRINK_RESTAURANT: 'dining',
  FOOD_AND_DRINK_VENDING_MACHINES: 'dining',
  TRANSPORTATION_GAS: 'gas',
  TRANSPORTATION_PARKING: 'transport',
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: 'transport',
  TRANSPORTATION_PUBLIC_TRANSIT: 'transport',
  TRANSPORTATION_TOLLS: 'transport',
  TRANSPORTATION_BIKES_AND_SCOOTERS: 'transport',
  RENT_AND_UTILITIES_RENT: 'housing',
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: 'housing',
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: 'transfer',
  LOAN_PAYMENTS_CAR_PAYMENT: 'transport',
  GENERAL_SERVICES_INSURANCE: 'insurance',
  GENERAL_SERVICES_EDUCATION: 'education',
  GENERAL_SERVICES_AUTOMOTIVE: 'transport',
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: 'fitness',
  PERSONAL_CARE_HAIR_AND_BEAUTY: 'personal',
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: 'gifts',
  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: 'bills',
  GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES: 'gifts',
  GENERAL_MERCHANDISE_PET_SUPPLIES: 'pets',
  GENERAL_MERCHANDISE_PHARMACIES_AND_SUPPLEMENTS: 'health',
  MEDICAL_VETERINARY_SERVICES: 'pets',
  ENTERTAINMENT_TV_AND_MOVIES: 'entertainment',
  ENTERTAINMENT_MUSIC_AND_AUDIO: 'subscriptions',
  TRANSFER_OUT_WITHDRAWAL: 'cash',
  TRANSFER_IN_CASH_ADVANCES_AND_LOANS: 'transfer',
  BANK_FEES_INTEREST_CHARGE: 'fees',
  INCOME_INTEREST_EARNED: 'income',
};

const PFC_PRIMARY: Record<string, string> = {
  INCOME: 'income',
  TRANSFER_IN: 'transfer',
  TRANSFER_OUT: 'transfer',
  LOAN_PAYMENTS: 'bills',
  BANK_FEES: 'fees',
  ENTERTAINMENT: 'entertainment',
  FOOD_AND_DRINK: 'dining',
  GENERAL_MERCHANDISE: 'shopping',
  HOME_IMPROVEMENT: 'housing',
  MEDICAL: 'health',
  PERSONAL_CARE: 'personal',
  GENERAL_SERVICES: 'bills',
  GOVERNMENT_AND_NON_PROFIT: 'bills',
  TRANSPORTATION: 'transport',
  TRAVEL: 'travel',
  RENT_AND_UTILITIES: 'bills',
};

export function mapProviderCategory(providerCategory: string | undefined): string | undefined {
  if (!providerCategory) return undefined;
  const pc = providerCategory.toUpperCase();
  if (PFC_DETAILED[pc]) return PFC_DETAILED[pc];
  // Longest primary prefix wins (TRANSFER_IN before TRANSFER)
  const primary = Object.keys(PFC_PRIMARY)
    .filter((p) => pc === p || pc.startsWith(`${p}_`))
    .sort((a, b) => b.length - a.length)[0];
  return primary ? PFC_PRIMARY[primary] : undefined;
}

// ---------- Pipeline ----------

export interface CategorizeContext {
  /** Rules sorted by priority (see sortRules). */
  rules: Rule[];
  learned: LearnedIndex;
  /** Set of valid category ids; unknown ids fall through. */
  validCategories: Set<string>;
  /** Auto-mark transactions reviewed at/above this confidence. 0 disables. */
  autoReviewThreshold: number;
}

export interface AutoResult {
  categoryId: string;
  source: CategorySource;
  confidence: number;
  displayName: string;
}

/** Best automatic guess without rules (used by the pipeline and for previews). */
export function autoCategorize(
  t: Pick<Transaction, 'description' | 'merchantName' | 'providerCategory' | 'amount' | 'displayName'>,
  ctx: Pick<CategorizeContext, 'learned' | 'validCategories'>,
): AutoResult {
  const known = lookupMerchant(t.description, t.merchantName);
  // Always derived (never read back from t.displayName) so improvements to cleaning apply on re-run.
  const displayName = known?.name || t.merchantName || cleanDescription(t.description);
  const ok = (id: string | undefined): id is string => !!id && ctx.validCategories.has(id);

  const learned = predictLearned(ctx.learned, { displayName, merchantName: t.merchantName });
  if (learned && ok(learned.categoryId)) {
    return { categoryId: learned.categoryId, source: 'learned', confidence: learned.confidence, displayName };
  }
  if (known && ok(known.categoryId)) {
    return { categoryId: known.categoryId, source: 'merchant', confidence: CONFIDENCE.merchant, displayName };
  }
  const provider = mapProviderCategory(t.providerCategory);
  if (ok(provider)) return { categoryId: provider, source: 'provider', confidence: CONFIDENCE.provider, displayName };

  const heuristic = heuristicCategory(`${t.merchantName ?? ''} ${t.description}`);
  if (ok(heuristic)) {
    // Income keywords only make sense for money coming in.
    if (!(heuristic === 'income' && t.amount < 0)) {
      return { categoryId: heuristic, source: 'heuristic', confidence: CONFIDENCE.heuristic, displayName };
    }
  }
  if (t.amount > 0 && ok('income')) {
    return { categoryId: 'income', source: 'heuristic', confidence: 0.35, displayName };
  }
  return { categoryId: UNCATEGORIZED, source: 'none', confidence: 0, displayName };
}

/**
 * Categorize a transaction. Returns a new object; never mutates the input.
 * User decisions (category, rename, exclusion, review state) are preserved.
 */
export function categorize(t: Transaction, ctx: CategorizeContext): Transaction {
  const auto = autoCategorize(t, ctx);
  const rules = evaluateRules(ctx.rules, {
    ...t,
    displayName: auto.displayName,
    renamed: t.renamedBy === 'user' ? t.renamed : undefined,
  });
  const next: Transaction = { ...t, displayName: auto.displayName };

  if (t.categorySource !== 'user') {
    if (rules.actions.categoryId && ctx.validCategories.has(rules.actions.categoryId)) {
      next.categoryId = rules.actions.categoryId;
      next.categorySource = 'rule';
      next.confidence = CONFIDENCE.rule;
      next.ruleId = rules.categoryRuleId;
    } else {
      next.categoryId = auto.categoryId;
      next.categorySource = auto.source;
      next.confidence = auto.confidence;
      next.ruleId = undefined;
    }
  }
  // Rule-applied renames/exclusions are re-derived each run so deleting or
  // editing a rule cleanly undoes its effect. Your own edits always stick.
  if (t.renamedBy !== 'user') {
    if (rules.actions.rename) {
      next.renamed = rules.actions.rename;
      next.renamedBy = 'rule';
    } else if (t.renamedBy === 'rule') {
      next.renamed = undefined;
      next.renamedBy = undefined;
    }
  }
  if (t.excludedBy !== 'user') {
    if (rules.actions.exclude !== undefined) {
      next.excluded = rules.actions.exclude;
      next.excludedBy = 'rule';
    } else if (t.excludedBy === 'rule') {
      next.excluded = false;
      next.excludedBy = undefined;
    }
  }
  if (!t.reviewed) {
    next.reviewed =
      !!rules.actions.markReviewed ||
      (ctx.autoReviewThreshold > 0 && next.categorySource !== 'none' && next.confidence >= ctx.autoReviewThreshold);
  }
  return next;
}

export function categorizeAll(transactions: Transaction[], ctx: CategorizeContext): Transaction[] {
  return transactions.map((t) => categorize(t, ctx));
}

/** Name to show in lists. */
export function transactionTitle(t: Pick<Transaction, 'renamed' | 'displayName'>): string {
  return t.renamed || t.displayName;
}
