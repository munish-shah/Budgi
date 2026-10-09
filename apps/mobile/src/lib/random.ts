import * as Crypto from 'expo-crypto';

/** Cryptographically secure random bytes (SecRandomCopyBytes on iOS). */
export function randomBytes(n: number): Uint8Array {
  return Crypto.getRandomBytes(n);
}

export function randomHex(n: number): string {
  return Array.from(randomBytes(n), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newId(prefix = ''): string {
  return `${prefix}${randomHex(8)}`;
}
