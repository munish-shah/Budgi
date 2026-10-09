import type { webcrypto } from 'node:crypto';
import { base64UrlDecode, base64UrlEncode } from '@budgi/core/auth';

type CryptoKey = webcrypto.CryptoKey;

/**
 * Runtime-agnostic crypto (WebCrypto) so the same relay runs on Node and on
 * Cloudflare Workers.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

/**
 * Envelope for secrets at rest (Plaid access tokens, SimpleFIN access URLs).
 * AES-256-GCM with a key derived from the master key via HKDF, a random
 * 96-bit IV per value, and the row id bound in as associated data so a
 * ciphertext can't be swapped onto another row.
 *
 * Format: v1.<iv>.<ciphertext>.<tag> (base64url).
 */
export class SecretBox {
  readonly #key: Promise<CryptoKey>;

  constructor(masterKey: Uint8Array, purpose = 'budgi/plaid-access-token/v1') {
    if (masterKey.length !== 32) throw new Error('Master key must be 32 bytes');
    this.#key = (async () => {
      const ikm = await subtle().importKey('raw', masterKey, 'HKDF', false, ['deriveKey']);
      return subtle().deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(purpose) },
        ikm,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
  }

  async seal(plaintext: string, aad: string): Promise<string> {
    const iv = randomBytes(12);
    const out = new Uint8Array(
      await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, await this.#key, enc.encode(plaintext)),
    );
    const ct = out.subarray(0, out.length - 16);
    const tag = out.subarray(out.length - 16);
    return ['v1', base64UrlEncode(iv), base64UrlEncode(ct), base64UrlEncode(tag)].join('.');
  }

  async open(sealed: string, aad: string): Promise<string> {
    const [version, iv, ct, tag] = sealed.split('.');
    if (version !== 'v1' || !iv || ct === undefined || !tag) throw new Error('Unsupported ciphertext');
    const ctBytes = base64UrlDecode(ct);
    const tagBytes = base64UrlDecode(tag);
    const joined = new Uint8Array(ctBytes.length + tagBytes.length);
    joined.set(ctBytes);
    joined.set(tagBytes, ctBytes.length);
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: base64UrlDecode(iv), additionalData: enc.encode(aad) },
      await this.#key,
      joined,
    );
    return dec.decode(plain);
  }
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export async function sha256(input: string): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', enc.encode(input)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomId(bytes = 16): string {
  return base64UrlEncode(randomBytes(bytes));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Crockford base32 without ambiguous characters (no I, L, O, U).
const PAIR_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function base32Code(chars: number): string {
  let code = '';
  for (const b of randomBytes(chars)) code += PAIR_ALPHABET[b & 31];
  return code.match(/.{5}/g)!.join('-');
}

/** 10-character one-time pairing code (50 bits), formatted XXXXX-XXXXX. */
export function newPairingCode(): string {
  return base32Code(10);
}

/** 20-character setup key (100 bits) used once to pair the first device. */
export function newSetupKey(): string {
  return base32Code(20);
}

export function normalizePairingCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
