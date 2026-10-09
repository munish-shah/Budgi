import { Children, Fragment, type ReactNode } from 'react';
import { Switch, View } from 'react-native';
import { radius, useTheme } from '@/lib/theme';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/** iOS-style inset grouped list. */
export function ListGroup({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const t = useTheme();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={{ marginTop: 22 }}>
      {title && (
        <Text variant="overline" tone="tertiary" style={{ marginLeft: 16, marginBottom: 8 }}>
          {title}
        </Text>
      )}
      <View style={{ backgroundColor: t.surface, borderRadius: radius.md, borderCurve: 'continuous', borderWidth: 1, borderColor: t.border, overflow: 'hidden' }}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {i > 0 && <View style={{ height: 1, backgroundColor: t.separator, marginLeft: 52 }} />}
            {child}
          </Fragment>
        ))}
      </View>
      {footer && (
        <Text variant="footnote" tone="tertiary" style={{ marginHorizontal: 16, marginTop: 8 }}>
          {footer}
        </Text>
      )}
    </View>
  );
}

export interface ListRowProps {
  icon?: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  toggle?: { value: boolean; onChange: (v: boolean) => void };
  right?: ReactNode;
  chevron?: boolean;
}

export function ListRow({ icon, iconColor, title, subtitle, value, onPress, destructive, toggle, right, chevron = !!onPress }: ListRowProps) {
  const t = useTheme();
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10 }}>
      {icon && (
        <View style={{ width: 28, height: 28, borderRadius: 8, borderCurve: 'continuous', backgroundColor: iconColor ?? t.surfacePressed, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={15} color={iconColor ? '#fff' : t.text} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" style={destructive ? { color: t.negative } : undefined}>
          {title}
        </Text>
        {subtitle && (
          <Text variant="footnote" tone="secondary">
            {subtitle}
          </Text>
        )}
      </View>
      {value && (
        <Text variant="body" tone="secondary" numberOfLines={1} style={{ maxWidth: '45%' }}>
          {value}
        </Text>
      )}
      {right}
      {toggle && <Switch value={toggle.value} onValueChange={toggle.onChange} trackColor={{ true: t.accentStrong, false: undefined }} />}
      {chevron && <Icon name="chevron.right" size={13} color={t.textTertiary} />}
    </View>
  );
  return onPress ? (
    <PressableScale onPress={onPress} activeScale={0.99}>
      {content}
    </PressableScale>
  ) : (
    content
  );
}
