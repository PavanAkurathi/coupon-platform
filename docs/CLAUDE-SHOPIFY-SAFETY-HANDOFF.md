# C6 — Shopify trial safety

October 10, 2026. Codex review of Claude's `d737def` found three reproducible beta blockers. Existing attribution approval gates remain intact. These reproductions used isolated fixtures, with no live store traffic.

## Assigned owner and scope

Claude Code owns `apps/extension/src/shopify-adapter.ts` and Shopify regression cases in `apps/extension/e2e/shopify-checkout.ts`. Request other files or shared contract changes through the coordinator. No installed build, archive, profile, database, deployment, live shopping or payment-field changes. Codex runs the resulting tests in a scratch copy.

## Required fixes

1. A pre-existing rejection survives while a valid response is delayed six seconds. The adapter returns a zero-saving failure at about 4.2 seconds, then the code applies after completion. `STALE_REJECTION_MS` cannot prove a response belongs to the latest attempt. Wait for evidence of the new response; if ambiguous, stop with an uncertainty error and no further attempts or false failure report.
2. The cart changes from subtotal 2500 to 5000 during the 150 ms typing wait. Apply still fires on the changed cart, and only then does the adapter detect it. Revalidate run identity immediately before each input, Apply and Remove action, including after any asynchronous wait. No further mutation after a changed-cart observation.
3. `history.pushState` switches to another valid checkout token on the same host during typing. Both initial and final Apply run against the new checkout. Bind the adapter to the exact initial URL and stop before any later mutation when it changes.

Add isolated regressions proving each failure against the previous implementation and the corrected behavior. Keep existing successful, failed, restored and existing-code cases. Do not claim these fixes detect equal-subtotal cart changes: the current observation has no line-item fingerprint. That requires a separate shared contract and observed non-personal item evidence.

## Handoff

Return outcome, files changed, exact checks, permission denials or interruptions, and remaining uncertainty. No commits or root/extension builds in the working tree.
