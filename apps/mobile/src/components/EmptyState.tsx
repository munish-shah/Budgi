import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { alpha, useTheme } from '@/lib/theme';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export function EmptyState({ icon, title, message, action, onAction }: { icon: string; title: string; message?: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32, gap: 10 }}>
      <View style={{ width: 64, height: 64, borderRadius: 22, backgroundColor: alpha(t.accent, 0.12), alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
        <Icon name={icon} size={28} color={t.accent} />
      </View>
      <Text variant="headline" align="center">
        {title}
      </Text>
      {message && (
        <Text variant="footnote" tone="secondary" align="center" style={{ maxWidth: 300 }}>
          {message}
        </Text>
      )}
      {action && (
        <PressableScale onPress={onAction} style={{ marginTop: 10, backgroundColor: t.accent, paddingHorizontal: 18, height: 40, borderRadius: 20, justifyContent: 'center' }}>
          <Text variant="callout" tone="onAccent" weight="700">
            {action}
          </Text>
        </PressableScale>
      )}
    </Animated.View>
  );
}
