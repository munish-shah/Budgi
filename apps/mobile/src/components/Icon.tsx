import { SymbolView, type SymbolWeight } from 'expo-symbols';
import { Platform, Text } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

/** Minimal web/Android fallbacks for the SF Symbols we use outside categories. */
const FALLBACK: Record<string, string> = {
  'gearshape.fill': '⚙︎',
  'eye.fill': '👁',
  'eye.slash.fill': '◌',
  'chevron.right': '›',
  'chevron.left': '‹',
  'chevron.down': '⌄',
  plus: '+',
  'plus.circle.fill': '+',
  'checkmark': '✓',
  'checkmark.circle.fill': '✓',
  xmark: '✕',
  'xmark.circle.fill': '✕',
  'arrow.up.arrow.down': '⇅',
  'arrow.up': '↑',
  'arrow.down': '↓',
  'faceid': '◉',
  'lock.fill': '🔒',
  'lock.shield.fill': '🛡',
  'building.columns.fill': '🏦',
  'sparkles': '✦',
  'wand.and.stars': '✦',
  'tray.full.fill': '▤',
  'magnifyingglass': '⌕',
  'calendar': '◷',
  'arrow.clockwise': '↻',
  'qrcode.viewfinder': '▣',
  'trash': '🗑',
  'pencil': '✎',
  'square.and.pencil': '✎',
  'line.3.horizontal.decrease': '≡',
  'slider.horizontal.3': '≡',
  'bolt.horizontal.fill': '⚡︎',
  'info.circle': 'ⓘ',
  'exclamationmark.triangle.fill': '⚠︎',
  'arrow.triangle.2.circlepath': '↻',
  'repeat': '↻',
  'creditcard.fill': '▭',
  'chart.line.uptrend.xyaxis': '↗',
  'server.rack': '▦',
  'key.fill': '⚿',
  'iphone': '▯',
  'hand.raised.fill': '✋',
  'doc.on.doc': '⧉',
  'chart.pie.fill': '◔',
  'arrow.right': '→',
  'arrow.uturn.right': '↷',
  'checkmark.shield.fill': '✓',
  'plus.circle': '+',
};

export interface IconProps {
  name: string;
  size?: number;
  color: string;
  weight?: SymbolWeight;
  /** Text to render where SF Symbols are unavailable (web). */
  fallback?: string;
}

export function Icon({ name, size = 18, color, weight = 'semibold', fallback }: IconProps) {
  if (Platform.OS === 'ios') {
    return <SymbolView name={name as SFSymbol} size={size} tintColor={color} weight={weight} resizeMode="scaleAspectFit" style={{ width: size, height: size }} />;
  }
  return (
    <Text style={{ fontSize: size * 0.9, lineHeight: size * 1.1, width: size * 1.2, textAlign: 'center', color }}>
      {fallback ?? FALLBACK[name] ?? '•'}
    </Text>
  );
}
