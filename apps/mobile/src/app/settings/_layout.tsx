import { Stack, router } from 'expo-router';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { ToastHost } from '@/components/Toast';
import { useTheme } from '@/lib/theme';

export default function SettingsLayout() {
  const t = useTheme();
  return (
    <>
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: t.bg },
        headerStyle: { backgroundColor: t.bg },
        headerShadowVisible: false,
        headerTintColor: t.accent,
        headerTitleStyle: { color: t.text },
        headerLargeTitleStyle: { color: t.text },
      }}>
      <Stack.Screen
        name="index"
        options={{
          title: 'Settings',
          headerLargeTitle: true,
          headerRight: () => (
            <PressableScale onPress={() => router.back()} style={{ padding: 6 }}>
              <Text variant="body" tone="accent" weight="700">
                Done
              </Text>
            </PressableScale>
          ),
        }}
      />
      <Stack.Screen name="connect" options={{ title: 'Accounts' }} />
    </Stack>
    <ToastHost inModal />
    </>
  );
}
