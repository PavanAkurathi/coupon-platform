# Beta hosting on Neon

Decided October 8, 2026: the coupon service for the private beta runs on Neon. Postgres is the Neon project `coupon-beta` (`solitary-forest-72896186`, aws-us-east-1, Postgres 16, database `coupons`, branch `main`). The API runs as a Neon Function on that branch. There is no Redis: rate limits use the `rate_limits` table.

## State

- Project created and migrations `0000`–`0003` applied. No merchants, coupons or shoppers yet. Never run the demo seed here.
- **Deployed October 8, with founder approval:** function `couponapi`, deployment 1, Node 24, on branch `main`. URL: `https://br-proud-breeze-b7ufxibk-couponapi.compute.c-13.us-east-1.aws.neon.tech`.
- Verified from outside: `/health` reports database and limiter up. `/v1/merchants` is empty. Extension origins get CORS; other origins don't. A report without a token gets 401, and invalid queries get 400. HSTS and nosniff headers are set.
- Beta extension built against it (`apps/extension/beta/dist`, git-ignored). In Chromium its worker reaches the API, and its CSP blocks localhost. No shopper flow calls the API yet: Amazon runs locally and no store is enabled.

## Deploy

1. `bun run --cwd services/coupon-service build:function` writes `dist/function/index.mjs` (Node ESM, `export default { fetch }`).
2. `bunx neonctl@8.0.12 functions deploy couponapi --project-id solitary-forest-72896186 --branch main --src services/coupon-service/dist/function --no-bundle --runtime nodejs24 --env EVIDENCE_WINDOW_DAYS=30`. The globally installed `neon` 2.x has no Functions support. Neon injects `DATABASE_URL`.
3. Environment: `EVIDENCE_WINDOW_DAYS=30`. Optionally `ANON_RATE_LIMIT_PER_MINUTE` (default 600 when no trusted IP header). Leave `CLIENT_IP_HEADER` unset unless a trusted proxy in front sets one.
4. Verify `GET <invocation_url>/health` returns `ok`, then build the extension with `COUPON_API_ORIGIN=<invocation_url origin> bun run --cwd apps/extension build:beta`.

## Operating it

- Migrations: `DATABASE_URL=<unpooled URL> bun run --cwd services/coupon-service db:migrate` before deploying a schema change.
- Stores: `bun run --cwd services/coupon-service merchant add|disable|enable|list` with the same `DATABASE_URL`.
- Codes: `coupon:review` records operator approval and evidence. Shoppers: `reporter:create` issues invite tokens.
- Logs: Neon branch logs, source `function`.

## Before a public launch

Neon gives each function a public URL with an account-wide cap of 100 concurrent invocations and documents no client-IP header or WAF. Put a Cloudflare Worker you control in front: edge rate limits, a shared `X-Secret` to the native URL, and `CLIENT_IP_HEADER=cf-connecting-ip` once the Worker forwards it. Per-shopper report limits already key on the verified token.
