#!/usr/bin/env node
/**
 * One-command deploy of Budgi to Cloudflare's free tier:
 *   - the web app (installable on your iPhone's Home Screen)
 *   - the relay API (Plaid / SimpleFIN), on the same address
 *   - a D1 database for encrypted bank tokens (no transactions are stored)
 *
 * Usage:  npm run deploy
 * Re-run any time to ship updates; existing secrets are kept.
 *
 * Non-interactive (CI or a cloud session): set CLOUDFLARE_API_TOKEN, and
 * optionally PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV in the environment.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import readline from 'node:readline';

const root = new URL('..', import.meta.url).pathname;
const serverDir = join(root, 'apps/server');
const deployConfig = 'wrangler.deploy.jsonc';
const interactive = process.stdin.isTTY && !process.env.CI;

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const step = (s) => console.log(`\n${bold('›')} ${s}`);

// Set once we know which Cloudflare account to use; passed to every wrangler call.
let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

function wrangler(args, { input, inherit = false } = {}) {
  const [cmd, ...pre] = process.env.WRANGLER_BIN ? [process.env.WRANGLER_BIN] : ['npx', 'wrangler'];
  const res = spawnSync(cmd, [...pre, ...args], {
    cwd: serverDir,
    encoding: 'utf8',
    input,
    stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) },
  });
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}`, stdout: res.stdout ?? '' };
}

/** Run a wrangler command that prints JSON; on any failure, show wrangler's own output. */
function wranglerJson(args, what) {
  const res = wrangler(args);
  try {
    if (!res.ok) throw new Error();
    return parseJson(res.stdout);
  } catch {
    throw new Error(`Couldn't ${what}. Wrangler said:\n\n${res.out.trim() || '(no output)'}\n`);
  }
}

function run(cmd, args, cwd = root) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

function ask(question, { hidden = false } = {}) {
  if (!interactive) return Promise.resolve('');
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '');
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const SETUP_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const newSetupKey = () => Array.from(randomBytes(20), (b) => SETUP_ALPHABET[b & 31]).join('').match(/.{5}/g).join('-');

function parseJson(text) {
  const starts = [text.indexOf('['), text.indexOf('{')].filter((i) => i >= 0);
  if (!starts.length) throw new Error('no JSON in output');
  return JSON.parse(text.slice(Math.min(...starts)));
}

async function chooseAccount() {
  let who = wrangler(['whoami', '--json']);
  if (!who.ok) {
    if (process.env.CLOUDFLARE_API_TOKEN) throw new Error(`CLOUDFLARE_API_TOKEN was rejected. Wrangler said:\n\n${who.out.trim()}`);
    if (!interactive) throw new Error('Not logged in to Cloudflare. Run `npx wrangler login` first, or set CLOUDFLARE_API_TOKEN.');
    console.log('A browser window will open to log in to Cloudflare (a free account is enough).');
    if (!wrangler(['login'], { inherit: true }).ok) throw new Error('Cloudflare login failed.');
    who = wrangler(['whoami', '--json']);
    if (!who.ok) throw new Error(`Still not logged in. Wrangler said:\n\n${who.out.trim()}`);
  }
  const user = parseJson(who.stdout);
  const accounts = (user.accounts ?? []).filter((a) => a && a.id);
  console.log(dim(`Logged in${user.email ? ` as ${user.email}` : ''}.`));
  if (accountId) return;
  if (accounts.length === 1) {
    accountId = accounts[0].id;
    return;
  }
  if (!accounts.length) throw new Error('This Cloudflare login has no accounts. Create one at dash.cloudflare.com, then re-run.');
  if (!interactive) {
    throw new Error(`Your login has ${accounts.length} Cloudflare accounts. Set CLOUDFLARE_ACCOUNT_ID to one of:\n${accounts.map((a) => `  ${a.id}  ${a.name}`).join('\n')}`);
  }
  console.log('\nYour login has access to several Cloudflare accounts:');
  accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a.name} ${dim(a.id)}`));
  for (;;) {
    const pick = Number(await ask(`Which one should Budgi use? [1-${accounts.length}]: `));
    if (Number.isInteger(pick) && pick >= 1 && pick <= accounts.length) {
      accountId = accounts[pick - 1].id;
      console.log(dim(`Tip: next time run with CLOUDFLARE_ACCOUNT_ID=${accountId} to skip this question.`));
      return;
    }
  }
}

async function main() {
  console.log(bold('\nBudgi → Cloudflare (free tier)\n'));

  step('Checking your Cloudflare login');
  await chooseAccount();

  step('Building the web app');
  if (!process.env.SKIP_BUILD) run('npm', ['run', 'build:pwa', '-w', '@budgi/mobile']);

  step('Preparing the database');
  const findDb = () => wranglerJson(['d1', 'list', '--json'], 'list your D1 databases').find((d) => d.name === 'budgi');
  let db = findDb();
  if (!db) {
    const created = wrangler(['d1', 'create', 'budgi']);
    if (!created.ok) throw new Error(`Could not create the D1 database:\n${created.out}`);
    db = findDb();
  }
  if (!db?.uuid) throw new Error('Could not find the D1 database id.');
  const base = JSON.parse(readFileSync(join(serverDir, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  base.d1_databases[0].database_id = db.uuid;
  base.account_id = accountId;
  writeFileSync(join(serverDir, deployConfig), JSON.stringify(base, null, 2));
  console.log(dim(`D1 database: ${db.uuid}`));

  step('Deploying');
  const deployed = wrangler(['deploy', '--config', deployConfig]);
  console.log(dim(deployed.out.trim().split('\n').slice(-6).join('\n')));
  if (!deployed.ok) throw new Error(`Deploy failed. Wrangler said:\n\n${deployed.out.trim()}`);
  const url = deployed.out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];

  step('Setting secrets (encrypted by Cloudflare, never in this repo)');
  const existing = new Set(wranglerJson(['secret', 'list', '--config', deployConfig], 'list the Worker’s secrets').map((s) => s.name));
  const put = (name, value) => {
    const res = wrangler(['secret', 'put', name, '--config', deployConfig], { input: value });
    if (!res.ok) throw new Error(`Could not set ${name}:\n${res.out}`);
    console.log(`  ${green('✓')} ${name}`);
  };

  if (!existing.has('BUDGI_MASTER_KEY')) put('BUDGI_MASTER_KEY', randomBytes(32).toString('base64'));
  let setupKey;
  if (!existing.has('BUDGI_SETUP_KEY') || process.argv.includes('--new-setup-key')) {
    setupKey = newSetupKey();
    put('BUDGI_SETUP_KEY', setupKey);
  }

  if (!existing.has('PLAID_CLIENT_ID')) {
    let clientId = process.env.PLAID_CLIENT_ID ?? '';
    let secret = process.env.PLAID_SECRET ?? '';
    let env = process.env.PLAID_ENV ?? '';
    if (!clientId && interactive) {
      console.log(`\nPlaid keys: ${dim('dashboard.plaid.com → Developers → Keys (sign up with “Personal use”).')}`);
      clientId = await ask('  Plaid client_id (Enter to skip for now): ');
      if (clientId) {
        secret = await ask('  Plaid secret: ', { hidden: true });
        const real = (await ask('  Connect real bank accounts? [Y/n] (n = Plaid sandbox test data): ')).toLowerCase();
        env = real === 'n' ? 'sandbox' : 'production';
      }
    }
    if (clientId && secret) {
      put('PLAID_CLIENT_ID', clientId);
      put('PLAID_SECRET', secret);
      put('PLAID_ENV', env || 'production');
    } else {
      console.log(dim('  Plaid skipped — demo data and SimpleFIN still work. Re-run `npm run deploy` to add it.'));
    }
  }

  console.log(`\n${green(bold('Budgi is live'))}${url ? `: ${bold(url)}` : ''}\n`);
  console.log('On your iPhone:');
  console.log(`  1. Open ${url ?? 'your workers.dev address'} in ${bold('Safari')}`);
  console.log(`  2. Tap ${bold('Share → Add to Home Screen')}, then open Budgi from the Home Screen`);
  console.log('  3. Settings → Budgi server → enter your setup key');
  if (setupKey) {
    console.log(`\n  Setup key: ${bold(setupKey)}`);
    console.log(dim('  It works once, only for your first device. Keep it until you have paired your phone.'));
  } else {
    console.log(dim('\n  (Your setup key was created on the first deploy. Lost it before pairing? Run: npm run deploy -- --new-setup-key)'));
  }
  console.log(dim('\nTo update later: git pull && npm run deploy\n'));
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
});
