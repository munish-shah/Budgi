import { daysBetween } from './dates';
import { merchantKey } from './merchants';
import type { Transaction } from './types';

/** Fields that belong to you (or to categorization), never to the bank. */
type UserFields = Pick<
  Transaction,
  | 'categoryId'
  | 'categorySource'
  | 'confidence'
  | 'ruleId'
  | 'excluded'
  | 'excludedBy'
  | 'reviewed'
  | 'note'
  | 'renamed'
  | 'renamedBy'
>;

function userFields(t: Transaction): UserFields {
  return {
    categoryId: t.categoryId,
    categorySource: t.categorySource,
    confidence: t.confidence,
    ruleId: t.ruleId,
    excluded: t.excluded,
    excludedBy: t.excludedBy,
    reviewed: t.reviewed,
    note: t.note,
    renamed: t.renamed,
    renamedBy: t.renamedBy,
  };
}

/** Apply bank data onto an existing transaction while keeping your edits. */
export function mergeProviderTxn(existing: Transaction | undefined, incoming: Transaction): Transaction {
  if (!existing) return incoming;
  return { ...incoming, ...userFields(existing), displayName: existing.displayName || incoming.displayName };
}

/** Did you touch this transaction? Only then is carrying state over worthwhile. */
function hasUserState(t: Transaction): boolean {
  return t.categorySource === 'user' || !!t.note || t.renamedBy === 'user' || t.excludedBy === 'user' || t.reviewed;
}

/**
 * Find the pending transaction a newly posted one replaces when the provider
 * doesn't link them (SimpleFIN). Same account, same-ish amount (tips!),
 * posted within a week, similar merchant.
 */
export function findPendingMatch(posted: Transaction, pendings: Transaction[]): Transaction | undefined {
  const key = merchantKey(posted.displayName);
  let best: Transaction | undefined;
  let bestScore = 0;
  for (const p of pendings) {
    if (!p.pending || p.accountId !== posted.accountId) continue;
    const gap = daysBetween(p.date, posted.date);
    if (gap < -1 || gap > 7) continue;
    const amountOk = p.amount === posted.amount || (Math.abs(posted.amount - p.amount) <= Math.abs(p.amount) * 0.25 && Math.sign(p.amount) === Math.sign(posted.amount));
    if (!amountOk) continue;
    const pk = merchantKey(p.displayName);
    const nameScore = pk === key ? 2 : pk && key && (pk.includes(key) || key.includes(pk)) ? 1 : 0;
    const score = (p.amount === posted.amount ? 2 : 1) + nameScore - gap * 0.05;
    if (nameScore > 0 && score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

export interface MergeResult {
  /** Upserted transactions (new or changed). */
  upserts: Transaction[];
  /** Ids to delete locally. */
  deletes: string[];
}

/**
 * Merge a provider delta into local state.
 *  - keeps your categories/notes/renames on modified transactions
 *  - carries your edits from a pending transaction to its posted version
 */
export function mergeDelta(
  existing: ReadonlyMap<string, Transaction>,
  delta: { added: Transaction[]; modified: Transaction[]; removed: string[] },
): MergeResult {
  const upserts = new Map<string, Transaction>();
  const deletes = new Set<string>(delta.removed);

  // A pending txn the provider still reports in this delta hasn't been replaced.
  const incomingIds = new Set([...delta.added, ...delta.modified].map((t) => t.id));
  const pendingPool = [...existing.values()].filter((t) => t.pending && !incomingIds.has(t.id));
  for (const incoming of [...delta.added, ...delta.modified]) {
    const prior = existing.get(incoming.id);
    let merged = mergeProviderTxn(prior, incoming);
    if (!prior && !incoming.pending) {
      const pendingSource = incoming.pendingTransactionId
        ? existing.get(incoming.pendingTransactionId)
        : findPendingMatch(incoming, pendingPool.filter((p) => !upserts.has(p.id)));
      if (pendingSource) {
        if (hasUserState(pendingSource)) merged = mergeProviderTxn(pendingSource, incoming);
        deletes.add(pendingSource.id);
        const idx = pendingPool.indexOf(pendingSource);
        if (idx >= 0) pendingPool.splice(idx, 1);
      }
    }
    upserts.set(merged.id, merged);
    deletes.delete(merged.id);
  }
  return { upserts: [...upserts.values()], deletes: [...deletes].filter((id) => existing.has(id)) };
}

/**
 * For window-based providers (SimpleFIN): local pending transactions inside the
 * fetched window that the bank no longer reports have been dropped or posted.
 */
export function stalePendingIds(
  existing: Iterable<Transaction>,
  fetchedIds: Set<string>,
  accountIds: Set<string>,
  windowStart: string,
): string[] {
  const out: string[] = [];
  for (const t of existing) {
    if (t.pending && accountIds.has(t.accountId) && t.date >= windowStart && !fetchedIds.has(t.id)) out.push(t.id);
  }
  return out;
}
