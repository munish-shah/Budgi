import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Envelope for secrets at rest (Plaid access tokens).
 * AES-256-GCM with a key derived from the master key via HKDF, a random
 * 96-bit IV per value, and the item id bound in as associated data so a
 * ciphertext can't be swapped onto another row.
 */
export class SecretBox {
  readonly #key: Buffer;

  constructor(masterKey: Buffer, purpose = 'budgi/plaid-access-token/v1') {
    if (masterKey.length !== 32) throw new Error('Master key must be 32 bytes');
    this.#key = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), purpose, 32));
  }

  seal(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), ct.toString('base64url'), tag.toString('base64url')].join('.');
  }

  open(sealed: string, aad: string): string {
    const [version, iv, ct, tag] = sealed.split('.');
    if (version !== 'v1' || !iv || !ct || !tag) throw new Error('Unsupported ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  }
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

// Crockford base32 without ambiguous characters (no I, L, O, U).
const PAIR_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 10-character one-time pairing code (50 bits), formatted XXXXX-XXXXX. */
export function newPairingCode(): string {
  const bytes = randomBytes(10);
  let code = '';
  for (const b of bytes) code += PAIR_ALPHABET[b & 31];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function normalizePairingCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}
