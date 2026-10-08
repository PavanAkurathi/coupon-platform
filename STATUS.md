# Project checkpoint

Updated October 8, 2026, midday. **Not ready for an external beta yet, but the blockers are now narrow and named.** Codex is paused until its weekly reset; the Claude coordinating session is doing Codex's work (see [coordination](docs/COORDINATION.md)). Shareable review: [beta readiness](docs/BETA-READINESS.md).

## Finished today

- **Amazon:** product coupons are detected on both live layouts, including the percent-off widget that was being missed. Unrecognized coupons now say "not recognized" instead of "no coupon". The extension also reads order review: "Coupon applied at checkout", with Amazon's displayed savings and total plus "Order not placed. No commission claimed." Code trials are refused on Amazon.
- **Shopify:** one shared adapter for Shopify's checkout, proven live on Allbirds. The real extension tried two codes, kept the one that worked and showed "$2.81 saved, WELCOME10 applied", with no order and no personal data. A store goes live once an operator enables its exact host and adds reviewed codes; the onboarding check verifies each store first.
- **Coupon service:** confirmations count only from the last 30 days; candidates show when a code last worked. Each store has an off switch and an operator CLI. Rate limits are proxy-safe, and Postgres can replace Redis.
- **Hosting:** the coupon API is live as a Neon Function (`couponapi` on project `coupon-beta`), verified from outside, and the beta extension is built against it ([runbook](docs/DEPLOY-NEON.md)). The database is empty by design.
- **Extension packaging:** dev and beta build targets, HTTPS-only beta manifest, PNG icons, friendly offline errors, and no demo UI on real stores.

## Validation (October 8)

Typecheck 5/5 workspaces. Unit tests, integration (live Postgres + HTTP), browser fixture suites and live store checks all pass; exact counts are in [the coordination log](docs/COORDINATION.md). Live Amazon walkthrough re-run on the integrated build: the 10% coupon is detected.

## Remaining before a private beta

1. **Founder:** choose the product name, publish a privacy policy, and create a private git remote. Today's work is committed locally (not pushed).
2. **First store live:** enable Allbirds (or another store) in the beta database with `merchant add`, after reviewing at least one public, attribution-neutral code with source evidence (`coupon:review`).
3. **Codes:** source reviewed public, attribution-neutral codes for the first 3–5 stores (merchant pages or merchant approval), plus invite tokens for the tester cohort.
4. **Real Chrome:** load the beta build in Chrome and confirm the toolbar activeTab flow on Amazon product and order review.

Price tracking and cashback remain explicit stubs. No affiliate revenue or payout ledger is active.
