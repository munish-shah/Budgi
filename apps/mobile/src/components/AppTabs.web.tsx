import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, View } from 'react-native';
import { useReviewQueue } from '@/lib/hooks';
import { radius, useTheme } from '@/lib/theme';
import { Text } from './Text';

const TABS = [
  { name: '(home)', href: '/', label: 'Home', glyph: '⌂' },
  { name: 'activity', href: '/activity', label: 'Activity', glyph: '≣' },
  { name: 'budgets', href: '/budgets', label: 'Budgets', glyph: '◔' },
  { name: 'rules', href: '/rules', label: 'Rules', glyph: '✦' },
] as const;

function TabButton({ isFocused, label, glyph, badge, ...props }: TabTriggerSlotProps & { label: string; glyph: string; badge?: number }) {
  const t = useTheme();
  return (
    <Pressable {...props} style={{ flex: 1, alignItems: 'center', paddingVertical: 6, gap: 2 }}>
      <Text style={{ fontSize: 20, color: isFocused ? t.accent : t.textSecondary }}>{glyph}</Text>
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

/** Web preview tab bar (the iOS app uses the native UITabBar). */
export default function AppTabs() {
  const t = useTheme();
  const toReview = useReviewQueue().length;
  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      <TabList asChild>
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 14, flexDirection: 'row', backgroundColor: t.surfaceRaised, borderRadius: radius.xl, borderWidth: 1, borderColor: t.border, paddingVertical: 4, maxWidth: 520, alignSelf: 'center', width: '92%' }}>
          {TABS.map((tab) => (
            <TabTrigger key={tab.name} name={tab.name} href={tab.href} asChild>
              <TabButton label={tab.label} glyph={tab.glyph} badge={tab.name === 'activity' ? toReview : undefined} />
            </TabTrigger>
          ))}
        </View>
      </TabList>
    </Tabs>
  );
}
