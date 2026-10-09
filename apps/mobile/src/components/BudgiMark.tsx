import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/** App mark: a rising spend line ending in a dot, on a mint gradient tile. */
export function BudgiMark({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#9BF7C4" />
          <Stop offset="1" stopColor="#2FD07F" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="64" height="64" rx="18" fill="url(#bm)" />
      <Path d="M14 44 C 22 44, 24 34, 31 33 S 40 24, 48 20" stroke="#05170D" strokeWidth="5.5" strokeLinecap="round" fill="none" />
      <Circle cx="48" cy="20" r="5" fill="#05170D" />
    </Svg>
  );
}
