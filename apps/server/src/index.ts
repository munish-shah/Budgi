import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createApp, VERSION } from './app';
import { loadConfig } from './config';
import { Store } from './db';
import { PlaidClient } from './plaid';

const config = loadConfig();
const store = new Store(config.DATABASE_PATH);
const plaid =
  config.PLAID_CLIENT_ID && config.PLAID_SECRET
    ? new PlaidClient(config.PLAID_CLIENT_ID, config.PLAID_SECRET, config.PLAID_ENV)
    : undefined;
const trustProxy = process.env.TRUST_PROXY === '1';

const app = createApp({
  config,
  store,
  plaid,
  clientKey: (c) => {
    if (trustProxy) {
      const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (fwd) return fwd;
    }
    return getConnInfo(c).remote.address ?? 'unknown';
  },
});

const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
  console.log(`[budgi] relay v${VERSION} listening on http://${info.address}:${info.port}`);
  console.log(`[budgi] plaid: ${plaid ? config.PLAID_ENV : 'not configured (SimpleFIN/demo only)'}`);
  if (config.HOST !== '127.0.0.1' && config.HOST !== 'localhost') {
    console.log('[budgi] reminder: expose this only over HTTPS (Tailscale, Cloudflare Tunnel, or a TLS proxy).');
  }
});

const shutdown = () => {
  server.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
