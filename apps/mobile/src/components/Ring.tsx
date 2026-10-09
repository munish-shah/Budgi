import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withDelay, withTiming, Easing } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '@/lib/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Progress ring that sweeps in. Progress > 1 wraps with an overflow color. */
export function Ring({ progress, size = 120, stroke = 12, color, children, delay = 0 }: { progress: number; size?: number; stroke?: number; color: string; children?: ReactNode; delay?: number }) {
  const t = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(Math.min(1, Math.max(0, progress)), { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [progress, delay, p]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - p.value) }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.surfacePressed} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          animatedProps={animatedProps}
        />
      </Svg>
      {children}
    </View>
  );
}
