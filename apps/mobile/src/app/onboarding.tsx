import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BudgiMark } from '@/components/BudgiMark';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { haptic } from '@/lib/haptics';
import { useStore } from '@/lib/store';
import { alpha, radius, useTheme } from '@/lib/theme';

const POINTS = [
  { icon: 'lock.shield.fill', title: 'Private by design', body: 'Transactions are stored only on this device, encrypted, behind Face ID.' },
  { icon: 'sparkles', title: 'Categorized for you', body: 'Hundreds of merchants recognized out of the box. Budgi learns from every correction.' },
  { icon: 'wand.and.stars', title: 'Rules when you want them', body: 'Rename, recategorize or exclude anything automatically.' },
];

export default function Onboarding() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const update = useStore((s) => s.updateSettings);
  const loadDemo = useStore((s) => s.loadDemo);
  const [busy, setBusy] = useState(false);

  const finish = (next?: () => void) => {
    update({ onboarded: true });
    haptic.success();
    router.back();
    if (next) setTimeout(next, 350);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20, paddingHorizontal: 24 }}>
      <Animated.View entering={FadeInDown.springify().damping(14)} style={{ alignItems: 'flex-start' }}>
        <BudgiMark size={72} />
      </Animated.View>
      <Animated.View entering={FadeInDown.delay(80).springify().damping(18)}>
        <Text variant="largeTitle" style={{ marginTop: 22, fontSize: 38, lineHeight: 42 }}>
          Know where{'\n'}your money goes.
        </Text>
      </Animated.View>
      <View style={{ marginTop: 32, gap: 22, flex: 1 }}>
        {POINTS.map((p, i) => (
          <Animated.View key={p.title} entering={FadeInDown.delay(180 + i * 90).springify().damping(18)} style={{ flexDirection: 'row', gap: 14 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: alpha(t.accent, 0.14), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={p.icon} size={19} color={t.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="headline">{p.title}</Text>
              <Text variant="footnote" tone="secondary">
                {p.body}
              </Text>
            </View>
          </Animated.View>
        ))}
      </View>
      <Animated.View entering={FadeInUp.delay(500).springify().damping(18)} style={{ gap: 10 }}>
        <PressableScale onPress={() => finish(() => router.push('/settings/connect'))} style={{ height: 54, borderRadius: radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="headline" tone="onAccent">
            Connect an account
          </Text>
        </PressableScale>
        <PressableScale
          onPress={async () => {
            setBusy(true);
            await loadDemo();
            finish();
          }}
          style={{ height: 54, borderRadius: radius.pill, backgroundColor: t.surfaceRaised, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}>
          {busy ? <ActivityIndicator /> : <Text variant="headline">Explore with demo data</Text>}
        </PressableScale>
      </Animated.View>
    </View>
  );
}
