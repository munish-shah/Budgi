import { Stack } from 'expo-router';
import { useTheme } from '@/lib/theme';

export default function HomeStack() {
  const t = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />;
}
