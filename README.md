# Coupon platform

A small, runnable coupon MVP: an MV3 extension, a real coupon API, and two explicit service stubs. Neutral naming throughout. Bun 1.3.14+, Docker, Chrome/Chromium; USD only for the first release.

Current progress: [STATUS.md](STATUS.md) and [beta readiness](docs/BETA-READINESS.md). Live-store evidence: [Amazon](docs/AMAZON-CHECKOUT-EVIDENCE.md), [Shopify](docs/SHOPIFY-CHECKOUT-EVIDENCE.md). Beta hosting: [Neon](docs/DEPLOY-NEON.md).

## Run

```sh
bun install
bun run build                 # turbo build; typechecks every workspace
bun run test
docker compose up --build -d  # migrates Postgres before starting the API
docker compose exec -e NODE_ENV=development coupon-service bun run --cwd services/coupon-service db:seed
bun run demo
```

Load `apps/extension/dist` as an unpacked extension at `chrome://extensions` (Developer mode). Open `http://localhost:4173/checkout`, then click **Try codes for me**. The demo has a $100 cart, `WELCOME10` ($10) and `SAVE15` ($15); the best total wins. `NEW20` ($20) and `LEGACY5` ($5) have fixture safety approval but start without shopper confirmations, for manual-code testing. All seed approvals and confirmations are synthetic localhost fixtures, never production evidence. Seeding is explicit and disabled under `NODE_ENV=production`.

**Amazon.com product coupons:** open a product page, then the extension. It reads visible native coupon offers locally and offers **Show coupon on Amazon**, which scrolls/focuses the existing control. It does not select the coupon. On Amazon's order review page it reads the coupon savings and order total Amazon displays, labelled "Order not placed. No commission claimed." Codes are never tested on Amazon. This uses temporary access when you open the popup; no persistent Amazon permission, API upload or browsing-history storage. Unknown layouts stop safely. [Scope and live evidence](docs/AMAZON-INTEGRATION.md).

**Shopify:** automated code trials work on Shopify's checkout for any store whose exact host an operator has enabled (`merchant add`). They were proven live on Allbirds. Codes come only from the reviewed, shopper-verified candidates. Existing codes are never removed and orders are never placed. Before enabling a store, run `bun run --cwd apps/extension e2e/shopify-live-check.ts --live-approved <host>`, which needs founder approval for live traffic. Fixture suites: `test:e2e:shopify`. New trial adapters require observed controls, approved coupon sources, explicit access and checkout regression tests.

To report results, issue a token for an operator-verified beta shopper, then paste it into the popup's Community settings:

```sh
docker compose exec coupon-service bun run --cwd services/coupon-service reporter:create --identity beta-shopper-001
```

Save the token securely; it is shown once. The same normalized identity cannot be registered twice. Browsing and trying verified codes work without a token. **Have a code to share?** checks a supplied code's safety approval before testing it and reporting the observed result. Unreviewed codes cannot trigger checkout automation. The CLI identity check is an invite-only beta boundary, not proof that arbitrary anonymous accounts represent separate humans.

If database ports are busy, run Compose with `POSTGRES_PORT=55432 REDIS_PORT=56379`; all service-to-service connections still use Docker's internal ports. Containers bind only to localhost. `docker compose down` stops the stack and retains its data.

This workspace's ignored `.env` uses `55432` / `56379` to coexist with your other running project.

For local API development, start only `postgres redis`, copy `.env.example` to `services/coupon-service/.env`, adjust its database/cache ports, then run `bun run db:migrate`, `bun run db:seed`, and `bun run --cwd services/coupon-service dev`.

Run `bun run verify:integration` for the HTTP, Postgres, operator CLI and database rate-limiter checks. It requires Docker with the `postgres:16-alpine` image already installed. The command creates a fresh database in memory, applies the migrations, starts a temporary API on loopback, runs the checks and removes its container and server. It ignores existing database/API settings and does not rebuild the installed extension, use a persistent volume or contact the hosted beta. This validates the Postgres limiter used by the Neon entry; it does not validate Redis or the deployed function.

For a browser smoke test against the running, seeded stack and demo, run `bun run --cwd apps/extension browser:install` once, then `bun run --cwd apps/extension test:e2e`. It opens an isolated browser with the real extension, checks coupon application, existing discounts, creator attribution preservation and the completed receipt, then closes its browser. `bun run --cwd apps/extension test:e2e:amazon` checks the Amazon reader and complete extension against isolated synthetic fixtures; it never contacts Amazon. Live Chrome validation is recorded separately.

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
| GET | `/v1/merchants` | Enabled merchant records only (operator off switch) |
| GET | `/v1/coupons/candidates?merchantId=<uuid>&limit=10` | Verified by 3 shoppers inside the evidence window (default 30 days); expiration filtered; rank by `successRate × expectedSavingsCents`; includes `lastConfirmedAt` |
| GET | `/v1/coupons/preflight?merchantId=<uuid>&code=SAVE15` | Fresh safety/expiry check before a user-requested trial; no quorum required |
| POST | `/v1/coupons/report` | Bearer shopper token; atomically creates/updates one vote per shopper and code |
| GET | `/health` | Dependency health, `503` when unavailable |

Report JSON:

```json
{"merchantId":"00000000-0000-4000-8000-000000000001","code":"SAVE15","outcome":"success","savingsCents":1500,"currency":"USD"}
```

Success requires positive savings; failure requires zero. Three distinct successful reporters verify a code's effectiveness; **separate operator approval is required for application**. New and migrated coupons default to pending/unknown. Candidates must be approved, public and attribution-neutral with recorded review evidence, as well as verified and unexpired. These checks run before SQL ranking/limit and again before response. Reports cannot change approval metadata.

Updates replace a shopper's vote, so retries never inflate confirmation counts. Losing the quorum quarantines it again. Success rate is successful voters / all voters; expected savings is the average successful saving, in cents. Transactions, a per-code advisory lock and unique constraints protect concurrent reports. Codes introduced through reports expire after 30 days unless an operator curates their expiration; expired codes never reach candidates and reject new reports. Redis limits reads and reports; candidate and preflight responses are not cached.

An operator records a source-backed decision locally (replace the placeholders with actual reviewed evidence):

```sh
docker compose exec coupon-service bun run --cwd services/coupon-service coupon:review \
  --merchant <uuid> --code <code> --operator <reviewer-id> \
  --approval approved --audience public --attribution neutral --evidence <evidence-reference>
```

Stores are managed the same way: `bun run --cwd services/coupon-service merchant add --domain <exact host> --name <name> --operator <id>`, `merchant disable|enable --merchant <uuid> --operator <id> --reason <text>`, `merchant list`. A disabled store disappears from the extension immediately.

Use `--create` to introduce a reviewed code before collecting shopper confirmations; this never creates votes. Optional `--expires-at` sets a future ISO timestamp. `--approval rejected` revokes application eligibility. Review evidence must establish public availability and neutral attribution; a working discount alone is insufficient. There is no public approval endpoint.

## Trust and earnings

The extension has no cookie or request-interception permissions, does not read/write cookies, rewrite affiliate URLs, or navigate through tracking links. Coupon trials operate only on promo controls after an explicit click; they never submit an order. Existing coupons are compared and restored if better; unsafe checkout changes stop the run.

Coupon codes can themselves assign affiliate credit. The shared safety policy blocks codes with unknown or affiliate attribution and private/creator codes. A creator referral may still use an approved neutral coupon; protecting the referral does not disable those savings.

`attributionPolicy` always denies affiliate-cookie writes. Creator, third-party and unknown attribution deny commission claims while still allowing coupons. URL markers are only hints: missing markers never establish ownership. Phase 1 makes no affiliate claims at all.

`allocateOrderCommission` allows exactly **100 cents per order**, only for a confirmed order with positive **additional** savings versus the original checkout (including its existing coupon), merchant-verified earned attribution, no creator conflict, and at least 100 cents of merchant commission. It never deducts from the shopper's savings. Merely retaining an existing discount earns nothing. Pending, refunded, zero-improvement, insufficient-commission or unowned-attribution orders earn zero. This is a tested policy, not an active ledger or payout system.

After a future authenticated settlement, `confirmedEarningsLine` renders **“You saved $X. We made $1.”** The current completed demo shows `$0` and labels itself Demo; it never pretends an affiliate commission was earned. Phase 3 must supply authenticated merchant events, an idempotent order ledger, refunds and reconciliation before enabling earnings.

## Phase order

1. **Extension + coupons now:** prove the checkout flow, invite a small reporting cohort, add one real merchant adapter at a time. No crawling infrastructure or affiliate network integration yet.
2. **Price tracker next:** add price observations and history, then opt-in drop alerts. `/v1/prices/*` intentionally returns `501` today.
3. **Cashback last:** integrate earned-attribution merchant events and a ledger, using the existing trust/fee policy. `/v1/cashback/*` intentionally returns `501` today.

Before a public beta: add real shopper verification/token recovery, merchant-specific terms/expiry curation, HTTPS API configuration and matching extension permissions, and real checkout regression fixtures. No accounts UI, billing system or broad merchant scraping is needed for the first private beta.

Runtime references: [Bun workspaces](https://bun.sh/docs/pm/workspaces), [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Drizzle transactions](https://orm.drizzle.team/docs/transactions).
