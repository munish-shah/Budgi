import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

const liquidGlass = Platform.OS === 'ios' && isLiquidGlassAvailable();

/** Round icon button: Liquid Glass on iOS 26, frosted blur before that. */
export function GlassButton({ icon, onPress, size = 40, label, tint }: { icon: string; onPress: () => void; size?: number; label: string; tint?: string }) {
  const t = useTheme();
  const inner = <Icon name={icon} size={size * 0.42} color={tint ?? t.text} />;
  const shape = { width: size, height: size, borderRadius: size / 2, alignItems: 'center' as const, justifyContent: 'center' as const, overflow: 'hidden' as const };
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} activeScale={0.9}>
      {liquidGlass ? (
        <GlassView glassEffectStyle="regular" isInteractive style={shape}>
          {inner}
        </GlassView>
      ) : Platform.OS === 'ios' ? (
        <BlurView intensity={40} tint={t.scheme === 'dark' ? 'systemThinMaterialDark' : 'systemThinMaterialLight'} style={shape}>
          {inner}
        </BlurView>
      ) : (
        <View style={[shape, { backgroundColor: t.surfaceRaised, borderWidth: 1, borderColor: t.border }]}>{inner}</View>
      )}
    </PressableScale>
  );
}
