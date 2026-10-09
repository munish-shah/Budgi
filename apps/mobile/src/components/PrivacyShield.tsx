import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { BudgiMark } from './BudgiMark';

/**
 * Covers the screen whenever the app isn't active, so the iOS app switcher
 * snapshot never shows balances or transactions.
 */
export function PrivacyShield() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (s) => setVisible(s !== 'active'));
    return () => sub.remove();
  }, []);
  if (!visible) return null;
  return (
    <Animated.View entering={FadeIn.duration(80)} exiting={FadeOut.duration(200)} style={{ position: 'absolute', inset: 0, zIndex: 200 }}>
      <BlurView intensity={80} tint="systemChromeMaterialDark" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <BudgiMark size={64} />
      </BlurView>
    </Animated.View>
  );
}
