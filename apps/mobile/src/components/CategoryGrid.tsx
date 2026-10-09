import type { Category } from '@budgi/core';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { alpha, radius, useTheme } from '@/lib/theme';
import { CategoryIcon } from './CategoryIcon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

function Cell({ category, selected, onPress }: { category: Category; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const ring = useAnimatedStyle(() => ({
    borderColor: selected ? alpha(category.color, 0.7) : t.border,
    backgroundColor: selected ? alpha(category.color, 0.12) : t.surfaceRaised,
    transform: [{ scale: withSpring(selected ? 1.03 : 1, { damping: 14, stiffness: 260 }) }],
  }));
  return (
    <PressableScale onPress={onPress} activeScale={0.92} style={{ width: '25%', padding: 4 }} accessibilityLabel={category.name} accessibilityState={{ selected }}>
      <Animated.View style={[{ alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: radius.md, borderCurve: 'continuous', borderWidth: 1.5 }, ring]}>
        <CategoryIcon category={category} size={34} />
        <Text variant="caption" numberOfLines={1} style={{ fontSize: 11, color: selected ? category.color : t.textSecondary, paddingHorizontal: 2 }}>
          {category.name}
        </Text>
      </Animated.View>
    </PressableScale>
  );
}

export function CategoryGrid({ categories, selected, onSelect }: { categories: Category[]; selected?: string; onSelect: (id: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
      {categories.map((c) => (
        <Cell key={c.id} category={c} selected={c.id === selected} onPress={() => onSelect(c.id)} />
      ))}
    </View>
  );
}
