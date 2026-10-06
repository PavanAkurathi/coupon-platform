# Claude Code — initial extension review

Completed October 5, 2026. Read-only review; this does not establish live merchant support.

The Write tool isn't available in this environment's function schema. I'll deliver the C0 handoff directly as text (per the ~800-word limit the task specified), and note the plan file couldn't be created.

---

## C0 Extension Audit — Handoff to Codex

**Observed state** (read-only; no mutations made)

---

### Prioritized Issues

**P0 — Safety gaps blocking any real merchant work**

1. **No approval/attribution gate on the trial path.** `worker.ts:run()` fetches candidates from `/v1/coupons/candidates` and passes them directly to `runTrials`. `candidateSchema` has no `approvalStatus`, `audience`, or `attributionBehavior` fields, so the extension cannot gate on them. FIRST-SPRINT.md names this as the blocking gap; it needs Codex to add the fields before the extension can enforce them.

2. **Manual `try-code` path bypasses all safety checks.** `worker.ts:run(code)` skips candidate selection entirely and calls `runTrials([code])` with no preflight — no approval check, no attribution check. A user-entered code can trigger immediate checkout mutation regardless of its status.

3. **`hasAffiliateMarker()` exists in `packages/shared/src/trust.ts` but is never called in `worker.ts`.** If the active tab URL carries an affiliate/creator marker (e.g., `?tag=creator-fixture`), the extension proceeds to coupon trials without consulting attribution policy. The e2e smoke test observes cookie preservation but the extension itself does not call `attributionPolicy(...)` or `hasAffiliateMarker(tab.url)` at any point.

**P1 — Architecture changes needed for any real adapter**

4. **No adapter interface or registry.** `adapter.ts` is a single concrete implementation using demo-specific data attributes (`[data-coupon-demo='v1']`, `[data-remove-coupon]`, `[data-coupon-input]`, `[data-apply-coupon]`). `content.ts` is gated entirely on `isDemoCheckout(location.href)`. `worker.ts:merchantFor()` hardcodes both `isDemoCheckout(tab.url)` and `merchant.domain === "localhost"`. There is no mechanism to add a second merchant without rewriting these three files.

5. **Manifest allows only `http://localhost/*`.** Both `host_permissions` and `content_scripts.matches` are `["http://localhost/*"]`. No real merchant origin can be injected until these are updated, and each new origin requires a reviewed adapter before it is added.

**P2 — What cannot be guessed or fabricated**

6. **Amazon and Shopify DOM selectors are unknown and must not be assumed.** Amazon distinguishes clipped product coupons (session-based, applied at cart build) from claim-code promotions (text input at checkout). These are different flows requiring separate observed DOM paths. Shopify checkout differs between standard, Plus one-page, and headless implementations. No selectors are provided here; guesses would violate AGENTS.md.

---

### Proposed Changed Files (Claude-owned)

- **`apps/extension/src/adapters/interface.ts`** (new): `MerchantAdapter` type — `{ merchantDomain: string; supports(url: string): boolean; inspect(): CheckoutInspection; runTrials(codes: string[]): Promise<TrialResult> }`
- **`apps/extension/src/adapters/demo.ts`** (new): existing `adapter.ts` logic moved here, implementing `MerchantAdapter`; `supports()` calls `isDemoCheckout`
- **`apps/extension/src/adapters/registry.ts`** (new): `const ADAPTERS: readonly MerchantAdapter[]`; `adapterFor(url)` returning the matching adapter or `undefined`
- **`apps/extension/src/adapter.ts`** → delete (replaced by `adapters/demo.ts`)
- **`apps/extension/src/content.ts`**: replace `isDemoCheckout` guard with `adapterFor(location.href)`; delegate `inspect`/`trial` to the matched adapter
- **`apps/extension/src/worker.ts`**: (a) replace demo-specific guard in `merchantFor()` with hostname match against tab URL via `adapterFor`; (b) add `hasAffiliateMarker(tab.url)` check before `run()`; (c) gate automatic application on `approvalStatus === 'approved' && audience === 'public' && attributionBehavior === 'neutral'` from candidate fields (blocked on Codex); (d) `try-code` path calls preflight endpoint before invoking `runTrials` (blocked on Codex)
- **`apps/extension/src/popup.ts` + `popup.html`**: add "Pending review" state distinct from "No verified codes" for pending/unknown codes
- **`apps/extension/src/protocol.test.ts`**: add registry tests (adapter `supports()` returns false for unregistered origins), approval gate tests (pending code → zero `runTrials` calls), attribution marker test

---

### Shared Contract Requests to Codex

1. **`candidateSchema`** — add `approvalStatus: z.enum(['pending', 'approved', 'rejected'])`, `audience: z.enum(['unknown', 'public', 'private', 'creator'])`, `attributionBehavior: z.enum(['unknown', 'neutral', 'affiliate'])`. The extension gates automatic application on all three being `approved / public / neutral`.

2. **New endpoint** `/v1/coupons/preflight?merchantId=&code=` returning `{ approvalStatus, audience, attributionBehavior, canAutoApply: boolean }` — used by the manual `try-code` path before any `runTrials` call.

3. **Confirm `merchantSchema.domain` format**: is it a bare hostname (`amazon.com`) or includes subdomain wildcards? Needed for `adapterFor(url)` hostname matching.

---

### First Implementation Scope

This packet: adapter interface + registry (demo only), enforce `hasAffiliateMarker` on tab URL, add "pending" UI state. The approval/attribution trial gate and `try-code` preflight wait for Codex to ship the contract additions.

Tests to add: `adapterFor` returns `undefined` for unregistered origins; `run()` with `creatorLinkDetected` URL halts before `runTrials`; pending-state popup renders correctly; existing e2e smoke passes unchanged.

---

### Access Required Before Declaring Merchant Support

**Amazon (both conditions must be met before any adapter code is written):**
- Direct browser inspection of a real product page with a visible clip-coupon button: selector, clip mechanism (network request vs DOM toggle), cart total DOM path after clipping
- Direct inspection of the checkout promo code input: selector, event model (React synthetic events vs native), settled-state signal
- Confirmed attribution behavior of Amazon promo codes (product coupon vs claim code differ)
- Associates/affiliate program terms review confirming extension eligibility for any revenue path used

**Named Shopify store (one specific store required):**
- Store name and checkout URL; direct browser inspection: standard vs Plus one-page vs headless; promo field selector; React/Vue event model; settled-state detection
- Confirmation of affiliate network (Awin, Impact, ShareASale, etc.) and observed attribution behavior for their codes
- Merchant or network confirmation that the specific codes are public and approved for distribution, not creator-exclusive

Neither merchant is supportable from existing code. Demo, fixture, and live results must stay labeled separately per AGENTS.md.

---

**Unresolved dependency:** Codex needs to ship the `candidateSchema` additions and preflight endpoint before the extension's approval/attribution trial gate can be implemented or tested. The adapter registry can be built independently while that is in progress.
