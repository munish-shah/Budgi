import { useEffect, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/lib/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface Pt {
  x: number;
  y: number;
}

/** Monotone cubic (Fritsch–Carlson): smooth, never overshoots — right for cumulative data. */
export function monotonePath(pts: Pt[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0]!.x},${pts[0]!.y}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]!.x - pts[i]!.x);
    slope.push((pts[i + 1]!.y - pts[i]!.y) / (dx[i] || 1));
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!;
    const b = slope[i]!;
    m.push(a * b <= 0 ? 0 : (3 * (dx[i - 1]! + dx[i]!)) / ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b));
  }
  m.push(slope[n - 2]!);
  let d = `M${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${(p0.x + h).toFixed(1)},${(p0.y + m[i]! * h).toFixed(1)} ${(p1.x - h).toFixed(1)},${(p1.y - m[i + 1]! * h).toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
  }
  return d;
}

function polylineLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return len * 1.05;
}

export interface SpendChartProps {
  /** Cumulative spend per day for the current month, only elapsed days. */
  current: number[];
  /** Cumulative spend per day for last month (full month). */
  previous: number[];
  daysInMonth: number;
  budget?: number;
  /** Where the budget pace line starts (fixed costs are due up front). */
  budgetStart?: number;
  height?: number;
  /** Called with the scrubbed day index (0-based) or null when released. */
  onScrub?: (day: number | null) => void;
}

const PAD_TOP = 14;
const PAD_BOTTOM = 6;

export function SpendChart({ current, previous, daysInMonth, budget, budgetStart = 0, height = 156, onScrub }: SpendChartProps) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  const geo = useMemo(() => {
    if (!width) return null;
    const days = Math.max(daysInMonth, 2);
    const maxY = Math.max(1, ...current, ...previous, budget ?? 0) * 1.08;
    const x = (i: number) => (i / (days - 1)) * (width - 8) + 4;
    const y = (v: number) => PAD_TOP + (1 - v / maxY) * (height - PAD_TOP - PAD_BOTTOM);
    const curPts = current.map((v, i) => ({ x: x(i), y: y(v) }));
    const prevPts = previous.slice(0, days).map((v, i) => ({ x: x(i), y: y(v) }));
    const curPath = monotonePath(curPts);
    const last = curPts[curPts.length - 1];
    const fill = last ? `${curPath}L${last.x.toFixed(1)},${height}L${curPts[0]!.x.toFixed(1)},${height}Z` : '';
    return {
      x,
      y,
      curPts,
      curPath,
      fill,
      prevPath: monotonePath(prevPts),
      curLen: polylineLength(curPts),
      last,
      budgetY: budget ? y(budget) : undefined,
      budgetStartY: y(Math.min(budgetStart, budget ?? 0)),
    };
  }, [width, height, current, previous, daysInMonth, budget, budgetStart]);

  // Draw-in animation whenever the data shape changes.
  const draw = useSharedValue(0);
  const fillOpacity = useSharedValue(0);
  const dataKey = `${current.length}:${current[current.length - 1] ?? 0}:${width}`;
  useEffect(() => {
    if (!geo) return;
    draw.value = 0;
    fillOpacity.value = 0;
    draw.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) });
    fillOpacity.value = withDelay(350, withTiming(1, { duration: 700 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);
  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: (geo?.curLen ?? 0) * (1 - draw.value) }));
  const fillProps = useAnimatedProps(() => ({ opacity: fillOpacity.value }));

  // Pulsing "today" dot.
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withDelay(1100, withRepeat(withSequence(withTiming(1, { duration: 1200 }), withTiming(0, { duration: 0 })), -1));
  }, [pulse]);
  const haloStyle = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - pulse.value) * fillOpacity.value, transform: [{ scale: 1 + pulse.value * 1.6 }] }));

  // Scrubbing.
  const scrubX = useSharedValue(-1);
  const [scrubDay, setScrubDay] = useState<number | null>(null);
  const lastDay = useRef<number | null>(null);
  const handleScrub = (px: number | null) => {
    if (px === null || !geo) {
      lastDay.current = null;
      setScrubDay(null);
      onScrub?.(null);
      return;
    }
    const maxIdx = Math.max(0, current.length - 1);
    const day = Math.max(0, Math.min(maxIdx, Math.round(((px - 4) / (width - 8)) * (Math.max(daysInMonth, 2) - 1))));
    if (day !== lastDay.current) {
      lastDay.current = day;
      haptic.select();
      setScrubDay(day);
      onScrub?.(day);
    }
  };
  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onBegin((e) => {
      scrubX.value = e.x;
    })
    .onUpdate((e) => {
      scrubX.value = e.x;
      scheduleOnRN(handleScrub, e.x);
    })
    .onFinalize(() => {
      scrubX.value = -1;
      scheduleOnRN(handleScrub, null);
    });
  const longPress = Gesture.LongPress()
    .minDuration(180)
    .onStart((e) => {
      scheduleOnRN(handleScrub, e.x);
    })
    .onFinalize(() => {
      scheduleOnRN(handleScrub, null);
    });

  const scrubPt = scrubDay !== null && geo ? geo.curPts[scrubDay] : undefined;

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pan, longPress)}>
      <View onLayout={onLayout} style={{ height }} accessibilityLabel="Cumulative spending this month compared with last month">
        {geo && (
          <>
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={t.accent} stopOpacity={0.32} />
                  <Stop offset="1" stopColor={t.accent} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              {[0.33, 0.66].map((f) => (
                <Line key={f} x1={0} x2={width} y1={PAD_TOP + f * (height - PAD_TOP)} y2={PAD_TOP + f * (height - PAD_TOP)} stroke={t.chartGrid} strokeWidth={1} />
              ))}
              {geo.budgetY !== undefined && (
                <Line x1={geo.x(0)} y1={geo.budgetStartY} x2={geo.x(Math.max(daysInMonth, 2) - 1)} y2={geo.budgetY} stroke={t.warning} strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="2 5" strokeLinecap="round" />
              )}
              <Path d={geo.prevPath} stroke={t.chartPrev} strokeWidth={2} strokeDasharray="1 6" strokeLinecap="round" fill="none" />
              <AnimatedPath d={geo.fill} fill="url(#fill)" animatedProps={fillProps} />
              <AnimatedPath
                d={geo.curPath}
                stroke={t.accent}
                strokeWidth={2.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                strokeDasharray={`${geo.curLen} ${geo.curLen}`}
                animatedProps={lineProps}
              />
              {scrubPt && (
                <>
                  <Line x1={scrubPt.x} x2={scrubPt.x} y1={0} y2={height} stroke={t.textSecondary} strokeOpacity={0.5} strokeWidth={1} />
                  <Circle cx={scrubPt.x} cy={scrubPt.y} r={5.5} fill={t.bg} stroke={t.accent} strokeWidth={2.5} />
                </>
              )}
              {!scrubPt && geo.last && <Circle cx={geo.last.x} cy={geo.last.y} r={4.5} fill={t.accent} />}
            </Svg>
            {!scrubPt && geo.last && (
              <Animated.View
                pointerEvents="none"
                style={[{ position: 'absolute', left: geo.last.x - 5, top: geo.last.y - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: t.accent }, haloStyle]}
              />
            )}
          </>
        )}
      </View>
    </GestureDetector>
  );
}
