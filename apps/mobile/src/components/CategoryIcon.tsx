import type { Category } from '@budgi/core';
import { View } from 'react-native';
import { alpha } from '@/lib/theme';
import { Icon } from './Icon';

export function CategoryIcon({ category, size = 40 }: { category: Category | undefined; size?: number }) {
  const color = category?.color ?? '#8E8E93';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        borderCurve: 'continuous',
        backgroundColor: alpha(color, 0.16),
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Icon name={category?.icon ?? 'questionmark.circle.fill'} size={size * 0.48} color={color} fallback={category?.emoji ?? '❔'} />
    </View>
  );
}
