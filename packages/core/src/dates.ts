import type { ISODate } from './types';

/** `YYYY-MM` key for grouping by month. */
export type MonthKey = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse `YYYY-MM-DD` as a local calendar date (no timezone shift). */
export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function monthKey(date: ISODate | Date): MonthKey {
  if (typeof date === 'string') return date.slice(0, 7);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function addMonths(key: MonthKey, delta: number): MonthKey {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y ?? 1970, (m ?? 1) - 1 + delta, 1);
  return monthKey(d);
}

export function daysInMonth(key: MonthKey): number {
  const [y, m] = key.split('-').map(Number);
  return new Date(y ?? 1970, m ?? 1, 0).getDate();
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = parseISODate(date);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = parseISODate(b).getTime() - parseISODate(a).getTime();
  return Math.round(ms / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function monthLabel(key: MonthKey, long = true): string {
  const m = Number(key.slice(5, 7)) - 1;
  return (long ? MONTHS_LONG : MONTHS)[m] ?? key;
}

/** "Today", "Yesterday", "Monday", or "Mar 4" (with year if not current). */
export function relativeDayLabel(date: ISODate, today: ISODate = toISODate(new Date())): string {
  const diff = daysBetween(date, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const d = parseISODate(date);
  if (diff > 1 && diff < 7) return WEEKDAYS[d.getDay()] ?? date;
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return sameYear ? base : `${base}, ${d.getFullYear()}`;
}

export function shortDate(date: ISODate): string {
  const d = parseISODate(date);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
