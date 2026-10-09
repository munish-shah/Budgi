import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import { create } from 'zustand';

interface LockState {
  locked: boolean;
  authenticating: boolean;
  /** Why unlock can't be enforced (no passcode set), if applicable. */
  warning?: string;
  backgroundedAt?: number;
  unlock(): Promise<boolean>;
  /** Re-verify the owner (e.g. before turning App Lock off) without locking the UI. */
  verify(reason: string): Promise<boolean>;
  lock(): void;
  setBackgroundedAt(t: number | undefined): void;
}

export const useLock = create<LockState>((set, get) => ({
  locked: Platform.OS !== 'web',
  authenticating: false,
  async unlock() {
    if (get().authenticating) return false;
    set({ authenticating: true });
    try {
      const level = await LocalAuthentication.getEnrolledLevelAsync();
      if (level === LocalAuthentication.SecurityLevel.NONE) {
        // No passcode or biometrics on this device — nothing to verify against.
        set({ locked: false, warning: 'Set a device passcode to enable App Lock.' });
        return true;
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Budgi',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      });
      if (res.success) set({ locked: false, warning: undefined });
      return res.success;
    } finally {
      set({ authenticating: false });
    }
  },
  async verify(reason) {
    if (Platform.OS === 'web') return true;
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return true;
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: reason, disableDeviceFallback: false });
    return res.success;
  },
  lock() {
    if (Platform.OS !== 'web') set({ locked: true });
  },
  setBackgroundedAt(t) {
    set({ backgroundedAt: t });
  },
}));

export async function biometryLabel(): Promise<string> {
  if (Platform.OS === 'web') return 'Passcode';
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID';
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'Touch ID';
  return 'Passcode';
}
