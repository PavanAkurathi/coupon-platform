# Beta readiness — October 8, 2026 (afternoon)

Shareable version with screenshots: https://claude.ai/artifact/TUPu7pruf8EXMuWULEjq3j (the owner shares access). Codex is paused until its weekly reset; the founder reassigned Codex's scope to the Claude coordinating session. Details are in [COORDINATION.md](COORDINATION.md).

**Verdict: not ready for an external beta. The remaining blockers are narrow and named:** source reviewed public codes and enable the first store, confirm the toolbar flow in real Chrome, and add a private remote. The coupon service is deployed and Shopify code testing is proven live.

## Gates

| Gate | State |
|---|---|
| No order submission, cookie access or attribution replacement | Done, tested |
| Coupon safety gate and exact $1 rule | Done, tested |
| Amazon product coupon detection | Done: both live layouts. Unrecognized coupons report "not recognized". Re-verified live on B097S1MF28 |
| Amazon order-review savings | Built: reader plus popup, 24 browser checks. Needs a real-Chrome run |
| Real Amazon cart saving through the extension | Partial: manual −$2.00 earlier. Extension path ready |
| One named Shopify store with public codes | Built and proven live: the real extension saved $2.81 on Allbirds. Waiting on reviewed public codes and enabling the store |
| 3–5 Shopify stores | Not started: the onboarding check exists; codes are the bottleneck |
| Hosted HTTPS service and beta build | Done: Neon Function `couponapi` live and verified; beta build uses it with an HTTPS-only manifest |
| 30-day evidence window, store off switch, proxy-safe limits | Done |
| Privacy policy, listing, icons, name | Partial: icons only. The name is a placeholder |
| Git remote and CI | Not started; work is committed locally only |

## Validation (fresh copy of the integrated tree)

Typecheck 5/5; unit tests 109; browser 121 (15 demo, 27 Amazon reader, 15 Amazon checkout reader, 9 Amazon checkout MV3, 19 Amazon MV3, 17 Shopify reader, 9 Shopify adapter, 10 Shopify MV3); live Postgres/API 64; Shopify live onboarding 8/8 on MVMT and Allbirds; Shopify trial adapter 13/13 live on Allbirds; real extension end to end on Allbirds ($2.81 saved); live Amazon re-walk passes.

## Founder decisions

Done: Neon deploy ([runbook](DEPLOY-NEON.md)) and local commits. Still needed: reviewed public codes and approval to enable the first store ([evidence](SHOPIFY-CHECKOUT-EVIDENCE.md)); add a private remote; choose the product name and publish a privacy policy.

## Deferred

TypeSafe's JEV model: kept out of the extension and checkout path, because checkout processing stays local and the flows are deterministic. A possible later use is server-side triage of merchants' public promo text for the operator review queue, with human approval kept.
