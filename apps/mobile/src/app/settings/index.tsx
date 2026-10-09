import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { BudgiMark } from '@/components/BudgiMark';
import { ListGroup, ListRow } from '@/components/List';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { toast } from '@/components/Toast';
import { haptic } from '@/lib/haptics';
import { biometryLabel, useLock } from '@/lib/lock';
import { getRelayConfig } from '@/lib/relay';
import { useStore } from '@/lib/store';

const LOCK_AFTER = [
  { s: 0, label: 'Immediately' },
  { s: 60, label: 'After 1 minute' },
  { s: 300, label: 'After 5 minutes' },
  { s: 900, label: 'After 15 minutes' },
];

export default function Settings() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const encrypted = useStore((s) => s.encrypted);
  const connections = useStore((s) => s.connections);
  const rulesCount = useStore((s) => s.rules.length);
  const wipeAll = useStore((s) => s.wipeAll);
  const lockWarning = useLock((s) => s.warning);
  const [bio, setBio] = useState('Face ID');
  const [relayUrl, setRelayUrl] = useState<string | null>(null);

  useEffect(() => {
    void biometryLabel().then(setBio);
    void getRelayConfig().then((c) => setRelayUrl(c?.url ?? null));
  }, []);

  const lockAfter = LOCK_AFTER.find((l) => l.s === settings.lockAfterSeconds) ?? LOCK_AFTER[1]!;
  const cycleLockAfter = () => {
    const i = LOCK_AFTER.indexOf(lockAfter);
    update({ lockAfterSeconds: LOCK_AFTER[(i + 1) % LOCK_AFTER.length]!.s });
    haptic.select();
  };

  const toggleLock = async (v: boolean) => {
    // Turning the lock off requires proving you're the owner.
    if (!v && !(await useLock.getState().verify('Turn off App Lock'))) return;
    update({ lockEnabled: v });
  };

  const erase = () => {
    const run = async () => {
      await wipeAll();
      haptic.warning();
      toast({ title: 'All data erased from this device', icon: 'trash' });
      router.dismissAll();
    };
    if (Platform.OS === 'web') return void run();
    Alert.alert('Erase everything?', 'Deletes all transactions, rules, budgets and keys stored on this device. Your bank connections on the relay are not affected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Erase', style: 'destructive', onPress: () => void run() },
    ]);
  };

  return (
    <Screen>
      <ListGroup title="Accounts">
        <ListRow icon="building.columns.fill" iconColor="#3B82F6" title="Connected accounts" value={String(connections.length)} onPress={() => router.push('/settings/connect')} />
        <ListRow
          icon="server.rack"
          iconColor="#6366F1"
          title={Platform.OS === 'web' ? 'Budgi server' : 'Relay server'}
          value={Platform.OS === 'web' ? (relayUrl ? 'Paired' : 'Not paired') : relayUrl ? relayUrl.replace(/^https?:\/\//, '') : 'Not set up'}
          onPress={() => router.push('/pair')}
        />
      </ListGroup>

      <ListGroup title="Privacy & security" footer={lockWarning ?? `Budgi locks with ${bio} and hides its contents in the app switcher.`}>
        <ListRow icon="faceid" iconColor="#22C55E" title={`Lock with ${bio}`} toggle={{ value: settings.lockEnabled, onChange: (v) => void toggleLock(v) }} />
        {settings.lockEnabled && <ListRow icon="lock.fill" iconColor="#64748B" title="Require unlock" value={lockAfter.label} onPress={cycleLockAfter} chevron={false} />}
        <ListRow icon="eye.slash.fill" iconColor="#A855F7" title="Hide amounts" subtitle="Tap the eye on Home to toggle anytime" toggle={{ value: settings.hideAmounts, onChange: (v) => update({ hideAmounts: v }) }} />
        <ListRow
          icon="lock.shield.fill"
          iconColor={encrypted ? '#10B981' : '#F59E0B'}
          title="On-device encryption"
          value={encrypted ? 'AES-256' : 'Dev build needed'}
        />
      </ListGroup>

      <ListGroup title="Smart categorization" footer="Confident guesses (known merchants, your rules, things you've taught Budgi) skip the review inbox.">
        <ListRow icon="sparkles" iconColor="#F59E0B" title="Auto-approve confident categories" toggle={{ value: settings.autoReview, onChange: (v) => update({ autoReview: v }) }} />
        <ListRow icon="wand.and.stars" iconColor="#EC4899" title="Rules" value={String(rulesCount)} onPress={() => {
            router.dismissAll();
            router.navigate('/rules');
          }}
        />
      </ListGroup>

      <ListGroup title="Data">
        <ListRow icon="trash" iconColor="#EF4444" title="Erase all data on this device" destructive onPress={erase} chevron={false} />
      </ListGroup>

      <View style={{ alignItems: 'center', gap: 8, marginTop: 36 }}>
        <BudgiMark size={40} />
        <Text variant="footnote" tone="tertiary" align="center">
          Budgi {Constants.expoConfig?.version ?? ''}
        </Text>
        <Text variant="caption" tone="tertiary" align="center" style={{ maxWidth: 300 }}>
          Your transactions live only on this device, encrypted. Bank credentials never touch Budgi — Plaid and SimpleFIN handle sign-in.
        </Text>
      </View>
    </Screen>
  );
}
