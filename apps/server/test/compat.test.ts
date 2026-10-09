import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { SecretBox } from '../src/crypto';

it('opens ciphertexts produced by the previous node:crypto implementation', async () => {
  const master = randomBytes(32);
  const key = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'budgi/plaid-access-token/v1', 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('item:abc'));
  const ct = Buffer.concat([cipher.update('access-token', 'utf8'), cipher.final()]);
  const sealed = ['v1', iv.toString('base64url'), ct.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
  expect(await new SecretBox(master).open(sealed, 'item:abc')).toBe('access-token');
});
