import { decodeSetupToken, parseAccessUrl, simplefinAccountsUrl, simplefinErrors, type SimpleFinAccountSet } from '@budgi/core';
import { newId } from './random';
import { deleteSecret, getSecret, SecretKeys, setSecret } from './secure';

/**
 * SimpleFIN runs entirely on-device: the phone talks to the SimpleFIN Bridge
 * directly over HTTPS with credentials kept in the Keychain. No relay needed.
 */
export async function claimSimpleFin(setupToken: string): Promise<string> {
  const claimUrl = decodeSetupToken(setupToken);
  const res = await fetch(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' } });
  if (res.status === 403) throw new Error('This setup token was already used or has expired. Create a new one in SimpleFIN Bridge.');
  if (!res.ok) throw new Error(`SimpleFIN claim failed (${res.status}).`);
  const accessUrl = (await res.text()).trim();
  parseAccessUrl(accessUrl); // validates https + credentials
  const connectionId = newId('sf_');
  await setSecret(SecretKeys.simplefin(connectionId), accessUrl);
  return connectionId;
}

export async function fetchSimpleFin(connectionId: string, start: Date): Promise<SimpleFinAccountSet & { messages: string[] }> {
  const accessUrl = await getSecret(SecretKeys.simplefin(connectionId));
  if (!accessUrl) throw new Error('SimpleFIN credentials are missing on this device. Reconnect it in Settings.');
  const { baseUrl, authorization } = parseAccessUrl(accessUrl);
  const res = await fetch(simplefinAccountsUrl(baseUrl, start), { headers: { Authorization: authorization, Accept: 'application/json' } });
  if (res.status === 403) throw new Error('SimpleFIN access was revoked. Reconnect it in Settings.');
  if (res.status === 402) throw new Error('Your SimpleFIN Bridge subscription needs attention.');
  if (!res.ok) throw new Error(`SimpleFIN error (${res.status}).`);
  const set = (await res.json()) as SimpleFinAccountSet;
  return { ...set, accounts: set.accounts ?? [], messages: simplefinErrors(set) };
}

export async function forgetSimpleFin(connectionId: string): Promise<void> {
  await deleteSecret(SecretKeys.simplefin(connectionId));
}
