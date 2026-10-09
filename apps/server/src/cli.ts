import { randomBytes } from 'node:crypto';
import qrcode from 'qrcode-terminal';
import { loadConfig } from './config';
import { newPairingCode, newSetupKey, normalizePairingCode } from './crypto';
import { openNodeDatabase } from './node-sqlite';
import { Store } from './store';

const PAIRING_TTL_MS = 10 * 60 * 1000;
const [command, ...args] = process.argv.slice(2);

function usage() {
  console.log(`Budgi relay CLI

  keygen              Print a new random BUDGI_MASTER_KEY
  setupkey            Print a new random BUDGI_SETUP_KEY
  pair                Create a one-time code (valid 10 min) to pair a device
  devices             List paired devices
  revoke <deviceId>   Revoke a device immediately
  items               List connected banks (no secrets shown)
`);
}

if (command === 'keygen') {
  console.log(randomBytes(32).toString('base64'));
  process.exit(0);
}

if (command === 'setupkey') {
  console.log(newSetupKey());
  process.exit(0);
}

if (!command || command === 'help' || command === '--help') {
  usage();
  process.exit(0);
}

const config = loadConfig(process.env);
const db = openNodeDatabase(config.DATABASE_PATH);
const store = new Store(db);
await store.init();

switch (command) {
  case 'pair': {
    const code = newPairingCode();
    await store.createPairingCode(normalizePairingCode(code), PAIRING_TTL_MS);
    const url = config.PUBLIC_URL ?? `http://${config.HOST}:${config.PORT}`;
    const deepLink = `budgi://pair?u=${encodeURIComponent(url)}&c=${code}`;
    console.log('\nScan with the Budgi app (Settings → Connect relay server), or enter manually:\n');
    qrcode.generate(deepLink, { small: true });
    console.log(`\n  Server:  ${url}`);
    console.log(`  Code:    ${code}`);
    console.log('\n  The code works once and expires in 10 minutes.\n');
    if (!url.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost|100\.\d+\.\d+\.\d+)/.test(url)) {
      console.log('  ⚠️  PUBLIC_URL is not HTTPS. Use Tailscale or a TLS proxy before pairing over a network.\n');
    }
    break;
  }
  case 'devices': {
    const rows = await store.listDevices();
    if (!rows.length) console.log('No devices paired yet. Run: npm run pair');
    for (const d of rows) {
      const status = d.revoked_at ? 'revoked' : 'active';
      const seen = d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : 'never';
      console.log(`${d.id}  ${d.name.padEnd(24)} ${status.padEnd(8)} last seen ${seen}`);
    }
    break;
  }
  case 'revoke': {
    const id = args[0];
    if (!id) {
      usage();
      process.exit(1);
    }
    console.log((await store.revokeDevice(id)) ? `Revoked ${id}` : `No active device ${id}`);
    break;
  }
  case 'items': {
    for (const i of await store.listItems()) {
      console.log(`${i.id}  ${(i.institution_name ?? 'Bank').padEnd(24)} ${i.error_code ?? 'ok'}`);
    }
    break;
  }
  default:
    usage();
    process.exit(1);
}
db.close();
