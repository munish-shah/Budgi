import { DatabaseSync } from 'node:sqlite';
import { randomId, sha256 } from './crypto';

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

const MIGRATIONS = [
  `CREATE TABLE devices (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     public_key TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL,
     last_seen_at INTEGER,
     revoked_at INTEGER
   );
   CREATE TABLE pairing_codes (
     code_hash TEXT PRIMARY KEY,
     expires_at INTEGER NOT NULL,
     used_at INTEGER
   );
   CREATE TABLE items (
     id TEXT PRIMARY KEY,
     institution_id TEXT,
     institution_name TEXT,
     access_token_enc TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     last_synced_at INTEGER,
     error_code TEXT
   );`,
];

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;');
    this.migrate();
  }

  private migrate() {
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  close() {
    this.db.close();
  }

  // ---- pairing ----
  createPairingCode(code: string, ttlMs: number, now = Date.now()) {
    this.db.prepare('DELETE FROM pairing_codes WHERE expires_at < ? OR used_at IS NOT NULL').run(now);
    this.db.prepare('INSERT INTO pairing_codes (code_hash, expires_at) VALUES (?, ?)').run(sha256(code), now + ttlMs);
  }

  /** Atomically consume a pairing code. Returns true if it was valid. */
  consumePairingCode(code: string, now = Date.now()): boolean {
    const res = this.db
      .prepare('UPDATE pairing_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at >= ?')
      .run(now, sha256(code), now);
    return res.changes === 1;
  }

  // ---- devices ----
  addDevice(name: string, publicKey: string, now = Date.now()): DeviceRow {
    const id = randomId();
    this.db.prepare('INSERT INTO devices (id, name, public_key, created_at) VALUES (?, ?, ?, ?)').run(id, name, publicKey, now);
    return this.getDevice(id)!;
  }

  getDevice(id: string): DeviceRow | undefined {
    return this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
  }

  listDevices(): DeviceRow[] {
    return this.db.prepare('SELECT * FROM devices ORDER BY created_at').all() as unknown as DeviceRow[];
  }

  touchDevice(id: string, now = Date.now()) {
    this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(now, id);
  }

  revokeDevice(id: string, now = Date.now()): boolean {
    return this.db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, id).changes === 1;
  }

  // ---- items ----
  upsertItem(row: Omit<ItemRow, 'last_synced_at' | 'error_code'>) {
    this.db
      .prepare(
        `INSERT INTO items (id, institution_id, institution_name, access_token_enc, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET access_token_enc = excluded.access_token_enc, error_code = NULL`,
      )
      .run(row.id, row.institution_id, row.institution_name, row.access_token_enc, row.created_at);
  }

  getItem(id: string): ItemRow | undefined {
    return this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
  }

  listItems(): ItemRow[] {
    return this.db.prepare('SELECT * FROM items ORDER BY created_at').all() as unknown as ItemRow[];
  }

  markItemSynced(id: string, errorCode: string | null, now = Date.now()) {
    if (errorCode) this.db.prepare('UPDATE items SET error_code = ? WHERE id = ?').run(errorCode, id);
    else this.db.prepare('UPDATE items SET last_synced_at = ?, error_code = NULL WHERE id = ?').run(now, id);
  }

  deleteItem(id: string) {
    this.db.prepare('DELETE FROM items WHERE id = ?').run(id);
  }
}
