/**
 * Cloudflare Workers entry. One Worker serves both the Budgi web app (static
 * assets) and the relay API, so nothing runs on your own hardware and the
 * free plan comfortably covers personal use.
 */
import { createApp } from './app';
import { loadConfig } from './config';
import { PlaidClient } from './plaid';
import { Store, type SqlDatabase } from './store';

interface Env {
  DB: SqlDatabase;
  ASSETS: { fetch(request: Request): Promise<Response> };
  BUDGI_MASTER_KEY: string;
  BUDGI_SETUP_KEY?: string;
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
  PLAID_ENV?: string;
  PLAID_COUNTRY_CODES?: string;
  PUBLIC_URL?: string;
}

let cached: { env: Env; app: ReturnType<typeof createApp> } | undefined;

function appFor(env: Env) {
  // Isolates are reused across requests; build the app once per isolate.
  if (cached?.env === env) return cached.app;
  const config = loadConfig(env as unknown as Record<string, string | undefined>);
  const plaid =
    config.PLAID_CLIENT_ID && config.PLAID_SECRET ? new PlaidClient(config.PLAID_CLIENT_ID, config.PLAID_SECRET, config.PLAID_ENV) : undefined;
  const app = createApp({ config, store: new Store(env.DB), plaid });
  cached = { env, app };
  return app;
}

const API = /^\/(v1\/|plaid\/|health$)/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (API.test(pathname)) {
      try {
        return await appFor(env).fetch(request);
      } catch (e) {
        console.error('[budgi] startup error:', e instanceof Error ? e.message : e);
        return Response.json({ error: 'MISCONFIGURED', message: 'Server secrets are missing or invalid. Re-run the deploy script.' }, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
