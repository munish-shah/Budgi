import { simplefinErrors, type SimpleFinAccountSet } from '@budgi/core';
import { relay } from './relay';

/**
 * Web/PWA: browsers can't call SimpleFIN directly (no CORS), so the claim and
 * fetches go through your relay, which keeps the access URL encrypted and
 * passes account data straight through without storing it.
 */
export async function claimSimpleFin(setupToken: string): Promise<string> {
  return (await relay.simplefinClaim(setupToken.trim())).connectionId;
}

export async function fetchSimpleFin(connectionId: string, start: Date): Promise<SimpleFinAccountSet & { messages: string[] }> {
  const set = await relay.simplefinAccounts(connectionId, start);
  return { ...set, accounts: set.accounts ?? [], messages: simplefinErrors(set) };
}

export async function forgetSimpleFin(connectionId: string): Promise<void> {
  await relay.simplefinRemove(connectionId).catch(() => undefined);
}
