import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { biometryLabel, useLock } from '@/lib/lock';
import { haptic } from '@/lib/haptics';
import { radius, useTheme } from '@/lib/theme';
import { BudgiMark } from './BudgiMark';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export function LockScreen() {
  const t = useTheme();
  const unlock = useLock((s) => s.unlock);
  const [label, setLabel] = useState('Face ID');
  const breathe = useSharedValue(1);

  useEffect(() => {
    void biometryLabel().then(setLabel);
    breathe.value = withRepeat(withSequence(withTiming(1.04, { duration: 1400 }), withTiming(1, { duration: 1400 })), -1);
    const id = setTimeout(() => void attempt(), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attempt = async () => {
    const ok = await unlock();
    if (ok) haptic.success();
  };

  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value }] }));

  return (
    <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(280)} style={{ position: 'absolute', inset: 0, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', gap: 18, zIndex: 100 }}>
      <Animated.View style={markStyle}>
        <BudgiMark size={76} />
      </Animated.View>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text variant="title">Budgi is locked</Text>
        <Text variant="footnote" tone="secondary">
          Your data is encrypted on this device.
        </Text>
      </View>
      <PressableScale
        onPress={attempt}
        style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.accent, paddingHorizontal: 22, height: 50, borderRadius: radius.pill }}>
        <Icon name={label === 'Face ID' ? 'faceid' : 'lock.fill'} size={20} color={t.onAccent} />
        <Text variant="headline" tone="onAccent">
          Unlock with {label}
        </Text>
      </PressableScale>
    </Animated.View>
  );
}
