import { useEffect } from 'react';
import { View, type TextStyle } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { Text, type TextVariant } from './Text';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function Digit({ digit, height, variant, style, index }: { digit: number; height: number; variant: TextVariant; style?: TextStyle; index: number }) {
  const y = useSharedValue(-digit * height);
  useEffect(() => {
    y.value = withDelay(index * 18, withSpring(-digit * height, { damping: 20, stiffness: 170, mass: 0.9 }));
  }, [digit, height, index, y]);
  const strip = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <View style={{ height, overflow: 'hidden' }}>
      {/* invisible sizer keeps the column exactly one digit wide */}
      <Text variant={variant} numeric style={[style, { opacity: 0, lineHeight: height }]}>
        0
      </Text>
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0 }, strip]}>
        {DIGITS.map((d) => (
          <Text key={d} variant={variant} numeric style={[style, { lineHeight: height, height }]} align="center">
            {d}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

/**
 * Odometer-style number: each digit rolls into place on a spring.
 * Pass the already-formatted string (e.g. "$2,431").
 */
export function RollingNumber({ value, variant = 'hero', style, lineHeight }: { value: string; variant?: TextVariant; style?: TextStyle; lineHeight?: number }) {
  const height = lineHeight ?? (variant === 'hero' ? 52 : variant === 'largeTitle' ? 40 : 30);
  const chars = value.split('');
  // Key digits from the right so the ones place stays stable as numbers grow.
  return (
    <Animated.View layout={LinearTransition.springify().damping(20)} style={{ flexDirection: 'row', alignItems: 'flex-end' }} accessible accessibilityLabel={value}>
      {chars.map((ch, i) => {
        const key = `${chars.length - i}`;
        const n = DIGITS.indexOf(ch);
        return (
          <Animated.View key={key + (n >= 0 ? 'd' : ch)} entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)} layout={LinearTransition.springify().damping(20)}>
            {n >= 0 ? (
              <Digit digit={n} height={height} variant={variant} style={style} index={chars.length - i} />
            ) : (
              <Text variant={variant} numeric style={[style, { lineHeight: height, height }]}>
                {ch}
              </Text>
            )}
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}
