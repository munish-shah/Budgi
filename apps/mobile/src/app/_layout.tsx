import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LockScreen } from '@/components/LockScreen';
import { PrivacyShield } from '@/components/PrivacyShield';
import { ToastHost } from '@/components/Toast';
import { useLock } from '@/lib/lock';
import { useStore } from '@/lib/store';
import { syncAll } from '@/lib/sync';
import { useTheme } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const t = useTheme();
  const ready = useStore((s) => s.ready);
  const onboarded = useStore((s) => s.settings.onboarded);
  const lockEnabled = useStore((s) => s.settings.lockEnabled);
  const locked = useLock((s) => s.locked);

  useEffect(() => {
    void useStore
      .getState()
      .init()
      .then(() => {
        // Nothing to protect before onboarding; afterwards respect the setting.
        const { lockEnabled, onboarded } = useStore.getState().settings;
        if (!lockEnabled || !onboarded) useLock.setState({ locked: false });
      })
      .finally(() => SplashScreen.hideAsync());
  }, []);

  // Re-lock after time in the background; refresh data on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const lock = useLock.getState();
      const { settings } = useStore.getState();
      if (state === 'background') lock.setBackgroundedAt(Date.now());
      if (state === 'active') {
        const away = lock.backgroundedAt ? (Date.now() - lock.backgroundedAt) / 1000 : 0;
        lock.setBackgroundedAt(undefined);
        if (settings.lockEnabled && lock.backgroundedAt && away >= settings.lockAfterSeconds) lock.lock();
        else if (away > 120) void syncAll();
      }
    });
    return () => sub.remove();
  }, []);

  // First unlock of the session: kick off a background sync.
  useEffect(() => {
    if (ready && !locked) void syncAll();
  }, [ready, locked]);

  useEffect(() => {
    if (ready && !onboarded && (!locked || !lockEnabled)) router.push('/onboarding');
  }, [ready, onboarded, locked, lockEnabled]);

  const navTheme = t.scheme === 'dark' ? DarkTheme : DefaultTheme;
  const sheet = {
    presentation: 'formSheet' as const,
    sheetGrabberVisible: true,
    sheetCornerRadius: 28,
    headerShown: false,
    contentStyle: { backgroundColor: t.surface },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <ThemeProvider value={{ ...navTheme, colors: { ...navTheme.colors, background: t.bg, card: t.bg, primary: t.accent, text: t.text, border: t.border } }}>
        <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
        {ready && (
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="transaction/[id]" options={{ ...sheet, sheetAllowedDetents: [0.72, 1] }} />
            <Stack.Screen name="budget/[categoryId]" options={{ ...sheet, sheetAllowedDetents: [0.62, 1] }} />
            <Stack.Screen name="rule/[id]" options={{ presentation: 'modal', contentStyle: { backgroundColor: t.bg } }} />
            <Stack.Screen name="review" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
            <Stack.Screen name="pair" options={{ presentation: 'modal' }} />
            <Stack.Screen name="onboarding" options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }} />
          </Stack>
        )}
        <ToastHost />
        {ready && locked && lockEnabled && <LockScreen />}
        <PrivacyShield />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
