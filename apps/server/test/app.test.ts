import { randomBytes } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { base64UrlEncode, keyPairFromSeed, signRequest } from '@budgi/core/auth';
import type { PlaidTransaction } from '@budgi/core';
import { createApp, readLinkResults } from '../src/app';
import { newPairingCode, newSetupKey, normalizePairingCode, SecretBox } from '../src/crypto';
import { openNodeDatabase } from '../src/node-sqlite';
import { PlaidError, type LinkTokenGetResponse, type PlaidApi, type SyncPage } from '../src/plaid';
import { Store } from '../src/store';

const masterKey = randomBytes(32);

function plaidTxn(id: string, amount: number, extra: Partial<PlaidTransaction> = {}): PlaidTransaction {
  return { transaction_id: id, account_id: 'acc1', amount, iso_currency_code: 'USD', date: '2026-10-01', name: 'STARBUCKS', merchant_name: 'Starbucks', pending: false, ...extra };
}

class FakePlaid implements PlaidApi {
  pages: SyncPage[] = [];
  syncCalls: Array<string | undefined> = [];
  failNextSyncWith?: PlaidError;
  removed: string[] = [];
  lastLinkOpts?: any;
  linkGet: LinkTokenGetResponse = { link_token: 'link-sandbox-123', link_sessions: [] };
  exchanges = 0;
  async createLinkToken(opts: any) {
    this.lastLinkOpts = opts;
    return { link_token: 'link-sandbox-123', expiration: '2026-10-09T12:00:00Z', hosted_link_url: opts.hostedLink ? 'https://hosted.plaid.com/link/abc' : undefined };
  }
  async getLinkToken() {
    return this.linkGet;
  }
  async exchangePublicToken(publicToken: string) {
    this.exchanges++;
    if (publicToken !== 'public-ok') throw new PlaidError(400, 'INVALID_PUBLIC_TOKEN', 'INVALID_INPUT', 'bad token');
    return { access_token: 'access-sandbox-SECRET-TOKEN', item_id: 'item_1' };
  }
  async transactionsSync(_token: string, cursor: string | undefined) {
    this.syncCalls.push(cursor);
    if (this.failNextSyncWith) {
      const e = this.failNextSyncWith;
      this.failNextSyncWith = undefined;
      throw e;
    }
    const page = this.pages.shift();
    if (!page) return { added: [], modified: [], removed: [], accounts: [], next_cursor: cursor ?? 'c0', has_more: false };
    return page;
  }
  async removeItem(token: string) {
    this.removed.push(token);
  }
  async getInstitutionName() {
    return { id: 'ins_1', name: 'First Platypus Bank' };
  }
}

let dir: string;
let db: ReturnType<typeof openNodeDatabase>;
let store: Store;
let plaid: FakePlaid;
let clock: number;
let app: ReturnType<typeof createApp>;
let fetchLog: string[];
const setupKey = newSetupKey();
const config = { masterKey, countryCodes: ['US'], PLAID_ENV: 'sandbox' as const, BUDGI_SETUP_KEY: setupKey, PUBLIC_URL: 'https://budgi.example.workers.dev' };

const fakeFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = String(input);
  fetchLog.push(`${init?.method ?? 'GET'} ${url}`);
  if (url.endsWith('/claim/DEMO')) return new Response('https://user:pass@beta-bridge.simplefin.org/simplefin');
  if (url.startsWith('https://beta-bridge.simplefin.org/simplefin/accounts')) {
    return Response.json({ errors: [], accounts: [{ id: 'A1', name: 'Checking', currency: 'USD', balance: '10.00', 'balance-date': 1, transactions: [] }] });
  }
  return new Response('nope', { status: 404 });
}) as typeof fetch;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'budgi-'));
  db = openNodeDatabase(join(dir, 'test.db'));
  store = new Store(db);
  await store.init();
  plaid = new FakePlaid();
  clock = 1_760_000_000_000;
  fetchLog = [];
  app = createApp({ config, store, plaid, now: () => clock, fetch: fakeFetch });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function pair(name = 'iPhone') {
  const code = newPairingCode();
  await store.createPairingCode(normalizePairingCode(code), 600_000, clock);
  const kp = keyPairFromSeed(randomBytes(32));
  const res = await app.request('/v1/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.toLowerCase(), publicKey: base64UrlEncode(kp.publicKey), name }),
  });
  const json = (await res.json()) as { deviceId: string };
  return { res, kp, deviceId: json.deviceId, code };
}

async function signed(kp: { secretKey: Uint8Array }, deviceId: string, method: string, path: string, body?: unknown, nonce = randomBytes(16)) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const headers = signRequest(kp.secretKey, deviceId, { method, path, body: raw }, nonce, clock);
  return app.request(path, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: raw || undefined });
}

describe('pairing', () => {
  it('pairs once with a valid code and rejects reuse', async () => {
    const first = await pair();
    expect(first.res.status).toBe(200);
    expect(first.deviceId).toBeTruthy();
    const again = await app.request('/v1/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: first.code, publicKey: base64UrlEncode(keyPairFromSeed(randomBytes(32)).publicKey), name: 'x' }),
    });
    expect(again.status).toBe(401);
  });

  it('rejects expired codes', async () => {
    const code = newPairingCode();
    await store.createPairingCode(normalizePairingCode(code), 1000, clock);
    clock += 2000;
    const res = await app.request('/v1/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, publicKey: base64UrlEncode(keyPairFromSeed(randomBytes(32)).publicKey), name: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('rate limits guessing', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const res = await app.request('/v1/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'AAAAA-AAAAA', publicKey: base64UrlEncode(keyPairFromSeed(randomBytes(32)).publicKey), name: 'x' }),
      });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

describe('request signing', () => {
  it('accepts signed requests', async () => {
    const { kp, deviceId } = await pair();
    const res = await signed(kp, deviceId, 'GET', '/v1/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deviceId, plaidEnabled: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects unsigned, stale, replayed, forged and revoked requests', async () => {
    const { kp, deviceId } = await pair();
    const unsigned = await app.request('/v1/me');
    expect(unsigned.status).toBe(401);
    expect(unsigned.headers.get('x-content-type-options')).toBe('nosniff');

    const nonce = randomBytes(16);
    expect((await signed(kp, deviceId, 'GET', '/v1/me', undefined, nonce)).status).toBe(200);
    expect((await signed(kp, deviceId, 'GET', '/v1/me', undefined, nonce)).status).toBe(401); // replay

    const forger = keyPairFromSeed(randomBytes(32));
    expect((await signed(forger, deviceId, 'GET', '/v1/me')).status).toBe(401);

    // Body tampering: sign one body, send another.
    const headers = signRequest(kp.secretKey, deviceId, { method: 'POST', path: '/v1/link/token', body: '{}' }, randomBytes(16), clock);
    const tampered = await app.request('/v1/link/token', { method: 'POST', headers, body: '{"itemId":"item_1"}' });
    expect(tampered.status).toBe(401);

    const headersOld = signRequest(kp.secretKey, deviceId, { method: 'GET', path: '/v1/me', body: '' }, randomBytes(16), clock - 10 * 60_000);
    expect((await app.request('/v1/me', { headers: headersOld })).status).toBe(401);

    await store.revokeDevice(deviceId, clock);
    expect((await signed(kp, deviceId, 'GET', '/v1/me')).status).toBe(401);
  });
});

describe('plaid relay', () => {
  it('exchanges tokens and stores them encrypted only', async () => {
    const { kp, deviceId } = await pair();
    const link = await signed(kp, deviceId, 'POST', '/v1/link/token', {});
    expect(await link.json()).toMatchObject({ linkToken: 'link-sandbox-123' });

    const bad = await signed(kp, deviceId, 'POST', '/v1/link/exchange', { publicToken: 'nope' });
    expect(bad.status).toBe(400);

    const ex = await signed(kp, deviceId, 'POST', '/v1/link/exchange', { publicToken: 'public-ok' });
    const exJson = await ex.json();
    expect(exJson).toEqual({ itemId: 'item_1', institutionName: 'First Platypus Bank' });
    expect(JSON.stringify(exJson)).not.toContain('SECRET');

    const row = (await store.getItem('item_1'))!;
    expect(row.access_token_enc).not.toContain('SECRET');
    expect(await new SecretBox(masterKey).open(row.access_token_enc, 'item:item_1')).toBe('access-sandbox-SECRET-TOKEN');
    // Ciphertext is bound to its row.
    await expect(new SecretBox(masterKey).open(row.access_token_enc, 'item:other')).rejects.toThrow();
    // And to the master key.
    await expect(new SecretBox(randomBytes(32)).open(row.access_token_enc, 'item:item_1')).rejects.toThrow();
    // Nothing in the database file is plaintext.
    db.raw.exec('PRAGMA wal_checkpoint(FULL)');
    expect(readFileSync(join(dir, 'test.db')).toString('latin1')).not.toContain('SECRET-TOKEN');

    const items = await (await signed(kp, deviceId, 'GET', '/v1/items')).json();
    expect(items).toMatchObject({ items: [{ itemId: 'item_1', institutionName: 'First Platypus Bank' }] });

    // Update mode passes the decrypted token to Plaid, never to the client.
    await signed(kp, deviceId, 'POST', '/v1/link/token', { itemId: 'item_1' });
    expect(plaid.lastLinkOpts).toMatchObject({ accessToken: 'access-sandbox-SECRET-TOKEN' });
  });

  it('pages through transactions/sync and maps to Budgi types', async () => {
    const { kp, deviceId } = await pair();
    await signed(kp, deviceId, 'POST', '/v1/link/exchange', { publicToken: 'public-ok' });
    plaid.pages = [
      { added: [plaidTxn('t1', 4.5)], modified: [], removed: [], accounts: [], next_cursor: 'c1', has_more: true },
      {
        added: [plaidTxn('t2', -1000, { name: 'PAYROLL' })],
        modified: [plaidTxn('t0', 3)],
        removed: [{ transaction_id: 'gone' }],
        accounts: [{ account_id: 'acc1', name: 'Checking', type: 'depository', balances: { current: 100, available: 90, iso_currency_code: 'USD' } }],
        next_cursor: 'c2',
        has_more: false,
      },
    ];
    const res = await signed(kp, deviceId, 'POST', '/v1/items/item_1/sync', { cursor: null });
    const body = (await res.json()) as Record<string, any>;
    expect(res.status).toBe(200);
    expect(plaid.syncCalls).toEqual([undefined, 'c1']);
    expect(body.nextCursor).toBe('c2');
    expect(body.added.map((t: any) => [t.id, t.amount])).toEqual([['plaid_t1', -450], ['plaid_t2', 100000]]);
    expect(body.modified[0].id).toBe('plaid_t0');
    expect(body.removed).toEqual(['plaid_gone']);
    expect(body.accounts[0]).toMatchObject({ id: 'plaid_acc1', balance: 10000, institution: 'First Platypus Bank' });
  });

  it('restarts on mutation during pagination and surfaces relink errors', async () => {
    const { kp, deviceId } = await pair();
    await signed(kp, deviceId, 'POST', '/v1/link/exchange', { publicToken: 'public-ok' });
    plaid.failNextSyncWith = new PlaidError(400, 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', 'TRANSACTIONS_ERROR', 'retry');
    const ok = await signed(kp, deviceId, 'POST', '/v1/items/item_1/sync', { cursor: 'start' });
    expect(ok.status).toBe(200);
    expect(plaid.syncCalls).toEqual(['start', 'start']);

    plaid.failNextSyncWith = new PlaidError(400, 'ITEM_LOGIN_REQUIRED', 'ITEM_ERROR', 'login required');
    const relink = await signed(kp, deviceId, 'POST', '/v1/items/item_1/sync', { cursor: 'start' });
    expect(relink.status).toBe(409);
    expect(await relink.json()).toMatchObject({ error: 'ITEM_LOGIN_REQUIRED', needsRelink: true });
    expect((await store.getItem('item_1'))?.error_code).toBe('ITEM_LOGIN_REQUIRED');
  });

  it('validates input and 404s unknown items', async () => {
    const { kp, deviceId } = await pair();
    const missing = await signed(kp, deviceId, 'POST', '/v1/items/nope/sync', {});
    expect(missing.status).toBe(404);
    // Security headers apply to error responses too.
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(missing.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await signed(kp, deviceId, 'POST', '/v1/link/token', { evil: true })).status).toBe(400);
  });

  it('removes items at Plaid and locally', async () => {
    const { kp, deviceId } = await pair();
    await signed(kp, deviceId, 'POST', '/v1/link/exchange', { publicToken: 'public-ok' });
    expect((await signed(kp, deviceId, 'DELETE', '/v1/items/item_1')).status).toBe(200);
    expect(plaid.removed).toEqual(['access-sandbox-SECRET-TOKEN']);
    expect(await store.getItem('item_1')).toBeNull();
  });

  it('lists and revokes devices', async () => {
    const a = await pair('iPhone');
    const b = await pair('Mac');
    const list = (await (await signed(a.kp, a.deviceId, 'GET', '/v1/devices')).json()) as { devices: Array<{ id: string; current: boolean }> };
    expect(list.devices).toHaveLength(2);
    expect(list.devices.find((d) => d.current)?.id).toBe(a.deviceId);
    expect((await signed(a.kp, a.deviceId, 'DELETE', `/v1/devices/${b.deviceId}`)).status).toBe(200);
    expect((await signed(b.kp, b.deviceId, 'GET', '/v1/me')).status).toBe(401);
  });
});

describe('without plaid configured', () => {
  it('explains what to do', async () => {
    const bare = createApp({ config, store, now: () => clock });
    const code = newPairingCode();
    await store.createPairingCode(normalizePairingCode(code), 600_000, clock);
    const kp = keyPairFromSeed(randomBytes(32));
    const paired = (await (await bare.request('/v1/pair', { method: 'POST', body: JSON.stringify({ code, publicKey: base64UrlEncode(kp.publicKey), name: 'x' }) })).json()) as { deviceId: string; plaidEnabled: boolean };
    expect(paired.plaidEnabled).toBe(false);
    const headers = signRequest(kp.secretKey, paired.deviceId, { method: 'POST', path: '/v1/link/token', body: '{}' }, randomBytes(16), clock);
    const res = await bare.request('/v1/link/token', { method: 'POST', headers, body: '{}' });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'PLAID_NOT_CONFIGURED' });
  });
});


describe('first-device setup key', () => {
  const pairWith = (code: string, a = app) =>
    a.request('/v1/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, publicKey: base64UrlEncode(keyPairFromSeed(randomBytes(32)).publicKey), name: 'iPhone' }),
    });

  it('pairs the first device only, then stops working', async () => {
    expect(await (await app.request('/v1/status')).json()).toMatchObject({ needsSetup: true, plaidEnabled: true });
    expect((await pairWith('wrong-key-wrong-key')).status).toBe(401);
    expect((await pairWith(setupKey.toLowerCase())).status).toBe(200);
    expect(await (await app.request('/v1/status')).json()).toMatchObject({ needsSetup: false });
    expect((await pairWith(setupKey)).status).toBe(401);
  });

  it('lets a paired device mint codes for more devices', async () => {
    const { kp, deviceId } = await pair();
    const res = (await (await signed(kp, deviceId, 'POST', '/v1/pairing-codes', {})).json()) as { code: string };
    expect(res.code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect((await pairWith(res.code)).status).toBe(200);
    expect((await pairWith(res.code)).status).toBe(401);
  });
});

describe('replay protection', () => {
  it('holds across separate app instances (e.g. Worker isolates)', async () => {
    const { kp, deviceId } = await pair();
    const other = createApp({ config, store, plaid, now: () => clock });
    const nonce = randomBytes(16);
    const headers = signRequest(kp.secretKey, deviceId, { method: 'GET', path: '/v1/me', body: '' }, nonce, clock);
    expect((await app.request('/v1/me', { headers })).status).toBe(200);
    expect((await other.request('/v1/me', { headers })).status).toBe(401);
  });
});

describe('Plaid Hosted Link', () => {
  it('reads results from /link/token/get', () => {
    expect(readLinkResults({ link_token: 'x', link_sessions: [] })).toEqual({ finished: false, exited: false, tokens: [] });
    expect(
      readLinkResults({
        link_token: 'x',
        link_sessions: [{ finished_at: 'now', results: { item_add_results: [{ public_token: 'p', institution: { name: 'Bank', institution_id: 'ins' } }] } }],
      }).tokens,
    ).toEqual([{ publicToken: 'p', institutionId: 'ins', institutionName: 'Bank' }]);
    expect(readLinkResults({ link_token: 'x', link_sessions: [{ finished_at: 'now', exit: {} }] }).exited).toBe(true);
  });

  it('starts, polls, and finishes exactly once', async () => {
    const { kp, deviceId } = await pair();
    const start = (await (await signed(kp, deviceId, 'POST', '/v1/link/hosted', {})).json()) as { sessionId: string; url: string };
    expect(start.url).toBe('https://hosted.plaid.com/link/abc');
    expect(plaid.lastLinkOpts).toMatchObject({
      hostedLink: { completionRedirectUri: 'https://budgi.example.workers.dev/connected.html' },
      webhook: 'https://budgi.example.workers.dev/plaid/webhook',
    });
    // The link token is stored encrypted.
    db.raw.exec('PRAGMA wal_checkpoint(FULL)');
    expect(readFileSync(join(dir, 'test.db')).toString('latin1')).not.toContain('link-sandbox-123');

    const poll = async () => (await signed(kp, deviceId, 'GET', `/v1/link/hosted/${start.sessionId}`)).json();
    expect(await poll()).toEqual({ status: 'pending' });

    plaid.linkGet = {
      link_token: 'link-sandbox-123',
      link_sessions: [{ finished_at: 'now', results: { item_add_results: [{ public_token: 'public-ok', institution: { name: 'Platypus', institution_id: 'ins_1' } }] } }],
    };
    // The webhook body is only a hint; it triggers a server-side fetch.
    const hook = await app.request('/plaid/webhook', {
      method: 'POST',
      body: JSON.stringify({ webhook_type: 'LINK', webhook_code: 'SESSION_FINISHED', link_token: 'link-sandbox-123', public_tokens: ['forged'] }),
    });
    expect(hook.status).toBe(200);
    expect(await poll()).toEqual({ status: 'done', items: [{ itemId: 'item_1', institutionName: 'Platypus' }] });
    expect(await poll()).toEqual({ status: 'done', items: [{ itemId: 'item_1', institutionName: 'Platypus' }] });
    expect(plaid.exchanges).toBe(1);
    expect(await store.getItem('item_1')).not.toBeNull();
  });

  it('ignores webhooks for unknown link tokens', async () => {
    const res = await app.request('/plaid/webhook', { method: 'POST', body: JSON.stringify({ webhook_type: 'LINK', webhook_code: 'SESSION_FINISHED', link_token: 'nope' }) });
    expect(res.status).toBe(200);
    expect(plaid.exchanges).toBe(0);
  });
});

describe('SimpleFIN proxy', () => {
  it('claims, stores encrypted, and fetches accounts', async () => {
    const { kp, deviceId } = await pair();
    const claim = (await (await signed(kp, deviceId, 'POST', '/v1/simplefin', { setupToken: btoa('https://beta-bridge.simplefin.org/simplefin/claim/DEMO') })).json()) as { connectionId: string };
    expect(claim.connectionId).toMatch(/^sf_/);
    db.raw.exec('PRAGMA wal_checkpoint(FULL)');
    expect(readFileSync(join(dir, 'test.db')).toString('latin1')).not.toContain('user:pass');
    const accounts = await (await signed(kp, deviceId, 'POST', `/v1/simplefin/${claim.connectionId}/accounts`, { startDate: 1_700_000_000_000 })).json();
    expect(accounts).toMatchObject({ accounts: [{ id: 'A1' }] });
    expect(fetchLog.at(-1)).toBe('GET https://beta-bridge.simplefin.org/simplefin/accounts?start-date=1700000000&pending=1');
  });

  it('refuses setup tokens that point anywhere but simplefin.org', async () => {
    const { kp, deviceId } = await pair();
    const res = await signed(kp, deviceId, 'POST', '/v1/simplefin', { setupToken: btoa('https://169.254.169.254/latest/meta-data') });
    expect(res.status).toBe(400);
    expect(fetchLog).toEqual([]);
  });
});
