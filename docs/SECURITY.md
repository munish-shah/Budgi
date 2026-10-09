# Budgi security model

Budgi is built so that the most sensitive things (bank credentials, Plaid
access tokens, your transaction history) each live in exactly one place,
protected by the strongest primitive available there — without making you
type a password every time you open the app.

## Where everything lives

| Secret / data | Where it lives | Protection |
| --- | --- | --- |
| Bank username & password | Your bank / Plaid / SimpleFIN only | Budgi never sees them. You sign in inside Plaid Link or the SimpleFIN Bridge. |
| Plaid `client_id` / `secret` | Relay server env vars | Never sent to the phone. |
| Plaid access tokens | Relay server SQLite | AES-256-GCM. Key derived with HKDF from `BUDGI_MASTER_KEY`. The item id is bound in as associated data, so a ciphertext can't be moved to another row. Never returned by any endpoint. |
| SimpleFIN access URL | iPhone Keychain | `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: excluded from backups, never synced to other devices. |
| Device signing key (Ed25519) | iPhone Keychain | Same Keychain class. The server only stores the public key. |
| Transactions, rules, budgets | iPhone, SQLite | SQLCipher (AES-256) with a random 256-bit key held in the Keychain. Never uploaded anywhere. |
| What's on screen | iPhone | Face ID / passcode app lock, blurred app-switcher snapshot, optional "hide amounts" mode. |

The relay **stores no transactions**. Sync is stateless: the phone sends its
own Plaid cursor, the relay calls Plaid and passes the delta straight back.
A compromised relay database yields only encrypted tokens; a compromised relay
*process* could call Plaid, which is why you should keep it private (below).

## Device pairing and request signing

1. On the server, `npm run server:pair` creates a one-time code (50 bits,
   expires in 10 minutes, stored only as a SHA-256 hash) and prints a QR code.
2. The app generates a fresh Ed25519 key pair, stores the private key in the
   Keychain, and sends only the public key with the code. The code is consumed
   atomically, so it works exactly once. Pairing is rate-limited.
3. Every later request is signed over
   `BUDGI-V1 ⏎ METHOD ⏎ PATH?QUERY ⏎ TIMESTAMP ⏎ NONCE ⏎ SHA256(BODY)`.
   The relay rejects missing or bad signatures, timestamps more than five
   minutes off, and any nonce it has already seen (replay protection).

There are no bearer tokens or passwords to leak from logs or proxies, and a
stolen server database can't be used to impersonate your phone. You can list
and revoke devices from the app (Settings → Relay server) or with
`npm run cli -w @budgi/server devices` / `revoke <id>`.

The Settings screen shows this device's key fingerprint; compare it with the
server's device list if you want to verify a pairing.

## Network

- The relay binds to `127.0.0.1` by default. **Recommended:** run it on a
  machine in your [Tailscale](https://tailscale.com) tailnet and expose it with
  `tailscale serve --bg 8787`. You get a private HTTPS URL reachable only by
  your own devices, and no ports open to the internet.
- The app refuses plain `http://` unless the host is loopback, a private LAN
  range or Tailscale's `100.64.0.0/10` range. iOS App Transport Security is
  left on (`NSAllowsArbitraryLoads: false`).
- Every relay response carries `Cache-Control: no-store`, a deny-all CSP,
  `nosniff`, HSTS and `Referrer-Policy: no-referrer`. Request bodies are capped
  at 64 KB and validated with strict schemas; unknown fields are rejected.
- Behind a reverse proxy, set `TRUST_PROXY=1` so rate limits use the real
  client IP. Without it, `X-Forwarded-For` is ignored and can't be spoofed.

## On the phone

- **App lock** is on by default after onboarding. It re-locks after a
  configurable time in the background (immediately → 15 minutes). Turning it
  off requires Face ID or the passcode first.
- **App-switcher privacy:** when Budgi isn't the active app, its contents are
  covered with a blur, so the iOS snapshot never shows balances.
- **Hide amounts** replaces every number with dots (tap the eye on Home), for
  using the app in public.
- **Encryption at rest** needs a development or release build (SQLCipher is a
  native module). In Expo Go the database falls back to plain SQLite and
  Settings shows "Dev build needed".
- **Erase all data** deletes the database and its key from the Keychain.
- The iOS privacy manifest declares no tracking and no collected data. There
  are no analytics or crash-reporting SDKs. Plaid Link events are ignored, not
  logged.

## Known trade-offs

- The nonce cache is in memory. If the relay restarts, a captured request
  could in theory be replayed within its five-minute window. TLS (Tailscale or
  HTTPS) makes capture impractical.
- The database key is not tied to Face ID at the Keychain level. If it were,
  changing your enrolled faces or fingerprints would make the data
  unrecoverable. App lock is enforced in the UI; the key is readable only while
  the phone is unlocked.
- If you lose `BUDGI_MASTER_KEY`, the relay can't decrypt tokens and you'll
  need to re-link your banks. Your on-phone data is unaffected.
- The web build is a design preview only. It keeps demo data in memory and
  never handles real credentials.

## Reporting

This is a personal project. If you find a problem, open a private security
advisory on the repository.
