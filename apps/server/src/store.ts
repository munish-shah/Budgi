import { randomId, sha256 } from './crypto';

/**
 * The subset of Cloudflare D1's API the relay uses. The Node build adapts
 * node:sqlite to the same shape (see node-sqlite.ts), so one Store
 * implementation runs in both places.
 */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<unknown>;
}

export interface DeviceRow {
  id: string;
  name: string;
  public_key: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

export interface ItemRow {
  id: string;
  institution_id: string | null;
  institution_name: string | null;
  access_token_enc: string;
  created_at: number;
  last_synced_at: number | null;
  error_code: string | null;
}

export interface LinkSessionRow {
  id: string;
  link_token_hash: string;
  link_token_enc: string;
  item_id: string | null;
  status: 'pending' | 'processing' | 'done' | 'exited';
  result: string | null;
  created_at: number;
}

export interface SimpleFinRow {
  id: string;
  access_url_enc: string;
  created_at: number;
}

// Every statement is idempotent so the schema can be ensured on startup
// (and on a Worker's first request) without a separate migration step.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS devices (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS pairing_codes (
     code_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS items (
     id TEXT PRIMARY KEY, institution_id TEXT, institution_name TEXT,
     access_token_enc TEXT NOT NULL, created_at INTEGER NOT NULL,
     last_synced_at INTEGER, error_code TEXT)`,
  `CREATE TABLE IF NOT EXISTS nonces (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS link_sessions (
     id TEXT PRIMARY KEY, link_token_hash TEXT NOT NULL UNIQUE, link_token_enc TEXT NOT NULL,
     item_id TEXT, status TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS simplefin (
     id TEXT PRIMARY KEY, access_url_enc TEXT NOT NULL, created_at INTEGER NOT NULL)`,
];

export class Store {
  #ready: Promise<void> | null = null;

  constructor(readonly db: SqlDatabase) {}

  /** Create tables if needed. Safe to call repeatedly. */
  init(): Promise<void> {
    this.#ready ??= this.db.batch(SCHEMA.map((s) => this.db.prepare(s))).then(() => undefined);
    return this.#ready;
  }

  private async changes(stmt: SqlStatement): Promise<number> {
    return (await stmt.run()).meta.changes ?? 0;
  }

  // ---- pairing ----
  async createPairingCode(code: string, ttlMs: number, now = Date.now()) {
    await this.db.prepare('DELETE FROM pairing_codes WHERE expires_at < ? OR used_at IS NOT NULL').bind(now).run();
    await this.db.prepare('INSERT INTO pairing_codes (code_hash, expires_at) VALUES (?, ?)').bind(await sha256(code), now + ttlMs).run();
  }

  /** Atomically consume a pairing code. Returns true if it was valid. */
  async consumePairingCode(code: string, now = Date.now()): Promise<boolean> {
    const stmt = this.db
      .prepare('UPDATE pairing_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at >= ?')
      .bind(now, await sha256(code), now);
    return (await this.changes(stmt)) === 1;
  }

  // ---- devices ----
  async addDevice(name: string, publicKey: string, now = Date.now()): Promise<DeviceRow> {
    const id = randomId();
    await this.db.prepare('INSERT INTO devices (id, name, public_key, created_at) VALUES (?, ?, ?, ?)').bind(id, name, publicKey, now).run();
    return (await this.getDevice(id))!;
  }

  getDevice(id: string): Promise<DeviceRow | null> {
    return this.db.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first<DeviceRow>();
  }

  async listDevices(): Promise<DeviceRow[]> {
    return (await this.db.prepare('SELECT * FROM devices ORDER BY created_at').all<DeviceRow>()).results;
  }

  async activeDeviceCount(): Promise<number> {
    const row = await this.db.prepare('SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL').first<{ n: number }>();
    return Number(row?.n ?? 0);
  }

  async touchDevice(id: string, now = Date.now()) {
    await this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(now, id).run();
  }

  async revokeDevice(id: string, now = Date.now()): Promise<boolean> {
    return (await this.changes(this.db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, id))) === 1;
  }

  // ---- replay protection & rate limiting (shared across Worker isolates) ----
  /** Returns false if the nonce was already used. */
  async useNonce(key: string, expiresAt: number, now = Date.now()): Promise<boolean> {
    if (Math.random() < 0.02) await this.db.prepare('DELETE FROM nonces WHERE expires_at < ?').bind(now).run();
    const inserted = await this.changes(this.db.prepare('INSERT OR IGNORE INTO nonces (key, expires_at) VALUES (?, ?)').bind(key, expiresAt));
    return inserted === 1;
  }

  /** Fixed-window counter. Returns false once `limit` is exceeded in the window. */
  async hit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
    await this.db
      .prepare(
        `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
           reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END`,
      )
      .bind(key, now + windowMs, now, now)
      .run();
    const row = await this.db.prepare('SELECT count FROM rate_limits WHERE key = ?').bind(key).first<{ count: number }>();
    return Number(row?.count ?? 0) <= limit;
  }

  // ---- Plaid items ----
  async upsertItem(row: Omit<ItemRow, 'last_synced_at' | 'error_code'>) {
    await this.db
      .prepare(
        `INSERT INTO items (id, institution_id, institution_name, access_token_enc, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET access_token_enc = excluded.access_token_enc, error_code = NULL`,
      )
      .bind(row.id, row.institution_id, row.institution_name, row.access_token_enc, row.created_at)
      .run();
  }

  getItem(id: string): Promise<ItemRow | null> {
    return this.db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<ItemRow>();
  }

  async listItems(): Promise<ItemRow[]> {
    return (await this.db.prepare('SELECT * FROM items ORDER BY created_at').all<ItemRow>()).results;
  }

  async markItemSynced(id: string, errorCode: string | null, now = Date.now()) {
    if (errorCode) await this.db.prepare('UPDATE items SET error_code = ? WHERE id = ?').bind(errorCode, id).run();
    else await this.db.prepare('UPDATE items SET last_synced_at = ?, error_code = NULL WHERE id = ?').bind(now, id).run();
  }

  async deleteItem(id: string) {
    await this.db.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
  }

  // ---- Plaid Hosted Link sessions ----
  async createLinkSession(row: Omit<LinkSessionRow, 'status' | 'result'>) {
    await this.db
      .prepare('INSERT INTO link_sessions (id, link_token_hash, link_token_enc, item_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(row.id, row.link_token_hash, row.link_token_enc, row.item_id, 'pending', row.created_at)
      .run();
  }

  getLinkSession(id: string): Promise<LinkSessionRow | null> {
    return this.db.prepare('SELECT * FROM link_sessions WHERE id = ?').bind(id).first<LinkSessionRow>();
  }

  getLinkSessionByTokenHash(hash: string): Promise<LinkSessionRow | null> {
    return this.db.prepare('SELECT * FROM link_sessions WHERE link_token_hash = ?').bind(hash).first<LinkSessionRow>();
  }

  /** Move a session between states only if it's in `from` (so concurrent callers can't double-process). */
  async transitionLinkSession(id: string, from: LinkSessionRow['status'], to: LinkSessionRow['status'], result?: string): Promise<boolean> {
    return (await this.changes(this.db.prepare('UPDATE link_sessions SET status = ?, result = ? WHERE id = ? AND status = ?').bind(to, result ?? null, id, from))) === 1;
  }

  async pruneLinkSessions(olderThan: number) {
    await this.db.prepare('DELETE FROM link_sessions WHERE created_at < ?').bind(olderThan).run();
  }

  // ---- SimpleFIN ----
  async addSimpleFin(id: string, accessUrlEnc: string, now = Date.now()) {
    await this.db.prepare('INSERT INTO simplefin (id, access_url_enc, created_at) VALUES (?, ?, ?)').bind(id, accessUrlEnc, now).run();
  }

  getSimpleFin(id: string): Promise<SimpleFinRow | null> {
    return this.db.prepare('SELECT * FROM simplefin WHERE id = ?').bind(id).first<SimpleFinRow>();
  }

  async deleteSimpleFin(id: string) {
    await this.db.prepare('DELETE FROM simplefin WHERE id = ?').bind(id).run();
  }
}
