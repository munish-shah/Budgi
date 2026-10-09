import type { LinkResult } from './plaid-link';

export type { LinkResult } from './plaid-link';

export async function openPlaidLink(_linkToken: string): Promise<LinkResult | null> {
  throw new Error('Connecting banks is available in the iOS app.');
}
