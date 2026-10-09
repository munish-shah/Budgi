import {
  HEADER_DEVICE,
  HEADER_NONCE,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  MAX_CLOCK_SKEW_MS,
  base64UrlDecode,
  verifyRequestSignature,
} from '@budgi/core/auth';
import type { MiddlewareHandler } from 'hono';
import type { DeviceRow, Store } from './db';

export type AppEnv = { Variables: { device: DeviceRow } };

/** Remembers nonces for the skew window so a captured request can't be replayed. */
export class NonceCache {
  readonly #seen = new Map<string, number>();
  constructor(private readonly ttlMs = MAX_CLOCK_SKEW_MS * 2) {}

  /** Returns false if the nonce was already used. */
  use(key: string, now = Date.now()): boolean {
    if (this.#seen.size > 10_000) this.prune(now);
    const exp = this.#seen.get(key);
    if (exp !== undefined && exp > now) return false;
    this.#seen.set(key, now + this.ttlMs);
    return true;
  }

  prune(now = Date.now()) {
    for (const [k, exp] of this.#seen) if (exp <= now) this.#seen.delete(k);
  }
}

/** Fixed-window rate limiter keyed by client. */
export class RateLimiter {
  readonly #hits = new Map<string, { count: number; reset: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const entry = this.#hits.get(key);
    if (!entry || entry.reset <= now) {
      if (this.#hits.size > 10_000) this.#hits.clear();
      this.#hits.set(key, { count: 1, reset: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }
}

const unauthorized = (reason: string) =>
  new Response(JSON.stringify({ error: 'UNAUTHORIZED', reason }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Verifies every request is signed by a paired, non-revoked device.
 * Failure reasons are deliberately coarse.
 */
export function requireDevice(store: Store, nonces: NonceCache, now: () => number = Date.now): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const deviceId = c.req.header(HEADER_DEVICE);
    const timestamp = c.req.header(HEADER_TIMESTAMP);
    const nonce = c.req.header(HEADER_NONCE);
    const signature = c.req.header(HEADER_SIGNATURE);
    if (!deviceId || !timestamp || !nonce || !signature) return unauthorized('missing signature');
    if (!/^\d{10,16}$/.test(timestamp) || Math.abs(now() - Number(timestamp)) > MAX_CLOCK_SKEW_MS) {
      return unauthorized('stale request — check your device clock');
    }
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return unauthorized('bad nonce');

    const device = store.getDevice(deviceId);
    // Same answer for unknown devices and bad signatures: don't reveal which ids exist.
    if (!device || device.revoked_at) return unauthorized('invalid signature');

    const url = new URL(c.req.url);
    const body = c.req.method === 'GET' || c.req.method === 'HEAD' ? '' : await c.req.text();
    const ok = verifyRequestSignature(
      base64UrlDecode(device.public_key),
      { method: c.req.method, path: url.pathname + url.search, timestamp, nonce, body },
      signature,
    );
    if (!ok) return unauthorized('invalid signature');
    // Only burn the nonce once the signature is proven, so garbage can't fill the cache.
    if (!nonces.use(`${deviceId}:${nonce}`, now())) return unauthorized('replayed request');

    if (!device.last_seen_at || now() - device.last_seen_at > 60_000) store.touchDevice(device.id, now());
    c.set('device', device);
    await next();
  };
}

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Cross-Origin-Resource-Policy', 'same-origin');
};
