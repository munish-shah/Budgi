import { merchantKey, ruleMatches, sortRules, transactionTitle, validateCondition, validateRule, type Rule, type RuleActions, type RuleCondition } from '@budgi/core';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useDeferredValue, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, Switch, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryGrid } from '@/components/CategoryGrid';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Money } from '@/components/Money';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';
import { useCategories, useTxnList } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { alpha, radius, useTheme } from '@/lib/theme';

type Field = RuleCondition['field'];

const FIELDS: Array<{ id: Field; label: string }> = [
  { id: 'merchant', label: 'Merchant' },
  { id: 'description', label: 'Description' },
  { id: 'amount', label: 'Amount' },
  { id: 'direction', label: 'Money in/out' },
  { id: 'account', label: 'Account' },
  { id: 'providerCategory', label: 'Bank category' },
];

const TEXT_OPS = [
  { id: 'contains', label: 'contains' },
  { id: 'equals', label: 'is' },
  { id: 'startsWith', label: 'starts with' },
  { id: 'endsWith', label: 'ends with' },
  { id: 'regex', label: 'regex' },
] as const;
const AMOUNT_OPS = [
  { id: 'gt', label: 'over' },
  { id: 'lt', label: 'under' },
  { id: 'eq', label: 'exactly' },
  { id: 'between', label: 'between' },
] as const;

function defaultCondition(field: Field, accountId?: string): RuleCondition {
  switch (field) {
    case 'merchant':
    case 'description':
      return { field, op: 'contains', value: '' };
    case 'amount':
      return { field, op: 'gt', value: 0 };
    case 'direction':
      return { field, op: 'is', value: 'expense' };
    case 'account':
      return { field, op: 'is', value: accountId ?? '' };
    case 'providerCategory':
      return { field, op: 'contains', value: '' };
  }
}

const centsToText = (c?: number) => (c ? String(c / 100) : '');
const textToCents = (s: string) => Math.round((Number(s.replace(/[^0-9.]/g, '')) || 0) * 100);

export default function RuleEditor() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { id, fromTxn } = useLocalSearchParams<{ id: string; fromTxn?: string }>();
  const existing = useStore((s) => s.rules.find((r) => r.id === id));
  const seedTxn = useStore((s) => (fromTxn ? s.txns[fromTxn] : undefined));
  const accounts = useStore((s) => s.accounts);
  const rulesCount = useStore((s) => s.rules.length);
  const position = useStore((s) => sortRules(s.rules).findIndex((r) => r.id === id));
  const { saveRule, deleteRule, moveRule } = useStore.getState();
  const { list, map } = useCategories();
  const txns = useTxnList();
  const accountList = Object.values(accounts);

  const [name, setName] = useState(existing?.name ?? (seedTxn ? transactionTitle(seedTxn) : ''));
  const [match, setMatch] = useState<Rule['match']>(existing?.match ?? 'all');
  const [conditions, setConditions] = useState<RuleCondition[]>(
    existing?.conditions ?? [seedTxn ? { field: 'merchant', op: 'contains', value: merchantKey(transactionTitle(seedTxn)) } : defaultCondition('merchant')],
  );
  const [actions, setActions] = useState<RuleActions>(existing?.actions ?? (seedTxn ? { categoryId: seedTxn.categoryId } : {}));
  const [error, setError] = useState<string>();

  const draft: Rule = { id: existing?.id ?? 'draft', name, match, conditions, actions, enabled: true, priority: 0, createdAt: '' };
  const deferred = useDeferredValue(draft);
  // Preview as soon as every condition is complete, even before actions are chosen.
  const matches = useMemo(
    () => (deferred.conditions.every((c) => !validateCondition(c)) ? txns.filter((x) => ruleMatches(deferred, x)) : []),
    [deferred, txns],
  );

  const update = (i: number, c: RuleCondition) => setConditions((cs) => cs.map((x, k) => (k === i ? c : x)));

  const save = () => {
    const err = validateRule(draft);
    if (err) {
      setError(err);
      haptic.error();
      return;
    }
    const finalName = name.trim() || conditions.map((c) => ('value' in c ? String(c.value) : '')).join(' ') || 'Rule';
    saveRule({ ...(existing ?? {}), id: existing?.id, name: finalName, match, conditions, actions, enabled: existing?.enabled ?? true });
    haptic.success();
    toast({ title: existing ? 'Rule updated' : 'Rule created', message: `Applied to ${matches.length} transaction${matches.length === 1 ? '' : 's'}`, icon: 'wand.and.stars' });
    router.back();
  };

  const remove = () => {
    const doDelete = () => {
      if (!existing) return;
      deleteRule(existing.id);
      haptic.warning();
      router.back();
    };
    if (Platform.OS === 'web') return doDelete();
    Alert.alert('Delete rule?', 'Transactions it categorized go back to automatic categories.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doDelete },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: existing ? 'Edit rule' : 'New rule',
          headerStyle: { backgroundColor: t.bg },
          headerTitleStyle: { color: t.text },
          headerTintColor: t.accent,
          headerLeft: () => (
            <PressableScale onPress={() => router.back()} hapticOnPress={false} style={{ padding: 6 }}>
              <Text variant="body" tone="accent">
                Cancel
              </Text>
            </PressableScale>
          ),
          headerRight: () => (
            <PressableScale onPress={save} style={{ padding: 6 }}>
              <Text variant="body" tone="accent" weight="700">
                Save
              </Text>
            </PressableScale>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Rule name"
          placeholderTextColor={t.textTertiary}
          style={{ fontSize: 24, fontWeight: '700', color: t.text, paddingVertical: 8 }}
        />

        {/* Conditions */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 10 }}>
          <Text variant="overline" tone="tertiary">
            If
          </Text>
          <Chip label="all" selected={match === 'all'} onPress={() => setMatch('all')} />
          <Chip label="any" selected={match === 'any'} onPress={() => setMatch('any')} />
          <Text variant="overline" tone="tertiary">
            of these match
          </Text>
        </View>

        {conditions.map((c, i) => (
          <Animated.View key={i} entering={FadeInDown.springify().damping(18)} exiting={FadeOut.duration(150)} layout={LinearTransition.springify().damping(18)}>
            <View style={{ backgroundColor: t.surface, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, padding: 12, marginBottom: 10, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
                  {FIELDS.map((f) => (
                    <Chip key={f.id} label={f.label} selected={c.field === f.id} onPress={() => c.field !== f.id && update(i, defaultCondition(f.id, accountList[0]?.id))} />
                  ))}
                </ScrollView>
                {conditions.length > 1 && (
                  <PressableScale onPress={() => setConditions((cs) => cs.filter((_, k) => k !== i))} style={{ paddingLeft: 10 }} accessibilityLabel="Remove condition">
                    <Icon name="xmark.circle.fill" size={20} color={t.textTertiary} />
                  </PressableScale>
                )}
              </View>
              <ConditionEditor condition={c} onChange={(nc) => update(i, nc)} accounts={accountList.map((a) => ({ id: a.id, label: `${a.name}${a.mask ? ` ••${a.mask}` : ''}` }))} />
            </View>
          </Animated.View>
        ))}
        <PressableScale onPress={() => setConditions((cs) => [...cs, defaultCondition('amount')])} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, alignSelf: 'flex-start' }}>
          <Icon name="plus.circle.fill" size={18} color={t.accent} />
          <Text variant="callout" tone="accent" weight="600">
            Add condition
          </Text>
        </PressableScale>

        {/* Actions */}
        <Text variant="overline" tone="tertiary" style={{ marginTop: 24, marginBottom: 10 }}>
          Then set category
        </Text>
        <CategoryGrid categories={list} selected={actions.categoryId} onSelect={(cid) => setActions((a) => ({ ...a, categoryId: a.categoryId === cid ? undefined : cid }))} />

        <View style={{ backgroundColor: t.surface, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, marginTop: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: 50, gap: 12 }}>
            <Text variant="body">Rename to</Text>
            <TextInput
              value={actions.rename ?? ''}
              onChangeText={(v) => setActions((a) => ({ ...a, rename: v || undefined }))}
              placeholder="Keep original"
              placeholderTextColor={t.textTertiary}
              style={{ flex: 1, textAlign: 'right', color: t.text, fontSize: 16 }}
            />
          </View>
          <Toggle label="Exclude from budget" value={!!actions.exclude} onChange={(v) => setActions((a) => ({ ...a, exclude: v ? true : undefined }))} />
          <Toggle label="Mark as reviewed" value={!!actions.markReviewed} onChange={(v) => setActions((a) => ({ ...a, markReviewed: v || undefined }))} />
        </View>

        {error && (
          <Animated.View entering={FadeIn} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 14 }}>
            <Icon name="exclamationmark.triangle.fill" size={14} color={t.negative} />
            <Text variant="footnote" tone="negative">
              {error}
            </Text>
          </Animated.View>
        )}

        {/* Live preview */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 26, marginBottom: 8 }}>
          <Text variant="overline" tone="tertiary">
            Preview
          </Text>
          <Text variant="subhead" tone="accent" numeric>
            {matches.length} match{matches.length === 1 ? '' : 'es'}
          </Text>
        </View>
        <View style={{ backgroundColor: t.surface, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, overflow: 'hidden' }}>
          {matches.length === 0 ? (
            <Text variant="footnote" tone="tertiary" style={{ padding: 14 }}>
              No existing transactions match yet. The rule will still apply to new ones.
            </Text>
          ) : (
            matches.slice(0, 6).map((x, k) => (
              <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderTopWidth: k ? 1 : 0, borderTopColor: t.separator }}>
                <CategoryIcon category={map.get(actions.categoryId ?? x.categoryId)} size={28} />
                <Text variant="callout" style={{ flex: 1 }} numberOfLines={1}>
                  {actions.rename || transactionTitle(x)}
                </Text>
                <Money cents={x.amount} options={{ abs: x.amount < 0 }} variant="footnote" tone="secondary" />
              </View>
            ))
          )}
        </View>

        {existing && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26 }}>
              <Text variant="callout" tone="secondary">
                Runs {position + 1} of {rulesCount}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Chip label="Move up" onPress={() => moveRule(existing.id, -1)} />
                <Chip label="Move down" onPress={() => moveRule(existing.id, 1)} />
              </View>
            </View>
            <PressableScale onPress={remove} style={{ marginTop: 22, height: 48, borderRadius: radius.pill, backgroundColor: alpha(t.negative, 0.12), alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="headline" tone="negative">
                Delete rule
              </Text>
            </PressableScale>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, minHeight: 50, borderTopWidth: 1, borderTopColor: t.separator }}>
      <Text variant="body">{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.accentStrong, false: undefined }} />
    </View>
  );
}

function ConditionEditor({ condition: c, onChange, accounts }: { condition: RuleCondition; onChange: (c: RuleCondition) => void; accounts: Array<{ id: string; label: string }> }) {
  const t = useTheme();
  const input = { flex: 1, height: 42, borderRadius: radius.sm, backgroundColor: t.surfaceRaised, color: t.text, paddingHorizontal: 12, fontSize: 16, borderWidth: 1, borderColor: t.border };
  switch (c.field) {
    case 'merchant':
    case 'description':
      return (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {TEXT_OPS.map((o) => (
              <Chip key={o.id} label={o.label} selected={c.op === o.id} onPress={() => onChange({ ...c, op: o.id })} />
            ))}
          </ScrollView>
          <TextInput
            value={c.value}
            onChangeText={(v) => onChange({ ...c, value: v })}
            placeholder={c.op === 'regex' ? '^uber (eats|trip)' : 'e.g. trader joe'}
            placeholderTextColor={t.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={input}
          />
        </>
      );
    case 'providerCategory':
      return (
        <TextInput
          value={c.value}
          onChangeText={(v) => onChange({ ...c, value: v })}
          placeholder="e.g. FOOD_AND_DRINK"
          placeholderTextColor={t.textTertiary}
          autoCapitalize="characters"
          style={input}
        />
      );
    case 'amount':
      return (
        <>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {AMOUNT_OPS.map((o) => (
              <Chip key={o.id} label={o.label} selected={c.op === o.id} onPress={() => onChange({ ...c, op: o.id })} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput defaultValue={centsToText(c.value)} onChangeText={(v) => onChange({ ...c, value: textToCents(v) })} keyboardType="decimal-pad" placeholder="$0" placeholderTextColor={t.textTertiary} style={input} />
            {c.op === 'between' && (
              <>
                <Text tone="secondary">and</Text>
                <TextInput defaultValue={centsToText(c.value2)} onChangeText={(v) => onChange({ ...c, value2: textToCents(v) })} keyboardType="decimal-pad" placeholder="$0" placeholderTextColor={t.textTertiary} style={input} />
              </>
            )}
          </View>
        </>
      );
    case 'direction':
      return (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Chip label="Money out" selected={c.value === 'expense'} onPress={() => onChange({ ...c, value: 'expense' })} />
          <Chip label="Money in" selected={c.value === 'income'} onPress={() => onChange({ ...c, value: 'income' })} />
        </View>
      );
    case 'account':
      return (
        <>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Chip label="is" selected={c.op === 'is'} onPress={() => onChange({ ...c, op: 'is' })} />
            <Chip label="is not" selected={c.op === 'isNot'} onPress={() => onChange({ ...c, op: 'isNot' })} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {accounts.map((a) => (
              <Chip key={a.id} label={a.label} selected={c.value === a.id} onPress={() => onChange({ ...c, value: a.id })} />
            ))}
          </ScrollView>
        </>
      );
  }
}
