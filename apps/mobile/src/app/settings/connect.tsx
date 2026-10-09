import { DEMO_CONNECTION } from '@budgi/core';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, TextInput, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { ListGroup, ListRow } from '@/components/List';
import { PressableScale } from '@/components/PressableScale';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';
import { getRelayConfig } from '@/lib/relay';
import { useStore, type Connection } from '@/lib/store';
import { connectPlaid, connectSimpleFin, disconnect, syncAll } from '@/lib/sync';
import { alpha, radius, useTheme } from '@/lib/theme';

function timeAgo(iso?: string) {
  if (!iso) return 'Never synced';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins}m ago`;
  if (mins < 1440) return `Synced ${Math.round(mins / 60)}h ago`;
  return `Synced ${Math.round(mins / 1440)}d ago`;
}

export default function Connect() {
  const t = useTheme();
  const connections = useStore((s) => s.connections);
  const accounts = useStore((s) => s.accounts);
  const syncing = useStore((s) => s.syncing);
  const loadDemo = useStore((s) => s.loadDemo);
  const [paired, setPaired] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [showSimpleFin, setShowSimpleFin] = useState(false);

  useEffect(() => {
    void getRelayConfig().then((c) => setPaired(!!c));
  }, []);

  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      if (success) {
        haptic.success();
        toast({ title: success, icon: 'checkmark.circle.fill' });
      }
    } catch (e) {
      haptic.error();
      toast({ title: 'Something went wrong', message: e instanceof Error ? e.message : String(e), icon: 'exclamationmark.triangle.fill', duration: 5000 });
    } finally {
      setBusy(null);
    }
  };

  const addPlaid = () => {
    if (!paired) return router.push('/pair');
    void run('plaid', async () => {
      const conn = await connectPlaid();
      if (conn) toast({ title: `${conn.name} connected`, message: 'Importing transactions…', icon: 'checkmark.circle.fill' });
    });
  };

  const remove = (c: Connection) => {
    const go = () => run(c.id, () => disconnect(c), `${c.name} removed`);
    if (Platform.OS === 'web') return void go();
    Alert.alert(`Remove ${c.name}?`, 'Its accounts and transactions are deleted from this device. Rules and budgets stay.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void go() },
    ]);
  };

  const hasDemo = connections.some((c) => c.id === DEMO_CONNECTION);

  return (
    <Screen>
      {connections.length > 0 && (
        <ListGroup title="Connected">
          {connections.map((c) => {
            const n = Object.values(accounts).filter((a) => a.connectionId === c.id).length;
            return (
              <ListRow
                key={c.id}
                icon={c.provider === 'demo' ? 'sparkles' : 'building.columns.fill'}
                iconColor={c.error ? '#F59E0B' : c.provider === 'plaid' ? '#111827' : c.provider === 'simplefin' ? '#0EA5E9' : '#8B5CF6'}
                title={c.name}
                subtitle={c.needsRelink ? 'Sign-in required — tap to fix' : c.error ? c.error : `${n} account${n === 1 ? '' : 's'} · ${c.provider === 'demo' ? 'Sample data' : timeAgo(c.lastSyncAt)}`}
                onPress={c.needsRelink ? () => void run(c.id, () => connectPlaid(c.id), 'Reconnected') : undefined}
                right={
                  busy === c.id ? (
                    <ActivityIndicator />
                  ) : (
                    <PressableScale onPress={() => remove(c)} style={{ padding: 6 }} accessibilityLabel={`Remove ${c.name}`}>
                      <Icon name="trash" size={16} color={t.textTertiary} />
                    </PressableScale>
                  )
                }
                chevron={false}
              />
            );
          })}
        </ListGroup>
      )}

      {connections.some((c) => c.provider !== 'demo') && (
        <PressableScale
          onPress={() => void run('sync', () => syncAll(true), 'Up to date')}
          style={{ marginTop: 12, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border }}>
          {syncing ? <ActivityIndicator /> : <Icon name="arrow.clockwise" size={15} color={t.accent} />}
          <Text variant="callout" tone="accent" weight="600">
            Sync now
          </Text>
        </PressableScale>
      )}

      <Text variant="overline" tone="tertiary" style={{ marginTop: 28, marginBottom: 10, marginLeft: 4 }}>
        Add an account
      </Text>

      <Animated.View layout={LinearTransition} style={{ gap: 10 }}>
        <Option
          icon="building.columns.fill"
          color="#22C55E"
          title="Bank or card via Plaid"
          body={paired ? '12,000+ institutions. Sign in with your bank inside Plaid — Budgi never sees your password.' : 'Requires your private Budgi relay (one-time setup). Tap to pair.'}
          badge={paired ? 'Relay connected' : 'Set up relay'}
          busy={busy === 'plaid'}
          onPress={addPlaid}
        />
        <Option
          icon="key.fill"
          color="#0EA5E9"
          title="SimpleFIN Bridge"
          body="No server needed. Read-only access you control at beta-bridge.simplefin.org; paste a setup token."
          onPress={() => setShowSimpleFin((v) => !v)}
        />
        {showSimpleFin && (
          <Animated.View entering={FadeInDown.springify().damping(18)}>
            <Card style={{ gap: 10 }}>
              <Text variant="footnote" tone="secondary">
                In SimpleFIN Bridge, create a new app connection, copy the Setup Token, and paste it here. It’s exchanged once for a private access key stored in your Keychain.
              </Text>
              <TextInput
                value={token}
                onChangeText={setToken}
                placeholder="Paste setup token"
                placeholderTextColor={t.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={{ height: 46, borderRadius: radius.sm, backgroundColor: t.surfaceRaised, color: t.text, paddingHorizontal: 12, fontSize: 15, borderWidth: 1, borderColor: t.border }}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <PressableScale
                  onPress={async () => setToken((await Clipboard.getStringAsync()).trim())}
                  style={{ flex: 1, height: 42, borderRadius: radius.pill, backgroundColor: t.surfacePressed, alignItems: 'center', justifyContent: 'center' }}>
                  <Text variant="callout" weight="600">
                    Paste
                  </Text>
                </PressableScale>
                <PressableScale
                  disabled={!token.trim() || busy === 'sf'}
                  onPress={() =>
                    void run(
                      'sf',
                      async () => {
                        await connectSimpleFin(token);
                        setToken('');
                        setShowSimpleFin(false);
                      },
                      'SimpleFIN connected',
                    )
                  }
                  style={{ flex: 2, height: 42, borderRadius: radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: token.trim() ? 1 : 0.4 }}>
                  {busy === 'sf' ? (
                    <ActivityIndicator color={t.onAccent} />
                  ) : (
                    <Text variant="callout" tone="onAccent" weight="700">
                      Connect
                    </Text>
                  )}
                </PressableScale>
              </View>
            </Card>
          </Animated.View>
        )}
        <Option
          icon="sparkles"
          color="#8B5CF6"
          title={hasDemo ? 'Remove demo data' : 'Explore with demo data'}
          body={hasDemo ? 'Clears the sample accounts and transactions.' : 'Five months of realistic sample data. Remove it anytime.'}
          busy={busy === 'demo'}
          onPress={() =>
            void run(
              'demo',
              async () => {
                const demo = connections.find((c) => c.id === DEMO_CONNECTION);
                if (demo) await disconnect(demo);
                else await loadDemo();
              },
              hasDemo ? 'Demo data removed' : 'Demo data loaded',
            )
          }
        />
      </Animated.View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 24, paddingHorizontal: 4 }}>
        <Icon name="lock.shield.fill" size={16} color={t.textTertiary} />
        <Text variant="footnote" tone="tertiary" style={{ flex: 1 }}>
          Connections are read-only. Plaid access tokens are encrypted on your relay and never sent to this phone; SimpleFIN keys never leave the Keychain.
        </Text>
      </View>
    </Screen>
  );
}

function Option({ icon, color, title, body, badge, onPress, busy }: { icon: string; color: string; title: string; body: string; badge?: string; onPress: () => void; busy?: boolean }) {
  const t = useTheme();
  return (
    <Card onPress={onPress} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
      <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: alpha(color, 0.16), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={color} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="headline">{title}</Text>
          {badge && (
            <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: alpha(color, 0.15) }}>
              <Text variant="caption" style={{ color, fontSize: 10 }}>
                {badge}
              </Text>
            </View>
          )}
        </View>
        <Text variant="footnote" tone="secondary">
          {body}
        </Text>
      </View>
      {busy ? <ActivityIndicator /> : <Icon name="chevron.right" size={13} color={t.textTertiary} />}
    </Card>
  );
}
