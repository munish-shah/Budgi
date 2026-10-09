import type * as PlaidSdk from 'react-native-plaid-link-sdk';

/**
 * Loaded lazily: the Plaid SDK is a native module that Expo Go doesn't
 * include, so importing it eagerly would crash the app on launch there.
 */
function loadPlaid(): typeof PlaidSdk {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-plaid-link-sdk') as typeof PlaidSdk;
  } catch {
    throw new Error('Plaid needs the Budgi development build (it isn’t available in Expo Go). SimpleFIN and demo data work everywhere.');
  }
}

export interface LinkResult {
  publicToken: string;
  institutionId?: string;
  institutionName?: string;
}

/** Open Plaid Link natively. Resolves null if you close it. */
export async function openPlaidLink(linkToken: string): Promise<LinkResult | null> {
  const { createPlaidLinkSession } = loadPlaid();
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
