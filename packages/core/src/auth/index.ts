/**
 * Device-bound request signing (Ed25519).
 *
 * The phone holds a private key that never leaves its Keychain. The relay
 * server stores only the public key, so a leaked server database cannot be
 * used to impersonate your phone, and there is no bearer token to steal
 * from logs or proxies. Each request signs:
 *
 *   BUDGI-V1 \n METHOD \n PATH?QUERY \n TIMESTAMP \n NONCE \n SHA256(BODY)
 *
 * The server rejects stale timestamps and reused nonces (replay protection).
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export const SIGNATURE_VERSION = 'BUDGI-V1';
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const HEADER_DEVICE = 'x-budgi-device';
export const HEADER_TIMESTAMP = 'x-budgi-ts';
export const HEADER_NONCE = 'x-budgi-nonce';
export const HEADER_SIGNATURE = 'x-budgi-sig';

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]! + B64URL[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]!;
  }
  return out;
}

export function base64UrlDecode(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!/^[A-Za-z0-9_-]*$/.test(clean) || clean.length % 4 === 1) throw new Error('Invalid base64url');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let j = 0;
  for (const ch of clean) {
    buffer = (buffer << 6) | B64URL.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, j);
}

export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

export interface CanonicalRequestInput {
  method: string;
  /** Path including query string, e.g. `/v1/items?x=1`. */
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}

export function canonicalRequest(r: CanonicalRequestInput): string {
  return [SIGNATURE_VERSION, r.method.toUpperCase(), r.path, r.timestamp, r.nonce, sha256Hex(r.body)].join('\n');
}

export interface DeviceKeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

/** Derive a key pair from 32 bytes of secure randomness. */
export function keyPairFromSeed(seed: Uint8Array): DeviceKeyPair {
  if (seed.length !== 32) throw new Error('Seed must be 32 bytes');
  return { secretKey: seed, publicKey: ed25519.getPublicKey(seed) };
}

// A type alias (not an interface) so it's assignable to fetch's HeadersInit.
export type SignedHeaders = {
  [HEADER_DEVICE]: string;
  [HEADER_TIMESTAMP]: string;
  [HEADER_NONCE]: string;
  [HEADER_SIGNATURE]: string;
};

export function signRequest(
  secretKey: Uint8Array,
  deviceId: string,
  req: { method: string; path: string; body: string },
  nonceBytes: Uint8Array,
  now: number = Date.now(),
): SignedHeaders {
  const timestamp = String(now);
  const nonce = base64UrlEncode(nonceBytes);
  const message = canonicalRequest({ ...req, timestamp, nonce });
  const sig = ed25519.sign(utf8ToBytes(message), secretKey);
  return {
    [HEADER_DEVICE]: deviceId,
    [HEADER_TIMESTAMP]: timestamp,
    [HEADER_NONCE]: nonce,
    [HEADER_SIGNATURE]: base64UrlEncode(sig),
  };
}

export function verifyRequestSignature(
  publicKey: Uint8Array,
  input: CanonicalRequestInput,
  signatureB64: string,
): boolean {
  try {
    const sig = base64UrlDecode(signatureB64);
    if (sig.length !== 64 || publicKey.length !== 32) return false;
    return ed25519.verify(sig, utf8ToBytes(canonicalRequest(input)), publicKey);
  } catch {
    return false;
  }
}

/** Short, human-comparable fingerprint of a public key (shown on both sides when pairing). */
export function keyFingerprint(publicKey: Uint8Array): string {
  const hex = sha256Hex(publicKey).slice(0, 16).toUpperCase();
  return hex.match(/.{4}/g)!.join('-');
}
