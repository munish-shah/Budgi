/**
 * Web build is a design preview only (demo data). There is no secure enclave
 * in a browser, so secrets are held in memory and never persisted.
 */
const memory = new Map<string, string>();

export const SecretKeys = {
  dbKey: 'budgi.db-key.v1',
  deviceSeed: 'budgi.device-seed.v1',
  relay: 'budgi.relay.v1',
  simplefin: (connectionId: string) => `budgi.simplefin.${connectionId}`,
} as const;

export async function getSecret(key: string): Promise<string | null> {
  return memory.get(key) ?? null;
}
export async function setSecret(key: string, value: string): Promise<void> {
  memory.set(key, value);
}
export async function deleteSecret(key: string): Promise<void> {
  memory.delete(key);
}
