import { addMonths, formatMoney, monthKey, monthLabel, summarizeMonth, toCents, transactionTitle, relativeDayLabel } from '@budgi/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Money, useMoneyText } from '@/components/Money';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { budgetSuggestions } from '@/lib/budget-suggestions';
import { haptic } from '@/lib/haptics';
import { useCategories, useToday, useTxnList } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';

export default function BudgetSheet() {
  const t = useTheme();
  const { categoryId, month: monthParam } = useLocalSearchParams<{ categoryId: string; month?: string }>();
  const today = useToday();
  const month = monthParam ?? monthKey(today);
  const { map } = useCategories();
  const category = map.get(categoryId);
  const txns = useTxnList();
  const setBudget = useStore((s) => s.setBudget);
  const money = useMoneyText();
  const [text, setText] = useState(category?.budget ? String(category.budget / 100) : '');

  const history = useMemo(
    () =>
      [5, 4, 3, 2, 1, 0].map((n) => {
        const m = addMonths(month, -n);
        const s = summarizeMonth(txns, m, map, today);
        return { month: m, spent: Math.max(0, s.byCategory.find((c) => c.categoryId === categoryId)?.spent ?? 0) };
      }),
    [txns, map, month, today, categoryId],
  );
  const suggestion = useMemo(() => budgetSuggestions(txns, map, today).get(categoryId), [txns, map, today, categoryId]);
  const monthTxns = useMemo(() => txns.filter((x) => x.categoryId === categoryId && x.date.startsWith(month)), [txns, categoryId, month]);
  const maxBar = Math.max(1, ...history.map((h) => h.spent), category?.budget ?? 0);

  if (!category) return null;

  const save = (value?: string) => {
    const v = (value ?? text).trim();
    let cents: number | undefined;
    try {
      cents = v ? toCents(v) : undefined;
    } catch {
      return;
    }
    setBudget(category.id, cents);
    haptic.success();
    router.back();
  };

  return (
    <ScrollView style={{ backgroundColor: t.surface }} contentContainerStyle={{ padding: 20, paddingTop: 28, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <CategoryIcon category={category} size={50} />
        <View style={{ flex: 1 }}>
          <Text variant="title3">{category.name}</Text>
          <Text variant="footnote" tone="secondary">
            {money(history[history.length - 1]!.spent, { compact: true })} spent in {monthLabel(month)}
          </Text>
        </View>
      </View>

      {/* 6-month history */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 10, marginTop: 24 }}>
        {history.map((h, i) => {
          const last = i === history.length - 1;
          return (
            <View key={h.month} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
              <Animated.View
                entering={FadeInUp.delay(i * 50).springify().damping(16)}
                style={{ width: '100%', height: Math.max(4, (h.spent / maxBar) * 92), borderRadius: 6, backgroundColor: last ? category.color : alpha(category.color, 0.35) }}
              />
              <Text variant="caption" tone={last ? 'primary' : 'tertiary'}>
                {monthLabel(h.month, false)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Budget input */}
      <Text variant="overline" tone="tertiary" style={{ marginTop: 26, marginBottom: 10 }}>
        Monthly budget
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.surfaceRaised, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, paddingHorizontal: 16, height: 64 }}>
        <Text variant="title" tone="secondary" style={{ fontFamily: fonts.rounded }}>
          $
        </Text>
        <TextInput
          value={text}
          onChangeText={(v) => setText(v.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="No budget"
          placeholderTextColor={t.textTertiary}
          onSubmitEditing={() => save()}
          style={{ flex: 1, fontSize: 30, fontWeight: '700', color: t.text, marginLeft: 4, fontFamily: fonts.rounded }}
          accessibilityLabel="Monthly budget amount"
        />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {suggestion ? <QuickAmount label={`Suggested ${formatMoney(suggestion, { compact: true })}`} onPress={() => setText(String(suggestion / 100))} accent /> : null}
        {[-50, -10, 10, 50].map((d) => (
          <QuickAmount key={d} label={`${d > 0 ? '+' : '−'}$${Math.abs(d)}`} onPress={() => setText((v) => String(Math.max(0, Math.round((Number(v) || 0) + d))))} />
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
        {category.budget ? (
          <PressableScale onPress={() => save('')} style={{ flex: 1, height: 50, borderRadius: radius.pill, backgroundColor: t.surfacePressed, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="headline" tone="negative">
              Remove
            </Text>
          </PressableScale>
        ) : null}
        <PressableScale onPress={() => save()} style={{ flex: 2, height: 50, borderRadius: radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="headline" tone="onAccent">
            Save budget
          </Text>
        </PressableScale>
      </View>

      {monthTxns.length > 0 && (
        <>
          <Text variant="overline" tone="tertiary" style={{ marginTop: 28, marginBottom: 6 }}>
            {monthLabel(month)} transactions
          </Text>
          {monthTxns.slice(0, 30).map((x) => (
            <PressableScale key={x.id} hapticOnPress={false} onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: x.id } })} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: t.separator }}>
              <View style={{ flex: 1 }}>
                <Text variant="callout" numberOfLines={1}>
                  {transactionTitle(x)}
                </Text>
                <Text variant="caption" tone="tertiary">
                  {relativeDayLabel(x.date, today)}
                </Text>
              </View>
              <Money cents={x.amount} options={{ abs: x.amount < 0, signed: x.amount > 0 }} colorize variant="callout" />
            </PressableScale>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function QuickAmount({ label, onPress, accent }: { label: string; onPress: () => void; accent?: boolean }) {
  const t = useTheme();
  return (
    <PressableScale onPress={onPress} style={{ paddingHorizontal: 12, height: 34, borderRadius: radius.pill, backgroundColor: accent ? alpha(t.accent, 0.15) : t.surfaceRaised, borderWidth: 1, borderColor: accent ? alpha(t.accent, 0.4) : t.border, justifyContent: 'center' }}>
      <Text variant="subhead" tone={accent ? 'accent' : 'secondary'} numeric>
        {label}
      </Text>
    </PressableScale>
  );
}
