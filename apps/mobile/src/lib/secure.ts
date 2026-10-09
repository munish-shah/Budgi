import * as SecureStore from 'expo-secure-store';

/**
 * Secrets live in the iOS Keychain with WHEN_UNLOCKED_THIS_DEVICE_ONLY:
 * readable only while the phone is unlocked, never included in iCloud or
 * device-to-device backups, never synced to another device.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const SecretKeys = {
  dbKey: 'budgi.db-key.v1',
  deviceSeed: 'budgi.device-seed.v1',
  relay: 'budgi.relay.v1',
  simplefin: (connectionId: string) => `budgi.simplefin.${connectionId}`,
} as const;

export async function getSecret(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key, OPTIONS);
}

export async function setSecret(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, OPTIONS);
}

export async function deleteSecret(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, OPTIONS);
}
