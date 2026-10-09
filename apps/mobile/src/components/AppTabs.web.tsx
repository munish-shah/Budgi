import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, View } from 'react-native';
import { useReviewQueue } from '@/lib/hooks';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { alpha, radius, useTheme } from '@/lib/theme';
import { Icon } from './Icon';
import { Text } from './Text';

const TABS = [
  { name: '(home)', href: '/', label: 'Home', icon: 'house.fill' },
  { name: 'activity', href: '/activity', label: 'Activity', icon: 'list.bullet.rectangle' },
  { name: 'budgets', href: '/budgets', label: 'Budgets', icon: 'chart.pie.fill' },
  { name: 'rules', href: '/rules', label: 'Rules', icon: 'wand.and.stars' },
] as const;

function TabButton({ isFocused, label, icon, badge, ...props }: TabTriggerSlotProps & { label: string; icon: string; badge?: number }) {
  const t = useTheme();
  return (
    <Pressable {...props} style={{ flex: 1, alignItems: 'center', paddingVertical: 6, gap: 2 }}>
      <Icon name={icon} size={24} color={isFocused ? t.accent : t.textSecondary} />
      <Text variant="caption" style={{ color: isFocused ? t.accent : t.textSecondary, fontSize: 10 }}>
        {label}
      </Text>
      {!!badge && (
        <View style={{ position: 'absolute', top: 2, left: '56%', minWidth: 17, height: 17, borderRadius: 9, backgroundColor: t.negative, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Web/PWA tab bar (the native iOS build uses UITabBar). Sits above the home indicator. */
export default function AppTabs() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const toReview = useReviewQueue().length;
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      <TabList asChild>
        <View
          style={{
            position: 'absolute',
            bottom: Math.max(insets.bottom - 6, 12),
            flexDirection: 'row',
            backgroundColor: alpha(t.surfaceRaised, 0.78),
            // Frosted glass, like the iOS tab bar.
            ...({ backdropFilter: 'saturate(180%) blur(20px)', WebkitBackdropFilter: 'saturate(180%) blur(20px)' } as object),
            borderRadius: radius.xl,
            borderWidth: 1,
            borderColor: t.border,
            paddingVertical: 4,
            maxWidth: 520,
            alignSelf: 'center',
            width: '92%',
          }}>
          {TABS.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
              <TabButton label={tab.label} icon={tab.icon} badge={tab.name === 'activity' ? toReview : undefined} />
            </TabTrigger>
          ))}
        </View>
      </TabList>
    </Tabs>
  );
}
