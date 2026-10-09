import { describe, expect, it } from 'vitest';
import { toCents, formatMoney, formatMoneyShort } from '../src/money';
import { addMonths, daysInMonth, relativeDayLabel, daysBetween, addDays } from '../src/dates';

describe('money', () => {
  it('parses decimals exactly', () => {
    expect(toCents('12.34')).toBe(1234);
    expect(toCents('-0.07')).toBe(-7);
    expect(toCents('1,234.5')).toBe(123450);
    expect(toCents('0.105')).toBe(11);
    expect(toCents(19.99)).toBe(1999);
    expect(() => toCents('abc')).toThrow();
  });
  it('formats', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(-500, { compact: true })).toBe('-$5');
    expect(formatMoney(500, { signed: true })).toBe('+$5.00');
    expect(formatMoneyShort(1_234_00)).toBe('$1.2k');
    expect(formatMoneyShort(25_000_00)).toBe('$25k');
  });
});

describe('dates', () => {
  it('handles month math', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('labels days', () => {
    expect(relativeDayLabel('2026-10-09', '2026-10-09')).toBe('Today');
    expect(relativeDayLabel('2026-10-08', '2026-10-09')).toBe('Yesterday');
    expect(relativeDayLabel('2026-10-05', '2026-10-09')).toBe('Monday');
    expect(relativeDayLabel('2026-09-01', '2026-10-09')).toBe('Sep 1');
    expect(relativeDayLabel('2025-09-01', '2026-10-09')).toBe('Sep 1, 2025');
  });
});
