# Coupon platform

A small, runnable coupon MVP: an MV3 extension, a real coupon API, and two explicit service stubs. Neutral naming throughout. Bun 1.3.14+, Docker, Chrome/Chromium; USD only for the first release.

## Run

```sh
bun install
bun run build                 # turbo build; typechecks every workspace
bun run test
docker compose up --build -d  # migrates Postgres before starting the API
docker compose exec -e NODE_ENV=development coupon-service bun run --cwd services/coupon-service db:seed
bun run demo
```

Load `apps/extension/dist` as an unpacked extension at `chrome://extensions` (Developer mode). Open `http://localhost:4173/checkout`, then click **Try codes for me**. The demo has a $100 cart, `WELCOME10` ($10) and `SAVE15` ($15); the best total wins. Seed confirmations are clearly synthetic fixtures, never production evidence. Seeding is explicit and disabled under `NODE_ENV=production`.

The supported merchant is the **local demo checkout only**. The API, database, reporting loop and extension interaction are real; live merchant selectors and partnerships are not invented. New merchants require a reviewed adapter, a database merchant row, explicit host access, and browser tests against that checkout.

To report results, issue a token for an operator-verified beta shopper, then paste it into the popup's Community settings:

```sh
docker compose exec coupon-service bun run --cwd services/coupon-service reporter:create --identity beta-shopper-001
```

Save the token securely; it is shown once. The same normalized identity cannot be registered twice. Browsing and trying verified codes work without a token. **Have a code to share?** tests a supplied code in the current checkout and reports the observed result; newly discovered codes start quarantined. The CLI identity check is an invite-only beta boundary, not proof that arbitrary anonymous accounts represent separate humans.

If database ports are busy, run Compose with `POSTGRES_PORT=55432 REDIS_PORT=56379`; all service-to-service connections still use Docker's internal ports. Containers bind only to localhost. `docker compose down` stops the stack and retains its data.

This workspace's ignored `.env` uses `55432` / `56379` to coexist with your other running project.

For local API development, start only `postgres redis`, copy `.env.example` to `services/coupon-service/.env`, adjust its database/cache ports, then run `bun run db:migrate`, `bun run db:seed`, and `bun run --cwd services/coupon-service dev`.

Run the live integration checks against a disposable/local database and running API with `DATABASE_URL=postgres://coupon:local-development-only@localhost:5432/coupons bun run --cwd services/coupon-service test:integration`. They create and clean their own test records.

For a browser smoke test against the running, seeded stack and demo, run `bun run --cwd apps/extension browser:install` once, then `bun run --cwd apps/extension test:e2e`. It opens an isolated browser with the real extension, checks coupon application, existing discounts, creator attribution preservation and the completed receipt, then closes its browser.

## Shape

```text
apps/extension            popup → worker → API; content script → promo controls
services/coupon-service   Hono API → Drizzle / Postgres; Redis rate limits
services/price-service    health + 501 stub (phase 2)
services/cashback-service health + 501 stub (phase 3)
packages/shared           Zod contracts, attribution and fee policy
```

Ports: coupon API `3001`, price `3002`, cashback `3003`, demo `4173`. Every Compose service has a healthcheck. Coupon health checks Postgres and Redis; the stubs need neither yet. Migrations and schema live in `services/coupon-service/{drizzle,src/db/schema.ts}`. Tables: `users`, `merchants`, `coupons`, `coupon_reports`.

## Coupon API

| Method | Route | Behavior |
|---|---|---|
| GET | `/v1/merchants` | Explicitly supported merchant records |
| GET | `/v1/coupons/candidates?merchantId=<uuid>&limit=10` | Verified only; expiration filtered; rank by `successRate × expectedSavingsCents` |
| POST | `/v1/coupons/report` | Bearer shopper token; atomically creates/updates one vote per shopper and code |
| GET | `/health` | Dependency health, `503` when unavailable |

Report JSON:

```json
{"merchantId":"00000000-0000-4000-8000-000000000001","code":"SAVE15","outcome":"success","savingsCents":1500,"currency":"USD"}
```

Success requires positive savings; failure requires zero. Three distinct successful reporters promote a code. Updates replace a shopper's vote, so retries never inflate confirmation counts. Losing the quorum quarantines it again. Success rate is successful voters / all voters; expected savings is the average successful saving, in cents. Transactions, a per-code advisory lock and unique constraints protect concurrent reports. Codes introduced through reports expire after 30 days unless an operator curates their expiration; expired codes never reach candidates and reject new reports. Redis limits reads and reports; no cached candidate list can outlive a coupon's expiration.

## Trust and earnings

The extension has no cookie or request-interception permissions, does not read/write cookies, rewrite affiliate URLs, or navigate through tracking links. Coupon trials operate only on promo controls after an explicit click; they never submit an order. Existing coupons are compared and restored if better; unsafe checkout changes stop the run.

`attributionPolicy` always denies affiliate-cookie writes. Creator, third-party and unknown attribution deny commission claims while still allowing coupons. URL markers are only hints: missing markers never establish ownership. Phase 1 makes no affiliate claims at all.

`allocateOrderCommission` allows exactly **100 cents per order**, only for a confirmed order with positive **additional** savings versus the original checkout (including its existing coupon), merchant-verified earned attribution, no creator conflict, and at least 100 cents of merchant commission. It never deducts from the shopper's savings. Merely retaining an existing discount earns nothing. Pending, refunded, zero-improvement, insufficient-commission or unowned-attribution orders earn zero. This is a tested policy, not an active ledger or payout system.

After a future authenticated settlement, `confirmedEarningsLine` renders **“You saved $X. We made $1.”** The current completed demo shows `$0` and labels itself Demo; it never pretends an affiliate commission was earned. Phase 3 must supply authenticated merchant events, an idempotent order ledger, refunds and reconciliation before enabling earnings.

## Phase order

1. **Extension + coupons now:** prove the checkout flow, invite a small reporting cohort, add one real merchant adapter at a time. No crawling infrastructure or affiliate network integration yet.
2. **Price tracker next:** add price observations and history, then opt-in drop alerts. `/v1/prices/*` intentionally returns `501` today.
3. **Cashback last:** integrate earned-attribution merchant events and a ledger, using the existing trust/fee policy. `/v1/cashback/*` intentionally returns `501` today.

Before a public beta: add real shopper verification/token recovery, merchant-specific terms/expiry curation, HTTPS API configuration and matching extension permissions, and real checkout regression fixtures. No accounts UI, billing system or broad merchant scraping is needed for the first private beta.

Runtime references: [Bun workspaces](https://bun.sh/docs/pm/workspaces), [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Drizzle transactions](https://orm.drizzle.team/docs/transactions).
