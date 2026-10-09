import { SymbolView, type SymbolWeight } from 'expo-symbols';
import { Platform, Text } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

/** SF Symbol → Material Symbol, for the web/PWA build. */
const MATERIAL: Record<string, string> = {
  'gearshape.fill': 'settings',
  'eye.fill': 'visibility',
  'eye.slash.fill': 'visibility_off',
  'chevron.right': 'chevron_right',
  'chevron.left': 'chevron_left',
  'chevron.down': 'expand_more',
  plus: 'add',
  'plus.circle.fill': 'add_circle',
  checkmark: 'check',
  'checkmark.circle.fill': 'check_circle',
  xmark: 'close',
  'xmark.circle.fill': 'cancel',
  'arrow.up': 'arrow_upward',
  'arrow.down': 'arrow_downward',
  'arrow.right': 'arrow_forward',
  'arrow.uturn.right': 'redo',
  faceid: 'face_unlock',
  'lock.fill': 'lock',
  'lock.shield.fill': 'shield_lock',
  'checkmark.shield.fill': 'verified_user',
  'building.columns.fill': 'account_balance',
  sparkles: 'auto_awesome',
  'wand.and.stars': 'auto_fix_high',
  magnifyingglass: 'search',
  calendar: 'calendar_today',
  'arrow.clockwise': 'refresh',
  'arrow.triangle.2.circlepath': 'sync',
  'qrcode.viewfinder': 'qr_code_scanner',
  trash: 'delete',
  pencil: 'edit',
  'square.and.pencil': 'edit_square',
  'info.circle': 'info',
  'exclamationmark.triangle.fill': 'warning',
  repeat: 'repeat',
  'creditcard.fill': 'credit_card',
  'chart.line.uptrend.xyaxis': 'trending_up',
  'chart.pie.fill': 'pie_chart',
  'server.rack': 'dns',
  'key.fill': 'key',
  iphone: 'smartphone',
  'doc.on.doc': 'content_copy',
  'hand.raised.fill': 'back_hand',
  // categories
  'arrow.down.circle.fill': 'payments',
  'cart.fill': 'shopping_cart',
  'fork.knife': 'restaurant',
  'cup.and.saucer.fill': 'local_cafe',
  'car.fill': 'directions_car',
  'fuelpump.fill': 'local_gas_station',
  'bag.fill': 'shopping_bag',
  'popcorn.fill': 'movie',
  'repeat.circle.fill': 'autorenew',
  'bolt.fill': 'bolt',
  'house.fill': 'home',
  'heart.fill': 'medical_services',
  'figure.run': 'directions_run',
  airplane: 'flight',
  'graduationcap.fill': 'school',
  'gift.fill': 'redeem',
  'pawprint.fill': 'pets',
  percent: 'percent',
  'banknote.fill': 'local_atm',
  'arrow.left.arrow.right': 'swap_horiz',
  'questionmark.circle.fill': 'help',
  // tabs
  house: 'home',
  'list.bullet.rectangle': 'receipt_long',
  'chart.pie': 'pie_chart',
};

export interface IconProps {
  name: string;
  size?: number;
  color: string;
  weight?: SymbolWeight;
  /** Text to render if no symbol mapping exists. */
  fallback?: string;
}

export function Icon({ name, size = 18, color, weight = 'semibold', fallback }: IconProps) {
  const material = MATERIAL[name];
  if (Platform.OS === 'ios' || material) {
    return (
      <SymbolView
        name={{ ios: name as SFSymbol, android: material as never, web: material as never }}
        size={size}
        tintColor={color}
        weight={weight}
        resizeMode="scaleAspectFit"
        style={{ width: size, height: size }}
        fallback={<Text style={{ fontSize: size * 0.9, color }}>{fallback ?? '•'}</Text>}
      />
    );
  }
  return <Text style={{ fontSize: size * 0.9, lineHeight: size * 1.1, width: size * 1.2, textAlign: 'center', color }}>{fallback ?? '•'}</Text>;
}
