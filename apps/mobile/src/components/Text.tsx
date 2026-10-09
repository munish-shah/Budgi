import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { fonts, useTheme } from '@/lib/theme';

const variants = {
  hero: { fontSize: 44, fontWeight: '700', letterSpacing: -1.2, fontFamily: fonts.rounded },
  largeTitle: { fontSize: 32, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  title3: { fontSize: 19, fontWeight: '600', letterSpacing: -0.3 },
  headline: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: '400', letterSpacing: -0.2 },
  callout: { fontSize: 15, fontWeight: '500', letterSpacing: -0.15 },
  subhead: { fontSize: 14, fontWeight: '500', letterSpacing: -0.1 },
  footnote: { fontSize: 13, fontWeight: '400', letterSpacing: -0.05 },
  caption: { fontSize: 12, fontWeight: '500', letterSpacing: 0 },
  overline: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
} satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof variants;
type Tone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'positive' | 'negative' | 'warning' | 'onAccent';

export interface ThemedTextProps extends TextProps {
  variant?: TextVariant;
  tone?: Tone;
  /** Tabular numerals so digits don't jitter. */
  numeric?: boolean;
  weight?: TextStyle['fontWeight'];
  align?: TextStyle['textAlign'];
}

export function Text({ variant = 'body', tone = 'primary', numeric, weight, align, style, ...rest }: ThemedTextProps) {
  const t = useTheme();
  const color = {
    primary: t.text,
    secondary: t.textSecondary,
    tertiary: t.textTertiary,
    accent: t.accent,
    positive: t.positive,
    negative: t.negative,
    warning: t.warning,
    onAccent: t.onAccent,
  }[tone];
  return (
    <RNText
      maxFontSizeMultiplier={1.6}
      {...rest}
      style={[
        variants[variant],
        { color },
        numeric && { fontVariant: ['tabular-nums'] },
        weight && { fontWeight: weight },
        align && { textAlign: align },
        style,
      ]}
    />
  );
}
