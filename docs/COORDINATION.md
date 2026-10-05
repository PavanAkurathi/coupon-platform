# Codex / Claude Code work split

Updated October 5, 2026. Shared launch requirement: Amazon plus 3–5 Shopify stores, real coupon savings, protected attribution, neutral naming. Founder availability has increased; quality gates stay unchanged.

## Ownership

| Owner | Scope | Review partner |
|---|---|---|
| Codex | `packages/shared`, `services/*`, database/migrations, root tooling, integration and release checks | Claude Code |
| Claude Code | `apps/extension`: popup, worker, adapter interfaces, merchant flows and browser tests | Codex |
| Founder | Product decisions, shopper acceptance testing, merchant relationships, account access and launch approval | Both |

The coordinator assigns narrowly scoped packets. Independent files can proceed in parallel. Shared contract changes are agreed before either side implements against them. Do not edit files owned by an active packet elsewhere.

## Current packets

- **C0 — Claude Code, running:** an initial HTTP 401 was resolved by successful reauthentication. The read-only extension review has been dispatched again; completion is not yet confirmed.
- **D0 — Codex, completed:** backend audit identified the missing public-code/neutral-attribution approval gate. Implementation packet is in `docs/FIRST-SPRINT.md`.
- **I0 — Codex, prepared:** file ownership and shared instructions established. Integrate Claude's review after sign-in succeeds; agree new shared contracts before coding both sides.

## First milestone acceptance

1. One real Amazon product/cart workflow and one named Shopify checkout have observed, documented behavior and real eligible offer sources.
2. The extension recognizes exactly which capabilities are supported and stops on unknown/cart-changing states.
3. Automatic code application requires known safe attribution behavior and recent independent verification.
4. Coupon results measure improvement over the original checkout and preserve a better existing coupon.
5. End-to-end tests cover application, failure, rollback, stale state, attribution protection and the no-purchase boundary.
6. Build passes; demo, fixture and live results are labeled separately. No fabricated revenue.

## Coordination mechanics

Claude Code is invoked locally using the founder's authenticated session; sign-in was refreshed successfully on October 5. Codex sends bounded task packets and reads its returned handoff. Initial review is restricted to read-only tools. A completed command is not a successful implementation; inspect its result and verify the work.

Continuous background work is not configured. Active runs and their outcomes are reported in this chat. Future coding packets need separate ownership or branches before concurrent edits.

## Handoff format

Outcome; changed/proposed files; contract changes requested; tests and evidence; unresolved dependency; next packet. Never include credentials, personal shopping information or copied checkout secrets.
