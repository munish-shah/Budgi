import type { Cents } from './types';

/** Parse a decimal string/number ("12.34", "-5", 12.3) into integer cents. */
export function toCents(value: string | number): Cents {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${value}`);
    return Math.round(value * 100);
  }
  const trimmed = value.trim().replace(/[,$\s]/g, '');
  if (!/^[-+]?\d*(\.\d+)?$/.test(trimmed) || trimmed === '' || trimmed === '-' || trimmed === '+') {
    throw new Error(`Invalid amount: ${value}`);
  }
  const negative = trimmed.startsWith('-');
  const unsigned = trimmed.replace(/^[-+]/, '');
  const [whole = '0', frac = ''] = unsigned.split('.');
  // Round half away from zero on the third decimal.
  const padded = (frac + '000').slice(0, 3);
  let cents = Number(whole || '0') * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1;
  return negative ? -cents : cents;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, fractionDigits: number): Intl.NumberFormat {
  const key = `${currency}:${fractionDigits}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formatters.set(key, f);
  }
  return f;
}

export interface FormatOptions {
  currency?: string;
  /** Drop cents for whole-dollar values (e.g. "$1,200"). */
  compact?: boolean;
  /** Always show a + for positive values. */
  signed?: boolean;
  /** Show the absolute value. */
  abs?: boolean;
}

export function formatMoney(cents: Cents, opts: FormatOptions = {}): string {
  const { currency = 'USD', compact = false, signed = false, abs = false } = opts;
  const value = abs ? Math.abs(cents) : cents;
  const digits = compact && value % 100 === 0 ? 0 : 2;
  const text = formatter(currency, digits).format(value / 100);
  return signed && value > 0 ? `+${text}` : text;
}

/** Short form for charts and tight spaces: $1.2k, $35, $1.4M. */
export function formatMoneyShort(cents: Cents, currency = 'USD'): string {
  const abs = Math.abs(cents) / 100;
  const sign = cents < 0 ? '-' : '';
  const symbol = currency === 'USD' ? '$' : '';
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 10_000) return `${sign}${symbol}${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sign}${symbol}${Math.round(abs)}`;
}
