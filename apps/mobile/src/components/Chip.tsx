import { View } from 'react-native';
import { alpha, radius, useTheme } from '@/lib/theme';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export function Chip({ label, selected, onPress, color, count, left }: { label: string; selected?: boolean; onPress?: () => void; color?: string; count?: number; left?: React.ReactNode }) {
  const t = useTheme();
  const c = color ?? t.accent;
  return (
    <PressableScale
      onPress={onPress}
      hapticOnPress={false}
      activeScale={0.94}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 13,
        height: 34,
        borderRadius: radius.pill,
        backgroundColor: selected ? alpha(c, 0.18) : t.surface,
        borderWidth: 1,
        borderColor: selected ? alpha(c, 0.5) : t.border,
      }}>
      {left}
      <Text variant="subhead" style={{ color: selected ? c : t.textSecondary }}>
        {label}
      </Text>
      {count !== undefined && count > 0 && (
        <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: selected ? c : t.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="caption" numeric style={{ color: selected ? t.onAccent : t.textSecondary, fontSize: 11 }}>
            {count}
          </Text>
        </View>
      )}
    </PressableScale>
  );
}
