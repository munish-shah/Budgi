import { createPlaidLinkSession } from 'react-native-plaid-link-sdk';

export interface LinkResult {
  publicToken: string;
  institutionId?: string;
  institutionName?: string;
}

/** Open Plaid Link natively. Resolves null if you close it. */
export async function openPlaidLink(linkToken: string): Promise<LinkResult | null> {
  return new Promise((resolve, reject) => {
    createPlaidLinkSession({
      token: linkToken,
      onSuccess: (success) =>
        resolve({
          publicToken: success.publicToken,
          institutionId: success.metadata?.institution?.id,
          institutionName: success.metadata?.institution?.name,
        }),
      // Link analytics events are intentionally ignored (nothing is logged).
      onEvent: () => {},
      onExit: (exit) => {
        if (exit.error?.displayMessage || exit.error?.errorMessage) {
          reject(new Error(exit.error.displayMessage || exit.error.errorMessage));
        } else resolve(null);
      },
    })
      .then((session) => session.open())
      .catch(reject);
  });
}
