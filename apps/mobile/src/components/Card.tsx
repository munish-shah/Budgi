import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, useTheme } from '@/lib/theme';
import { PressableScale } from './PressableScale';

export function Card({ children, style, onPress, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean }) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: t.border,
    padding: padded ? 16 : 0,
    overflow: 'hidden',
  };
  if (onPress) {
    return (
      <PressableScale onPress={onPress} activeScale={0.985} style={[base, style]}>
        {children}
      </PressableScale>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}
