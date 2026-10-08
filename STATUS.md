# Project checkpoint

Updated October 7, 2026. **The installed Chrome extension now detects a real Amazon product coupon.** Automated checkout code trials still support the local demo only; Shopify is unfinished.

## Finished this packet

- Claude Code C4 completed popup, worker, manifest and build wiring. Codex integrated the shared contracts, observed Amazon reader, content script, safety fixes and tests.
- Live Chrome: product B097S1MF28 showed **Coupon price $15.99, limit one item** inside the actual extension. **Show coupon on Amazon** focused its existing checkbox and left it unchecked. No purchase or cart change.
- Offers are local observations, separate from community-verified codes. Product/offer changes and stale actions stop safely; selected coupons are not called confirmed savings.
- Amazon inspection needs no running backend and stores no product snapshots. No cookie access, affiliate replacement or persistent Amazon host permission.
- [Amazon scope and evidence](docs/AMAZON-INTEGRATION.md).

## Validation

- Frozen dependency install and all five builds passed; **88 unit tests** passed.
- **15 Amazon reader fixture checks and 15 complete Amazon MV3 fixture checks** passed. The latter use a disposable test-only host grant; the real Chrome toolbar test separately confirmed the shipping activeTab permission.
- **15 demo MV3 browser checks** passed, including unknown-code rejection, preserving better discounts, creator attribution and no order submission.
- All five Docker containers are healthy as checked October 7. Prior backend integration checkpoint: **51 live API/Postgres/operator checks** passed; backend behavior was not changed by this Amazon packet.
- Price and cashback remain explicit stubs. No affiliate revenue or payout ledger is active.

## Next release gates

The founder's target is a beta within a couple of days. The remaining work is concrete:

1. Amazon: observe coupon activation and verify the resulting cart discount without ordering; product detection alone is not a verified saving.
2. Shopify: one named checkout with real eligible public codes, measured improvement and restoration tests; expand to 3–5 stores.
3. Beta release: recent verification, shopper onboarding, HTTPS API configuration, privacy/store listing and clean installation checks.

Missing live coupon sources and attribution evidence cannot be replaced with synthetic votes. Public launch is not yet ready. The demo's real API/verification loop and trust/$1 policies are implemented; price tracking and cashback follow after the extension.

## Coordination

Claude C4 completed successfully with no permission denials. Codex reviewed and tested its handoff. One earlier internal review hit a usage limit; Codex took over. The final reviewer completed the isolated MV3 regression checks; Codex reran and passed all 45 browser checks after integration. All work packets are complete. No recurring background job is configured. This checkpoint and the coordination log record the actual state so the next session can resume without guessing.
