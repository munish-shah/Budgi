import { z } from 'zod';

const schema = z.object({
  PLAID_CLIENT_ID: z.string().min(1).optional(),
  PLAID_SECRET: z.string().min(1).optional(),
  PLAID_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  PLAID_COUNTRY_CODES: z.string().default('US'),
  /** Required for OAuth banks on iOS (must be a universal link you control). */
  PLAID_REDIRECT_URI: z.string().url().optional(),
  /** 32 random bytes, base64. Generate with `npm run cli -w @budgi/server keygen`. */
  BUDGI_MASTER_KEY: z.string().min(1, 'BUDGI_MASTER_KEY is required'),
  /** Where the app reaches this server (printed into the pairing QR code). */
  PUBLIC_URL: z.string().url().optional(),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_PATH: z.string().default('./budgi.db'),
});

export type Config = z.infer<typeof schema> & { masterKey: Buffer; countryCodes: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  const masterKey = Buffer.from(parsed.data.BUDGI_MASTER_KEY, 'base64');
  if (masterKey.length !== 32) {
    throw new Error('BUDGI_MASTER_KEY must be 32 bytes, base64-encoded. Run: npm run cli -w @budgi/server keygen');
  }
  return {
    ...parsed.data,
    masterKey,
    countryCodes: parsed.data.PLAID_COUNTRY_CODES.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
  };
}
