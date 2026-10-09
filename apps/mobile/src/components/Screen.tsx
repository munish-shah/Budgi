import type { ReactNode } from 'react';
import { Platform, RefreshControl, ScrollView, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

/** Scroll container that cooperates with native large titles and the tab bar. */
export function Screen({ children, refreshing, onRefresh, padded = true, contentContainerStyle, ...rest }: ScrollViewProps & { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; padded?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={[
        { paddingHorizontal: padded ? 16 : 0, paddingBottom: 40 + (Platform.OS === 'web' ? 80 : insets.bottom) },
        contentContainerStyle,
      ]}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.accent} /> : undefined}
      {...rest}>
      {children}
    </ScrollView>
  );
}
