import type { LinkResult } from './plaid-link';

export type { LinkResult } from './plaid-link';

/** The web app uses Plaid Hosted Link instead (see startHostedLink in sync.ts). */
export async function openPlaidLink(_linkToken: string): Promise<LinkResult | null> {
  throw new Error('Use Hosted Link on the web.');
}
