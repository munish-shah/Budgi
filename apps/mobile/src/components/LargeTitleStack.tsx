import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { useTheme } from '@/lib/theme';

/** Native stack with an iOS large, collapsing, translucent title. */
export function LargeTitleStack({ title }: { title: string }) {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: t.bg },
        headerLargeTitle: true,
        headerTransparent: Platform.OS === 'ios',
        headerBlurEffect: t.scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight',
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerLargeStyle: { backgroundColor: 'transparent' },
        headerStyle: Platform.OS === 'ios' ? undefined : { backgroundColor: t.bg },
        headerTitleStyle: { color: t.text },
        headerLargeTitleStyle: { color: t.text },
        headerTintColor: t.accent,
        title,
        // Web/Android preview draws its own titles; iOS gets the native large title.
        headerShown: Platform.OS === 'ios',
      }}
    />
  );
}
