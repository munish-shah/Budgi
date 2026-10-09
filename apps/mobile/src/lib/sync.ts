import {
  addDays,
  mapSimpleFinAccount,
  mapSimpleFinTransaction,
  stalePendingIds,
  toISODate,
  type Transaction,
} from '@budgi/core';
import { openPlaidLink } from './plaid-link';
import { relay, RelayError } from './relay';
import { claimSimpleFin, fetchSimpleFin, forgetSimpleFin } from './simplefin';
import { useStore, type Connection } from './store';

const SIMPLEFIN_MIN_INTERVAL_MS = 30 * 60 * 1000; // Bridge data refreshes ~daily; be polite.

async function syncPlaid(conn: Connection): Promise<number> {
  const store = useStore.getState();
  let cursor = conn.cursor ?? null;
  const initialImport = cursor === null;
  let added = 0;
  for (let round = 0; round < 10; round++) {
    let res;
    try {
      res = await relay.sync(conn.id, cursor);
    } catch (e) {
      if (e instanceof RelayError && e.needsRelink) {
        store.patchConnection(conn.id, { needsRelink: true, error: 'Your bank needs you to sign in again.' });
        return added;
      }
      throw e;
    }
    added += await store.applyDelta(conn.id, res, { initialImport });
    // Only advance the cursor after the delta is safely stored.
    cursor = res.nextCursor;
    store.patchConnection(conn.id, { cursor });
    if (!res.hasMore) break;
  }
  return added;
}

async function syncSimpleFin(conn: Connection, force: boolean): Promise<number> {
  const store = useStore.getState();
  if (!force && conn.lastSyncAt && Date.now() - Date.parse(conn.lastSyncAt) < SIMPLEFIN_MIN_INTERVAL_MS) return 0;
  const start = conn.lastSyncAt ? new Date(Date.parse(conn.lastSyncAt) - 14 * 86_400_000) : new Date(Date.now() - 90 * 86_400_000);
  const set = await fetchSimpleFin(conn.id, start);
  const accounts = set.accounts.map((a) => mapSimpleFinAccount(a, conn.id, conn.name));
  const txns: Transaction[] = set.accounts.flatMap((a) => (a.transactions ?? []).map((t) => mapSimpleFinTransaction(t, a)));
  const fetched = new Set(txns.map((t) => t.id));
  const removed = stalePendingIds(Object.values(store.txns), fetched, new Set(accounts.map((a) => a.id)), toISODate(start));
  const added = await store.applyDelta(conn.id, { added: txns, modified: [], removed, accounts }, { initialImport: !conn.lastSyncAt });
  if (set.messages.length) store.patchConnection(conn.id, { error: set.messages.join(' ') });
  return added;
}

let inflight: Promise<number> | null = null;

/** Sync every connection. Concurrent calls share one run. */
export function syncAll(force = false): Promise<number> {
  if (inflight) return inflight;
  inflight = (async () => {
    const store = useStore.getState();
    store.setSyncing(true);
    let total = 0;
    try {
      for (const conn of store.connections) {
        if (conn.provider === 'demo') continue;
        try {
          total += conn.provider === 'plaid' ? await syncPlaid(conn) : await syncSimpleFin(conn, force);
        } catch (e) {
          useStore.getState().patchConnection(conn.id, { error: e instanceof Error ? e.message : 'Sync failed' });
        }
      }
    } finally {
      useStore.getState().setSyncing(false);
      inflight = null;
    }
    return total;
  })();
  return inflight;
}

/**
 * Web/PWA: Plaid Hosted Link. Start a session (the page opens Plaid in a
 * browser tab from a tap), then poll until the relay has collected the result
 * from Plaid. Works with OAuth banks because sign-in happens in real Safari.
 */
export function startHostedLink(relinkItemId?: string) {
  return relay.linkHosted(relinkItemId);
}

export async function waitForHostedLink(sessionId: string, relinkItemId?: string, signal?: { cancelled: boolean }): Promise<Connection[] | null> {
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline && !signal?.cancelled) {
    const res = await relay.linkHostedStatus(sessionId).catch(() => ({ status: 'pending' as const, items: undefined }));
    if (res.status === 'exited') return null;
    if (res.status === 'done') {
      const store = useStore.getState();
      const conns: Connection[] = [];
      for (const item of res.items ?? []) {
        if (item.itemId === relinkItemId) {
          store.patchConnection(item.itemId, { needsRelink: false, error: undefined });
          continue;
        }
        const existing = store.connections.find((c) => c.id === item.itemId);
        const conn: Connection = existing ?? { id: item.itemId, provider: 'plaid', name: item.institutionName, cursor: null };
        if (!existing) store.upsertConnection(conn);
        conns.push(conn);
      }
      void syncAll(true);
      return conns;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

/** Native: get a link token from the relay, open the Link SDK, exchange on the relay. */
export async function connectPlaid(relinkItemId?: string): Promise<Connection | null> {
  const { linkToken } = await relay.linkToken(relinkItemId);
  const result = await openPlaidLink(linkToken);
  if (!result) return null;
  const store = useStore.getState();
  if (relinkItemId) {
    store.patchConnection(relinkItemId, { needsRelink: false, error: undefined });
    void syncAll(true);
    return store.connections.find((c) => c.id === relinkItemId) ?? null;
  }
  const { itemId, institutionName } = await relay.exchange(result.publicToken, result.institutionId, result.institutionName);
  const conn: Connection = { id: itemId, provider: 'plaid', name: institutionName, cursor: null };
  store.upsertConnection(conn);
  void syncAll(true);
  return conn;
}

export async function connectSimpleFin(setupToken: string): Promise<Connection> {
  const id = await claimSimpleFin(setupToken);
  const conn: Connection = { id, provider: 'simplefin', name: 'SimpleFIN' };
  const store = useStore.getState();
  store.upsertConnection(conn);
  // Name the connection after the first institution we see.
  await syncAll(true);
  const first = Object.values(useStore.getState().accounts).find((a) => a.connectionId === id);
  if (first?.institution) store.patchConnection(id, { name: first.institution });
  return conn;
}

export async function disconnect(conn: Connection): Promise<void> {
  if (conn.provider === 'plaid') await relay.removeItem(conn.id).catch(() => undefined);
  if (conn.provider === 'simplefin') await forgetSimpleFin(conn.id);
  await useStore.getState().removeConnection(conn.id);
}

export const todayISO = () => toISODate(new Date());
export const daysAgo = (n: number) => addDays(todayISO(), -n);
