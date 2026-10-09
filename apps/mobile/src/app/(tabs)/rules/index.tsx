import { describeCondition, ruleMatches, sortRules } from '@budgi/core';
import { router, Stack } from 'expo-router';
import { useMemo } from 'react';
import { Platform, Switch, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@/components/Card';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';
import { useCategories, useTxnList } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { alpha, radius, useTheme } from '@/lib/theme';

const EXAMPLES = [
  { title: 'Venmo from roommates → Rent', detail: 'Merchant contains “venmo” and money in' },
  { title: 'Amazon over $150 → Shopping, review', detail: 'Big purchases always get a second look' },
  { title: 'Work lunches → Excluded', detail: 'Reimbursable spending stays out of budgets' },
];

export default function Rules() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const rules = useStore((s) => s.rules);
  const accounts = useStore((s) => s.accounts);
  const saveRule = useStore((s) => s.saveRule);
  const recategorizeAll = useStore((s) => s.recategorizeAll);
  const txns = useTxnList();
  const { map } = useCategories();
  const sorted = useMemo(() => sortRules(rules), [rules]);
  const counts = useMemo(() => new Map(sorted.map((r) => [r.id, txns.filter((x) => ruleMatches({ ...r, enabled: true }, x)).length])), [sorted, txns]);
  const autoCount = useMemo(() => txns.filter((x) => ['merchant', 'learned', 'provider', 'heuristic'].includes(x.categorySource)).length, [txns]);

  const add = () => router.push({ pathname: '/rule/[id]', params: { id: 'new' } });

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <PressableScale onPress={add} accessibilityLabel="New rule" style={{ padding: 6 }}>
              <Icon name="plus" size={20} color={t.accent} />
            </PressableScale>
          ),
        }}
      />
      <Screen contentContainerStyle={{ paddingTop: Platform.OS === 'ios' ? 4 : insets.top + 12 }}>
        {Platform.OS !== 'ios' && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text variant="largeTitle">Rules</Text>
            <PressableScale onPress={add} style={{ padding: 8 }} accessibilityLabel="New rule">
              <Icon name="plus" size={22} color={t.accent} />
            </PressableScale>
          </View>
        )}

        <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: alpha(t.accent, 0.07), borderColor: alpha(t.accent, 0.2) }}>
          <Icon name="sparkles" size={20} color={t.accent} />
          <Text variant="footnote" tone="secondary" style={{ flex: 1 }}>
            Budgi auto-categorized <Text variant="footnote" weight="700">{autoCount.toLocaleString()}</Text> transactions. Rules run first, top to bottom, and always win over automatic guesses.
          </Text>
        </Card>

        {sorted.length === 0 ? (
          <Animated.View entering={FadeInDown.springify().damping(18)} style={{ marginTop: 20, gap: 10 }}>
            <Text variant="overline" tone="tertiary" style={{ marginLeft: 4 }}>
              Ideas
            </Text>
            {EXAMPLES.map((e) => (
              <Card key={e.title} onPress={add} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Icon name="wand.and.stars" size={18} color={t.textSecondary} />
                <View style={{ flex: 1 }}>
                  <Text variant="callout" weight="600">
                    {e.title}
                  </Text>
                  <Text variant="footnote" tone="secondary">
                    {e.detail}
                  </Text>
                </View>
              </Card>
            ))}
            <PressableScale onPress={add} style={{ marginTop: 8, height: 50, borderRadius: radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="headline" tone="onAccent">
                Create a rule
              </Text>
            </PressableScale>
            <Text variant="footnote" tone="tertiary" align="center">
              Tip: change a category on any transaction and Budgi offers to make a rule for you.
            </Text>
          </Animated.View>
        ) : (
          <View style={{ marginTop: 16, gap: 10 }}>
            {sorted.map((r, i) => {
              const cat = r.actions.categoryId ? map.get(r.actions.categoryId) : undefined;
              const outcomes = [r.actions.rename && `Rename “${r.actions.rename}”`, r.actions.exclude && 'Exclude', r.actions.markReviewed && 'Mark reviewed'].filter(Boolean);
              return (
                <Animated.View key={r.id} layout={LinearTransition.springify().damping(18)} entering={FadeInDown.delay(i * 40).springify().damping(18)}>
                  <Card onPress={() => router.push({ pathname: '/rule/[id]', params: { id: r.id } })} style={{ opacity: r.enabled ? 1 : 0.55 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Text variant="caption" tone="tertiary" numeric style={{ width: 18 }}>
                        {i + 1}
                      </Text>
                      <Text variant="headline" style={{ flex: 1 }} numberOfLines={1}>
                        {r.name || 'Untitled rule'}
                      </Text>
                      <Switch
                        value={r.enabled}
                        onValueChange={(v) => {
                          haptic.select();
                          saveRule({ ...r, enabled: v });
                        }}
                        trackColor={{ true: t.accentStrong, false: undefined }}
                      />
                    </View>
                    <View style={{ marginLeft: 28, marginTop: 6, gap: 3 }}>
                      {r.conditions.map((c, k) => (
                        <Text key={k} variant="footnote" tone="secondary" numberOfLines={1}>
                          {k > 0 ? (r.match === 'all' ? 'and ' : 'or ') : 'If '}
                          {describeCondition(c, (id) => accounts[id]?.name ?? 'account').replace(/^./, (s) => s.toLowerCase())}
                        </Text>
                      ))}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                        <Icon name="arrow.right" size={12} color={t.textTertiary} fallback="→" />
                        {cat && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 10, paddingLeft: 3, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: alpha(cat.color, 0.14) }}>
                            <CategoryIcon category={cat} size={20} />
                            <Text variant="caption" style={{ color: cat.color }}>
                              {cat.name}
                            </Text>
                          </View>
                        )}
                        {outcomes.map((o) => (
                          <Text key={String(o)} variant="caption" tone="secondary">
                            {o}
                          </Text>
                        ))}
                        <Text variant="caption" tone="tertiary" style={{ marginLeft: 'auto' }}>
                          {counts.get(r.id) ?? 0} matches
                        </Text>
                      </View>
                    </View>
                  </Card>
                </Animated.View>
              );
            })}
            <PressableScale
              onPress={() => {
                const n = recategorizeAll();
                haptic.success();
                toast({ title: n ? `Updated ${n} transactions` : 'Everything is up to date', icon: 'arrow.triangle.2.circlepath' });
              }}
              style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border }}>
              <Icon name="arrow.triangle.2.circlepath" size={15} color={t.accent} />
              <Text variant="callout" tone="accent" weight="600">
                Re-apply rules to all transactions
              </Text>
            </PressableScale>
          </View>
        )}
      </Screen>
    </>
  );
}
