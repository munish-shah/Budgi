import { parseISODate, transactionTitle, type Category, type Transaction } from '@budgi/core';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, ScrollView, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInDown,
  ZoomIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Chip } from '@/components/Chip';
import { GlassButton } from '@/components/GlassButton';
import { Icon } from '@/components/Icon';
import { Money } from '@/components/Money';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { toast, ToastHost } from '@/components/Toast';
import { haptic } from '@/lib/haptics';
import { useCategories, useReviewQueue } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';

const SOURCE_LABEL: Record<string, string> = {
  rule: 'Your rule',
  learned: 'Learned from you',
  merchant: 'Known merchant',
  provider: 'Bank category',
  heuristic: 'Best guess',
  none: 'Unknown',
};

function ReviewCard({ txn, category, accountName }: { txn: Transaction; category?: Category; accountName?: string }) {
  const t = useTheme();
  const date = parseISODate(txn.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <View style={{ flex: 1, padding: 22, justifyContent: 'space-between' }}>
      <View style={{ gap: 6 }}>
        <Text variant="footnote" tone="secondary">
          {date}
          {accountName ? ` · ${accountName}` : ''}
          {txn.pending ? ' · Pending' : ''}
        </Text>
        <Text variant="title" numberOfLines={2}>
          {transactionTitle(txn)}
        </Text>
        <Money cents={txn.amount} options={{ abs: txn.amount < 0, signed: txn.amount > 0 }} colorize variant="largeTitle" style={{ fontFamily: fonts.rounded }} />
        <Text variant="caption" tone="tertiary" numberOfLines={1} style={{ fontFamily: fonts.mono }}>
          {txn.description}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, backgroundColor: alpha(category?.color ?? t.textSecondary, 0.1) }}>
        <CategoryIcon category={category} size={46} />
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="secondary">
            {SOURCE_LABEL[txn.categorySource] ?? 'Guess'}
            {txn.confidence > 0 ? ` · ${Math.round(txn.confidence * 100)}%` : ''}
          </Text>
          <Text variant="title3" style={{ color: category?.color }}>
            {category?.name ?? 'Uncategorized'}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function Review() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const live = useReviewQueue();
  // Snapshot the queue so cards don't reshuffle while you work through them.
  const [ids] = useState(() => live.map((x) => x.id));
  const [index, setIndex] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const txns = useStore((s) => s.txns);
  const accounts = useStore((s) => s.accounts);
  const { list, map } = useCategories();
  const markReviewed = useStore((s) => s.markReviewed);
  const setCategory = useStore((s) => s.setCategory);
  const createRuleFromTxn = useStore((s) => s.createRuleFromTxn);

  const queue = ids.map((id) => txns[id]).filter((x): x is Transaction => !!x);
  const current = queue[index];
  // Nothing to confirm on an unknown merchant — you have to pick.
  const needsPick = current?.categoryId === 'uncategorized';
  const next = queue[index + 1];
  const third = queue[index + 2];

  // Most-used categories make the quickest picks.
  const quick = useMemo(() => {
    const counts = new Map<string, number>();
    for (const x of Object.values(txns)) counts.set(x.categoryId, (counts.get(x.categoryId) ?? 0) + 1);
    return list
      .filter((c) => c.id !== 'uncategorized')
      .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
      .slice(0, 8);
  }, [txns, list]);

  const x = useSharedValue(0);
  const y = useSharedValue(0);

  const advance = () => {
    setMoreOpen(false);
    x.value = 0;
    y.value = 0;
    setIndex((i) => i + 1);
  };

  const accept = () => {
    if (!current || current.categoryId === 'uncategorized') return;
    haptic.success();
    markReviewed([current.id]);
  };

  const flyOut = (dir: 1 | -1, then: () => void) => {
    x.value = withTiming(dir * width * 1.3, { duration: 240 }, (done) => {
      if (done) scheduleOnRN(advance);
    });
    then();
  };

  const choose = (categoryId: string) => {
    if (!current) return;
    haptic.select();
    const res = setCategory(current.id, categoryId);
    const merchant = transactionTitle(current);
    const txnId = current.id;
    flyOut(1, () => undefined);
    if (res) {
      toast({
        title: `Always use ${map.get(categoryId)?.name} for ${merchant}?`,
        message: res.similar > 0 ? `Also updates ${res.similar} similar` : undefined,
        icon: 'wand.and.stars',
        action: {
          label: 'Always',
          onPress: () => {
            createRuleFromTxn(txnId, categoryId);
            haptic.success();
          },
        },
      });
    }
  };

  const canAccept = !needsPick;
  const pan = Gesture.Pan()
    .onUpdate((e) => {
      x.value = e.translationX;
      y.value = e.translationY * 0.25;
    })
    .onEnd((e) => {
      const threshold = width * 0.28;
      if (canAccept && (e.translationX > threshold || e.velocityX > 900)) {
        x.value = withTiming(width * 1.3, { duration: 220 }, () => scheduleOnRN(advance));
        scheduleOnRN(accept);
      } else if (e.translationX < -threshold || e.velocityX < -900) {
        // Skip: leave it unreviewed for later.
        x.value = withTiming(-width * 1.3, { duration: 220 }, () => scheduleOnRN(advance));
      } else {
        x.value = withSpring(0, { damping: 16, stiffness: 180 });
        y.value = withSpring(0);
      }
    });

  const topStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${interpolate(x.value, [-width, width], [-12, 12])}deg` }],
  }));
  const acceptHint = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, width * 0.25], [0, 1], 'clamp') }));
  const skipHint = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-width * 0.25, 0], [1, 0], 'clamp') }));
  const nextStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.abs(x.value) / (width * 0.5));
    return { transform: [{ scale: interpolate(p, [0, 1], [0.94, 1]) }, { translateY: interpolate(p, [0, 1], [14, 0]) }], opacity: interpolate(p, [0, 1], [0.7, 1]) };
  });

  const cardBase = {
    position: 'absolute' as const,
    inset: 0,
    borderRadius: 28,
    borderCurve: 'continuous' as const,
    backgroundColor: t.surfaceRaised,
    borderWidth: 1,
    borderColor: t.border,
    shadowColor: '#000',
    shadowOpacity: t.scheme === 'dark' ? 0.5 : 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  };

  const total = ids.length;
  const done = !current;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + (Platform.OS === 'ios' ? 8 : 16), paddingBottom: insets.bottom + 12 }}>
      {/* Top bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16 }}>
        <GlassButton icon="xmark" label="Close" onPress={() => router.back()} size={36} />
        <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: t.surfacePressed, overflow: 'hidden' }}>
          <Animated.View style={{ height: 6, borderRadius: 3, backgroundColor: t.accent, width: `${total ? (Math.min(index, total) / total) * 100 : 100}%` }} />
        </View>
        <Text variant="subhead" tone="secondary" numeric>
          {Math.min(index + 1, total)}/{total}
        </Text>
      </View>

      {done ? (
        <Animated.View entering={FadeIn} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 }}>
          <Animated.View entering={ZoomIn.springify().damping(10)} style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: alpha(t.accent, 0.15), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="checkmark" size={40} color={t.accent} weight="bold" />
          </Animated.View>
          <Text variant="title">All caught up</Text>
          <Text variant="callout" tone="secondary" align="center">
            Every change you made also teaches Budgi for next time.
          </Text>
          <PressableScale onPress={() => router.back()} style={{ marginTop: 12, backgroundColor: t.accent, paddingHorizontal: 28, height: 48, borderRadius: radius.pill, justifyContent: 'center' }}>
            <Text variant="headline" tone="onAccent">
              Done
            </Text>
          </PressableScale>
        </Animated.View>
      ) : (
        <>
          {/* Card stack */}
          <View style={{ flex: 1, marginHorizontal: 20, marginTop: 22, marginBottom: 16, maxHeight: 360 }}>
            {third && <Animated.View style={[cardBase, { transform: [{ scale: 0.88 }, { translateY: 28 }], opacity: 0.4 }]} />}
            {next && (
              <Animated.View key={`next-${next.id}`} style={[cardBase, nextStyle]}>
                <ReviewCard txn={next} category={map.get(next.categoryId)} accountName={accounts[next.accountId]?.name} />
              </Animated.View>
            )}
            <Animated.View key={`top-${current.id}`} entering={index === 0 ? FadeInDown.springify().damping(18) : undefined} style={{ position: 'absolute', inset: 0 }}>
              <GestureDetector gesture={pan}>
                <Animated.View style={[cardBase, topStyle]}>
                  <ReviewCard txn={current} category={map.get(current.categoryId)} accountName={accounts[current.accountId]?.name} />
                  {!needsPick && (
                    <Animated.View style={[{ position: 'absolute', top: 22, right: 22, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 2, borderColor: t.positive, transform: [{ rotate: '8deg' }] }, acceptHint]}>
                      <Text variant="headline" tone="positive">
                        LOOKS RIGHT
                      </Text>
                    </Animated.View>
                  )}
                  <Animated.View style={[{ position: 'absolute', top: 22, left: 22, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 2, borderColor: t.textSecondary, transform: [{ rotate: '-8deg' }] }, skipHint]}>
                    <Text variant="headline" tone="secondary">
                      LATER
                    </Text>
                  </Animated.View>
                </Animated.View>
              </GestureDetector>
            </Animated.View>
          </View>

          {/* Quick picks */}
          <Text variant="overline" tone="tertiary" style={{ marginHorizontal: 20, marginBottom: 8 }}>
            Or pick a category
          </Text>
          <ScrollView horizontal={!moreOpen} showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, maxHeight: moreOpen ? 200 : 46 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, flexWrap: moreOpen ? 'wrap' : 'nowrap', flexDirection: 'row' }}>
            {(moreOpen ? list : quick)
              .filter((c) => c.id !== current.categoryId)
              .map((c) => (
                <Chip key={c.id} label={c.name} color={c.color} onPress={() => choose(c.id)} left={<CategoryIcon category={c} size={20} />} />
              ))}
            {!moreOpen && <Chip label="More…" onPress={() => setMoreOpen(true)} />}
          </ScrollView>

          {/* Actions */}
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginTop: 16 }}>
            <PressableScale
              onPress={() => flyOut(-1, () => undefined)}
              style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.surfaceRaised, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}
              accessibilityLabel="Skip for now">
              <Icon name="arrow.uturn.right" size={20} color={t.textSecondary} fallback="↷" />
            </PressableScale>
            <PressableScale
              disabled={needsPick}
              onPress={() => flyOut(1, accept)}
              style={{ flex: 1, height: 56, borderRadius: 28, backgroundColor: needsPick ? t.surfaceRaised : t.accent, borderWidth: needsPick ? 1 : 0, borderColor: t.border, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
              {!needsPick && <Icon name="checkmark" size={18} color={t.onAccent} weight="bold" />}
              <Text variant="headline" tone={needsPick ? 'secondary' : 'onAccent'}>
                {needsPick ? 'Pick a category above' : 'Looks right'}
              </Text>
            </PressableScale>
          </View>
        </>
      )}
      <ToastHost inModal />
    </View>
  );
}
