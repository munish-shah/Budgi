import type { Account, Transaction } from '@budgi/core';
import { base64UrlDecode, base64UrlEncode, keyFingerprint, keyPairFromSeed, signRequest } from '@budgi/core/auth';
import { randomBytes } from './random';
import { deleteSecret, getSecret, SecretKeys, setSecret } from './secure';

/**
 * Client for your self-hosted Budgi relay. Every request is signed with this
 * device's Ed25519 key; the private key never leaves the Keychain and the
 * server only knows the public half.
 */

export interface RelayConfig {
  url: string;
  deviceId: string;
}

export class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly needsRelink = false,
  ) {
    super(message);
  }
}

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|[\w-]+\.local)$/;

/** HTTPS is required except for loopback / LAN / Tailscale (100.64/10) addresses. */
export function validateRelayUrl(input: string): string {
  const url = input.trim().replace(/\/+$/, '');
  const m = /^(https?):\/\/([^/:]+)(:\d+)?(\/.*)?$/i.exec(url);
  if (!m) throw new Error('Enter a URL like https://budgi.your-tailnet.ts.net');
  const [, scheme, host] = m;
  if (scheme!.toLowerCase() === 'http' && !PRIVATE_HOST.test(host!)) {
    throw new Error('Use https:// — plain http is only allowed on your local network or Tailscale.');
  }
  return url;
}

async function deviceSeed(): Promise<Uint8Array> {
  let seed = await getSecret(SecretKeys.deviceSeed);
  if (!seed) {
    seed = base64UrlEncode(randomBytes(32));
    await setSecret(SecretKeys.deviceSeed, seed);
  }
  return base64UrlDecode(seed);
}

export async function getRelayConfig(): Promise<RelayConfig | null> {
  const raw = await getSecret(SecretKeys.relay);
  return raw ? (JSON.parse(raw) as RelayConfig) : null;
}

export async function deviceFingerprint(): Promise<string> {
  return keyFingerprint(keyPairFromSeed(await deviceSeed()).publicKey);
}

async function parseError(res: Response): Promise<RelayError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; reason?: string; needsRelink?: boolean };
  const code = body.error ?? `HTTP_${res.status}`;
  const message =
    body.message ??
    (res.status === 401 ? `Relay rejected this device (${body.reason ?? 'unauthorized'}). Pair again in Settings.` : `Relay error ${res.status}`);
  return new RelayError(res.status, code, message, !!body.needsRelink);
}

export async function pairWithRelay(urlInput: string, code: string, deviceName: string): Promise<RelayConfig & { plaidEnabled: boolean }> {
  const url = validateRelayUrl(urlInput);
  // A fresh key per pairing, so re-pairing rotates the device identity.
  const seed = randomBytes(32);
  const { publicKey } = keyPairFromSeed(seed);
  const res = await fetch(`${url}/v1/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, publicKey: base64UrlEncode(publicKey), name: deviceName.slice(0, 64) }),
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { deviceId: string; plaidEnabled: boolean };
  await setSecret(SecretKeys.deviceSeed, base64UrlEncode(seed));
  const config = { url, deviceId: body.deviceId };
  await setSecret(SecretKeys.relay, JSON.stringify(config));
  return { ...config, plaidEnabled: body.plaidEnabled };
}

export async function forgetRelay(): Promise<void> {
  await deleteSecret(SecretKeys.relay);
  await deleteSecret(SecretKeys.deviceSeed);
}

export async function relayRequest<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const config = await getRelayConfig();
  if (!config) throw new RelayError(0, 'NOT_PAIRED', 'Connect your relay server in Settings first.');
  const raw = body === undefined ? '' : JSON.stringify(body);
  const headers = signRequest(await deviceSeed(), config.deviceId, { method, path, body: raw }, randomBytes(16));
  let res: Response;
  try {
    res = await fetch(`${config.url}${path}`, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: raw || undefined,
    });
  } catch {
    throw new RelayError(0, 'NETWORK', 'Can’t reach your relay server. Is it running and reachable from this phone?');
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export interface RelaySyncResponse {
  added: Transaction[];
  modified: Transaction[];
  removed: string[];
  accounts: Account[];
  nextCursor: string | null;
  hasMore: boolean;
  status?: string;
}

export const relay = {
  me: () => relayRequest<{ deviceId: string; name: string; plaidEnabled: boolean; plaidEnv: string; version: string }>('GET', '/v1/me'),
  linkToken: (itemId?: string) => relayRequest<{ linkToken: string }>('POST', '/v1/link/token', itemId ? { itemId } : {}),
  exchange: (publicToken: string, institutionId?: string, institutionName?: string) =>
    relayRequest<{ itemId: string; institutionName: string }>('POST', '/v1/link/exchange', { publicToken, institutionId, institutionName }),
  items: () => relayRequest<{ items: Array<{ itemId: string; institutionName: string; error: string | null }> }>('GET', '/v1/items'),
  sync: (itemId: string, cursor: string | null) => relayRequest<RelaySyncResponse>('POST', `/v1/items/${encodeURIComponent(itemId)}/sync`, { cursor }),
  removeItem: (itemId: string) => relayRequest<{ ok: true }>('DELETE', `/v1/items/${encodeURIComponent(itemId)}`),
  devices: () =>
    relayRequest<{ devices: Array<{ id: string; name: string; createdAt: number; lastSeenAt: number | null; revoked: boolean; current: boolean }> }>(
      'GET',
      '/v1/devices',
    ),
  revokeDevice: (id: string) => relayRequest<{ ok: true }>('DELETE', `/v1/devices/${encodeURIComponent(id)}`),
};
