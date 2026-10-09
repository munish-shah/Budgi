import { formatMoney, relativeDayLabel, transactionTitle, type Transaction } from '@budgi/core';
import { FlashList } from '@shopify/flash-list';
import { router, Stack } from 'expo-router';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Platform, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { Money } from '@/components/Money';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { TransactionRow } from '@/components/TransactionRow';
import { useCategories, useToday, useTxnList } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { syncAll } from '@/lib/sync';
import { radius, useTheme } from '@/lib/theme';

type Filter = 'all' | 'review' | 'uncategorized' | 'income' | 'excluded';
type Item = { type: 'header'; key: string; label: string; total: number } | { type: 'txn'; key: string; txn: Transaction };

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'review', label: 'To review' },
  { id: 'uncategorized', label: 'Uncategorized' },
  { id: 'income', label: 'Money in' },
  { id: 'excluded', label: 'Excluded' },
];

export default function Activity() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const all = useTxnList();
  const { map } = useCategories();
  const accounts = useStore((s) => s.accounts);
  const syncing = useStore((s) => s.syncing);
  const markReviewed = useStore((s) => s.markReviewed);
  const today = useToday();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query.trim().toLowerCase());

  const counts = useMemo(
    () => ({
      review: all.filter((x) => !x.reviewed).length,
      uncategorized: all.filter((x) => x.categoryId === 'uncategorized').length,
    }),
    [all],
  );

  const items = useMemo(() => {
    const filtered = all.filter((x) => {
      if (filter === 'review' && x.reviewed) return false;
      if (filter === 'uncategorized' && x.categoryId !== 'uncategorized') return false;
      if (filter === 'income' && x.amount <= 0) return false;
      if (filter === 'excluded' && !x.excluded) return false;
      if (!q) return true;
      const hay = `${transactionTitle(x)} ${x.description} ${map.get(x.categoryId)?.name ?? ''} ${x.note ?? ''} ${formatMoney(Math.abs(x.amount))}`.toLowerCase();
      return hay.includes(q);
    });
    const out: Item[] = [];
    const sticky: number[] = [];
    let currentDate = '';
    let headerIdx = -1;
    for (const txn of filtered) {
      if (txn.date !== currentDate) {
        currentDate = txn.date;
        sticky.push(out.length);
        headerIdx = out.length;
        out.push({ type: 'header', key: `h${txn.date}`, label: relativeDayLabel(txn.date, today), total: 0 });
      }
      const header = out[headerIdx] as Extract<Item, { type: 'header' }>;
      if (txn.amount < 0 && !txn.excluded && map.get(txn.categoryId)?.kind === 'expense') header.total += -txn.amount;
      out.push({ type: 'txn', key: txn.id, txn });
    }
    return { out, sticky };
  }, [all, filter, q, map, today]);

  const open = useCallback((id: string) => router.push({ pathname: '/transaction/[id]', params: { id } }), []);
  const onReviewed = useCallback(
    (id: string) => {
      markReviewed([id]);
    },
    [markReviewed],
  );

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      if (item.type === 'header') {
        return (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, backgroundColor: t.bg }}>
            <Text variant="footnote" weight="600" tone="secondary">
              {item.label}
            </Text>
            {item.total > 0 && <Money cents={item.total} variant="footnote" tone="tertiary" options={{ compact: false }} />}
          </View>
        );
      }
      const acct = accounts[item.txn.accountId];
      return (
        <TransactionRow
          txn={item.txn}
          category={map.get(item.txn.categoryId)}
          accountLabel={acct?.mask ? `••${acct.mask}` : acct?.name}
          onPress={open}
          onReviewed={item.txn.reviewed ? undefined : onReviewed}
          onCategorize={open}
        />
      );
    },
    [accounts, map, open, onReviewed, t.bg],
  );

  const header = (
    <View style={{ paddingTop: Platform.OS === 'ios' ? 4 : insets.top + 12 }}>
      {Platform.OS !== 'ios' && (
        <View style={{ paddingHorizontal: 16 }}>
          <Text variant="largeTitle" style={{ marginBottom: 12 }}>
            Activity
          </Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search merchants, notes, amounts"
            placeholderTextColor={t.textTertiary}
            style={{ height: 40, borderRadius: radius.md, backgroundColor: t.surface, color: t.text, paddingHorizontal: 14, fontSize: 16, borderWidth: 1, borderColor: t.border }}
          />
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            label={f.label}
            selected={filter === f.id}
            count={f.id === 'review' ? counts.review : f.id === 'uncategorized' ? counts.uncategorized : undefined}
            onPress={() => setFilter(f.id)}
          />
        ))}
      </ScrollView>
      {filter === 'review' && counts.review > 0 && (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 6 }}>
          <Chip label="Review one by one" onPress={() => router.push('/review')} />
          <Chip
            label="Mark all reviewed"
            onPress={() => {
              const ids = all.filter((x) => !x.reviewed).map((x) => x.id);
              markReviewed(ids);
              toast({ title: `Marked ${ids.length} reviewed`, icon: 'checkmark.circle.fill' });
            }}
          />
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: 'Merchants, notes, amounts',
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            onCancelButtonPress: () => setQuery(''),
            hideWhenScrolling: true,
            tintColor: t.accent,
          },
        }}
      />
      <FlashList
        data={items.out}
        renderItem={renderItem}
        keyExtractor={(i) => i.key}
        getItemType={(i) => i.type}
        stickyHeaderIndices={items.sticky}
        ListHeaderComponent={header}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        refreshing={syncing}
        onRefresh={() => void syncAll(true)}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListEmptyComponent={
          <EmptyState
            icon={q ? 'magnifyingglass' : 'checkmark.circle.fill'}
            title={q ? 'No matches' : filter === 'review' ? 'All caught up' : 'Nothing here yet'}
            message={q ? 'Try a merchant, category, note or amount.' : filter === 'review' ? 'Every transaction has been reviewed.' : undefined}
          />
        }
      />
    </View>
  );
}
