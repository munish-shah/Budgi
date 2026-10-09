import {
  mapPlaidAccount,
  mapPlaidTransaction,
  plaidTxnId,
  type Account,
  type Transaction,
} from '@budgi/core';
import { base64UrlDecode } from '@budgi/core/auth';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Config } from './config';
import { normalizePairingCode, SecretBox } from './crypto';
import type { Store } from './db';
import { PlaidError, type PlaidApi } from './plaid';
import { NonceCache, RateLimiter, requireDevice, securityHeaders, type AppEnv } from './security';

export const VERSION = '0.1.0';

export interface AppDeps {
  config: Pick<Config, 'masterKey' | 'countryCodes' | 'PLAID_REDIRECT_URI' | 'PLAID_ENV'>;
  store: Store;
  /** Undefined when Plaid isn't configured (SimpleFIN-only setups). */
  plaid?: PlaidApi;
  now?: () => number;
  /** Resolve the client address for rate limiting. */
  clientKey?: (c: Context) => string;
}

const pairSchema = z.object({
  code: z.string().min(6).max(32),
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'publicKey must be a base64url Ed25519 key'),
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[^\p{Cc}]+$/u, 'name must not contain control characters'),
});
const linkTokenSchema = z.object({ itemId: z.string().max(128).optional() }).strict();
const exchangeSchema = z
  .object({
    publicToken: z.string().min(1).max(512),
    institutionId: z.string().max(128).optional(),
    institutionName: z.string().max(128).optional(),
  })
  .strict();
const syncSchema = z.object({ cursor: z.string().max(4096).nullable().optional() }).strict();

const MAX_SYNC_PAGES = 40;

export function createApp(deps: AppDeps) {
  const { store, plaid, config } = deps;
  const now = deps.now ?? Date.now;
  const box = new SecretBox(config.masterKey);
  const nonces = new NonceCache();
  const pairLimiter = new RateLimiter(10, 60_000);
  const apiLimiter = new RateLimiter(120, 60_000);
  const clientKey = deps.clientKey ?? ((c: Context) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local');

  const app = new Hono<AppEnv>();
  app.use('*', securityHeaders);
  app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'PAYLOAD_TOO_LARGE' }, 413) }));

  app.notFound((c) => c.json({ error: 'NOT_FOUND' }, 404));

  app.get('/health', (c) => c.json({ ok: true, version: VERSION }));

  // ---------- Pairing (unauthenticated, rate-limited, one-time codes) ----------
  app.post('/v1/pair', async (c) => {
    if (!pairLimiter.allow(`pair:${clientKey(c)}`, now())) return c.json({ error: 'RATE_LIMITED' }, 429);
    const body = pairSchema.parse(await c.req.json());
    if (base64UrlDecode(body.publicKey).length !== 32) return c.json({ error: 'BAD_REQUEST' }, 400);
    if (!store.consumePairingCode(normalizePairingCode(body.code), now())) {
      return c.json({ error: 'INVALID_CODE', message: 'That pairing code is invalid or expired.' }, 401);
    }
    try {
      const device = store.addDevice(body.name, body.publicKey, now());
      console.log(`[budgi] paired new device "${device.name}" (${device.id})`);
      return c.json({ deviceId: device.id, plaidEnabled: !!plaid, plaidEnv: config.PLAID_ENV });
    } catch {
      return c.json({ error: 'ALREADY_PAIRED' }, 409);
    }
  });

  // ---------- Everything below requires a signed request ----------
  const api = new Hono<AppEnv>();
  api.use('*', async (c, next) => {
    if (!apiLimiter.allow(`api:${clientKey(c)}`, now())) return c.json({ error: 'RATE_LIMITED' }, 429);
    await next();
  });
  api.use('*', requireDevice(store, nonces, now));

  const requirePlaid = (): PlaidApi => {
    if (!plaid) throw new HttpError(503, 'PLAID_NOT_CONFIGURED', 'Set PLAID_CLIENT_ID and PLAID_SECRET on the server.');
    return plaid;
  };
  const accessTokenFor = (itemId: string) => {
    const item = store.getItem(itemId);
    if (!item) throw new HttpError(404, 'ITEM_NOT_FOUND', 'Unknown connection.');
    return { item, accessToken: box.open(item.access_token_enc, `item:${item.id}`) };
  };

  api.get('/me', (c) => {
    const d = c.get('device');
    return c.json({ deviceId: d.id, name: d.name, plaidEnabled: !!plaid, plaidEnv: config.PLAID_ENV, version: VERSION });
  });

  api.post('/link/token', async (c) => {
    const p = requirePlaid();
    const { itemId } = linkTokenSchema.parse(await c.req.json());
    const accessToken = itemId ? accessTokenFor(itemId).accessToken : undefined;
    const res = await p.createLinkToken({
      // Single-user server: one stable Plaid user for all your devices.
      clientUserId: 'budgi-owner',
      accessToken,
      redirectUri: config.PLAID_REDIRECT_URI,
      countryCodes: config.countryCodes,
    });
    return c.json({ linkToken: res.link_token, expiration: res.expiration });
  });

  api.post('/link/exchange', async (c) => {
    const p = requirePlaid();
    const body = exchangeSchema.parse(await c.req.json());
    const { access_token, item_id } = await p.exchangePublicToken(body.publicToken);
    let institution: { id?: string; name?: string } = { id: body.institutionId, name: body.institutionName };
    if (!institution.name) institution = await p.getInstitutionName(access_token).catch(() => institution);
    store.upsertItem({
      id: item_id,
      institution_id: institution.id ?? null,
      institution_name: institution.name ?? null,
      access_token_enc: box.seal(access_token, `item:${item_id}`),
      created_at: now(),
    });
    // The access token never leaves the server.
    return c.json({ itemId: item_id, institutionName: institution.name ?? 'Bank' });
  });

  api.get('/items', (c) =>
    c.json({
      items: store.listItems().map((i) => ({
        itemId: i.id,
        institutionName: i.institution_name ?? 'Bank',
        createdAt: i.created_at,
        lastSyncedAt: i.last_synced_at,
        error: i.error_code,
      })),
    }),
  );

  /**
   * Stateless transaction sync: the phone keeps its own cursor and its own
   * copy of the data; this server stores no transactions at all.
   */
  api.post('/items/:itemId/sync', async (c) => {
    const p = requirePlaid();
    const { item, accessToken } = accessTokenFor(c.req.param('itemId'));
    const { cursor: startCursor } = syncSchema.parse(await c.req.json());

    for (let attempt = 0; attempt < 3; attempt++) {
      const added: Transaction[] = [];
      const modified: Transaction[] = [];
      const removed: string[] = [];
      let accounts: Account[] = [];
      let cursor = startCursor ?? undefined;
      let hasMore = true;
      let status: string | undefined;
      try {
        for (let page = 0; page < MAX_SYNC_PAGES && hasMore; page++) {
          const res = await p.transactionsSync(accessToken, cursor);
          added.push(...res.added.map(mapPlaidTransaction));
          modified.push(...res.modified.map(mapPlaidTransaction));
          removed.push(...res.removed.map((r) => plaidTxnId(r.transaction_id)));
          if (res.accounts?.length) {
            accounts = res.accounts.map((a) => mapPlaidAccount(a, item.id, item.institution_name ?? undefined));
          }
          cursor = res.next_cursor;
          hasMore = res.has_more;
          status = res.transactions_update_status;
        }
      } catch (err) {
        if (err instanceof PlaidError && err.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION') continue;
        if (err instanceof PlaidError && err.type === 'ITEM_ERROR') {
          store.markItemSynced(item.id, err.code, now());
          return c.json({ error: err.code, message: err.message, needsRelink: err.code === 'ITEM_LOGIN_REQUIRED' }, 409);
        }
        throw err;
      }
      store.markItemSynced(item.id, null, now());
      return c.json({ added, modified, removed, accounts, nextCursor: cursor ?? null, hasMore, status });
    }
    return c.json({ error: 'SYNC_BUSY', message: 'Your bank is updating; try again in a minute.' }, 503);
  });

  api.delete('/items/:itemId', async (c) => {
    const p = requirePlaid();
    const { item, accessToken } = accessTokenFor(c.req.param('itemId'));
    await p.removeItem(accessToken).catch((err) => {
      // Already gone at Plaid is fine; anything else should surface.
      if (!(err instanceof PlaidError && err.code === 'ITEM_NOT_FOUND')) throw err;
    });
    store.deleteItem(item.id);
    return c.json({ ok: true });
  });

  api.get('/devices', (c) =>
    c.json({
      devices: store.listDevices().map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.created_at,
        lastSeenAt: d.last_seen_at,
        revoked: !!d.revoked_at,
        current: d.id === c.get('device').id,
      })),
    }),
  );

  api.delete('/devices/:id', (c) => {
    const ok = store.revokeDevice(c.req.param('id'), now());
    return ok ? c.json({ ok: true }) : c.json({ error: 'NOT_FOUND' }, 404);
  });

  app.route('/v1', api);

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status as 400);
    if (err instanceof PlaidError) return c.json({ error: err.code, message: err.message }, err.status >= 500 ? 502 : 400);
    if (err instanceof z.ZodError) return c.json({ error: 'BAD_REQUEST', message: err.issues[0]?.message }, 400);
    if (err instanceof SyntaxError) return c.json({ error: 'BAD_REQUEST', message: 'Invalid JSON' }, 400);
    console.error('[budgi] unhandled error:', err instanceof Error ? err.message : err);
    return c.json({ error: 'INTERNAL' }, 500);
  });

  return app;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
