import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const enabled = Platform.OS === 'ios';

export const haptic = {
  tap: () => enabled && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  soft: () => enabled && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
  select: () => enabled && void Haptics.selectionAsync(),
  success: () => enabled && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => enabled && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => enabled && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};
