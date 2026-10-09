import { formatMoney, type FormatOptions } from '@budgi/core';
import { useStore } from '@/lib/store';
import { Text, type ThemedTextProps } from './Text';

export interface MoneyProps extends Omit<ThemedTextProps, 'children'> {
  cents: number;
  options?: FormatOptions;
  /** Color inflows green. */
  colorize?: boolean;
}

/** Formatted amount that respects "Hide amounts" privacy mode. */
export function Money({ cents, options, colorize, tone, ...rest }: MoneyProps) {
  const hidden = useStore((s) => s.settings.hideAmounts);
  const text = hidden ? '•••••' : formatMoney(cents, options);
  return (
    <Text numeric tone={tone ?? (colorize && cents > 0 ? 'positive' : undefined)} {...rest}>
      {text}
    </Text>
  );
}

export function useMoneyText() {
  const hidden = useStore((s) => s.settings.hideAmounts);
  return (cents: number, options?: FormatOptions) => (hidden ? '•••••' : formatMoney(cents, options));
}
