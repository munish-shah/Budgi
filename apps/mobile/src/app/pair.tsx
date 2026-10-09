import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { ListGroup, ListRow } from '@/components/List';
import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/Text';
import { toast, ToastHost } from '@/components/Toast';
import { haptic } from '@/lib/haptics';
import { deviceFingerprint, forgetRelay, getRelayConfig, pairWithRelay, relay, relayStatus, SAME_ORIGIN_RELAY, type RelayConfig } from '@/lib/relay';
import { alpha, fonts, radius, useTheme } from '@/lib/theme';

type Device = Awaited<ReturnType<typeof relay.devices>>['devices'][number];

/** Parse `budgi://pair?u=<url>&c=<code>` from the relay's QR code. */
function parsePairLink(data: string): { url: string; code: string } | null {
  const m = /^budgi:\/\/pair\?(.*)$/.exec(data.trim());
  if (!m) return null;
  const params = Object.fromEntries(m[1]!.split('&').map((kv) => kv.split('=').map(decodeURIComponent) as [string, string]));
  return params.u && params.c ? { url: params.u, code: params.c } : null;
}

export default function Pair() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ u?: string; c?: string }>();
  const [url, setUrl] = useState(params.u ?? SAME_ORIGIN_RELAY ?? '');
  const [code, setCode] = useState(params.c ?? '');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [config, setConfig] = useState<RelayConfig | null>(null);
  const [fingerprint, setFingerprint] = useState('');
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [status, setStatus] = useState<string>();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [newCode, setNewCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const isWeb = Platform.OS === 'web';

  const refresh = async () => {
    const c = await getRelayConfig();
    setConfig(c);
    if (!c) {
      if (SAME_ORIGIN_RELAY) setNeedsSetup((await relayStatus())?.needsSetup ?? null);
      return;
    }
    setFingerprint(await deviceFingerprint());
    try {
      const me = await relay.me();
      setStatus(`Connected · Plaid ${me.plaidEnabled ? me.plaidEnv : 'not configured'} · v${me.version}`);
      setDevices((await relay.devices()).devices);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Unreachable');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const pair = async (u = url, c = code) => {
    setBusy(true);
    try {
      const name = isWeb ? webDeviceName() : `${Constants.deviceName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Device')}`;
      await pairWithRelay(u, c, name);
      haptic.success();
      toast({ title: isWeb ? 'Device paired' : 'Relay connected', message: 'You can now link banks through Plaid.', icon: 'checkmark.circle.fill' });
      setCode('');
      await refresh();
    } catch (e) {
      haptic.error();
      toast({ title: 'Pairing failed', message: e instanceof Error ? e.message : String(e), icon: 'exclamationmark.triangle.fill', duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  const startScan = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    setScanning(true);
  };

  const forget = () => {
    const go = async () => {
      await forgetRelay();
      setConfig(null);
      setDevices(null);
      haptic.warning();
    };
    if (Platform.OS === 'web') return void go();
    Alert.alert('Disconnect relay?', 'This device’s key is deleted. Plaid accounts stop syncing until you pair again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void go() },
    ]);
  };

  const input = { height: 48, borderRadius: radius.sm, backgroundColor: t.surface, color: t.text, paddingHorizontal: 14, fontSize: 16, borderWidth: 1, borderColor: t.border };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: isWeb ? 'Budgi server' : 'Relay server',
          headerStyle: { backgroundColor: t.bg },
          headerTitleStyle: { color: t.text },
          headerShadowVisible: false,
          headerRight: () => (
            <PressableScale onPress={() => router.back()} style={{ padding: 6 }}>
              <Text variant="body" tone="accent" weight="700">
                Done
              </Text>
            </PressableScale>
          ),
        }}
      />
      {scanning ? (
        <View style={{ flex: 1 }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              const parsed = parsePairLink(data);
              if (!parsed) return;
              setScanning(false);
              haptic.success();
              setUrl(parsed.url);
              setCode(parsed.code);
              void pair(parsed.url, parsed.code);
            }}
          />
          <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View entering={ZoomIn.springify()} style={{ width: 240, height: 240, borderRadius: 28, borderWidth: 3, borderColor: t.accent }} />
            <Text variant="callout" style={{ color: '#fff', marginTop: 20 }}>
              Scan the QR code from `npm run pair`
            </Text>
          </View>
          <PressableScale onPress={() => setScanning(false)} style={{ position: 'absolute', bottom: insets.bottom + 24, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 22, height: 46, borderRadius: 23, justifyContent: 'center' }}>
            <Text variant="headline" style={{ color: '#fff' }}>
              Cancel
            </Text>
          </PressableScale>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          {config ? (
            <Animated.View entering={FadeIn}>
              <View style={{ alignItems: 'center', gap: 10, paddingVertical: 18 }}>
                <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: alpha(t.accent, 0.15), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="checkmark.shield.fill" size={30} color={t.accent} fallback="✓" />
                </View>
                <Text variant="title3">{isWeb ? 'This device is paired' : config.url.replace(/^https?:\/\//, '')}</Text>
                <Text variant="footnote" tone="secondary" align="center">
                  {status ?? 'Checking…'}
                </Text>
              </View>
              <ListGroup
                title="This device"
                footer={
                  isWeb
                    ? 'Every request is signed with a key that never leaves this device (stored encrypted). Your server only knows its public half.'
                    : 'Every request is signed with a key stored in this phone’s Keychain. Compare this fingerprint with `npm run cli devices` on the server.'
                }>
                <ListRow icon="key.fill" iconColor="#6366F1" title="Key fingerprint" right={<Text variant="footnote" tone="secondary" style={{ fontFamily: fonts.mono }}>{fingerprint}</Text>} chevron={false} />
              </ListGroup>
              {devices && (
                <ListGroup title="Paired devices">
                  {devices.map((d) => (
                    <ListRow
                      key={d.id}
                      icon="iphone"
                      iconColor={d.revoked ? '#6B7280' : '#0EA5E9'}
                      title={`${d.name}${d.current ? ' (this device)' : ''}`}
                      subtitle={d.revoked ? 'Revoked' : d.lastSeenAt ? `Last seen ${new Date(d.lastSeenAt).toLocaleString()}` : 'Never used'}
                      right={
                        !d.current && !d.revoked ? (
                          <PressableScale
                            onPress={async () => {
                              await relay.revokeDevice(d.id);
                              haptic.warning();
                              void refresh();
                            }}>
                            <Text variant="subhead" tone="negative">
                              Revoke
                            </Text>
                          </PressableScale>
                        ) : undefined
                      }
                      chevron={false}
                    />
                  ))}
                </ListGroup>
              )}
              <ListGroup title="Add another device" footer="Open Budgi on your other device (for example your Mac at this site's address), choose pair, and enter this code. It works once and expires in 10 minutes.">
                {newCode ? (
                  <ListRow icon="key.fill" iconColor="#22C55E" title={newCode.code} subtitle={`Expires ${new Date(newCode.expiresAt).toLocaleTimeString()}`} chevron={false} />
                ) : (
                  <ListRow
                    icon="plus"
                    iconColor="#22C55E"
                    title="Create a pairing code"
                    onPress={async () => {
                      try {
                        setNewCode(await relay.pairingCode());
                        haptic.success();
                      } catch (e) {
                        toast({ title: 'Couldn’t create a code', message: e instanceof Error ? e.message : String(e), icon: 'exclamationmark.triangle.fill' });
                      }
                    }}
                  />
                )}
              </ListGroup>
              <ListGroup>
                <ListRow title="Disconnect this device" destructive onPress={forget} chevron={false} />
              </ListGroup>
            </Animated.View>
          ) : (
            isWeb ? (
              <Animated.View entering={FadeInDown.springify().damping(18)} style={{ gap: 12 }}>
                <Text variant="title3" style={{ marginTop: 8 }}>
                  {needsSetup === false ? 'Pair this device' : 'Pair your first device'}
                </Text>
                <Text variant="footnote" tone="secondary">
                  {needsSetup === false
                    ? 'On a device that’s already paired, open Settings → Budgi server → Create a pairing code, and enter it here.'
                    : 'Enter the setup key printed when you deployed Budgi. It only works once — for your first device.'}
                </Text>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  placeholder={needsSetup === false ? 'Pairing code (XXXXX-XXXXX)' : 'Setup key'}
                  placeholderTextColor={t.textTertiary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={[input, { fontFamily: fonts.mono }]}
                />
                <PressableScale
                  disabled={!code || busy}
                  onPress={() => void pair(SAME_ORIGIN_RELAY, code)}
                  style={{ height: 50, borderRadius: radius.pill, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: code ? 1 : 0.5 }}>
                  {busy ? <ActivityIndicator color={t.onAccent} /> : <Text variant="headline" tone="onAccent">Pair this device</Text>}
                </PressableScale>
                <Text variant="caption" tone="tertiary">
                  Pairing creates a signing key that never leaves this device. Your server only accepts requests signed with it.
                </Text>
              </Animated.View>
            ) : (
            <Animated.View entering={FadeInDown.springify().damping(18)} style={{ gap: 12 }}>
              <Text variant="title3" style={{ marginTop: 8 }}>
                Connect your private relay
              </Text>
              <Text variant="footnote" tone="secondary">
                Plaid requires a server to hold its API keys. The Budgi relay is a tiny server you run (on a Mac, a Raspberry Pi or a $5 VPS). It stores no transactions — only your encrypted bank tokens.
              </Text>
              <View style={{ backgroundColor: t.surface, borderRadius: radius.md, padding: 14, gap: 6, borderWidth: 1, borderColor: t.border }}>
                <Text variant="caption" tone="tertiary">
                  ON YOUR SERVER
                </Text>
                <Text variant="footnote" style={{ fontFamily: fonts.mono }} selectable>
                  npm run server{'\n'}npm run server:pair
                </Text>
              </View>
              {Platform.OS !== 'web' && (
                <PressableScale onPress={startScan} style={{ height: 50, borderRadius: radius.pill, backgroundColor: t.accent, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 6 }}>
                  <Icon name="qrcode.viewfinder" size={18} color={t.onAccent} />
                  <Text variant="headline" tone="onAccent">
                    Scan pairing code
                  </Text>
                </PressableScale>
              )}
              <Text variant="overline" tone="tertiary" style={{ marginTop: 10 }}>
                Or enter manually
              </Text>
              <TextInput value={url} onChangeText={setUrl} placeholder="https://budgi.your-tailnet.ts.net" placeholderTextColor={t.textTertiary} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={input} />
              <TextInput value={code} onChangeText={setCode} placeholder="Pairing code (XXXXX-XXXXX)" placeholderTextColor={t.textTertiary} autoCapitalize="characters" autoCorrect={false} style={[input, { fontFamily: fonts.mono }]} />
              <PressableScale
                disabled={!url || !code || busy}
                onPress={() => void pair()}
                style={{ height: 50, borderRadius: radius.pill, backgroundColor: t.surfaceRaised, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center', opacity: url && code ? 1 : 0.5 }}>
                {busy ? <ActivityIndicator /> : <Text variant="headline">Pair this device</Text>}
              </PressableScale>
              <Text variant="caption" tone="tertiary">
                Tip: deploy Budgi to Cloudflare’s free tier (`npm run deploy`) and use that address — nothing to keep running yourself.
              </Text>
            </Animated.View>
            )
          )}
        </ScrollView>
      )}
      <ToastHost inModal />
    </View>
  );
}

function webDeviceName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPhone/.test(ua)) return 'iPhone (web app)';
  if (/iPad/.test(ua)) return 'iPad (web app)';
  if (/Mac/.test(ua)) return 'Mac (web app)';
  return 'Browser';
}
