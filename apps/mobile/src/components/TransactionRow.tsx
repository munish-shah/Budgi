import { transactionTitle, type Category, type Transaction } from '@budgi/core';
import { memo, useRef } from 'react';
import { View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { haptic } from '@/lib/haptics';
import { alpha, useTheme } from '@/lib/theme';
import { CategoryIcon } from './CategoryIcon';
import { Icon } from './Icon';
import { Money } from './Money';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

function SwipeAction({ progress, color, icon, label, align }: { progress: SharedValue<number>; color: string; icon: string; label: string; align: 'left' | 'right' }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.6, 1], [0, 0.8, 1]),
    transform: [{ scale: interpolate(progress.value, [0, 1, 1.4], [0.6, 1, 1.12], 'clamp') }],
  }));
  return (
    <View style={{ width: 96, justifyContent: 'center', alignItems: align === 'left' ? 'flex-start' : 'flex-end', paddingHorizontal: 22, backgroundColor: alpha(color, 0.16) }}>
      <Animated.View style={[{ alignItems: 'center', gap: 4 }, style]}>
        <Icon name={icon} size={20} color={color} />
        <Text variant="caption" style={{ color }}>
          {label}
        </Text>
      </Animated.View>
    </View>
  );
}

export interface TransactionRowProps {
  txn: Transaction;
  category?: Category;
  accountLabel?: string;
  onPress: (id: string) => void;
  onReviewed?: (id: string) => void;
  onCategorize?: (id: string) => void;
}

export const TransactionRow = memo(function TransactionRow({ txn, category, accountLabel, onPress, onReviewed, onCategorize }: TransactionRowProps) {
  const t = useTheme();
  const ref = useRef<SwipeableMethods>(null);
  const subtitle = [txn.pending ? 'Pending' : undefined, category?.name, accountLabel].filter(Boolean).join(' · ');
  const isIncome = txn.amount > 0;

  const row = (
    <PressableScale onPress={() => onPress(txn.id)} activeScale={0.985} hapticOnPress={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: t.bg }}>
      <CategoryIcon category={category} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="callout" numberOfLines={1} style={{ opacity: txn.excluded ? 0.55 : 1 }}>
          {transactionTitle(txn)}
        </Text>
        <Text variant="footnote" tone={txn.categoryId === 'uncategorized' ? 'warning' : 'secondary'} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Money
          cents={txn.amount}
          options={{ abs: !isIncome, signed: isIncome }}
          variant="callout"
          weight="600"
          colorize
          style={{ textDecorationLine: txn.excluded ? 'line-through' : 'none', opacity: txn.pending ? 0.7 : 1 }}
        />
        {!txn.reviewed && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.accent }} accessibilityLabel="Needs review" />}
      </View>
    </PressableScale>
  );

  if (!onReviewed && !onCategorize) return row;
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.6}
      leftThreshold={70}
      rightThreshold={70}
      overshootFriction={6}
      renderLeftActions={onReviewed ? (p) => <SwipeAction progress={p} color={t.positive} icon="checkmark.circle.fill" label="Reviewed" align="left" /> : undefined}
      renderRightActions={onCategorize ? (p) => <SwipeAction progress={p} color={t.accent} icon="square.and.pencil" label="Category" align="right" /> : undefined}
      onSwipeableWillOpen={(direction) => {
        haptic.soft();
        // 'right' = row dragged right, revealing the left (Reviewed) action.
        if (direction === 'right') onReviewed?.(txn.id);
        else onCategorize?.(txn.id);
        setTimeout(() => ref.current?.close(), 120);
      }}>
      {row}
    </ReanimatedSwipeable>
  );
});
