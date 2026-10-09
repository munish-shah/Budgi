import { getPlain, setPlain } from './web-vault';

/**
 * Web/PWA: Face ID through a device-bound passkey (WebAuthn platform
 * authenticator with user verification). The passkey never leaves the
 * device's Secure Enclave; we only check that iOS verified you.
 * Browsers require a tap to start WebAuthn, so there's no auto-prompt.
 */
export const AUTO_PROMPT = false;
const CREDENTIAL_KEY = 'passkey-credential-id';

function random(n: number) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function canAuthenticate(): Promise<boolean> {
  try {
    return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

/** Authenticator data flag bit 2 = user verified (Face ID / passcode actually checked). */
function userVerified(authData: ArrayBuffer): boolean {
  const flags = new Uint8Array(authData)[32] ?? 0;
  return (flags & 0x04) !== 0;
}

async function register(): Promise<boolean> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Budgi', id: location.hostname },
      user: { id: random(16), name: 'Budgi', displayName: 'Budgi app lock' },
      challenge: random(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) return false;
  await setPlain(CREDENTIAL_KEY, new Uint8Array(cred.rawId));
  return true;
}

export async function authenticate(_reason: string): Promise<boolean> {
  try {
    const id = await getPlain<Uint8Array<ArrayBuffer>>(CREDENTIAL_KEY);
    // First unlock on this device creates the passkey (which itself requires Face ID).
    if (!id) return await register();
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    const response = assertion?.response as AuthenticatorAssertionResponse | undefined;
    return !!response && userVerified(response.authenticatorData);
  } catch {
    return false;
  }
}

export async function biometryLabel(): Promise<string> {
  return /iPhone|iPad/.test(navigator.userAgent) ? 'Face ID' : /Mac/.test(navigator.userAgent) ? 'Touch ID' : 'Passkey';
}
