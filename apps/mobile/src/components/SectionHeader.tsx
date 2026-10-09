import { View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 10, paddingHorizontal: 4 }}>
      <Text variant="title3">{title}</Text>
      {action && (
        <PressableScale onPress={onAction} hapticOnPress={false} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 }}>
          <Text variant="subhead" tone="accent">
            {action}
          </Text>
          <Icon name="chevron.right" size={11} color={t.accent} />
        </PressableScale>
      )}
    </View>
  );
}
