import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useReviewQueue } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

/** Native UITabBar — Liquid Glass on iOS 26, minimizes as you scroll. */
export default function AppTabs() {
  const t = useTheme();
  const toReview = useReviewQueue().length;
  return (
    <NativeTabs tintColor={t.accent} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="activity">
        <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'list.bullet.rectangle', selected: 'list.bullet.rectangle.fill' }} />
        <NativeTabs.Trigger.Badge hidden={toReview === 0}>{String(Math.min(toReview, 99))}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="budgets">
        <NativeTabs.Trigger.Label>Budgets</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'chart.pie', selected: 'chart.pie.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="rules">
        <NativeTabs.Trigger.Label>Rules</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'wand.and.stars', selected: 'wand.and.stars' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
