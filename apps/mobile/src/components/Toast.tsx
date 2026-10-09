import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import Animated, { FadeOutDown, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { radius, useTheme } from '@/lib/theme';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

interface ToastSpec {
  id: number;
  title: string;
  message?: string;
  icon?: string;
  action?: { label: string; onPress: () => void };
  duration?: number;
}

const useToastStore = create<{ toast?: ToastSpec; show(t: Omit<ToastSpec, 'id'>): void; hide(): void }>((set) => ({
  show: (t) => set({ toast: { ...t, id: Date.now() } }),
  hide: () => set({ toast: undefined }),
}));

export const toast = (t: Omit<ToastSpec, 'id'>) => useToastStore.getState().show(t);

/**
 * Mount once at the root, and again (with `inModal`) inside native sheets —
 * iOS presents sheets above the root view, which would hide the root toast.
 */
export function ToastHost({ inModal = false }: { inModal?: boolean }) {
  const spec = useToastStore((s) => s.toast);
  const hide = useToastStore((s) => s.hide);
  const insets = useSafeAreaInsets();
  const t = useTheme();

  useEffect(() => {
    if (!spec) return;
    const timer = setTimeout(hide, spec.duration ?? (spec.action ? 6000 : 2600));
    return () => clearTimeout(timer);
  }, [spec, hide]);

  if (!spec || (inModal && Platform.OS !== 'ios')) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 70, alignItems: 'center', paddingHorizontal: 16 }}>
      <Animated.View
        key={spec.id}
        entering={SlideInDown.springify().damping(18)}
        exiting={FadeOutDown.duration(180)}
        style={{
          width: '100%',
          maxWidth: 480,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 14,
          borderRadius: radius.lg,
          borderCurve: 'continuous',
          backgroundColor: t.surfaceRaised,
          borderWidth: 1,
          borderColor: t.border,
          shadowColor: '#000',
          shadowOpacity: 0.35,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 10 },
        }}>
        {spec.icon && <Icon name={spec.icon} size={20} color={t.accent} />}
        <View style={{ flex: 1 }}>
          <Text variant="callout" weight="600">
            {spec.title}
          </Text>
          {spec.message && (
            <Text variant="footnote" tone="secondary" numberOfLines={2}>
              {spec.message}
            </Text>
          )}
        </View>
        {spec.action && (
          <PressableScale
            onPress={() => {
              spec.action!.onPress();
              hide();
            }}
            style={{ backgroundColor: t.accent, paddingHorizontal: 14, height: 34, borderRadius: radius.pill, justifyContent: 'center' }}>
            <Text variant="subhead" tone="onAccent" weight="700">
              {spec.action.label}
            </Text>
          </PressableScale>
        )}
      </Animated.View>
    </View>
  );
}
