# Codex / Claude Code work split

Updated October 7, 2026. Shared launch requirement: Amazon plus 3–5 Shopify stores, real coupon savings, protected attribution, neutral naming. Founder availability has increased; quality gates stay unchanged.

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
- **C3 — Claude Code, completed:** read-only launch gap review returned successfully with no permission denials or edits. Codex verified the source evidence and corrected the proposed generic Shopify skeleton/manifest approach. [Integrated review](LIVE-STORE-REVIEW.md) includes the current competitor comparison, actual Chrome observations, remaining gaps and next packet. No new packet is running.

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
