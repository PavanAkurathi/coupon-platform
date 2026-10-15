# Hold v1 plan

**October 15 founder requirement:** the [trust charter](TRUST-CHARTER.md) is a hard constraint on every feature and commercial decision. Revenue and growth cannot override it. Existing no-tracking and monetization gates remain in force.

Decided October 10, 2026 by the founder: **honest commission**. 0.4.2 is accurate but can see too few stores, has no working coupons and earns nothing. v1 fixes all three with affiliate networks, under rules that keep Hold on the shopper's side. Until v1 meets the launch bar, Hold stays an unlisted beta.

## Launch bar

- **Hit rate:** on a fixed basket of 50 real products the founder would buy (at least half electronics, appliances or tools), Hold shows a real, verified saving on **at least 1 in 3**. A saving is a cheaper exact item, a store-authorized code that works, or money back of at least $1. The baseline comes from `docs/COVERAGE.md` (in progress).
- **Zero false savings claims** across that basket.
- Every claim on the listing can be reproduced by a reviewer (lesson from the founder's earlier rejection).

## The rules (these become code and tests)

1. **The cheapest deal wins.** The ranking code never receives commission data; they are separate types and modules. A test proves an offer paying commission can't outrank a cheaper one. Stores that pay Hold nothing, Amazon included, are compared and shown exactly the same, with a plain link. Commission is added only when the cheapest deal happens to be at a partner store.
2. **Commission links only on the shopper's click** of a Hold button, such as "Go to the cheaper store" or "Use this code", with the disclosure next to it: "Hold may earn a commission. It never changes which deal we show." This is what Chrome's affiliate policy requires: a direct user benefit, a related user action before each affiliate link, and disclosure in the listing and the UI.
3. **Stand down.** If the shopper arrived through another affiliate or creator link, Hold shows no commission link and no prompt for that store for the rest of the session. The logic runs in the extension, is documented and tested. Every network requires this; one suspended a large coupon extension's payments in January 2026 for breaking it.
4. **Never** replace an existing link or code, set shopping cookies, open pages on its own, or apply a code without a click.
5. **Amazon:** comparison only. Its affiliate rules reportedly bar links in browser extensions. That needs confirming on Amazon's own page, but plan without Amazon commission.

## How data, coupons and money work

| Need | Source | Notes |
|---|---|---|
| Prices at many stores | Affiliate-network product feeds, loaded into Neon Postgres and keyed by barcode or brand + model | One network documents a publisher product-feed API; another has partner catalogs once you join a brand; a third is unclear (some sources say there's no publisher product search). Feeds are hours old, so a feed price is a **candidate**: Hold re-checks the store page before alerting |
| More prices | eBay Browse API (code built, keys pending), live Amazon and Walmart checks (kept), prices the shopper saw | Walmart via its affiliate API if approved |
| Coupons | Network offer and voucher APIs: codes the store itself published | Shown with Copy; applied only on a click. The existing Shopify code-testing engine can verify them |
| Money | Commissions on clicks Hold sent to a cheaper store or a working code | Phase 1: commission only, no accounts. Phase 2 (optional): cash back, which needs accounts, payouts, tax forms and fraud checks |

**Open policy question (must be settled before Phase 1):** does Chrome count "Hold found you a cheaper price, here's the link" as a direct user benefit without cash back? The policy names discount, cash back or donation. Conservative path: show commission links only where Hold delivers a measurable saving (a cheaper store or a working code), and ask Chrome Web Store support in writing before launch. If the answer is no, Phase 2 (cash back) becomes required.

## What we park

- **Shopify code-trial operator tooling** (enabled merchants, shopper tokens): replaced by network-authorized codes. Keep the trial engine.
- **Price-drop refunds** (`PRICE-MATCH.md` b): after v1.
- **Amazon checkout tips:** finish only if it's cheap; it needs the founder's checkout click.
- **Firefox for Android:** after v1.

## Who does what

- **Founder:**
  - apply to the networks (two or three large ones; Walmart's program runs through one of them);
  - eBay keys, Chrome and Mozilla accounts;
  - the money decisions below;
  - shop from the 50-product basket.

  Apply early: networks and each store approve publishers separately, and extensions must say they're extensions when applying.
- **Codex (backend):** feed and voucher ingestion with a Postgres schema; price-service lookups by identity; deep-link generation through network APIs; commission reporting.
- **Claude (extension):** stand-down detection; click-to-activate UI with disclosure; ranking kept separate from commission; re-checking feed candidates on the live page; rewriting the listing, privacy policy and landing page; end-to-end tests.

## Milestones

| | Done when |
|---|---|
| **M0** (this week) | Coverage baseline written; eBay keys live; network applications sent; code committed to a private repo |
| **M1** | Feed prices from the first approved stores in the price service, re-checked live before alerting; basket hit rate measured again |
| **M2** | Commission links with stand-down and disclosure; privacy policy, listing and landing page rewritten; Chrome's answer on user benefit received; unlisted beta to a few testers |
| **M3** | Store-authorized codes; basket at least 1 in 3 with zero false claims; public launch |
| **M4** | Optional: cash back with accounts; price-drop refunds |

## Risks

- **Approval:** a new publisher with no traffic may be turned down or approved slowly. Mitigation: honest application, the privacy page live, the coverage numbers as evidence.
- **Chrome's reading of "user benefit":** could force cash back, and accounts, earlier.
- **Feed accuracy:** stale prices. Mitigation: re-check on the live page before any alert.
- **Founder time and money.** Keep everything on free tiers until commissions arrive.

## Decisions (made October 10, 2026)

1. **Phase 1 money:** commission only, no accounts. Cash back comes later (M4), or sooner if Chrome's answer requires it.
2. **Launch focus:** electronics, appliances and tools.
3. **Launch bar:** a real, verified saving on at least 1 in 3 of a 50-product basket, with zero false claims.
