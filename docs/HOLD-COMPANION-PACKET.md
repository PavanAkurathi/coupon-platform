# Hold companion packet — October 11, 2026

Founder requested the full Honey-style experience with Hold's approach, choosing the extension plus shopping dashboard. This expands the product surface; it does not establish merchant access, live coupon coverage, earnings or launch readiness. eBay remains on hold and C6 remains an M3 prerequisite. The installed 0.4.3 output stays untouched.

## Ownership and shared contract

- Codex: new `apps/dashboard`, `packages/shared/src/watchlist.ts`, shared price review, root scripts, integration and documentation.
- C7 was assigned to Claude, but the CLI returned a revoked OAuth token without edits. The founder explicitly reassigned this bounded extension integration to Codex on October 11. No other active session's checkout-tips files or worktrees.
- Frozen contract: `watchlist.ts` exports `watchlistSchema`, `watchlistRequestSchema`, `WATCHLIST_KEY`, `emptyWatchlist`, `applyWatchlistRequest`, `savePageItem`, `observeSavedPage`. Request and response types live there; changes go to Codex.
- Every watchlist message replies `{ok: true, data: Watchlist}` or `{ok: false, error: string}`. Data is private to this browser, with no accounts or sync. Page observations are evidence of a displayed price, not savings or an order. Imported history becomes manual evidence.

## C7 — Claude extension integration

Allowed: extension worker, popup HTML/CSS/TS, price-worker, build wiring; new watchlist-worker module/tests and bounded browser tests. Do not change shared contracts, dashboard source, Shopify code trial engine or enabled merchants. Never build installed `apps/extension/dist`; use a fresh explicit temporary output directory. Do not deploy, install, access cookies, inspect secrets, insert affiliate links or interact with live shopping.

1. Add a serialized storage worker using `WATCHLIST_KEY`. Validate on load. Recover missing data to an empty list; report invalid existing data without overwriting it. A failed storage write must return an error. All mutations serialized, including observations, so concurrent save/remove cannot lose updates.
2. Accept watchlist messages only from exact extension-owned `popup.html` and `dashboard/index.html` URLs (ignore fragments/query when identifying the exact page). These pages can have `sender.tab`; distinguish them before content-script dispatch. Content scripts and other extensions must never read or mutate saved items.
3. `hold-save-page` is popup-only. Resolve the current active tab via the existing observed reader (`popupPrice` is usable); recheck tab URL after awaits; call `savePageItem`. Do not accept a claimed product in a request.
4. Hook successful `rememberProduct` into `observeSavedPage` only for already-saved items. Saving does not grant additional host permissions or start a background polling loop.
5. Add a visible “My Hold list” button that opens the packaged dashboard only on a click. Add “Save item” when the current popup has an observed product. Show success or actionable failure. Retain existing coupon and comparison controls.
6. Bundle `../../apps/dashboard/src/main.ts` to `dashboard/main.js`, copy `apps/dashboard/public/index.html` and `styles.css` into `dashboard/` at build time. All code local, no inline script/eval. Dashboard build has no external dependencies beyond shared. Do not mark dashboard web-accessible or add permissions. Keep beta validation and Firefox support intact.
7. Unit-test sender authorization, rejected content messages, queue behavior and stale-tab save. Run extension typecheck/unit tests (no default build).

## D4 — Codex companion

Standalone browser dashboard and the exact same UI packaged in the extension: saved links/products, target prices, observed/manual price history, search/filter/sort, edit/remove, backup import/export and deletion. Clear browser-local storage scope, user-controlled retailer navigation, and truthful store/coupon/reward availability. Standalone list remains separate from extension storage until explicit backup import; no silent bridge or browsing uploads. No fabricated coupons, products, price histories or earned balances.

## Product gate

This work is not evidence of product-market fit. Retain the measurable launch gate: real additional savings on at least one third of a fixed 50-product basket, zero false claims. Require repeated use in a shopper pilot before expanding scope again.
