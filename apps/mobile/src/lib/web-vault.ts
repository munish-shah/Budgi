/**
 * Encrypted storage for the web/PWA build.
 *
 * Every record is AES-256-GCM encrypted before it touches IndexedDB. The key
 * is a *non-extractable* WebCrypto key: page code can use it but can never
 * read its bytes, and WebKit persists it wrapped by a key in the device
 * Keychain. Wiping deletes the whole database, key included.
 */

const DB_NAME = 'budgi';
const DB_VERSION = 1;
export const STORES = ['keys', 'secrets', 'kv', 'accounts', 'transactions'] as const;
export type StoreName = (typeof STORES)[number];

interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let keyPromise: Promise<CryptoKey> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function openVault(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      for (const s of STORES) if (!open.result.objectStoreNames.contains(s)) open.result.createObjectStore(s);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

async function vaultKey(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const db = await openVault();
    const existing = await req(db.transaction('keys').objectStore('keys').get('data-key'));
    if (existing) return existing as CryptoKey;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(key, 'data-key');
    await done(tx);
    return key;
  })();
  return keyPromise;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function seal(value: unknown, aad: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, await vaultKey(), enc.encode(JSON.stringify(value)));
  return { iv, data };
}

async function unseal<T>(sealed: Sealed, aad: string): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData: enc.encode(aad) }, await vaultKey(), sealed.data);
  return JSON.parse(dec.decode(plain)) as T;
}

/** Read every record in a store, decrypted. */
export async function getAll<T>(store: StoreName): Promise<Array<{ key: string; value: T }>> {
  const db = await openVault();
  const tx = db.transaction(store);
  const [keys, values] = await Promise.all([req(tx.objectStore(store).getAllKeys()), req(tx.objectStore(store).getAll())]);
  return Promise.all(keys.map(async (k, i) => ({ key: String(k), value: await unseal<T>(values[i] as Sealed, `${store}:${String(k)}`) })));
}

export async function get<T>(store: StoreName, key: string): Promise<T | null> {
  const db = await openVault();
  const sealed = (await req(db.transaction(store).objectStore(store).get(key))) as Sealed | undefined;
  return sealed ? unseal<T>(sealed, `${store}:${key}`) : null;
}

/**
 * Write many records atomically. Encryption happens first because IndexedDB
 * transactions auto-commit as soon as they're idle across an await.
 */
export async function putMany(store: StoreName, entries: Array<[string, unknown]>, deletes: string[] = []): Promise<void> {
  const sealed = await Promise.all(entries.map(async ([k, v]) => [k, await seal(v, `${store}:${k}`)] as const));
  const db = await openVault();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const [k, v] of sealed) os.put(v, k);
  for (const k of deletes) os.delete(k);
  await done(tx);
}

export async function remove(store: StoreName, key: string): Promise<void> {
  await putMany(store, [], [key]);
}

/** Delete the database and the key with it. */
export async function wipeVault(): Promise<void> {
  const db = await openVault();
  db.close();
  dbPromise = null;
  keyPromise = null;
  await new Promise<void>((resolve, reject) => {
    const del = indexedDB.deleteDatabase(DB_NAME);
    del.onsuccess = () => resolve();
    del.onerror = () => reject(del.error);
    del.onblocked = () => resolve();
  });
}

/** Ask the browser not to evict our storage under pressure (installed PWAs usually get this). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Plain (unencrypted) values that aren't sensitive, e.g. the passkey credential id. */
export async function getPlain<T>(key: string): Promise<T | null> {
  const db = await openVault();
  return ((await req(db.transaction('keys').objectStore('keys').get(key))) as T | undefined) ?? null;
}

export async function setPlain(key: string, value: unknown): Promise<void> {
  const db = await openVault();
  const tx = db.transaction('keys', 'readwrite');
  tx.objectStore('keys').put(value, key);
  await done(tx);
}
