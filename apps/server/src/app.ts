import {
  decodeSetupToken,
  mapPlaidAccount,
  mapPlaidTransaction,
  parseAccessUrl,
  plaidTxnId,
  simplefinAccountsUrl,
  type Account,
  type Transaction,
} from '@budgi/core';
import { base64UrlDecode } from '@budgi/core/auth';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Config } from './config';
import { newPairingCode, normalizePairingCode, randomId, safeEqual, SecretBox, sha256 } from './crypto';
import { PlaidError, type LinkTokenGetResponse, type PlaidApi } from './plaid';
import { RateLimiter, requireDevice, securityHeaders, type AppEnv } from './security';
import type { Store } from './store';

export const VERSION = '0.2.0';

export interface AppDeps {
  config: Pick<Config, 'masterKey' | 'countryCodes' | 'PLAID_REDIRECT_URI' | 'PLAID_ENV' | 'BUDGI_SETUP_KEY' | 'PUBLIC_URL'>;
  store: Store;
  /** Undefined when Plaid isn't configured (SimpleFIN-only setups). */
  plaid?: PlaidApi;
  now?: () => number;
  /** Resolve the client address for rate limiting. */
  clientKey?: (c: Context) => string;
  /** Outbound fetch (SimpleFIN). Injectable for tests. */
  fetch?: typeof fetch;
}

const pairSchema = z.object({
  code: z.string().min(6).max(64),
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
const simplefinClaimSchema = z.object({ setupToken: z.string().min(10).max(2048) }).strict();
const simplefinFetchSchema = z.object({ startDate: z.number().int().positive() }).strict();

const MAX_SYNC_PAGES = 40;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const LINK_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** SimpleFIN requests may only go to SimpleFIN's own servers (no SSRF via setup tokens). */
const SIMPLEFIN_HOST = /^https:\/\/([a-z0-9-]+\.)*simplefin\.org(\/|$)/i;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface HostedLinkResult {
  status: 'pending' | 'done' | 'exited';
  items?: Array<{ itemId: string; institutionName: string }>;
}

/** Pull public tokens / exit state out of a /link/token/get response. */
export function readLinkResults(res: LinkTokenGetResponse): {
  finished: boolean;
  exited: boolean;
  tokens: Array<{ publicToken: string; institutionId?: string; institutionName?: string }>;
} {
  const tokens: Array<{ publicToken: string; institutionId?: string; institutionName?: string }> = [];
  let finished = false;
  let exited = false;
  for (const s of res.link_sessions ?? []) {
    if (s.finished_at) finished = true;
    if (s.exit || s.on_exit) exited = true;
    for (const r of s.results?.item_add_results ?? []) {
      tokens.push({ publicToken: r.public_token, institutionId: r.institution?.institution_id, institutionName: r.institution?.name });
    }
    if (!s.results?.item_add_results?.length && s.on_success?.public_token) {
      const inst = s.on_success.metadata?.institution;
      tokens.push({ publicToken: s.on_success.public_token, institutionId: inst?.institution_id, institutionName: inst?.name });
    }
  }
  return { finished: finished || tokens.length > 0, exited: exited && tokens.length === 0, tokens };
}

export function createApp(deps: AppDeps) {
  const { store, plaid, config } = deps;
  const now = deps.now ?? Date.now;
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const plaidBox = new SecretBox(config.masterKey);
  const simplefinBox = new SecretBox(config.masterKey, 'budgi/simplefin-access-url/v1');
  const linkBox = new SecretBox(config.masterKey, 'budgi/plaid-link-token/v1');
  const apiLimiter = new RateLimiter(240, 60_000);
  const clientKey = deps.clientKey ?? ((c: Context) => c.req.header('cf-connecting-ip') ?? 'local');

  const app = new Hono<AppEnv>();
  app.use('*', securityHeaders);
  app.use('*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'PAYLOAD_TOO_LARGE' }, 413) }));
  app.use('*', async (_c, next) => {
    await store.init();
    await next();
  });

  app.notFound((c) => c.json({ error: 'NOT_FOUND' }, 404));

  app.get('/health', (c) => c.json({ ok: true, version: VERSION }));

  /** Lets a fresh install know whether to ask for the setup key or a pairing code. */
  app.get('/v1/status', async (c) =>
    c.json({ version: VERSION, needsSetup: (await store.activeDeviceCount()) === 0, plaidEnabled: !!plaid, plaidEnv: config.PLAID_ENV }),
  );

  // ---------- Pairing (unauthenticated, rate-limited, one-time codes) ----------
  app.post('/v1/pair', async (c) => {
    const ip = clientKey(c);
    if (!(await store.hit(`pair:${ip}`, 10, 10 * 60_000, now())) || !(await store.hit('pair:all', 50, 10 * 60_000, now()))) {
      return c.json({ error: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' }, 429);
    }
    const body = pairSchema.parse(await c.req.json());
    if (base64UrlDecode(body.publicKey).length !== 32) return c.json({ error: 'BAD_REQUEST' }, 400);
    const code = normalizePairingCode(body.code);

    // The setup key only works to pair the very first device.
    const setupKey = config.BUDGI_SETUP_KEY ? normalizePairingCode(config.BUDGI_SETUP_KEY) : '';
    const viaSetupKey = !!setupKey && safeEqual(code, setupKey) && (await store.activeDeviceCount()) === 0;
    if (!viaSetupKey && !(await store.consumePairingCode(code, now()))) {
      return c.json({ error: 'INVALID_CODE', message: 'That code is invalid, expired, or already used.' }, 401);
    }
    try {
      const device = await store.addDevice(body.name, body.publicKey, now());
      console.log(`[budgi] paired new device (${device.id})`);
      return c.json({ deviceId: device.id, plaidEnabled: !!plaid, plaidEnv: config.PLAID_ENV });
    } catch {
      return c.json({ error: 'ALREADY_PAIRED' }, 409);
    }
  });

  // ---------- Plaid webhook (unauthenticated; only ever used as a hint) ----------
  // The body is never trusted: it only tells us which of *our* pending
  // link sessions to check, and results are fetched from Plaid directly.
  app.post('/plaid/webhook', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { webhook_type?: string; webhook_code?: string; link_token?: string };
    if (plaid && body.webhook_type === 'LINK' && body.webhook_code === 'SESSION_FINISHED' && typeof body.link_token === 'string') {
      const session = await store.getLinkSessionByTokenHash(await sha256(body.link_token));
      if (session) await resolveLinkSession(session.id).catch(() => undefined);
    }
    return c.json({ ok: true });
  });

  // ---------- Everything below requires a signed request ----------
  const api = new Hono<AppEnv>();
  api.use('*', async (c, next) => {
    if (!apiLimiter.allow(`api:${clientKey(c)}`, now())) return c.json({ error: 'RATE_LIMITED' }, 429);
    await next();
  });
  api.use('*', requireDevice(store, now));

  const requirePlaid = (): PlaidApi => {
    if (!plaid) throw new HttpError(503, 'PLAID_NOT_CONFIGURED', 'Set PLAID_CLIENT_ID and PLAID_SECRET on the server.');
    return plaid;
  };
  const accessTokenFor = async (itemId: string) => {
    const item = await store.getItem(itemId);
    if (!item) throw new HttpError(404, 'ITEM_NOT_FOUND', 'Unknown connection.');
    return { item, accessToken: await plaidBox.open(item.access_token_enc, `item:${item.id}`) };
  };

  /** Exchange a public token and store the encrypted access token. Returns what the phone may know. */
  const addItem = async (p: PlaidApi, publicToken: string, institutionId?: string, institutionName?: string) => {
    const { access_token, item_id } = await p.exchangePublicToken(publicToken);
    let institution: { id?: string; name?: string } = { id: institutionId, name: institutionName };
    if (!institution.name) institution = await p.getInstitutionName(access_token).catch(() => institution);
    await store.upsertItem({
      id: item_id,
      institution_id: institution.id ?? null,
      institution_name: institution.name ?? null,
      access_token_enc: await plaidBox.seal(access_token, `item:${item_id}`),
      created_at: now(),
    });
    // The access token never leaves the server.
    return { itemId: item_id, institutionName: institution.name ?? 'Bank' };
  };

  /** Idempotently finish a Hosted Link session (called by polling and by the webhook). */
  const resolveLinkSession = async (id: string): Promise<HostedLinkResult> => {
    const p = requirePlaid();
    const session = await store.getLinkSession(id);
    if (!session) throw new HttpError(404, 'NOT_FOUND', 'Unknown link session.');
    if (session.status === 'done') return { status: 'done', items: JSON.parse(session.result ?? '[]') };
    if (session.status === 'exited') return { status: 'exited' };
    if (session.status === 'processing') return { status: 'pending' };

    const linkToken = await linkBox.open(session.link_token_enc, `link:${session.id}`);
    const results = readLinkResults(await p.getLinkToken(linkToken));
    if (results.exited) {
      await store.transitionLinkSession(id, 'pending', 'exited');
      return { status: 'exited' };
    }
    if (!results.finished) return { status: 'pending' };
    // Claim the session so a concurrent poll/webhook doesn't exchange twice.
    if (!(await store.transitionLinkSession(id, 'pending', 'processing'))) return { status: 'pending' };
    try {
      const items = [];
      for (const t of results.tokens) items.push(await addItem(p, t.publicToken, t.institutionId, t.institutionName));
      if (session.item_id) {
        await store.markItemSynced(session.item_id, null, now()); // update mode: re-authenticated
        items.push({ itemId: session.item_id, institutionName: (await store.getItem(session.item_id))?.institution_name ?? 'Bank' });
      }
      await store.transitionLinkSession(id, 'processing', 'done', JSON.stringify(items));
      return { status: 'done', items };
    } catch (err) {
      await store.transitionLinkSession(id, 'processing', 'pending');
      throw err;
    }
  };

  api.get('/me', (c) => {
    const d = c.get('device');
    return c.json({ deviceId: d.id, name: d.name, plaidEnabled: !!plaid, plaidEnv: config.PLAID_ENV, version: VERSION });
  });

  /** Create a one-time code (10 minutes) so you can add another device, e.g. your Mac. */
  api.post('/pairing-codes', async (c) => {
    const code = newPairingCode();
    await store.createPairingCode(normalizePairingCode(code), PAIRING_TTL_MS, now());
    return c.json({ code, expiresAt: now() + PAIRING_TTL_MS });
  });

  // Native app: Plaid Link SDK flow.
  api.post('/link/token', async (c) => {
    const p = requirePlaid();
    const { itemId } = linkTokenSchema.parse(await c.req.json());
    const accessToken = itemId ? (await accessTokenFor(itemId)).accessToken : undefined;
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
    return c.json(await addItem(p, body.publicToken, body.institutionId, body.institutionName));
  });

  // Web/PWA: Plaid Hosted Link. Bank sign-in (including OAuth banks) happens
  // on Plaid's page in a browser tab; results come back to this server.
  api.post('/link/hosted', async (c) => {
    const p = requirePlaid();
    const { itemId } = linkTokenSchema.parse(await c.req.json());
    const accessToken = itemId ? (await accessTokenFor(itemId)).accessToken : undefined;
    const origin = config.PUBLIC_URL?.replace(/\/$/, '') ?? new URL(c.req.url).origin;
    const publicOrigin = /^https:\/\//.test(origin) && !/localhost|127\.0\.0\.1/.test(origin);
    const res = await p.createLinkToken({
      clientUserId: 'budgi-owner',
      accessToken,
      countryCodes: config.countryCodes,
      hostedLink: { completionRedirectUri: publicOrigin ? `${origin}/connected.html` : undefined },
      webhook: publicOrigin ? `${origin}/plaid/webhook` : undefined,
    });
    if (!res.hosted_link_url) throw new HttpError(502, 'NO_HOSTED_LINK', 'Plaid did not return a Hosted Link URL.');
    const id = randomId();
    await store.pruneLinkSessions(now() - LINK_SESSION_TTL_MS);
    await store.createLinkSession({
      id,
      link_token_hash: await sha256(res.link_token),
      link_token_enc: await linkBox.seal(res.link_token, `link:${id}`),
      item_id: itemId ?? null,
      created_at: now(),
    });
    return c.json({ sessionId: id, url: res.hosted_link_url });
  });

  api.get('/link/hosted/:id', async (c) => c.json(await resolveLinkSession(c.req.param('id'))));

  api.get('/items', async (c) =>
    c.json({
      items: (await store.listItems()).map((i) => ({
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
    const { item, accessToken } = await accessTokenFor(c.req.param('itemId'));
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
          await store.markItemSynced(item.id, err.code, now());
          return c.json({ error: err.code, message: err.message, needsRelink: err.code === 'ITEM_LOGIN_REQUIRED' }, 409);
        }
        throw err;
      }
      await store.markItemSynced(item.id, null, now());
      return c.json({ added, modified, removed, accounts, nextCursor: cursor ?? null, hasMore, status });
    }
    return c.json({ error: 'SYNC_BUSY', message: 'Your bank is updating; try again in a minute.' }, 503);
  });

  api.delete('/items/:itemId', async (c) => {
    const p = requirePlaid();
    const { item, accessToken } = await accessTokenFor(c.req.param('itemId'));
    await p.removeItem(accessToken).catch((err) => {
      // Already gone at Plaid is fine; anything else should surface.
      if (!(err instanceof PlaidError && err.code === 'ITEM_NOT_FOUND')) throw err;
    });
    await store.deleteItem(item.id);
    return c.json({ ok: true });
  });

  // ---------- SimpleFIN (for the web app, where browsers block direct calls) ----------
  // The access URL is stored encrypted like a Plaid token; account data is
  // passed straight through and never stored.
  api.post('/simplefin', async (c) => {
    const { setupToken } = simplefinClaimSchema.parse(await c.req.json());
    let claimUrl: string;
    try {
      claimUrl = decodeSetupToken(setupToken);
    } catch (e) {
      throw new HttpError(400, 'BAD_TOKEN', e instanceof Error ? e.message : 'Invalid setup token');
    }
    if (!SIMPLEFIN_HOST.test(claimUrl)) throw new HttpError(400, 'BAD_TOKEN', 'Setup token must come from simplefin.org.');
    const res = await doFetch(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' } });
    if (res.status === 403) throw new HttpError(400, 'TOKEN_USED', 'This setup token was already used or has expired.');
    if (!res.ok) throw new HttpError(502, 'SIMPLEFIN_ERROR', `SimpleFIN claim failed (${res.status}).`);
    const accessUrl = (await res.text()).trim();
    const { baseUrl } = parseAccessUrl(accessUrl);
    if (!SIMPLEFIN_HOST.test(baseUrl)) throw new HttpError(502, 'SIMPLEFIN_ERROR', 'Unexpected SimpleFIN server.');
    const id = `sf_${randomId(8)}`;
    await store.addSimpleFin(id, await simplefinBox.seal(accessUrl, `simplefin:${id}`), now());
    return c.json({ connectionId: id });
  });

  api.post('/simplefin/:id/accounts', async (c) => {
    const row = await store.getSimpleFin(c.req.param('id'));
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Unknown SimpleFIN connection.');
    const { startDate } = simplefinFetchSchema.parse(await c.req.json());
    const { baseUrl, authorization } = parseAccessUrl(await simplefinBox.open(row.access_url_enc, `simplefin:${row.id}`));
    const res = await doFetch(simplefinAccountsUrl(baseUrl, new Date(startDate)), { headers: { Authorization: authorization, Accept: 'application/json' } });
    if (res.status === 403) throw new HttpError(400, 'REVOKED', 'SimpleFIN access was revoked. Reconnect it.');
    if (res.status === 402) throw new HttpError(400, 'PAYMENT_REQUIRED', 'Your SimpleFIN Bridge subscription needs attention.');
    if (!res.ok) throw new HttpError(502, 'SIMPLEFIN_ERROR', `SimpleFIN error (${res.status}).`);
    return c.json(await res.json());
  });

  api.delete('/simplefin/:id', async (c) => {
    await store.deleteSimpleFin(c.req.param('id'));
    return c.json({ ok: true });
  });

  api.get('/devices', async (c) =>
    c.json({
      devices: (await store.listDevices()).map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.created_at,
        lastSeenAt: d.last_seen_at,
        revoked: !!d.revoked_at,
        current: d.id === c.get('device').id,
      })),
    }),
  );

  api.delete('/devices/:id', async (c) => {
    const ok = await store.revokeDevice(c.req.param('id'), now());
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
