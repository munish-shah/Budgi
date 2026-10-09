/**
 * Core domain types shared by the mobile app and the relay server.
 *
 * Conventions:
 *  - Money is stored as integer minor units (cents) to avoid float drift.
 *  - Negative amounts are money leaving you (spending), positive amounts are
 *    money coming in. (Plaid uses the opposite sign; providers normalize.)
 *  - Dates are ISO calendar dates `YYYY-MM-DD` in the account's local time.
 */

export type Cents = number;
export type ISODate = string;

export type Provider = 'plaid' | 'simplefin' | 'demo' | 'manual';

export type AccountType = 'depository' | 'credit' | 'loan' | 'investment' | 'other';

export interface Account {
  id: string;
  provider: Provider;
  /** Plaid item id / SimpleFIN connection id / 'demo'. */
  connectionId: string;
  name: string;
  officialName?: string;
  mask?: string;
  type: AccountType;
  subtype?: string;
  institution?: string;
  /** Current balance. For credit/loan accounts this is the amount owed (positive). */
  balance: Cents;
  available?: Cents;
  currency: string;
  updatedAt: string;
  hidden?: boolean;
}

export type CategorySource =
  /** Set explicitly by you. Never overwritten by automation. */
  | 'user'
  /** Set by one of your rules. */
  | 'rule'
  /** Learned from how you categorized this merchant before. */
  | 'learned'
  /** Mapped from the bank / aggregator's own category. */
  | 'provider'
  /** Matched by Budgi's built-in merchant knowledge. */
  | 'merchant'
  /** Heuristic guess (keywords, amount sign). */
  | 'heuristic'
  | 'none';

export interface Transaction {
  id: string;
  accountId: string;
  provider: Provider;
  date: ISODate;
  authorizedDate?: ISODate;
  amount: Cents;
  currency: string;
  /** Raw bank descriptor, e.g. "SQ *BLUE BOTTLE COFFE 0123 OAKLAND CA". */
  description: string;
  /** Merchant name from the provider, if any. */
  merchantName?: string;
  /** Cleaned, human friendly name shown in the UI. */
  displayName: string;
  /** Provider category hint, e.g. Plaid PFC "FOOD_AND_DRINK_COFFEE". */
  providerCategory?: string;
  pending: boolean;
  /** For posted Plaid transactions, the id of the pending txn they replace. */
  pendingTransactionId?: string;
  categoryId: string;
  categorySource: CategorySource;
  /** 0..1 confidence of the automatic categorization. */
  confidence: number;
  /** Rule that last touched this transaction. */
  ruleId?: string;
  /** Excluded from spending & budgets (transfers, card payments, reimbursements). */
  excluded: boolean;
  reviewed: boolean;
  note?: string;
  /** Name override set by you or a rule. */
  renamed?: string;
  renamedBy?: 'user' | 'rule';
  excludedBy?: 'user' | 'rule';
}

export type CategoryKind = 'expense' | 'income' | 'transfer';

export interface Category {
  id: string;
  name: string;
  /** SF Symbol name (iOS). */
  icon: string;
  /** Emoji fallback for platforms without SF Symbols. */
  emoji: string;
  color: string;
  kind: CategoryKind;
  /** Optional monthly budget in cents. */
  budget?: Cents;
  /**
   * Fixed costs (rent, utilities, subscriptions) are due regardless of the
   * day, so pacing treats them as fully expected instead of spread evenly.
   */
  fixed?: boolean;
  archived?: boolean;
}

// ---------- Rules ----------

export type TextField = 'description' | 'merchant';
export type TextOp = 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'regex';

export type RuleCondition =
  | { field: TextField; op: TextOp; value: string }
  | { field: 'amount'; op: 'gt' | 'lt' | 'eq' | 'between'; value: number; value2?: number }
  | { field: 'direction'; op: 'is'; value: 'expense' | 'income' }
  | { field: 'account'; op: 'is' | 'isNot'; value: string }
  | { field: 'providerCategory'; op: 'contains'; value: string };

export interface RuleActions {
  categoryId?: string;
  rename?: string;
  exclude?: boolean;
  markReviewed?: boolean;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  match: 'all' | 'any';
  conditions: RuleCondition[];
  actions: RuleActions;
  /** Lower runs first; earlier rules win conflicts. */
  priority: number;
  createdAt: string;
}

// ---------- Sync ----------

export interface SyncDelta {
  added: Transaction[];
  modified: Transaction[];
  /** Ids of transactions the provider removed. */
  removed: string[];
  accounts: Account[];
}
