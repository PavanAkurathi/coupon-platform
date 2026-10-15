# Chenchulu / HOLD checkpoint

Updated October 15, 2026. **Current source: 0.6.0 preview on `codex/coupons-design-v2`. Current unpacked extension files: Hold 0.5.1 in `apps/extension/dist` (read from its manifest; browser loading/reloading was not verified).** The older 0.4.3 installation note below is historical. Nothing was installed or deployed by this packet.

## October 15 integration checkpoint

- Applied the supplied Evergreen & Mint tokens, local Figtree fonts and Claude's Chenchulu branding. Chrome defaults to a persistent side panel; Firefox retains a popup. Coupon observations and savings come first, with price comparison secondary and loaded independently. No tax estimates, ZIP/membership forms or delivery predictions were added.
- Amazon coupon focus remains read-only. Checkout amounts are labeled as Amazon's observations, not savings caused by the extension. Candidate evidence, empty/error states and additional savings over the starting checkout have explicit UI. Saved-item storage and backups remain compatible; dashboard visible branding matches.
- Surface actions are bound to the displayed tab and URL; navigation/tab switching withdraws old data. Live Shopify trials are blocked pending C6/M3. No merchant was enabled, no new live coverage was established, and eBay remains on hold.
- Optional Best Buy Products API connector is implemented with mock tests. `BESTBUY_API_KEY` belongs only in the server's secret configuration and is **not configured or live-tested**. See [setup and limits](services/price-service/BESTBUY.md). This is pricing data, not coupon supply.
- Commit `5dabd75` saved an unfinished integration: mismatched `renderPriceAlerts` arguments, `<html>`/`<body>` panel detection mismatch and a missing `page-prices` UI request. Follow-up corrections resolve these. Git does not identify whether Antigravity made that commit; no deleted source files or lost history were found in this review.
- Validation completed: six workspace typechecks, 169 unit tests, four Chrome/Firefox build tests, 55 isolated coupon-surface browser checks and 16 companion checks. Fixtures do not prove live merchant coverage. No Firefox runtime, Best Buy live API, production/database check or 0.6.0 store release was performed.
- Remaining: finish the separate demo-trial UI regression (not written/run), prepare a reviewed 0.6.0 package if requested, and configure/validate Best Buy separately. No package or extension installation is implied by the source version. Work was narrowed after the founder raised token usage; no further feature expansion is in progress.

## Historical October 11 companion checkpoint

Updated October 11, 2026. **Usable local prototype; not ready to claim Honey/Rakuten parity or launch.** The founder chose an extension plus companion dashboard. A broader interface does not resolve the documented coverage gap: the last recorded 30-product test had zero correct savings alerts and one wrong alert; accuracy fixes landed afterward, but coverage has not been remeasured.

## Current source and installed version

- `main` includes Claude's merge at `dcf77fe`: price comparisons, Hold 0.4.0–0.4.3, Codex I3 and the UPC-suffix rule. The companion packet is saved in local commit `fe7b3cd` as **0.5.0 preview**; no push or deployment.
- The founder's installed extension remains **0.4.3** in `apps/extension/dist`. This packet did not rebuild that folder, alter archives, install an extension or deploy anything.
- `codex/price-speed` still has unmerged work. Checkout tips in `coupon-price-compare` belong to another session. Neither worktree was changed here.

## Working in this packet

- **Companion dashboard:** `bun run dashboard`, then `http://127.0.0.1:4175`. Responsive Hold design; saved product links, optional prices and targets, chronological price observations, search/filter/sort, item editing/removal, backup import/export and explicit deletion. No fabricated catalog or balances.
- **Extension integration:** new builds package the same dashboard. “My Hold list” opens it; “Save item” records a product read from the current page. Observations can update an already-saved item when revisiting a readable page. Storage mutations serialize; content scripts cannot query the list through messages; navigation invalidates pending saves.
- **Evidence:** entered/imported prices are personal notes. Page observations are displayed prices, not receipts or confirmed savings. Target matches expire after 15 minutes and are before shipping/tax. No scheduled monitoring, push/email alerts, accounts or cross-device sync.
- **Coupons:** the packaged dashboard reads the build's configured coupon service, filters reviewed public neutral codes, and rechecks current evidence before Copy. Empty/unavailable states are explicit. No merchant was enabled. The standalone dashboard has no coupon-service connection.
- **Rewards:** explicitly unavailable. No points, payable balances, commission activation or payouts were invented.
- **Shared price review:** approved the UPC-prefix exception with further negative tests. Fixed `sameBundle`: generic labels cannot prove matching contents. Marked bundles are excluded until structured bundle facts exist; title markers are not exhaustive evidence.
- **Feed/voucher design:** [design document](docs/AFFILIATE-FEEDS-DESIGN.md) includes Postgres identities/snapshots, scheduled imports, candidate/live-check separation, voucher review, independent commercial data, and Rakuten Advertising US. Design only.

## Verification

- Six workspace typechecks passed.
- 153 unit/build tests passed, including Chrome and Firefox scratch builds.
- 16 companion browser checks passed: empty state, persistent operations, import validation, mobile width, unavailable services, MV3 messaging, active-page save, updated history and content-script denial. Synthetic fixtures only; no live merchant traffic or purchased orders.
- Preview packages were built from commit `fe7b3cd` in `apps/extension/release/0.5.0-preview`: Chrome, Firefox and source ZIPs plus SHA256SUMS. Firefox rebuilt byte-for-byte from the source ZIP. Mozilla lint reported zero errors and 10 warnings, recorded in `RELEASE.txt`; this is not store approval.
- No fresh 50-product coverage run, hosted API verification or database integration run was performed for this packet. Existing price-speed behavior remains unresolved. No new live-support claims.

## What determines whether this is worth continuing

1. Obtain actual approved US feed/coupon access and measure candidate discovery plus live-confirmation success. Feeds alone cannot solve blocked confirmation pages under the current policy.
2. Meet the existing bar: at least 17 real additional savings in a fixed 50-product basket and zero false claims.
3. Run a small shopper pilot to see whether people return and prefer Hold for a concrete benefit. Trust messaging and a polished list are insufficient evidence.
4. M2 needs approved monetization, disclosure and attribution stand-down. **eBay is on hold. C6 stays an M3 prerequisite; no automatic-code merchant may be enabled until C6 is fixed.**

Claude's C7 run failed with a revoked OAuth token without edits. The founder explicitly reassigned that bounded extension integration to Codex; ownership elsewhere is unchanged. See [packet](docs/HOLD-COMPANION-PACKET.md) and [coordination](docs/COORDINATION.md).
