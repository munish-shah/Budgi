import * as LocalAuthentication from 'expo-local-authentication';

/** Native: Face ID / Touch ID / passcode via LocalAuthentication. */
export const AUTO_PROMPT = true;

export async function canAuthenticate(): Promise<boolean> {
  return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
}

export async function authenticate(reason: string): Promise<boolean> {
  const res = await LocalAuthentication.authenticateAsync({ promptMessage: reason, fallbackLabel: 'Use Passcode', disableDeviceFallback: false });
  return res.success;
}

export async function biometryLabel(): Promise<string> {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID';
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'Touch ID';
  return 'Passcode';
}
