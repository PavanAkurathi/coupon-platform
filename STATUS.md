# Project checkpoint

Updated October 7, 2026. First paired implementation complete. **Local demo works; Amazon and Shopify are not implemented yet.**

## Finished

- Claude Code: extension safety checks, manual-code approval check, store-adapter structure and popup copy.
- Codex: shared contracts, database migration, coupon review/approval workflow, API enforcement and integration fixes.
- Three shopper confirmations establish effectiveness; separate evidence-backed review establishes eligibility for automated application. Unknown/private/creator/attribution-changing codes are blocked.
- Real browser tests show unknown codes leave checkout unchanged, approved neutral codes work on creator referrals, better existing discounts are restored and no order is submitted.
- Claude Code’s final backend review found no blocking issues.

## Verified

- Dependency installation and all five workspace builds passed.
- 83 unit tests, 51 live API/database/operator checks and 15 actual extension browser checks passed.
- All five Docker containers are healthy as checked October 6.
- Price and cashback services remain explicit stubs. There is no active affiliate revenue or payout ledger.

## Next milestone

Prove one actual Amazon product/cart workflow and one named Shopify checkout with real eligible offers and observed checkout behavior. Then expand to 3–5 Shopify stores for launch. These are required, unfinished features; the demo does not count as merchant support.

October 7 review: Amazon sign-in, a real product's regular/Prime/subscription choices, its built-in price-history panel, and the extension's unsupported state were observed in Chrome. Product loading required retries. No cart was changed and no real coupon application was verified. Gymshark's public terms reveal customer restrictions and possible loss of free shipping after a coupon.

The next implementation packet covers offer eligibility, recent verification and explicit store capability states before enabling live trials. Claude's review confirmed missing freshness checks and eligibility data; shopper independence still relies on operator verification. [Findings and acceptance criteria](docs/LIVE-STORE-REVIEW.md).

Live coupon sources and merchant/network attribution agreements still need evidence. No launch date is committed. This review changed documentation only; the build/test counts above are the previous implementation results.

## Coordination and interruptions

Claude Code completed four bounded packets: initial review, extension implementation, final backend review, and C3 launch gap review. C3 completed successfully with no permission denials or edits. Codex reviewed its recommendations and saved the findings alongside the browser and competitor evidence. No Claude packet remains running; no recurring background run is configured.

One internal delegated run hit a usage limit; Codex took over its unfinished work. Current code and handoffs are saved in this repository. Future packets must be announced in chat, followed by a result or explicit interruption report and an updated checkpoint. Usage limits can interrupt execution; they must not leave the project’s state implicit.
