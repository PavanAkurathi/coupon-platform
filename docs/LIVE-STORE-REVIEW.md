# Live store and competitive review

October 7, 2026. Research and browser observations, not a claim of live extension support. Amazon and 3–5 Shopify stores remain required for launch.

## Product direction

Win on trustworthy **additional savings** and useful eligibility explanations. The shopper should understand what changed, what conditions apply, and why a code is worth trying. Price comparison, coupon testing, community submissions and price alerts already exist elsewhere. Our advantage must be demonstrated on real carts.

| Product | Current documented strengths | Implication for us |
|---|---|---|
| Honey | Automatic coupon testing, community submissions, Amazon seller comparison, price history and Droplist. | Community sourcing and preserving the better price are baseline requirements, not unique features. [Features](https://help.joinhoney.com/article/39-what-is-the-honey-extension-and-how-do-i-get-it), [Amazon](https://help.joinhoney.com/article/46-can-i-use-honey-on-amazon). |
| Rakuten | Cashback plus coupons. Outside codes can invalidate cashback. A current, restricted Amazon new-member offer is funded by Rakuten. | Explain compatibility and eligibility; do not promise universal Amazon cashback or immediate settlement. [Extension](https://www.rakuten.com/help/category/browser-extension-help-26579223731603), [exclusions](https://www.rakuten.com/help/exclusions.htm), [Amazon offer](https://www.rakuten.com/mktg/amazonpromo). |
| Capital One Shopping | Coupon trials, Amazon comparison, price alerts; rewards redeem for selected gift cards. | A clear distinction between immediate savings and conditional rewards can help shoppers. [Official help](https://capitaloneshopping.com/help). |
| Keepa | Amazon price history, target-price/restock alerts and international comparisons. | Competing on chart breadth immediately would distract from checkout reliability. [Publisher listing](https://chromewebstore.google.com/detail/keepa-amazon-price-tracke/neebplgakaahbhdphmkckjjcegoiijjo). |

This is a feature/terms comparison, not a controlled performance benchmark of installed competing extensions. Do not advertise that we save more until that is measured.

## Observed in actual Chrome

**Amazon:** sign-in succeeded. The Coupons navigation led to Prime Big Deal Days during this session, so the adapter cannot rely on a fixed coupon landing page. Two product pages initially rendered blank; a retry eventually exposed one product's purchase controls. No cart items were added, removed or changed; no order, payment or subscription action was taken.

The public product [B072JTL1HW](https://www.amazon.com/dp/B072JTL1HW) displayed regular, Prime-only and Subscribe & Save prices for the same variant. These are different purchase conditions, not three interchangeable coupon results. Opening its Price history control exposed Amazon's own history panel. These observations establish product-page behavior only; no eligible coupon was clipped, no claim code was applied, and no checkout savings were verified. Prices and layout can change.

The installed extension's Amazon popup remained disabled with its local-demo message. There is still no live Amazon adapter. Amazon also documents its own [price history](https://www.aboutamazon.com/news/retail/how-to-check-amazon-price-history), reinforcing that history alone is not a differentiator.

**Gymshark:** the storefront showed a shipping threshold and student/referral offers. Its [official discount guide](https://support.gymshark.com/en/articles/11179105-what-discounts-are-available) distinguishes new-customer, student and athlete discounts, limits orders to one code, and warns that a discount can remove free shipping. It also instructs shoppers to preserve code capitalization. None of those offers was enrolled in, submitted or added to our database.

Gymshark is a useful eligibility test case, but this review did not establish an eligible public, attribution-neutral code for automatic trials. It is not yet approved as the first integrated Shopify store. [Shopify's combination rules](https://help.shopify.com/en/manual/discounts/discount-combinations) vary with merchant configuration, so platform-wide stacking assumptions are unsuitable.

## Benefits to build

| Priority | Shopper benefit | Acceptance evidence |
|---|---|---|
| Launch | A reliable savings receipt | Original and final comparable payable totals; existing discounts preserved; shipping/tax uncertainty labeled; no credit for an existing sale. |
| Launch | Offers that fit this purchase | Separate claim codes, clipped coupons, membership prices and subscriptions; product/variant, region, quantity and customer restrictions recorded. No automatic enrollment or purchase-option switch. |
| Launch | Fewer stale or irrelevant trials | Show recent independent confirmations and eligibility; quarantine insufficient/stale evidence; filter before ranking. |
| Launch | Creator credit stays protected | Preserve existing creator codes and referral attribution; unknown effects stop automation/monetization. A better price alone never authorizes replacing creator credit. |
| Phase 2 | Useful wait-or-buy advice | Approved price-history source, matched variant/seller/purchase mode, target alerts. No invented history or perpetual polling infrastructure. |
| Phase 3 | Understandable rewards | Signed order evidence, pending/confirmed/reversed states and exactly $1 only on eligible earned commission with positive additional savings. |

Coupon savings remain entirely the shopper's. No “We made $1” until entitlement is confirmed. Amazon monetization needs a permitted arrangement; ordinary [Associates enrollment](https://affiliate-program.amazon.com/help/operating/policies) does not establish extension rights. [Chrome's affiliate policy](https://developer.chrome.com/docs/webstore/program-policies/affiliate-ads) requires disclosure, benefit and related user action.

## Claude C3 result and integration review

Actual Claude Code completed a read-only review successfully, with no permission denials and no edits. Codex checked these findings against the source:

- **Live support missing:** `apps/extension/src/adapters/registry.ts` and `public/manifest.json` contain only the local demo. A real store requires an observed adapter, merchant record, exact host permissions and reviewed offer evidence together.
- **Stale evidence:** `services/coupon-service/src/db/store.ts` aggregates current votes without an age window. Operator-created codes can have no expiry. Historical confirmations can therefore remain eligible indefinitely.
- **Missing eligibility:** `packages/shared/src/contracts.ts` cannot express customer, basket, variant or stacking restrictions. It also uppercases every code; merchant-specific handling needs validation before supporting case-sensitive codes.
- **Shopper independence:** tokens and unique identity hashes prevent duplicate votes under one provisioned identity. `scripts/create-reporter.ts` relies on operator verification; there is no documented review/revocation process proving separate people.
- **Recovery/operations:** demo rollback is conditional on a readable, unchanged cart. It is not proof of recovery after navigation, content-script loss or a worker restart. There is no per-merchant operational disable switch.

Claude proposed a generic Shopify adapter skeleton. Codex did **not** accept this as the next live-support implementation: synthetic selectors do not prove merchant behavior, comments are invalid in `manifest.json`, and a broad `*.myshopify.com` permission conflicts with exact-store activation. No such code or permissions were added.

## Next bounded packet

**Readiness for the first real stores:** Codex owns shared Zod contracts, evidence freshness and eligibility storage/filtering; Claude owns the extension's offer explanations and capability states after those contracts are agreed. No new service or large framework is needed.

1. Define offer type, purchase conditions, evidence timestamp and total completeness. Unknown eligibility remains unknown. Preserve exact code text unless a specific merchant's behavior establishes safe normalization.
2. Require three independent successful reports inside a configurable freshness window; recalculate at read time as reports age out. Display last success and recent count. Suggested initial window: 30 days, subject to beta measurement. A single new success must not revive two stale votes.
3. Record the first Amazon and named Shopify walkthrough with public offer evidence, observed controls, settled-result signals and restoration limits. Keep raw account/checkout data local and out of fixtures. Enable only the exact validated host and flow; inspection-only is not “coupon support.”
4. Test shipping-threshold loss, ineligible membership/subscription offers, better existing/creator codes, multiple discounts, code case, stale votes, unknown totals, navigation and interrupted trials. No purchase action in tests.

The first release gate remains **one real Amazon offer-to-cart savings proof plus one named Shopify checkout**, then expansion to 3–5 Shopify stores. This session did not pass that gate. Track additional savings per eligible attempt, time to result, failure/recovery rate and repeat use; do not choose a launch date from test counts alone.

No application code changed in this review. Prior build/test results remain the last implementation checkpoint; they were not rerun as part of this research. No Claude packet remains running.
