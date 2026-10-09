import {
  buildLearnedIndex,
  categorize,
  DEFAULT_CATEGORIES,
  DEMO_CONNECTION,
  demoAccounts,
  demoTransactions,
  merchantKey,
  mergeDelta,
  sortRules,
  suggestRuleFor,
  toISODate,
  transactionTitle,
  type Account,
  type CategorizeContext,
  type Category,
  type Rule,
  type Transaction,
} from '@budgi/core';
import { create } from 'zustand';
import { openDatabase, type Database } from './db';
import { newId } from './random';

export type ConnectionProvider = 'plaid' | 'simplefin' | 'demo';

export interface Connection {
  id: string;
  provider: ConnectionProvider;
  name: string;
  /** Plaid transactions/sync cursor. */
  cursor?: string | null;
  lastSyncAt?: string;
  error?: string;
  needsRelink?: boolean;
}

export interface Settings {
  onboarded: boolean;
  lockEnabled: boolean;
  /** Seconds in background before requiring Face ID again. */
  lockAfterSeconds: number;
  hideAmounts: boolean;
  /** Auto-approve confident categorizations so the review inbox stays short. */
  autoReview: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  lockEnabled: true,
  lockAfterSeconds: 60,
  hideAmounts: false,
  autoReview: true,
};

export interface SyncDeltaInput {
  added: Transaction[];
  modified: Transaction[];
  removed: string[];
  accounts: Account[];
}

interface State {
  ready: boolean;
  encrypted: boolean;
  accounts: Record<string, Account>;
  txns: Record<string, Transaction>;
  categories: Category[];
  rules: Rule[];
  connections: Connection[];
  settings: Settings;
  syncing: boolean;
  syncMessage?: string;

  init(): Promise<void>;
  updateSettings(patch: Partial<Settings>): void;

  // connections & data
  upsertConnection(c: Connection): void;
  patchConnection(id: string, patch: Partial<Connection>): void;
  removeConnection(id: string): Promise<void>;
  /**
   * Merge provider data. On an initial import, history older than a week is
   * pre-approved so the review inbox only holds recent and unknown items.
   */
  applyDelta(connectionId: string, delta: SyncDeltaInput, opts?: { initialImport?: boolean }): Promise<number>;
  loadDemo(): Promise<void>;
  setSyncing(syncing: boolean, message?: string): void;

  // transactions
  setCategory(id: string, categoryId: string): { similar: number; merchant: string } | undefined;
  updateTxn(id: string, patch: Partial<Pick<Transaction, 'note' | 'renamed' | 'excluded' | 'reviewed'>>): void;
  markReviewed(ids: string[]): void;

  // rules
  saveRule(rule: Omit<Rule, 'id' | 'createdAt' | 'priority'> & { id?: string }): Rule;
  createRuleFromTxn(txnId: string, categoryId: string): Rule | undefined;
  deleteRule(id: string): void;
  moveRule(id: string, direction: -1 | 1): void;
  recategorizeAll(): number;

  // categories & budgets
  setBudget(categoryId: string, cents: number | undefined): void;
  saveCategory(c: Omit<Category, 'id'> & { id?: string }): Category;

  wipeAll(): Promise<void>;
}

let db: Database | null = null;

/** Keep your edits, but pick up new default categories/flags from app updates. */
function mergeDefaults(stored: Category[] | undefined): Category[] {
  if (!stored) return DEFAULT_CATEGORIES;
  const byId = new Map(stored.map((c) => [c.id, c]));
  const merged = DEFAULT_CATEGORIES.map((d) => {
    const s = byId.get(d.id);
    return s ? { ...d, ...s, fixed: s.fixed ?? d.fixed } : d;
  });
  return [...merged, ...stored.filter((c) => !DEFAULT_CATEGORIES.some((d) => d.id === c.id))];
}

const persistKV = (key: string, value: unknown) => {
  void db?.setKV(key, value);
};

function contextFor(s: Pick<State, 'rules' | 'categories' | 'settings' | 'txns'>): CategorizeContext {
  return {
    rules: sortRules(s.rules),
    learned: buildLearnedIndex(Object.values(s.txns)),
    validCategories: new Set(s.categories.filter((c) => !c.archived).map((c) => c.id)),
    autoReviewThreshold: s.settings.autoReview ? 0.85 : 0,
  };
}

export const useStore = create<State>((set, get) => {
  /** Replace txns, persist the given changes. */
  const commitTxns = (upserts: Transaction[], deletes: string[] = []) => {
    if (!upserts.length && !deletes.length) return;
    const txns = { ...get().txns };
    for (const t of upserts) txns[t.id] = t;
    for (const id of deletes) delete txns[id];
    set({ txns });
    void db?.saveTransactions(upserts, deletes);
  };

  const setRules = (rules: Rule[]) => {
    const normalized = sortRules(rules).map((r, i) => ({ ...r, priority: i }));
    set({ rules: normalized });
    persistKV('rules', normalized);
  };

  return {
    ready: false,
    encrypted: false,
    accounts: {},
    txns: {},
    categories: DEFAULT_CATEGORIES,
    rules: [],
    connections: [],
    settings: DEFAULT_SETTINGS,
    syncing: false,

    async init() {
      if (get().ready) return;
      db = await openDatabase();
      const snap = await db.load();
      set({
        ready: true,
        encrypted: db.encrypted,
        accounts: Object.fromEntries(snap.accounts.map((a) => [a.id, a])),
        txns: Object.fromEntries(snap.transactions.map((t) => [t.id, t])),
        categories: mergeDefaults(snap.kv.categories as Category[] | undefined),
        rules: (snap.kv.rules as Rule[] | undefined) ?? [],
        connections: (snap.kv.connections as Connection[] | undefined) ?? [],
        settings: { ...DEFAULT_SETTINGS, ...(snap.kv.settings as Partial<Settings> | undefined) },
      });
    },

    updateSettings(patch) {
      const prev = get().settings;
      const settings = { ...prev, ...patch };
      set({ settings });
      persistKV('settings', settings);
      if (patch.autoReview !== undefined && patch.autoReview !== prev.autoReview) get().recategorizeAll();
    },

    upsertConnection(c) {
      const connections = [...get().connections.filter((x) => x.id !== c.id), c];
      set({ connections });
      persistKV('connections', connections);
    },

    patchConnection(id, patch) {
      const connections = get().connections.map((c) => (c.id === id ? { ...c, ...patch } : c));
      set({ connections });
      persistKV('connections', connections);
    },

    async removeConnection(id) {
      const { accounts, txns, connections } = get();
      const accountIds = new Set(Object.values(accounts).filter((a) => a.connectionId === id).map((a) => a.id));
      const txnIds = Object.values(txns).filter((t) => accountIds.has(t.accountId)).map((t) => t.id);
      const nextAccounts = { ...accounts };
      for (const a of accountIds) delete nextAccounts[a];
      set({ accounts: nextAccounts });
      void db?.saveAccounts([], [...accountIds]);
      commitTxns([], txnIds);
      const nextConnections = connections.filter((c) => c.id !== id);
      set({ connections: nextConnections });
      persistKV('connections', nextConnections);
    },

    async applyDelta(connectionId, delta, opts) {
      const state = get();
      // Accounts first (balances).
      if (delta.accounts.length) {
        const accounts = { ...state.accounts };
        for (const a of delta.accounts) accounts[a.id] = { ...a, hidden: accounts[a.id]?.hidden };
        set({ accounts });
        void db?.saveAccounts(delta.accounts);
      }
      const existing = new Map(Object.entries(get().txns));
      const { upserts, deletes } = mergeDelta(existing, delta);
      const ctx = contextFor(get());
      const reviewCutoff = toISODate(new Date(Date.now() - 7 * 86_400_000));
      const categorized = upserts.map((t) => {
        const c = categorize(t, ctx);
        if (opts?.initialImport && !existing.has(c.id) && c.date < reviewCutoff && c.categorySource !== 'none') c.reviewed = true;
        return c;
      });
      commitTxns(categorized, deletes);
      get().patchConnection(connectionId, { lastSyncAt: new Date().toISOString(), error: undefined, needsRelink: false });
      return categorized.filter((t) => !existing.has(t.id)).length;
    },

    async loadDemo() {
      const accounts = demoAccounts();
      const txns = demoTransactions();
      get().upsertConnection({ id: DEMO_CONNECTION, provider: 'demo', name: 'Demo Bank', lastSyncAt: new Date().toISOString() });
      await get().applyDelta(DEMO_CONNECTION, { added: txns, modified: [], removed: [], accounts }, { initialImport: true });
    },

    setSyncing(syncing, message) {
      set({ syncing, syncMessage: message });
    },

    setCategory(id, categoryId) {
      const t = get().txns[id];
      if (!t || (t.categoryId === categoryId && t.categorySource === 'user')) return undefined;
      const updated: Transaction = { ...t, categoryId, categorySource: 'user', confidence: 1, ruleId: undefined, reviewed: true };
      commitTxns([updated]);
      const key = merchantKey(transactionTitle(updated));
      const similar = Object.values(get().txns).filter(
        (x) => x.id !== id && x.categoryId !== categoryId && x.categorySource !== 'user' && merchantKey(transactionTitle(x)) === key,
      ).length;
      // Future transactions from this merchant learn from this choice automatically.
      return { similar, merchant: transactionTitle(updated) };
    },

    updateTxn(id, patch) {
      const t = get().txns[id];
      if (!t) return;
      const next: Transaction = { ...t, ...patch };
      if (patch.renamed !== undefined) {
        next.renamed = patch.renamed.trim() || undefined;
        next.renamedBy = next.renamed ? 'user' : undefined;
      }
      if (patch.excluded !== undefined) next.excludedBy = 'user';
      if (patch.note !== undefined) next.note = patch.note.trim() || undefined;
      commitTxns([next]);
    },

    markReviewed(ids) {
      const txns = get().txns;
      commitTxns(ids.map((id) => txns[id]).filter((t): t is Transaction => !!t && !t.reviewed).map((t) => ({ ...t, reviewed: true })));
    },

    saveRule(input) {
      const rules = get().rules;
      const existing = input.id ? rules.find((r) => r.id === input.id) : undefined;
      const rule: Rule = existing
        ? { ...existing, ...input, id: existing.id }
        : { ...input, id: newId('rule_'), createdAt: new Date().toISOString(), priority: -1 };
      // New rules go to the top: the specific rule you just wrote should win.
      setRules(existing ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule]);
      get().recategorizeAll();
      return get().rules.find((r) => r.id === rule.id) ?? rule;
    },

    createRuleFromTxn(txnId, categoryId) {
      const t = get().txns[txnId];
      if (!t) return undefined;
      return get().saveRule(suggestRuleFor(t, categoryId));
    },

    deleteRule(id) {
      setRules(get().rules.filter((r) => r.id !== id));
      get().recategorizeAll();
    },

    moveRule(id, direction) {
      const rules = sortRules(get().rules);
      const i = rules.findIndex((r) => r.id === id);
      const j = i + direction;
      if (i < 0 || j < 0 || j >= rules.length) return;
      [rules[i], rules[j]] = [rules[j]!, rules[i]!];
      setRules(rules.map((r, k) => ({ ...r, priority: k })));
      get().recategorizeAll();
    },

    recategorizeAll() {
      const state = get();
      const ctx = contextFor(state);
      const changed: Transaction[] = [];
      for (const t of Object.values(state.txns)) {
        const next = categorize(t, ctx);
        if (
          next.categoryId !== t.categoryId ||
          next.renamed !== t.renamed ||
          next.excluded !== t.excluded ||
          next.reviewed !== t.reviewed ||
          next.categorySource !== t.categorySource ||
          next.displayName !== t.displayName
        ) {
          changed.push(next);
        }
      }
      commitTxns(changed);
      return changed.length;
    },

    setBudget(categoryId, cents) {
      const categories = get().categories.map((c) => (c.id === categoryId ? { ...c, budget: cents && cents > 0 ? cents : undefined } : c));
      set({ categories });
      persistKV('categories', categories);
    },

    saveCategory(input) {
      const categories = get().categories;
      const category: Category = { ...input, id: input.id ?? newId('cat_') } as Category;
      const next = input.id ? categories.map((c) => (c.id === input.id ? category : c)) : [...categories, category];
      set({ categories: next });
      persistKV('categories', next);
      return category;
    },

    async wipeAll() {
      await db?.wipe();
      db = null;
      set({
        ready: false,
        accounts: {},
        txns: {},
        categories: DEFAULT_CATEGORIES,
        rules: [],
        connections: [],
        settings: DEFAULT_SETTINGS,
      });
      await get().init();
    },
  };
});
