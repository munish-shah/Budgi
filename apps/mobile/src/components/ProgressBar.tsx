import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { useTheme } from '@/lib/theme';

/** Animated bar with an optional "where you should be today" pace marker. */
export function ProgressBar({ progress, color, marker, height = 8, delay = 0 }: { progress: number; color: string; marker?: number; height?: number; delay?: number }) {
  const t = useTheme();
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withDelay(delay, withSpring(Math.max(0, Math.min(1, progress)), { damping: 22, stiffness: 120 }));
  }, [progress, delay, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: t.surfacePressed, overflow: 'visible' }}>
      <Animated.View style={[{ height, borderRadius: height / 2, backgroundColor: color }, fill]} />
      {marker !== undefined && marker > 0 && marker < 1 && (
        <View style={{ position: 'absolute', left: `${marker * 100}%`, top: -3, width: 2, height: height + 6, borderRadius: 1, backgroundColor: t.text, opacity: 0.55 }} />
      )}
    </View>
  );
}
