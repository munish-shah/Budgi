import { Platform, useColorScheme } from 'react-native';

const dark = {
  scheme: 'dark' as 'dark' | 'light',
  bg: '#08080A',
  surface: '#131316',
  surfaceRaised: '#1B1B1F',
  surfacePressed: '#232328',
  border: 'rgba(255,255,255,0.07)',
  separator: 'rgba(255,255,255,0.06)',
  text: '#F5F5F7',
  textSecondary: '#9C9CA5',
  textTertiary: '#5F5F68',
  accent: '#7CF2B0',
  accentStrong: '#3EE08C',
  accentMuted: 'rgba(124,242,176,0.14)',
  onAccent: '#04130B',
  positive: '#4ADE80',
  negative: '#FF6B6B',
  warning: '#FFC35C',
  chartGrid: 'rgba(255,255,255,0.06)',
  chartPrev: 'rgba(255,255,255,0.28)',
  shadow: '#000',
};

const light: typeof dark = {
  scheme: 'light',
  bg: '#F3F3F6',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfacePressed: '#ECECF0',
  border: 'rgba(0,0,0,0.06)',
  separator: 'rgba(0,0,0,0.06)',
  text: '#0B0B0E',
  textSecondary: '#6A6A73',
  textTertiary: '#A4A4AC',
  accent: '#0FAF62',
  accentStrong: '#0A9654',
  accentMuted: 'rgba(15,175,98,0.12)',
  onAccent: '#FFFFFF',
  positive: '#109A55',
  negative: '#E5484D',
  warning: '#D98A00',
  chartGrid: 'rgba(0,0,0,0.06)',
  chartPrev: 'rgba(0,0,0,0.22)',
  shadow: '#000',
};

export type Theme = typeof dark;
export const themes = { dark, light };

export function useTheme(): Theme {
  return useColorScheme() === 'light' ? light : dark;
}

export const fonts = {
  /** SF Pro Rounded on iOS — used for big numbers. */
  rounded: Platform.select({ ios: 'ui-rounded', web: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif', default: undefined }),
  mono: Platform.select({ ios: 'ui-monospace', web: 'ui-monospace, Menlo, monospace', default: 'monospace' }),
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const;

/** Snappy-but-soft spring used across the app. */
export const spring = { damping: 18, stiffness: 220, mass: 0.9 } as const;
export const softSpring = { damping: 22, stiffness: 140, mass: 1 } as const;

/** Mix a hex color with alpha. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
