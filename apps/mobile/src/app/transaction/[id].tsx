import { formatMoney, parseISODate, transactionTitle, type CategorySource } from '@budgi/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { CategoryGrid } from '@/components/CategoryGrid';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Icon } from '@/components/Icon';
import { Money } from '@/components/Money';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { toast, ToastHost } from '@/components/Toast';
import { haptic } from '@/lib/haptics';
import { useCategories } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';

const SOURCE_TEXT: Record<CategorySource, string> = {
  user: 'You chose this category.',
  rule: 'Set by one of your rules.',
  learned: 'Learned from how you categorized this merchant before.',
  merchant: 'Recognized merchant.',
  provider: 'Based on your bank’s category.',
  heuristic: 'Best guess from the description — worth a glance.',
  none: 'Budgi couldn’t tell. Pick a category to teach it.',
};

export default function TransactionSheet() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const txn = useStore((s) => s.txns[id]);
  const account = useStore((s) => (txn ? s.accounts[txn.accountId] : undefined));
  const rule = useStore((s) => (txn?.ruleId ? s.rules.find((r) => r.id === txn.ruleId) : undefined));
  const { list, map } = useCategories();
  const setCategory = useStore((s) => s.setCategory);
  const updateTxn = useStore((s) => s.updateTxn);
  const createRuleFromTxn = useStore((s) => s.createRuleFromTxn);
  const [suggest, setSuggest] = useState<{ categoryId: string; similar: number; merchant: string } | null>(null);
  const [name, setName] = useState(txn ? transactionTitle(txn) : '');
  const [note, setNote] = useState(txn?.note ?? '');

  // Opening a transaction counts as reviewing it.
  useEffect(() => {
    if (txn && !txn.reviewed) useStore.getState().markReviewed([txn.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!txn) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text tone="secondary">This transaction no longer exists.</Text>
      </View>
    );
  }
  const category = map.get(txn.categoryId);
  const d = parseISODate(txn.date);
  const dateText = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const pick = (categoryId: string) => {
    haptic.select();
    const res = setCategory(txn.id, categoryId);
    if (res) setSuggest({ categoryId, ...res });
  };

  const commitName = () => {
    if (name.trim() !== transactionTitle(txn)) updateTxn(txn.id, { renamed: name.trim() === txn.displayName ? '' : name });
  };

  return (
    <>
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 28, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" style={{ backgroundColor: t.surface }}>
      {/* Summary */}
      <View style={{ alignItems: 'center', gap: 8 }}>
        <CategoryIcon category={category} size={58} />
        <Text variant="title3" align="center" numberOfLines={2}>
          {transactionTitle(txn)}
        </Text>
        <Money cents={txn.amount} options={{ signed: txn.amount > 0, abs: txn.amount < 0 }} colorize variant="largeTitle" style={{ fontFamily: fonts.rounded }} />
        <Text variant="footnote" tone="secondary" align="center">
          {dateText}
          {account ? ` · ${account.name}${account.mask ? ` ••${account.mask}` : ''}` : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {txn.pending && <Badge label="Pending" color={t.warning} />}
          {txn.excluded && <Badge label="Excluded from budget" color={t.textSecondary} />}
        </View>
      </View>

      {/* Category */}
      <Text variant="overline" tone="tertiary" style={{ marginTop: 26, marginBottom: 10 }}>
        Category
      </Text>
      <CategoryGrid categories={list} selected={txn.categoryId} onSelect={pick} />

      {suggest && (
        <Animated.View entering={FadeInDown.springify().damping(16)} exiting={FadeOut} layout={LinearTransition}>
          <View style={{ marginTop: 14, padding: 14, borderRadius: radius.md, backgroundColor: alpha(t.accent, 0.1), borderWidth: 1, borderColor: alpha(t.accent, 0.3), gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Icon name="wand.and.stars" size={18} color={t.accent} />
              <Text variant="callout" style={{ flex: 1 }}>
                Always categorize <Text variant="callout" weight="700">{suggest.merchant}</Text> as {map.get(suggest.categoryId)?.name}?
              </Text>
            </View>
            <Text variant="footnote" tone="secondary">
              {suggest.similar > 0 ? `Creates a rule and updates ${suggest.similar} other transaction${suggest.similar === 1 ? '' : 's'}.` : 'Creates a rule for future transactions.'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <PressableScale
                onPress={() => {
                  createRuleFromTxn(txn.id, suggest.categoryId);
                  haptic.success();
                  toast({ title: 'Rule created', message: `${suggest.merchant} → ${map.get(suggest.categoryId)?.name}`, icon: 'wand.and.stars' });
                  setSuggest(null);
                }}
                style={{ flex: 1, height: 40, borderRadius: radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="callout" tone="onAccent" weight="700">
                  Create rule
                </Text>
              </PressableScale>
              <PressableScale onPress={() => setSuggest(null)} style={{ flex: 1, height: 40, borderRadius: radius.pill, backgroundColor: t.surfacePressed, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="callout" weight="600">
                  Just this one
                </Text>
              </PressableScale>
            </View>
          </View>
        </Animated.View>
      )}

      {/* Why */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'flex-start' }}>
        <Icon name="info.circle" size={14} color={t.textTertiary} />
        <Text variant="footnote" tone="tertiary" style={{ flex: 1 }}>
          {txn.categorySource === 'rule' && rule ? `Set by your rule “${rule.name}”.` : SOURCE_TEXT[txn.categorySource]}
          {txn.categorySource !== 'user' && txn.categorySource !== 'none' ? ` Confidence ${Math.round(txn.confidence * 100)}%.` : ''}
        </Text>
      </View>

      {/* Details */}
      <Text variant="overline" tone="tertiary" style={{ marginTop: 26, marginBottom: 10 }}>
        Details
      </Text>
      <View style={{ backgroundColor: t.surfaceRaised, borderRadius: radius.md, borderWidth: 1, borderColor: t.border }}>
        <Field label="Name">
          <TextInput value={name} onChangeText={setName} onBlur={commitName} onSubmitEditing={commitName} returnKeyType="done" style={{ flex: 1, color: t.text, fontSize: 16, textAlign: 'right' }} placeholderTextColor={t.textTertiary} />
        </Field>
        <Field label="Note" border>
          <TextInput
            value={note}
            onChangeText={setNote}
            onBlur={() => updateTxn(txn.id, { note })}
            placeholder="Add a note"
            placeholderTextColor={t.textTertiary}
            style={{ flex: 1, color: t.text, fontSize: 16, textAlign: 'right' }}
          />
        </Field>
        <Field label="Exclude from budget" border>
          <Switch
            value={txn.excluded}
            onValueChange={(v) => {
              haptic.select();
              updateTxn(txn.id, { excluded: v });
            }}
            trackColor={{ true: t.accentStrong, false: undefined }}
          />
        </Field>
      </View>

      <Text variant="overline" tone="tertiary" style={{ marginTop: 26, marginBottom: 8 }}>
        Bank description
      </Text>
      <Text variant="footnote" tone="secondary" selectable style={{ fontFamily: fonts.mono }}>
        {txn.description}
      </Text>
      {txn.providerCategory && (
        <Text variant="caption" tone="tertiary" style={{ marginTop: 6 }}>
          Bank category: {txn.providerCategory.replace(/_/g, ' ').toLowerCase()}
        </Text>
      )}

      <PressableScale
        onPress={() => router.push({ pathname: '/rule/[id]', params: { id: 'new', fromTxn: txn.id } })}
        style={{ marginTop: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border }}>
        <Icon name="wand.and.stars" size={16} color={t.accent} />
        <Text variant="callout" tone="accent" weight="600">
          Create custom rule…
        </Text>
      </PressableScale>
      <Text variant="caption" tone="tertiary" align="center" style={{ marginTop: 12 }}>
        Amount {formatMoney(txn.amount)} · {txn.provider === 'demo' ? 'Demo data' : `via ${txn.provider === 'plaid' ? 'Plaid' : 'SimpleFIN'}`}
      </Text>
    </ScrollView>
      <ToastHost inModal />
    </>
  );
}

function Field({ label, children, border }: { label: string; children: React.ReactNode; border?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 14, borderTopWidth: border ? 1 : 0, borderTopColor: t.separator }}>
      <Text variant="body">{label}</Text>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>{children}</View>
    </View>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: alpha(color, 0.15) }}>
      <Text variant="caption" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}
