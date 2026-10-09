import { describe, expect, it } from 'vitest';
import { base64UrlDecode, base64UrlEncode, keyFingerprint, keyPairFromSeed, signRequest, verifyRequestSignature, HEADER_SIGNATURE, HEADER_NONCE, HEADER_TIMESTAMP } from '../src/auth';

describe('auth', () => {
  it('round-trips base64url', () => {
    for (let len = 0; len < 40; len++) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + len) & 255);
      expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
    }
    expect(base64UrlEncode(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('signs and verifies requests; tampering fails', () => {
    const kp = keyPairFromSeed(new Uint8Array(32).fill(7));
    const req = { method: 'POST', path: '/v1/items/abc/sync', body: '{"cursor":null}' };
    const h = signRequest(kp.secretKey, 'dev1', req, new Uint8Array(16).fill(1), 1_700_000_000_000);
    const input = { ...req, timestamp: h[HEADER_TIMESTAMP], nonce: h[HEADER_NONCE] };
    expect(verifyRequestSignature(kp.publicKey, input, h[HEADER_SIGNATURE])).toBe(true);
    expect(verifyRequestSignature(kp.publicKey, { ...input, body: '{"cursor":"x"}' }, h[HEADER_SIGNATURE])).toBe(false);
    expect(verifyRequestSignature(kp.publicKey, { ...input, path: '/v1/items/other/sync' }, h[HEADER_SIGNATURE])).toBe(false);
    const other = keyPairFromSeed(new Uint8Array(32).fill(8));
    expect(verifyRequestSignature(other.publicKey, input, h[HEADER_SIGNATURE])).toBe(false);
    expect(verifyRequestSignature(kp.publicKey, input, 'garbage')).toBe(false);
    expect(keyFingerprint(kp.publicKey)).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });
});

describe('verifyRequestSignatureAsync', () => {
  it('agrees with the pure-JS verifier', async () => {
    const { verifyRequestSignatureAsync } = await import('../src/auth');
    const kp = keyPairFromSeed(new Uint8Array(32).fill(3));
    const req = { method: 'GET', path: '/v1/me', body: '' };
    const h = signRequest(kp.secretKey, 'd', req, new Uint8Array(16).fill(9), 1_700_000_000_000);
    const input = { ...req, timestamp: h[HEADER_TIMESTAMP], nonce: h[HEADER_NONCE] };
    expect(await verifyRequestSignatureAsync(kp.publicKey, input, h[HEADER_SIGNATURE])).toBe(true);
    expect(await verifyRequestSignatureAsync(kp.publicKey, { ...input, path: '/v1/x' }, h[HEADER_SIGNATURE])).toBe(false);
    expect(await verifyRequestSignatureAsync(kp.publicKey, input, 'AAAA')).toBe(false);
  });
});
