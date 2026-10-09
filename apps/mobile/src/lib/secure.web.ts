import { get, putMany, remove } from './web-vault';

/**
 * Web/PWA secrets: encrypted in IndexedDB under a non-extractable key
 * (the closest browser equivalent to the iOS Keychain).
 */
export const SecretKeys = {
  dbKey: 'budgi.db-key.v1',
  deviceSeed: 'budgi.device-seed.v1',
  relay: 'budgi.relay.v1',
  simplefin: (connectionId: string) => `budgi.simplefin.${connectionId}`,
} as const;

export async function getSecret(key: string): Promise<string | null> {
  return get<string>('secrets', key);
}
export async function setSecret(key: string, value: string): Promise<void> {
  await putMany('secrets', [[key, value]]);
}
export async function deleteSecret(key: string): Promise<void> {
  await remove('secrets', key);
}
