# Amazon product coupons

October 7, 2026 — implemented and tested in the founder's installed Chrome extension, version 0.1.0.

## What works

Opening the popup on an exact `https://www.amazon.com` product route injects an isolated reader through `activeTab` + `scripting`. It identifies the current product, reads visible native coupon tiles, displays advertised coupon prices and terms, and offers **Show coupon on Amazon**. That action only scrolls and focuses the matching control; it never clicks or selects it.

The reader uses the observed `#promoPriceBlockMessage_feature_div`, `.ct-coupon-tile`, labelled checkbox, `.a-price`, `#title #productTitle` and ASIN inputs. Hidden mobile duplicates, ads and unrelated Prime/subscription prices are excluded. Missing identity, ambiguous controls and changing products return an unavailable state. Other Amazon layouts are not yet established as supported.

Observations stay local and ephemeral. There are no coupon API calls, saved Amazon snapshots, cookie access, tracking changes or persistent Amazon host permissions. Native offers never enter the community verification/reporting loop or the code-trial adapter registry. A selected checkbox is described as selected, never as a verified discount.

The worker binds replies to the injected document, checks the URL before/after inspection and rejects product mismatches. Showing a coupon rescans its fingerprint and requires an observation at most two minutes old. Navigation clears the badge; asynchronous badge writes cannot override a newer navigation. The badge denotes a coupon observed by the reader, not confirmed savings.

## Live evidence

On October 7, the installed extension detected the real native coupon for public product ASIN **B097S1MF28**: advertised coupon price **$15.99**, **Limit 1 item**. The popup's Show coupon action focused Amazon's existing checkbox, which remained unchecked. No purchase, cart modification or coupon activation occurred. No personal account data or page HTML was saved.

This proves product-offer detection and the focus action on this observed layout. It does **not** prove checkout eligibility, a $4 realized saving, clipping behavior, claim-code trials, stacking, a merchant partnership or affiliate revenue. The offer can change after this observation.

## Repeatable checks

`bun run --cwd apps/extension test:e2e:amazon` runs isolated synthetic DOM and complete MV3 popup/worker/content tests. Fixture traffic is intercepted; no request reaches Amazon. The MV3 harness labels its temporary fixture host permission if programmatic popup opening cannot grant activeTab. The shipping manifest keeps temporary action access; the actual Chrome toolbar-click test above covers that permission flow.

Coverage includes hidden/duplicate offers, changed product/price, stale actions, ambiguous currency, disabled/selected coupons, unsupported routes, zero page clicks/submits, no API calls or saved snapshots, trial rejection and popup state changes. Existing demo checkout tests remain separate.

## Remaining launch work

Observe and implement Amazon coupon activation plus cart discount verification without touching purchase/payment controls. Establish eligible coupon sources and one named Shopify checkout, then expand to 3–5 stores. Complete HTTPS backend configuration, shopper onboarding, privacy/store listing and release checks before a public launch. Product-page detection alone does not satisfy the full launch gate.
