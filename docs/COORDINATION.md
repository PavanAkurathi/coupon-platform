# Codex / Claude Code work split

Updated October 11, 2026. Main is merged through `dcf77fe`. The newer [Hold v1 plan](HOLD-V1-PLAN.md) and `../CODEX-V1-PACKET.md` updates replace the earlier launch scope below. The founder now requests the extension plus a companion shopping dashboard. Historical packets remain recorded here; [STATUS.md](../STATUS.md) is the current checkpoint.

## Ownership

| Owner | Scope | Review partner |
|---|---|---|
| Codex | `packages/shared`, `services/*`, database/migrations, root tooling, integration and release checks | Claude Code |
| Claude Code | `apps/extension`: popup, worker, adapter interfaces, merchant flows and browser tests | Codex |
| Founder | Product decisions, shopper acceptance testing, merchant relationships, account access and launch approval | Both |

The coordinator assigns narrowly scoped packets. Independent files can proceed in parallel. Shared contract changes are agreed before either side implements against them. Do not edit files owned by an active packet elsewhere.

## Current packets

- **C0 — Claude Code, completed:** reauthentication succeeded and the read-only review returned successfully. Findings are in `docs/CLAUDE-REVIEW.md`. Codex corrected one proposal: creator URL markers suppress monetization, not safe neutral coupon use.
- **D0 — Codex, completed:** backend audit identified the missing public-code/neutral-attribution approval gate. Implementation packet is in `docs/FIRST-SPRINT.md`.
- **D1 — Codex, completed:** shared safety/preflight contracts, backend approval metadata, additive migration, operator review CLI and preflight endpoint. Existing rows migrate to pending/unknown; reports cannot approve codes.
- **C1 — Claude Code, completed:** implemented candidate/manual safety checks, a demo adapter registry and popup copy. Codex reviewed and strengthened the dispatch tests, expiry recheck and report-result copy. Details: `docs/CLAUDE-HANDOFF.md`.
- **I1 — Codex, verified:** frozen install; all five workspace builds; 83 unit tests; 51 live HTTP/Postgres/CLI checks; 15 real MV3 browser checks. Migration defaults verified before reseeding. Claude Code’s final backend review completed with no blocking findings.
- **C3 — Claude Code, completed:** read-only launch gap review returned successfully with no permission denials or edits. Codex verified the source evidence and corrected the proposed generic Shopify skeleton/manifest approach. [Integrated review](LIVE-STORE-REVIEW.md) includes the current competitor comparison, actual Chrome observations, remaining gaps and next packet.
- **C4 — Claude Code, completed and integrated:** Amazon popup, worker messaging, manifest and build wiring only. Codex owns shared native-offer contracts, the observed Amazon DOM reader/content entry and tests. Amazon is a separate inspection capability; it never enters the demo code-trial registry. No purchases, cart mutations, cookie access, checkout verification claims or fabricated community votes.

- **I2 — Codex, verified:** C4 returned successfully with no permission denials. Codex supplied the reader/contracts, corrected selected-vs-applied wording, stale actions and badge/navigation races. Installed Chrome 0.1.0 detected a real $15.99 Amazon coupon and focused its unchecked control without changing the cart. Frozen install, five builds, 88 unit tests, 15 reader fixture checks, 15 Amazon MV3 fixture checks and 15 demo MV3 checks passed. The final review also added a passing delayed-response/navigation regression and mixed-currency rejection. The MV3 fixture uses a temporary test-only host grant; real Chrome verified shipping activeTab access. All packets are complete. [Evidence and limits](AMAZON-INTEGRATION.md).

## First milestone acceptance

1. One real Amazon product/cart workflow and one named Shopify checkout have observed, documented behavior and real eligible offer sources.
2. The extension recognizes exactly which capabilities are supported and stops on unknown/cart-changing states.
3. Automatic code application requires known safe attribution behavior and recent independent verification.
4. Coupon results measure improvement over the original checkout and preserve a better existing coupon.
5. End-to-end tests cover application, failure, rollback, stale state, attribution protection and the no-purchase boundary.
6. Build passes; demo, fixture and live results are labeled separately. No fabricated revenue.

## Coordination mechanics

`STATUS.md` is the founder-facing checkpoint: finished work, validation, next milestone and blockers. Announce each Claude packet in chat before dispatch, report its result and any interruption, and save the checkpoint before moving on. Keep updates concise and concrete.

Claude Code is invoked locally using the founder's authenticated session; sign-in was refreshed successfully on October 5. Codex sends bounded task packets and reads its returned handoff. Initial review is restricted to read-only tools. A completed command is not a successful implementation; inspect its result and verify the work.

Continuous background work is not configured. Active runs and their outcomes are reported in this chat. Future coding packets need separate ownership or branches before concurrent edits.

## Handoff format

Outcome; changed/proposed files; contract changes requested; tests and evidence; unresolved dependency; next packet. Never include credentials, personal shopping information or copied checkout secrets.


## October 8 live-checkout packet

The founder explicitly authorized coupon selection, test-cart additions and checkout progress across stores, stopping before the final purchase action. This expands the prior inspection-only walkthrough; it does not authorize orders, subscriptions, payment changes or exposing personal account data.

- **C5 — Claude Code, first run died without output** (empty result file). Re-run below.
- **C5 re-run — Claude Code, returned for review:** see "October 8 C5 checkout review" below.
- Live Amazon reached Place your order with **Your Coupon Savings: -$2.00** after applying the current 10% coupon. No order placed. [Observed structure](AMAZON-CHECKOUT-EVIDENCE.md).
- The internal Shopify research agent hit a usage limit. Codex took over official-source research and live store testing.

## October 8 beta build targets (Claude Code, completed; needs Codex review)

Scope: only `apps/extension/build.ts`, `src/protocol.ts`, `public/manifest.json`, new `public/icon-{16,32,48,128}.png` and `package.json` scripts. No popup/worker edits, no root build, no deploy.

- **Outcome:** `bun run --cwd apps/extension build` is unchanged: the dev target writes `apps/extension/dist`. `COUPON_API_ORIGIN=https://… bun run --cwd apps/extension build:beta` writes the git-ignored `apps/extension/beta/dist`. The beta build fails unless the origin is a bare, non-local https origin. Beta manifest: no `host_permissions`, no content scripts and CSP `connect-src` set to that origin only. Beta also drops `content.js`, and `DEMO_ORIGIN` is `null`, so the demo adapter never matches. `API_ORIGIN` and the new `BUILD_TARGET` export are injected with Bun.build `define`. The build now bundles and checks everything in memory before writing, so a failed build no longer wipes `dist`. It refuses to clear a directory that is not a previous build, and a beta build fails if any bundle or the manifest contains a local URL. Icons are rendered from `icon.svg` with `bun run --cwd apps/extension icons` and declared in `icons` and `action.default_icon`.
- **Name placeholder:** `PRODUCT_NAME = "Checkout Savings"` in `build.ts`, marked PLACEHOLDER for the founder. Dev builds show "(dev)". `manifest.json` is now a template (`__PRODUCT_NAME__`, `__API_ORIGIN__`). Its other values stay literal dev values, so `protocol.test.ts` still checks them.
- **Evidence:** run in a scratch copy of HEAD plus these files only.
  - tsc passed; 35 extension and 33 shared unit tests passed.
  - The dev bundles differ from HEAD's only in minifier renames and the target constant.
  - 45 browser checks passed: 15 demo smoke, 15 Amazon reader and 15 Amazon MV3.
  - Both builds were loaded in Chromium. Beta has no localhost grant, its CSP blocks `http://localhost:3001` and all 4 icons are served. Dev still reaches the local API.
  - 10 invalid origins (unset, http, path, query, credentials, localhost/127/::1, not a URL) and an unknown target all fail the build.
  - The live working tree, including the in-progress C5 and reader edits, passes tsc and 37 unit tests.
- **Coordinator request, done:** `test:e2e:amazon` now runs `amazon-reader.ts`, then `amazon-checkout.ts` (owned by the coordinator), then `amazon-extension.ts`. Beta adds no persistent amazon.com host permission: checkout inspection uses activeTab plus scripting, as product pages do.
- **Requests:**
  1. **C5 (popup.html/popup.ts):** beta still shows the "LOCAL DEMO" pill, the demo-checkout copy and a link to `http://localhost:4173/checkout` on unsupported pages and API errors. Gate them on `BUILD_TARGET` from `protocol.ts`. `build:beta` warns until this is fixed.
  2. **Codex:** there is no hosted HTTPS API yet, so beta was not tested end to end. Backend CORS already reflects any `chrome-extension://` origin, so beta should need no API host permission; verify this against the hosted API. Run beta builds from the package script: root turbo does not pass `COUPON_API_ORIGIN` and would cache across it. Add the variable to turbo `build.env` if turbo should build beta.
  3. **Founder:** choose the final name and icon, then run `bun run --cwd apps/extension icons`. The installed `dist` was not rebuilt. The next root build renames it "Checkout Savings (dev)" and adds icons.
  4. **Suggested follow-ups:** a unit test for the beta manifest transform (today `build.ts` checks it at build time), and a zip step for Web Store upload.

## October 8 Amazon second coupon layout (Claude Code, completed; needs Codex review)

The founder approved this Codex-owned reader change. Scope: `src/amazon-reader.ts`, `e2e/amazon-reader.ts`, `e2e/amazon-extension.ts` and the new `e2e/fixtures/amazon-product-percent.html`. No contract, popup, worker, `dist` or root-build changes.

- **Bug:** on B097S1MF28, Amazon now serves an `i.newCouponBadge` "Coupon:" badge with an unlabelled checkbox and "Apply 10% coupon" text instead of `.ct-coupon-tile`, so the popup said "No visible coupon."
- **Fail-closed rule:** if a visible coupon scope mentions "coupon" but no layout is recognized, the reader now returns `unavailable` ("…layout is not recognized. Review it on Amazon."), never `no_offer`. The same applies to badges that fail pairing.
- **Second layout:** the reader recognizes the badge plus the exact id suffix shared by `input#checkboxpctch<id>`, `label[for]` and `#couponTextpctch<id>`, within one `.promoPriceBlockMessage` row.
  - Lookups are scoped to that row, so hidden accordion rows and the hidden duplicate scope (which reuses the same ids) are never used.
  - The label is Amazon's text ("Apply 10% coupon"). `advertisedPriceCents` is null, since a percentage is not a coupon price.
  - A checked checkbox, or Amazon's visible "10% off coupon applied" state, reports `already_selected` with the label "10% off coupon". It is never shown as applied or confirmed.
  - A disabled checkbox reports `unavailable`. Subscribe & Save rows report `subscription`.
  - The action still only scrolls the paired label and focuses the input. It never clicks.
- **Evidence:** run in a scratch copy of HEAD plus these files.
  - tsc passed in all 5 workspaces, and all 88 unit tests passed.
  - Reader suite: 27/27 (the 15 existing checks plus 12 new). MV3 suite: 19/19 (the 15 existing checks plus 4 new). Against the HEAD reader, the new checks fail with `no_offer`.
  - A snapshot of the current working tree (C5, checkout reader, beta build) also passed tsc, 37+36 unit tests, 27 reader checks and 19 MV3 checks.
  - Live read-only probe (signed-out headless Chromium, no focus or clicks): `offers_found`, "Apply 10% coupon", available, price null.
  - `dist` was not rebuilt.
- **Uncertain:** the applied-state DOM is inferred from Amazon's hidden `donepctch` span; it has not been observed after a real selection. Dollar-off text with the same `pctch` ids passes the amount check but has not been observed. Other id prefixes fail closed as `unavailable`.
- **Requests:**
  1. **Codex:** review and integrate, then update `AMAZON-INTEGRATION.md`. Its line "Other Amazon layouts are not yet established" now has one more supported layout.
  2. **Founder:** confirm in the installed extension after the next approved rebuild.
  3. The 2026-10-08 brief said the root tree failed typecheck because of `amazon-checkout-inspect`. The current snapshot typechecks.

## October 8 C5 checkout review (Claude Code, completed; needs coordinator review)

Scope: only `apps/extension/src/worker.ts`, `src/popup.ts`, `public/popup.html` and `public/popup.css`. This re-runs C5, whose first run died without output, plus two fixes the coordinator added. No contract, reader, build, manifest or protocol edits. `dist` was not rebuilt and no root build was run.

- **Checkout review:** `isAmazonCheckout` is checked before the product and merchant/API branches.
  - **Reading the page:** the worker injects `amazon-content.js` into the top frame only. It sends `amazon-checkout-inspect` bound to that document's `documentId`. The full URL must still match before injection, after injection and after the reply.
  - **Validation:** the reply must pass the schema, and `observedAt` must be no more than 60 s old and not in the future. Any failure, or no reply, means `unavailable` with no amounts.
  - **What it returns:** the response carries no URL or session ID. There are no fetches or storage writes.
  - **Badge:** `$` only for a fresh `review_ready` with savings above $0.
  - **Code trials:** `run` and `try-code` are rejected as review-only.
- **Checkout popup panel:**
  - "Coupon applied at checkout." appears only when savings are above $0.
  - Rows read "Coupon savings shown by Amazon" and "Order total shown by Amazon". A $0 saving shows "No coupon discount shown."
  - `unavailable` clears all amounts and shows the reader's reason.
  - "Order not placed. No commission claimed." is always visible, with one "Check totals again" button.
  - The refresh button is disabled while a check runs, and amounts are withdrawn until a fresh reading arrives.
  - Product, checkout and demo modes each restore their own UI when the popup switches between them.
  - Amazon pages without a product ID now show "Amazon", not "Amazon · product page".
- **Coordinator fixes:**
  - **`api()` errors:** network, CSP, timeout and bad-payload failures all become "The coupon service is unavailable. Please try again shortly."
  - **Unsupported non-Amazon pages:** these show "Not supported here yet." with no pill, trust row, trial button or code section.
  - **Demo link:** it appears only when `DEMO_ORIGIN` is set (dev builds) and the active tab is on that host. Its href now comes from `DEMO_ORIGIN`, not `popup.html`.
  - **Initial HTML:** it hides the pill, trust row, trial button and code section until status arrives. This covers the beta-build request: `build:beta` no longer warns, and beta `popup.js` has no localhost reference.
- **Evidence:**
  - extension `tsc` passed; `bun test` passed 37 extension and 36 shared tests.
  - `e2e/amazon-checkout.ts` passed 15/15.
  - Scratch copies against a scratch dev build, all headless:
    - demo smoke 15/15, run against the running local API and demo server, with its screenshot redirected to the scratchpad
    - Amazon MV3 19/19
    - C5 checkout harness 14/14
    - unsupported/API-error harness 4/4
  - Against a scratch beta build (`COUPON_API_ORIGIN=https://api.example.com`): C5 harness 13/13 (the demo section is skipped on beta) and unsupported harness 2/2. The harnesses are in the side-session notes folder.
- **Not run:** root build, root turbo, live Amazon and a real Chrome activeTab gesture.
- **For review:**
  - The reader's `reason` is shown to the shopper unchanged; today it is a fixed string.
  - Checkout freshness is 60 s; product focus allows 2 min.
  - The cart copy "Cart and checkout coupon testing are not available yet." is kept because the MV3 suite asserts it.
  - Beta `worker.js` still contains the registry's `merchantDomain:"localhost"`. That is not a URL and is outside these files.

## October 8 coordinator takeover (Claude Code main session; for Codex on return)

The founder asked the Claude coordinating session to continue Codex's work while Codex waits for its weekly reset: shared contracts, coupon service, readers, live store tests and integration. It reviewed and integrated the three Claude packets above, then committed them locally with founder approval (not pushed).

- **Amazon checkout reader:** `src/amazon-checkout-reader.ts` plus the `amazon-checkout-inspect` branch in `amazon-content.ts`; each request re-checks its own route. It reads one visible `#subtotals-marketplace-table`, pairs label and amount in document order, and needs exactly one `Order total:`, at most one `Your Coupon Savings:` (absent → 0) and a visible place-order control (read only). `e2e/amazon-checkout.ts`: 15 reader fixture checks plus 9 complete MV3 checks of C5's popup and worker. Cart copy now points to order review.
- **Coupon service:**
  - **Recent evidence:** confirmations count only inside `EVIDENCE_WINDOW_DAYS` (default 30), recomputed on every candidates read. Candidates carry `lastConfirmedAt`, a new required contract field. Reports aggregate over the same window, so one new success cannot revive stale votes. The seed refreshes fixture votes.
  - **Store off switch:** `merchants.enabled` plus a required reason, via migration `0002`. Disabled stores vanish from `/v1/merchants`, and candidates, preflight and report all return 404. CLI: `merchant add|disable|enable|list`, exact-hostname validation.
  - **Proxy-safe client IP:** `client-ip.ts` reads `CLIENT_IP_HEADER`/`TRUSTED_PROXY_HOPS` only when configured; forged prefixes are ignored.
  - **Neon portability:** `hashToken` uses `node:crypto`. A Postgres limiter (`rate_limits`, migration `0003`) and a Neon Functions entry (`src/function.ts`, `build:function`) were added. The anonymous limit is configurable. The health field is now `limiter`.
- **Neon:** project `coupon-beta` (`solitary-forest-72896186`, aws-us-east-1) was created with founder approval, and migrations 0000–0003 were applied. It has no data. The function bundle passed a Node 24 smoke test against it. **Deployed with founder approval** as `couponapi` (`https://br-proud-breeze-b7ufxibk-couponapi.compute.c-13.us-east-1.aws.neon.tech`) and verified from outside. Runbook: [DEPLOY-NEON.md](DEPLOY-NEON.md).
- **Shopify:** the founder approved live guest-checkout observation on MVMT and Allbirds (guest cart, deliberately invalid code, stop before contact or payment). Both stores share the same checkout structure: [SHOPIFY-CHECKOUT-EVIDENCE.md](SHOPIFY-CHECKOUT-EVIDENCE.md). New `isShopifyCheckout` and `shopifyCheckoutInspectionSchema` contracts (exact enabled host only) and `src/shopify-checkout-reader.ts`, with 17 fixture checks. `e2e/shopify-live-check.ts --live-approved <hosts>` is the operator onboarding check. The first live run failed: the real table has a column-header row the fixture lacked. After the fix, both stores passed 8/8 live. **Not wired into the popup or registry:** the accepted-code structure (discount line, chip, remove control) has not been observed, so automatic trials stay off. Next: observe one valid code, then build trial/restore on the shared adapter.
- **Tooling:** turbo `agentGuidance: false` (turbo kept injecting a block into `AGENTS.md`), and turbo `build.env` includes `COUPON_API_ORIGIN`.
- **Validation:** tsc 5/5, unit tests and integration as listed in STATUS.md, plus browser suites 15 demo + 27 Amazon reader + 24 Amazon checkout + 19 Amazon MV3 + 17 Shopify reader, plus Shopify live 16/16 and a live Amazon re-walk (the percent coupon is now detected).
- **For Codex review:** the `lastConfirmedAt` contract change; Postgres limiter cost under load (put an edge limiter in front before public launch); C5's 60 s checkout freshness.

## October 8 afternoon: Shopify success path (coordinator)

The founder supplied codes in chat. They were used for observation only and are aggregator-looking, so their attribution is unknown and they stay out of the database; `AFF-FIRST15` was skipped. On Allbirds, WELCOME10 was accepted and its structure recorded ([evidence](SHOPIFY-CHECKOUT-EVIDENCE.md)). SAVE16, and MVMT's WKND30 and SUM25, were rejected.

- **Reader:** skips heading-only rows ("Order discount") and reports `appliedCodes` from "Remove <CODE>" buttons. This adds a required `appliedCodes` field to the contract, plus `shopifyContentRequestSchema`.
- **Adapter:** `src/shopify-adapter.ts`: apply, measure the payable total, remove, re-apply the best and verify. Existing codes are never removed; a changed cart is never mutated further.
- **Extension:** `shopify-content.ts` (new build entry). The worker calls `/v1/merchants` only on Shopify-shaped checkout URLs and matches the exact host. The gate gained an injectable `supports` hook. A keepalive call covers long runs. The popup gets an estimate note and an existing-code message, and trials are disabled while a code is applied.
- **Tests (fresh copy of the tree):** typecheck 5/5 and 109 unit tests. Browser checks: 15 demo, 27 Amazon reader, 15 Amazon checkout reader, 9 Amazon checkout MV3, 19 Amazon MV3, 17 Shopify reader, 9 Shopify adapter (including a late field reset and a slow valid code after a rejection), 10 Shopify MV3. Live: adapter 13/13 on Allbirds, plus the real extension end to end on Allbirds.
- **Integration note:** the coordinator ran `bun run build` in `apps/extension` once by mistake, which rewrote the founder's installed `dist`. That build was later confirmed byte-identical to the final verified build. Chrome picks it up on the next extension reload.
- **Not done:** enabling Allbirds in the beta database, and reviewed public codes with source evidence. Both are founder/operator decisions.

## October 8 evening: price alerts (coordinator, while Codex is at its usage limit)

Codex started the founder's cross-store price packet at 7:16 PM ([packet](../../CODEX-PRICE-PACKET.md)) and hit its usage limit at 7:19 PM, before its three helpers ran; it resets at 10:21 PM. The founder re-sent the request to the Claude coordinating session, which built the feature in this worktree (branch `codex/price-compare`, uncommitted, not merged into `coupon-platform`, nothing installed or deployed). Details and evidence: [PRICE-ALERTS.md](PRICE-ALERTS.md).

- **Shared:** `prices.ts` replaces Codex's 73-line draft, keeping its fail-closed design. It adds GTIN/model normalization, exact matching, `compareOffers` and the `priceOffers*` wire contract. `extension.ts` gains the `price-alerts`/`price-forget` popup requests and the `price`/`priceAlerts` status fields.
- **Price service:** the stub was replaced with `POST /v1/prices/offers`, an eBay Browse connector, a reviewed feed and a 10-minute cache.
- **Extension:**
  - New files: `product-reader.ts`, `price-content.ts`, `price-worker.ts` and `price-popup.ts`.
  - Worker and popup are wired up.
  - The manifest gains the optional `https://*/*` permission.
  - Build adds the `price-content` entry and `PRICE_API_ORIGIN`.
- **Tests:** passed as listed in PRICE-ALERTS.md, including the live eBay→Amazon alert and pause. The demo smoke test and the eBay API live were not run.
- **For Codex on return:** please review rather than restart this packet. Open items:
  - eBay live verification once the founder adds keys.
  - Best Buy connector.
  - Hosting the price service next to `couponapi`, which needs founder approval.
  - Privacy policy text.
- **Later the same evening, at the founder's request:** live checks. The worker fetches Amazon and Walmart pages from the shopper's browser, with no cookies, parses them offscreen (new `offscreen` permission, `store-lookups.ts`, `search-parsers.ts`, `offscreen.ts`), and keeps only exact matches. Proven live: Best Buy MG9575/49 at $96.99 showed "$7.99 less at Walmart". eBay and Best Buy refuse background requests; Target and Costco need scripts. Tests: unit 48/39/7/28, price fixtures 11, live 3. The Amazon and Shopify suites pass; their popup tests failed several times on macOS window focus, then passed repeatedly, and the baseline build behaved the same.
- **0.3.1 (same night):**
  - Cheaper seller on the same Amazon page (`amazon-sellers.ts`), live-proven on B008M5U1C2 ("$4.37 less from another seller on Amazon").
  - Amazon reader accepts the shown price among several purchase modes and reads `#prodDetails`.
  - Fixture e2e 13/13; live 5/5 (eBay steps skipped: eBay serves its error page to automated browsers).
  - Packaged as `outputs/checkout-savings-0.3.1`.

## October 9 morning: 0.3.2 (coordinator)

The founder's real Chrome showed no alert on Best Buy MG9575/49 ($99.99) although Amazon had it for $96.49. There were two causes, and both are fixed.

**1. The background Amazon check skipped pages with several purchase modes** (new $96.49 / used $81.23). For those pages, Amazon's offer list (`aodAjaxMain`) now names the buy box. Files: `store-lookups.ts`, `offscreen.ts`, and `product-reader.ts` (`Page.buyBoxCents`).

**2. Codex's 9:20 AM hardening** was left unfinished by its usage limit and committed mid-edit in 99e25a8. It blocked matching and reading in four ways; this is what changed:
- **Variant rule:** a variant on one side and none on the other now passes when the exact model codes match. Two stated variants must still agree (token containment: "Matte Black" matches "Black"; "Steel" does not match "Silver").
- **Amazon and Walmart colour fields:** no longer used, because colour names differ between stores.
- **JSON-LD price check:** falls back to the visible-price check when a page has no microdata Product scope (Best Buy).
- **Product URL matching:** a single JSON-LD Product is accepted, and URL matching is lenient again.
- **Kept from Codex:** the restricted-offer filter, the model and brand conflict checks, the strict shipping details, `InStoreOnly` treated as not purchasable, the abortable live checks and the v2 cache.
- **Popup:** says "Turn on price alerts" when the live-store permission is missing.

**Tests:**
- Shared 50/50 and extension unit 39/39; price fixture e2e passes my 13 checks.
- Live 4/4: Best Buy → "$3.50 less at Amazon"; the knife correctly stays quiet because Amazon.com is $47.00 and only used offers are cheaper.
- Codex's new e2e "cached offer before slow sources" fails because its feature isn't implemented yet. Left for Codex (back at 2:13 PM).

**Install:** built from a clean HEAD copy plus these files (excluding the checkout-tips session's in-progress files), installed into `coupon-platform/apps/extension/dist` and packaged as `outputs/checkout-savings-0.3.2`.

## October 10 return / integration packet (I3 — Codex, in progress)

- Review Claude's committed backend/shared and Shopify changes; preserve extension ownership and the existing installed builds and archives. Extension findings go through a handoff.
- Codex files: `services/coupon-service/tests/verify-integration.ts`, root `package.json`, `README.md`, `STATUS.md`, `docs/BETA-READINESS.md` and this log. Add a disposable local Postgres/HTTP verification command; no existing database or hosted-service changes. I3-B owns only `src/client-ip.ts` and `test/client-ip.test.ts` under the coupon service to fix rejection of forwarding chains shorter than the configured trusted proxy depth.
- Parallel work is read-only review plus scratch-copy builds, unit tests and isolated browser fixtures. No live shopping, cookie access, installed-profile changes, publication or deployment in this packet.
- Results, remaining risks and cross-owner requests will be recorded before handoff.
- **I3-B — Codex, completed:** short forwarding chains cannot bypass the configured trusted proxy depth. A failing regression preceded the fix; 29 backend unit tests (95 assertions) and the backend typecheck passed. Current hosted configuration leaves the forwarded header unset, so this repairs the optional proxy path.
- **C6 — Claude Code, assigned:** fix the three reproduced Shopify trial safety defects in [the bounded handoff](CLAUDE-SHOPIFY-SAFETY-HANDOFF.md). Only the adapter and its existing fixture suite are assigned. Equal-subtotal cart identity needs a later coordinated contract; no claims of full cart identity protection.

## October 10 night: 0.4.3 accuracy fixes (Claude)

Fixes for the three accuracy failures in [COVERAGE.md](COVERAGE.md). Built from the exact 0.4.2 tree plus this diff, packaged in `outputs/hold-0.4.3`, installed in `coupon-platform/apps/extension/dist`. Nothing committed or submitted.

- **Open box read as new (Walmart reader).** An item counts as new only when every signal agrees: `conditionType` is New, `isConditionNew` is true, `conditionV2` (when present) is group 1 "New", and the name has no condition marker. Live 11384707978 now reads as refurbished. The schema.org and Amazon readers already apply the title markers. Amazon also reads a page that features a used offer (`#usedBuySection`) as used.
- **Bundles: a shared contract change, additive, for Codex review.**
  - `prices.ts` gains `sameBundle(a, b)`.
  - `comparableOffers` now also requires both titles to carry the same bundle markers: bundle, protection plan/pack, extended or accident warranty/protection, AppleCare.
  - Every offer source passes through this check, and it applies in both directions.
- **Amazon pages with two purchase-mode prices.**
  - Fetched pages take the new price from Amazon's own "Buy New" row (`[data-a-accordion-row-name="newAccordionRow"]`), observed on B0DGJ7HYG1 and B00006JSUA. Without that row, the offer-list path is unchanged.
  - The worker console now logs each candidate a live check sets aside: `Hold live check (Store): <url> not used: <why>`. This includes offer-list failures, which used to drop the read silently.
- **What happened on #12 and #18.** This corrects item 4 of COVERAGE.md "What failed".
  - **#18:** the in-run read succeeded through the offer list. The match was refused because Amazon's model is L8SK3PLT and Walmart's is L8SK3, with the same UPC (075536300801). `sameProduct` lets conflicting models veto a UPC match. **Open question for Codex and the founder.**
  - **#12:** for anonymous visitors, Amazon switches between two versions of the page: new $116.99 plus used, or one that features a used offer at $111.14. The in-run fetch most likely got the second (read as used, so no offer-list request).
- **Tests:**
  - Shared 51/51 and extension unit 50/50, including the new `store-lookups.test.ts`.
  - New `e2e/price-readers.ts`: 6/6, run on 7 trimmed live fixtures. 5 of its checks failed on 0.4.2.
  - Price-alert fixture e2e: 13 checks pass. "cached offer before slow sources" still fails, as it does on 0.4.2.
- **Live check** (0.4.3 Chrome build, Playwright):
  - #12: no alert. Walmart logged "condition refurbished, not new"; Amazon logged "condition used, not new".
  - #18: the Amazon page was read; the log says "model L8SK3PLT, not L8SK3".

## October 11: one trunk (Claude, at the founder's request)

- `main` now carries everything: Codex's I3 (committed as a469367), and the `codex/price-compare` line merged in.
  That line holds the price alerts and the Hold rename (0.3.x), the store release (0.4.0), 0.4.1 (no shopper token in store builds), 0.4.2 (Best Buy price-match tip), 0.4.3 (accuracy fixes), the docs, and the UPC-vs-model-suffix rule.
- Each 0.4.x commit was built from that release's exact source tree. Rebuilding the 0.4.3 commit with `release.ts --ref` gives Chrome and Firefox files identical to `outputs/hold-0.4.3`.
- Not merged:
  - the checkout-tips work in progress: uncommitted in `outputs/coupon-price-compare`, owned by its session;
  - `codex/price-speed`: Codex's uncommitted speed work, for Codex to rebase.
- **For Codex to review** (shared contract):
  - `sameBundle` in `comparableOffers` (0.4.3);
  - the UPC-suffix exception in `sameProduct` (3d88c2b, founder decision October 11; not in a release yet).

## October 11: shared review and companion (D4 / C7 — Codex)

- **Authorization:** founder requested the full Honey-style product with Hold's approach and chose extension plus dashboard. Claude's bounded C7 invocation returned `401 OAuth access token has been revoked` without edits. The founder explicitly reassigned this Save item/dashboard extension packet to Codex. Other ownership, worktrees and the C6/M3 deferral remain intact.
- **Shared review:** UPC-beats-model-suffix approved with normalization and contradictory-fact regressions. `sameBundle` fixed: two generic marker sets cannot establish equivalent contents, and hyphenated/multiple-space protection labels cannot bypass the gate. Marked bundles now remain incomparable until structured contents are available. Untagged titles are not proof of bundle absence.
- **D4:** `apps/dashboard` provides a real local saved-item list, targets, recorded price history, search/filter/sort, editing, deletion and backups. The same frontend runs standalone and inside the extension. Imported history is deliberately downgraded to personal notes; no product/catalog/earnings seed data is shown to shoppers. Standalone and extension storage are separate, with explicit export/import transfer.
- **C7:** popup Save item/My Hold list controls; serialized, validated local storage; exact extension-page message authorization; active-tab recheck before save; observations update only existing saved listings; dashboard bundled in Chrome/Firefox. Source packaging includes the new dashboard. No new permissions, tracking links, installed extension changes, checkout mutations, production changes or deployment.
- **Coupons/rewards:** packaged dashboard reads the configured coupon API and rechecks current review/evidence before Copy. No merchant was enabled. Standalone service absence, empty catalogs and unavailable rewards are explicit. This does not complete M1/M2/M3 or deliver automatic price-drop monitoring.
- **Feed design completed:** [AFFILIATE-FEEDS-DESIGN.md](AFFILIATE-FEEDS-DESIGN.md), including Rakuten Advertising US, barcode/model keys, imports, live confirmation and restricted commercial data. Still design only.
- **Validation:** all six workspace typechecks; 153 unit/build tests; Chrome/Firefox temporary builds; 16 isolated companion browser checks. Tests cover persistent editing/history, import failure/round trip, mobile layout, MV3 persistence, page read/save, price revisit, and content-message denial. No live merchant test, fresh coverage basket, database/hosted-service test or full Mozilla release lint was run in this packet. Existing price-speed work remains unmerged.
- **Handoff to Claude:** review C7 and the shared watchlist contract; update shopper privacy/store disclosures before any release (saved-item history persists until deletion, unlike the existing seven-day incidental price memory). C6 remains deferred to M3; no automatic-code merchant can be enabled first. Checkout tips in the other session are untouched.
- **Product assessment:** the new interface makes the prototype usable but does not prove competitive value. Proceed toward approved coverage and a measured 50-product result; do not describe this as a completed Honey clone or a launch-ready product.
- **Saved preview:** code/design committed as `fe7b3cd` (Hold 0.5.0 preview). Ran the full local release workflow from that commit: frozen install, tests/typecheck, Chrome/Firefox builds, Mozilla lint (zero errors, 10 warnings) and byte-identical Firefox rebuild from the source ZIP. Artifacts are in ignored `apps/extension/release/0.5.0-preview`, separate from installed 0.4.3. Nothing pushed, submitted or installed.
- **Lint review:** six `DANGEROUS_EVAL` markers come from bundled Zod; every extension/dashboard bundle starts with the existing `jitless` configuration and is exercised under CSP. Four `UNSAFE_VAR_ASSIGNMENT` markers are the dashboard's HTML template assignments. Variable text/attributes are escaped, links are validated direct HTTPS URLs, chart values are validated integers, and imported markup renders as text in the browser check. These are review notes, not Mozilla approval; carry them into the source review before submission.
