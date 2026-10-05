# First paired implementation packet

## Problem

The prototype publishes any code after three successful reports. Success does not establish that a code is public or that applying it preserves another publisher's commission. The popup's manual-code path also bypasses candidate selection and immediately automates a trial.

## Codex ownership: approval and attribution gate

Add shared Zod metadata for operator review state (`pending`, `approved`, `rejected`), audience (`unknown`, `public`, `private`, `creator`), attribution behavior (`unknown`, `neutral`, `affiliate`), evidence reference and review time. Names and response shape must be agreed with Claude before implementation.

Default every new or migrated coupon to pending/unknown. Successful shopper reports may update verification counts but must never approve or alter safety metadata. Automatic candidates require approved/public/neutral evidence in addition to quorum and expiry, filtered in SQL before ordering/limit and checked again before response.

Use a local operator CLI for evidence-backed review; no public moderation endpoint yet. Only the localhost fixture can receive synthetic approval from the demo seed. An explicit preflight contract will let the extension check manual codes before automated application; approval is separate from shopper verification.

Files: `packages/shared/src/*`, `services/coupon-service/src/db/*`, domain and API routes, review/seed scripts, an additive migration, unit and integration tests.

Acceptance: three shoppers cannot approve safety; all unknown/restricted states stay blocked; approval revocation immediately removes candidates; reports cannot edit approval; unsafe high-ranked codes cannot crowd safe codes out of the limit; migrated rows fail closed.

## Claude ownership: extension enforcement and adapter boundary

Review the shared contract, then enforce it in both candidate and manual-code automation. Explain pending approval clearly in the popup. User-entered codes must not bypass the automatic-application safety gate.

Extract the local demo behind an adapter interface/registry so recognition, checkout inspection and trial capability are separate. Preserve existing runtime origin checks, original-coupon recovery, stale-result handling and sender validation. Unknown merchants have no trial capability. Do not add guessed Amazon/Shopify selectors or broaden permissions without an observed implementation need.

Files: `apps/extension/src/*`, extension UI and focused tests. Shared contract requests go to Codex; do not edit the backend or root dependency files independently.

Acceptance: pending/unsafe manual codes trigger zero checkout mutations; approved codes still work; unsupported origins cannot invoke trials; the existing demo browser tests pass; UI does not confuse approval with community verification.

## Integration and next live milestone

Codex integrates and runs install/build, focused unit tests, the live database checks and affected browser tests. Claude reviews the backend patch; Codex reviews the extension patch. Record failures as failures, not completed work.

This packet is production groundwork, not Amazon support. Next: inspect one real Amazon product/cart flow and one named Shopify checkout; obtain real eligible coupon sources and verify attribution behavior. Launch still requires Amazon and 3–5 Shopify stores.
