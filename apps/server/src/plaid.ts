import type { PlaidAccount, PlaidTransaction } from '@budgi/core';

/**
 * A deliberately tiny Plaid client over fetch — five endpoints, no SDK, easy
 * to audit. Credentials are only ever sent to Plaid's own hosts.
 */

const HOSTS = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
} as const;

export class PlaidError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly type: string,
    message: string,
  ) {
    super(message);
    this.name = 'PlaidError';
  }
}

export interface LinkTokenOptions {
  clientUserId: string;
  /** Provide to open Link in update mode (re-authenticate an item). */
  accessToken?: string;
  redirectUri?: string;
  countryCodes: string[];
}

export interface SyncPage {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: Array<{ transaction_id: string }>;
  accounts: PlaidAccount[];
  next_cursor: string;
  has_more: boolean;
  transactions_update_status?: string;
}

export interface PlaidApi {
  createLinkToken(opts: LinkTokenOptions): Promise<{ link_token: string; expiration: string }>;
  exchangePublicToken(publicToken: string): Promise<{ access_token: string; item_id: string }>;
  transactionsSync(accessToken: string, cursor: string | undefined): Promise<SyncPage>;
  removeItem(accessToken: string): Promise<void>;
  getInstitutionName(accessToken: string): Promise<{ id?: string; name?: string }>;
}

export class PlaidClient implements PlaidApi {
  readonly #clientId: string;
  readonly #secret: string;
  readonly #host: string;

  constructor(clientId: string, secret: string, env: keyof typeof HOSTS) {
    this.#clientId = clientId;
    this.#secret = secret;
    this.#host = HOSTS[env];
  }

  async #post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.#host}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Plaid-Version': '2020-09-14' },
      body: JSON.stringify({ client_id: this.#clientId, secret: this.#secret, ...body }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new PlaidError(
        res.status,
        String(json.error_code ?? 'UNKNOWN'),
        String(json.error_type ?? 'API_ERROR'),
        String(json.display_message ?? json.error_message ?? `Plaid request failed (${res.status})`),
      );
    }
    return json as T;
  }

  createLinkToken(opts: LinkTokenOptions) {
    return this.#post<{ link_token: string; expiration: string }>('/link/token/create', {
      client_name: 'Budgi',
      language: 'en',
      country_codes: opts.countryCodes,
      user: { client_user_id: opts.clientUserId },
      ...(opts.accessToken
        ? { access_token: opts.accessToken }
        : { products: ['transactions'], transactions: { days_requested: 730 } }),
      ...(opts.redirectUri ? { redirect_uri: opts.redirectUri } : {}),
    });
  }

  exchangePublicToken(publicToken: string) {
    return this.#post<{ access_token: string; item_id: string }>('/item/public_token/exchange', { public_token: publicToken });
  }

  transactionsSync(accessToken: string, cursor: string | undefined) {
    return this.#post<SyncPage>('/transactions/sync', {
      access_token: accessToken,
      ...(cursor ? { cursor } : {}),
      count: 500,
      options: { include_original_description: true },
    });
  }

  async removeItem(accessToken: string) {
    await this.#post('/item/remove', { access_token: accessToken });
  }

  async getInstitutionName(accessToken: string) {
    const item = await this.#post<{ item: { institution_id?: string | null; institution_name?: string | null } }>('/item/get', {
      access_token: accessToken,
    });
    return { id: item.item.institution_id ?? undefined, name: item.item.institution_name ?? undefined };
  }
}
