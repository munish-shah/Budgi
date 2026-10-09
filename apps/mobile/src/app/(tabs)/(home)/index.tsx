import { addDays, daysBetween, monthPace, formatMoney, monthLabel, monthlyCost, relativeDayLabel, shortDate, transactionTitle } from '@budgi/core';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@/components/Card';
import { CategoryIcon } from '@/components/CategoryIcon';
import { EmptyState } from '@/components/EmptyState';
import { GlassButton } from '@/components/GlassButton';
import { Icon } from '@/components/Icon';
import { Money, useMoneyText } from '@/components/Money';
import { ProgressBar } from '@/components/ProgressBar';
import { RollingNumber } from '@/components/RollingNumber';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { SpendChart } from '@/components/SpendChart';
import { Text } from '@/components/Text';
import { haptic } from '@/lib/haptics';
import { useAccounts, useCategories, useMonthSummary, useRecurring, useReviewQueue, useToday } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { syncAll } from '@/lib/sync';
import { alpha, radius, useTheme } from '@/lib/theme';

const enter = (i: number) => FadeInDown.delay(60 + i * 55).springify().damping(18).stiffness(160);

export default function Home() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const { current, previous } = useMonthSummary();
  const { map } = useCategories();
  const review = useReviewQueue();
  const recurring = useRecurring();
  const accounts = useAccounts();
  const syncing = useStore((s) => s.syncing);
  const hide = useStore((s) => s.settings.hideAmounts);
  const hasData = useStore((s) => Object.keys(s.txns).length > 0);
  const updateSettings = useStore((s) => s.updateSettings);
  const money = useMoneyText();
  const [scrub, setScrub] = useState<number | null>(null);

  const elapsed = Math.max(1, current.daysElapsed);
  const curSeries = current.cumulative.slice(0, elapsed);
  const prevAtSameDay = previous.cumulative[Math.min(elapsed, previous.cumulative.length) - 1] ?? 0;
  const shownDay = scrub ?? elapsed - 1;
  const shownSpent = curSeries[shownDay] ?? current.spent;
  const prevAtShown = previous.cumulative[Math.min(shownDay, previous.cumulative.length - 1)] ?? 0;
  const diff = shownSpent - (scrub === null ? prevAtSameDay : prevAtShown);

  const pace = monthPace(current, map);
  const fixedBudget = current.byCategory.reduce((s, c) => s + (c.budget && map.get(c.categoryId)?.fixed ? c.budget : 0), 0);
  const topCategories = current.byCategory.filter((c) => c.spent > 0).slice(0, 5);
  const maxCat = Math.max(1, ...topCategories.map((c) => c.spent));
  const upcoming = useMemo(
    () => recurring.filter((r) => r.active && r.nextDate >= today && r.nextDate <= addDays(today, 14)).slice(0, 4),
    [recurring, today],
  );
  const monthlyRecurring = recurring.filter((r) => r.active).reduce((s, r) => s + monthlyCost(r), 0);

  const refresh = async () => {
    haptic.tap();
    const added = await syncAll(true);
    if (added > 0) haptic.success();
  };

  return (
    <Screen refreshing={syncing} onRefresh={refresh} contentContainerStyle={{ paddingTop: Platform.OS === 'ios' ? 6 : insets.top + 12 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <View>
          <Text variant="overline" tone="tertiary">
            {monthLabel(current.month)} {current.month.slice(0, 4)}
          </Text>
          <Text variant="largeTitle">Overview</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <GlassButton
            icon={hide ? 'eye.slash.fill' : 'eye.fill'}
            label={hide ? 'Show amounts' : 'Hide amounts'}
            onPress={() => updateSettings({ hideAmounts: !hide })}
          />
          <GlassButton icon="gearshape.fill" label="Settings" onPress={() => router.push('/settings')} />
        </View>
      </View>

      {!hasData ? (
        <Card>
          <EmptyState
            icon="building.columns.fill"
            title="Connect your first account"
            message="Link a bank through your private relay or SimpleFIN — or explore with demo data."
            action="Add account"
            onAction={() => router.push('/settings/connect')}
          />
        </Card>
      ) : (
        <>
          {/* Hero */}
          <Animated.View entering={FadeIn.duration(400)}>
            <Text variant="subhead" tone="secondary">
              {scrub === null ? `Spent in ${monthLabel(current.month)}` : `Spent through ${shortDate(`${current.month}-${String(shownDay + 1).padStart(2, '0')}`)}`}
            </Text>
            <View style={{ marginTop: 2 }}>
              {hide ? <Text variant="hero">•••••</Text> : <RollingNumber value={formatMoney(shownSpent, { compact: true })} />}
            </View>
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: radius.pill,
                  backgroundColor: alpha(diff <= 0 ? t.positive : t.negative, 0.14),
                }}>
                <Icon name={diff <= 0 ? 'arrow.down' : 'arrow.up'} size={11} color={diff <= 0 ? t.positive : t.negative} />
                <Text variant="footnote" weight="600" numeric style={{ color: diff <= 0 ? t.positive : t.negative }}>
                  {money(Math.abs(diff), { compact: true })} {diff <= 0 ? 'less' : 'more'} than last month
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Chart */}
          <Animated.View entering={enter(1)} style={{ marginTop: 18, marginHorizontal: -4 }}>
            <SpendChart current={curSeries} previous={previous.cumulative} daysInMonth={current.daysTotal} budget={current.budgeted || undefined} budgetStart={fixedBudget} onScrub={setScrub} />
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 8, paddingHorizontal: 4 }}>
              <Legend color={t.accent} label="This month" />
              <Legend color={t.chartPrev} label="Last month" dashed />
              {current.budgeted > 0 && <Legend color={t.warning} label="Budget pace" dashed />}
            </View>
          </Animated.View>

          {/* Budget pace */}
          <Animated.View entering={enter(2)}>
            {pace ? (
              <Card style={{ marginTop: 20 }} onPress={() => router.push('/budgets')}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
                  <View>
                    <Text variant="footnote" tone="secondary">
                      {pace.remaining >= 0 ? 'Left to spend' : 'Over budget'}
                    </Text>
                    <Money cents={Math.abs(pace.remaining)} options={{ compact: true }} variant="title" tone={pace.remaining >= 0 ? 'primary' : 'negative'} />
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="footnote" tone="secondary">
                      Flexible / day
                    </Text>
                    <Money cents={pace.perDayLeft} options={{ compact: true }} variant="headline" />
                  </View>
                </View>
                <ProgressBar
                  progress={pace.progress}
                  marker={pace.expectedProgress}
                  color={pace.status === 'exceeded' || pace.status === 'over' ? t.negative : pace.status === 'onTrack' ? t.warning : t.accent}
                />
                <Text variant="caption" tone="tertiary" style={{ marginTop: 8 }}>
                  {money(current.budgetedSpent, { compact: true })} of {money(current.budgeted, { compact: true })} ·{' '}
                  {pace.status === 'under' ? 'Comfortably under pace' : pace.status === 'onTrack' ? 'On pace' : pace.status === 'over' ? 'Ahead of pace — ease up' : 'Budget exceeded'}
                </Text>
              </Card>
            ) : (
              <Card style={{ marginTop: 20 }} onPress={() => router.push('/budgets')}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Icon name="chart.pie.fill" size={22} color={t.accent} />
                  <View style={{ flex: 1 }}>
                    <Text variant="headline">Set a monthly budget</Text>
                    <Text variant="footnote" tone="secondary">
                      Budgi suggests amounts from your history.
                    </Text>
                  </View>
                  <Icon name="chevron.right" size={13} color={t.textTertiary} />
                </View>
              </Card>
            )}
          </Animated.View>

          {/* Review inbox */}
          {review.length > 0 && (
            <Animated.View entering={enter(3)}>
              <Card style={{ marginTop: 12, backgroundColor: alpha(t.accent, 0.08), borderColor: alpha(t.accent, 0.25) }} onPress={() => router.push('/review')}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ flexDirection: 'row' }}>
                    {[...new Set(review.map((r) => r.categoryId))].slice(0, 3).map((cid, i) => (
                      <View key={cid} style={{ marginLeft: i ? -12 : 0, borderRadius: 14, borderWidth: 2, borderColor: t.surface, backgroundColor: t.surface }}>
                        <CategoryIcon category={map.get(cid)} size={32} />
                      </View>
                    ))}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="headline">
                      {review.length} to review
                    </Text>
                    <Text variant="footnote" tone="secondary" numberOfLines={1}>
                      Swipe through Budgi’s guesses in seconds
                    </Text>
                  </View>
                  <Icon name="chevron.right" size={13} color={t.accent} />
                </View>
              </Card>
            </Animated.View>
          )}

          {/* Top categories */}
          {topCategories.length > 0 && (
            <Animated.View entering={enter(4)}>
              <SectionHeader title="Where it went" action="Budgets" onAction={() => router.push('/budgets')} />
              <Card padded={false}>
                {topCategories.map((c, i) => {
                  const cat = map.get(c.categoryId);
                  return (
                    <PressRow key={c.categoryId} onPress={() => router.push({ pathname: '/budget/[categoryId]', params: { categoryId: c.categoryId } })} first={i === 0}>
                      <CategoryIcon category={cat} size={36} />
                      <View style={{ flex: 1, gap: 7 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text variant="callout">{cat?.name ?? 'Other'}</Text>
                          <Money cents={c.spent} options={{ compact: true }} variant="callout" weight="600" />
                        </View>
                        <ProgressBar progress={c.spent / maxCat} color={cat?.color ?? t.accent} height={5} delay={i * 70} />
                      </View>
                    </PressRow>
                  );
                })}
              </Card>
            </Animated.View>
          )}

          {/* Upcoming */}
          {upcoming.length > 0 && (
            <Animated.View entering={enter(5)}>
              <SectionHeader title="Coming up" action={`${money(monthlyRecurring, { compact: true })}/mo`} onAction={() => router.push('/budgets')} />
              <Card padded={false}>
                {upcoming.map((r, i) => {
                  const days = daysBetween(today, r.nextDate);
                  return (
                    <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: t.separator }}>
                      <CategoryIcon category={map.get(r.categoryId)} size={36} />
                      <View style={{ flex: 1 }}>
                        <Text variant="callout">{r.name}</Text>
                        <Text variant="footnote" tone="secondary">
                          {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`} · {r.cadence}
                        </Text>
                      </View>
                      <Money cents={r.amount} variant="callout" weight="600" />
                    </View>
                  );
                })}
              </Card>
            </Animated.View>
          )}

          {/* Accounts */}
          <Animated.View entering={enter(6)}>
            <SectionHeader title="Accounts" action="Manage" onAction={() => router.push('/settings/connect')} />
            <Card padded={false}>
              <View style={{ padding: 16, paddingBottom: 10 }}>
                <Text variant="footnote" tone="secondary">
                  Net worth
                </Text>
                <Money cents={accounts.netWorth} options={{ compact: true }} variant="title" />
              </View>
              {accounts.list.map((a) => (
                <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.separator }}>
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.surfacePressed, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={a.type === 'credit' ? 'creditcard.fill' : a.type === 'investment' ? 'chart.line.uptrend.xyaxis' : 'building.columns.fill'} size={15} color={t.textSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="callout" numberOfLines={1}>
                      {a.name}
                    </Text>
                    <Text variant="footnote" tone="secondary" numberOfLines={1}>
                      {[a.institution, a.mask && `••${a.mask}`].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Money cents={a.type === 'credit' || a.type === 'loan' ? -a.balance : a.balance} variant="callout" weight="600" />
                </View>
              ))}
            </Card>
          </Animated.View>

          <RecentStrip />
        </>
      )}
    </Screen>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: dashed ? 'transparent' : color, borderWidth: dashed ? 1 : 0, borderColor: color, borderStyle: 'dashed' }} />
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
    </View>
  );
}

function PressRow({ children, onPress, first }: { children: React.ReactNode; onPress: () => void; first: boolean }) {
  const t = useTheme();
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderTopColor: t.separator }}>
      <Card onPress={onPress} padded={false} style={{ borderWidth: 0, borderRadius: 0, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
        {children}
      </Card>
    </View>
  );
}

function RecentStrip() {
  const txns = useStore((s) => s.txns);
  const { map } = useCategories();
  const today = useToday();
  const recent = useMemo(() => Object.values(txns).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4), [txns]);
  if (!recent.length) return null;
  return (
    <>
      <SectionHeader title="Recent" action="All activity" onAction={() => router.push('/activity')} />
      <Card padded={false}>
        {recent.map((r, i) => (
          <PressRow key={r.id} first={i === 0} onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: r.id } })}>
            <CategoryIcon category={map.get(r.categoryId)} size={36} />
            <View style={{ flex: 1 }}>
              <Text variant="callout" numberOfLines={1}>
                {transactionTitle(r)}
              </Text>
              <Text variant="footnote" tone="secondary">
                {relativeDayLabel(r.date, today)}
                {r.pending ? ' · Pending' : ''}
              </Text>
            </View>
            <Money cents={r.amount} options={{ abs: r.amount < 0, signed: r.amount > 0 }} colorize variant="callout" weight="600" />
          </PressRow>
        ))}
      </Card>
    </>
  );
}
