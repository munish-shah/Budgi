import { addMonths, budgetPace, monthKey, monthLabel, monthlyCost, monthPace, type PaceStatus } from '@budgi/core';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@/components/Card';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Icon } from '@/components/Icon';
import { Money, useMoneyText } from '@/components/Money';
import { PressableScale } from '@/components/PressableScale';
import { ProgressBar } from '@/components/ProgressBar';
import { Ring } from '@/components/Ring';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { budgetSuggestions } from '@/lib/budget-suggestions';
import { haptic } from '@/lib/haptics';
import { useCategories, useMonthSummary, useRecurring, useToday, useTxnList } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { alpha, fonts, radius, useTheme, type Theme } from '@/lib/theme';

const statusColor = (s: PaceStatus, t: Theme) => (s === 'exceeded' || s === 'over' ? t.negative : s === 'onTrack' ? t.warning : t.accent);

export default function Budgets() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const [month, setMonth] = useState(monthKey(today));
  const { current } = useMonthSummary(month);
  const { map } = useCategories();
  const txns = useTxnList();
  const recurring = useRecurring();
  const setBudget = useStore((s) => s.setBudget);
  const money = useMoneyText();
  const isCurrent = month === monthKey(today);

  const budgeted = current.byCategory.filter((c) => c.budget);
  const unbudgeted = current.byCategory.filter((c) => !c.budget && c.spent > 0 && c.categoryId !== 'uncategorized');
  const suggestions = useMemo(() => budgetSuggestions(txns, map, today), [txns, map, today]);
  const pace = monthPace(current, map);
  const subs = recurring.filter((r) => r.active);
  const subsTotal = subs.reduce((s, r) => s + monthlyCost(r), 0);

  const applySuggestions = () => {
    let n = 0;
    for (const [id, cents] of suggestions) {
      if (!map.get(id)?.budget) {
        setBudget(id, cents);
        n++;
      }
    }
    haptic.success();
    toast({ title: `Created ${n} budgets`, message: 'Based on your last three months. Tap any to adjust.', icon: 'sparkles' });
  };

  return (
    <Screen contentContainerStyle={{ paddingTop: Platform.OS === 'ios' ? 0 : insets.top + 12 }}>
      {Platform.OS !== 'ios' && <Text variant="largeTitle">Budgets</Text>}
      {/* Month switcher */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <PressableScale onPress={() => setMonth(addMonths(month, -1))} style={{ padding: 10 }} accessibilityLabel="Previous month">
          <Icon name="chevron.left" size={16} color={t.textSecondary} />
        </PressableScale>
        <Text variant="headline">
          {monthLabel(month)} {month.slice(0, 4)}
        </Text>
        <PressableScale onPress={() => !isCurrent && setMonth(addMonths(month, 1))} style={{ padding: 10, opacity: isCurrent ? 0.3 : 1 }} accessibilityLabel="Next month">
          <Icon name="chevron.right" size={16} color={t.textSecondary} />
        </PressableScale>
      </View>

      {pace ? (
        <Animated.View entering={FadeInDown.springify().damping(18)}>
          <Card style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 20 }}>
            <Ring progress={pace.progress} size={118} stroke={12} color={statusColor(pace.status, t)}>
              <Text variant="title" numeric style={{ fontFamily: fonts.rounded }}>
                {Math.round(pace.progress * 100)}%
              </Text>
              <Text variant="caption" tone="secondary">
                used
              </Text>
            </Ring>
            <View style={{ flex: 1, gap: 10 }}>
              <Stat label="Spent" value={money(current.budgetedSpent, { compact: true })} />
              <Stat label="Budget" value={money(current.budgeted, { compact: true })} />
              {isCurrent && <Stat label={pace.remaining >= 0 ? 'Flexible / day' : 'Over by'} value={money(pace.remaining >= 0 ? pace.perDayLeft : -pace.remaining, { compact: true })} tone={pace.remaining < 0 ? 'negative' : 'accent'} />}
            </View>
          </Card>
        </Animated.View>
      ) : (
        <Animated.View entering={FadeInDown.springify().damping(18)}>
          <Card style={{ marginTop: 10, gap: 12, backgroundColor: alpha(t.accent, 0.08), borderColor: alpha(t.accent, 0.25) }}>
            <Icon name="sparkles" size={24} color={t.accent} />
            <Text variant="title3">Budgets in one tap</Text>
            <Text variant="footnote" tone="secondary">
              Budgi looks at your last three months and suggests a realistic limit for each category. You can tweak any of them.
            </Text>
            <PressableScale
              onPress={applySuggestions}
              disabled={suggestions.size === 0}
              style={{ alignSelf: 'flex-start', backgroundColor: t.accent, paddingHorizontal: 18, height: 42, borderRadius: radius.pill, justifyContent: 'center', opacity: suggestions.size ? 1 : 0.4 }}>
              <Text variant="callout" tone="onAccent" weight="700">
                {suggestions.size ? `Suggest ${suggestions.size} budgets` : 'Not enough history yet'}
              </Text>
            </PressableScale>
          </Card>
        </Animated.View>
      )}

      {budgeted.length > 0 && <SectionHeader title="Budgets" />}
      {budgeted.map((c, i) => {
        const cat = map.get(c.categoryId);
        const p = budgetPace(Math.max(0, c.spent), c.budget!, current.daysElapsed, current.daysTotal, cat?.fixed);
        return (
          <Animated.View key={c.categoryId} entering={FadeInDown.delay(i * 45).springify().damping(18)}>
            <Card style={{ marginBottom: 10 }} onPress={() => router.push({ pathname: '/budget/[categoryId]', params: { categoryId: c.categoryId, month } })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <CategoryIcon category={cat} size={36} />
                <View style={{ flex: 1 }}>
                  <Text variant="callout" weight="600">
                    {cat?.name}
                  </Text>
                  <Text variant="footnote" tone="secondary" numeric>
                    {money(Math.max(0, c.spent), { compact: true })} of {money(c.budget!, { compact: true })}
                    {cat?.fixed ? ' · fixed' : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Money cents={Math.abs(p.remaining)} options={{ compact: true }} variant="callout" weight="600" style={{ color: p.remaining < 0 ? t.negative : t.text }} />
                  <Text variant="caption" tone="tertiary">
                    {p.remaining < 0 ? 'over' : 'left'}
                  </Text>
                </View>
              </View>
              <ProgressBar progress={p.progress} marker={isCurrent && !cat?.fixed ? p.timeProgress : undefined} color={statusColor(p.status, t)} delay={i * 45} />
            </Card>
          </Animated.View>
        );
      })}

      {unbudgeted.length > 0 && <SectionHeader title={budgeted.length ? 'Not budgeted' : 'Spending'} />}
      {unbudgeted.length > 0 && (
        <Card padded={false}>
          {unbudgeted.map((c, i) => {
            const cat = map.get(c.categoryId);
            const suggestion = suggestions.get(c.categoryId);
            return (
              <View key={c.categoryId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: t.separator }}>
                <CategoryIcon category={cat} size={34} />
                <PressableScale style={{ flex: 1 }} hapticOnPress={false} onPress={() => router.push({ pathname: '/budget/[categoryId]', params: { categoryId: c.categoryId, month } })}>
                  <Text variant="callout">{cat?.name}</Text>
                  <Money cents={c.spent} options={{ compact: true }} variant="footnote" tone="secondary" />
                </PressableScale>
                {suggestion ? (
                  <PressableScale
                    onPress={() => {
                      setBudget(c.categoryId, suggestion);
                      haptic.success();
                    }}
                    style={{ paddingHorizontal: 12, height: 32, borderRadius: radius.pill, backgroundColor: alpha(t.accent, 0.14), justifyContent: 'center' }}>
                    <Text variant="footnote" tone="accent" weight="700" numeric>
                      + {money(suggestion, { compact: true })}
                    </Text>
                  </PressableScale>
                ) : null}
              </View>
            );
          })}
        </Card>
      )}

      {subs.length > 0 && (
        <>
          <SectionHeader title="Subscriptions & bills" />
          <Card padded={false}>
            <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <View>
                <Text variant="footnote" tone="secondary">
                  Every month
                </Text>
                <Money cents={subsTotal} options={{ compact: true }} variant="title" />
              </View>
              <Text variant="footnote" tone="tertiary">
                {subs.length} detected
              </Text>
            </View>
            {subs.map((r) => (
              <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.separator }}>
                <CategoryIcon category={map.get(r.categoryId)} size={32} />
                <View style={{ flex: 1 }}>
                  <Text variant="callout">{r.name}</Text>
                  <Text variant="footnote" tone="secondary">
                    {r.cadence} · next {new Date(`${r.nextDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
                <Money cents={r.amount} variant="callout" weight="600" />
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'accent' | 'negative' }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant="subhead" tone="secondary">
        {label}
      </Text>
      <Text variant="headline" numeric tone={tone}>
        {value}
      </Text>
    </View>
  );
}
