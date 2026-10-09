import { create } from 'zustand';
import { authenticate, AUTO_PROMPT, biometryLabel, canAuthenticate } from './biometric';

export { biometryLabel };
/** Whether the lock screen should prompt automatically (browsers need a tap). */
export const LOCK_AUTO_PROMPT = AUTO_PROMPT;

interface LockState {
  locked: boolean;
  authenticating: boolean;
  /** Why unlock can't be enforced (no passcode/passkey support), if applicable. */
  warning?: string;
  backgroundedAt?: number;
  unlock(): Promise<boolean>;
  /** Re-verify the owner (e.g. before turning App Lock off) without locking the UI. */
  verify(reason: string): Promise<boolean>;
  lock(): void;
  setBackgroundedAt(t: number | undefined): void;
}

export const useLock = create<LockState>((set, get) => ({
  locked: true,
  authenticating: false,
  async unlock() {
    if (get().authenticating) return false;
    set({ authenticating: true });
    try {
      if (!(await canAuthenticate())) {
        // Nothing on this device to verify against.
        set({ locked: false, warning: 'Set a device passcode (and Face ID) to enable App Lock.' });
        return true;
      }
      const ok = await authenticate('Unlock Budgi');
      if (ok) set({ locked: false, warning: undefined });
      return ok;
    } finally {
      set({ authenticating: false });
    }
  },
  async verify(reason) {
    if (!(await canAuthenticate())) return true;
    return authenticate(reason);
  },
  lock() {
    set({ locked: true });
  },
  setBackgroundedAt(t) {
    set({ backgroundedAt: t });
  },
}));
