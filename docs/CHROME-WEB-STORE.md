# Chrome Web Store submission: Hold

Updated October 11, 2026 for the 0.5.1 store build `hold-chrome-0.5.1.zip`. The coordinating session builds it with `apps/extension/release.ts` from the merged commit, next to its `SHA256SUMS`. (The earlier 0.4.2 build, `outputs/hold-0.4.2/hold-chrome-0.4.2.zip`, SHA-256 `b30f781c…0b8ee634`, came from commit 170cc32 plus the store-release changes.) Claims were checked against `apps/extension/src`, `apps/dashboard/src`, `services/price-service/src` and `services/coupon-service/src`. Compared with 0.3.5, the Chrome build has the same permissions, endpoints and cookie handling. 0.4.0 changed the manifest description, set `minimum_chrome_version` to 140 and made validation run without `new Function`. 0.4.1 hides the shopper-token and share-a-code sections in store builds. 0.4.2 adds a price-match tip on Best Buy (see `PRICE-MATCH.md`), with no new permissions and no new data leaving the browser. 0.4.3 tightens matching (no open-box or bundle matches). 0.5.0 adds *Save item* in the popup and the *My Hold list* page packaged inside the extension: saved items, target prices, recorded price history, and backup export and import. The list stays in extension storage until the shopper deletes it, and none of it is uploaded. 0.5.1 hides that page's Coupons and Rewards tabs in store builds, so the page never calls the coupon service. Neither version adds a permission or an endpoint. Upload steps for both stores are in `STORE-RELEASE.md`; Firefox listing fields are in [FIREFOX-ADD-ONS.md](FIREFOX-ADD-ONS.md). Nothing has been submitted.

## Fix before uploading

1. **Host the privacy policy.** `outputs/hold-site/privacy.html` needs a public https URL, such as `https://hold.deals/privacy.html` once the domain exists. Replace the placeholder contact `hello@hold.deals` with a real inbox and delete the yellow note under it.
2. **Done in 0.4.1: no UI a reviewer can't use.** A previous extension by the same founder was rejected for "Inaccurate Description – Non functional" because the reviewer could not reproduce its "Authentication". 0.4.0 showed *Community settings → Shopper token* on every non-Amazon page and said "Coupon codes aren't tested on this store yet". In 0.4.1 store builds, the token and share-a-code sections stay hidden and that line is gone. The dev build keeps them for local tests. This was checked in the real popup on October 10, on a product page and on a page with no product. **0.5.1 does the same for My Hold list:** its Coupons tab (no store is enabled for codes) and Rewards tab (rewards don't exist yet) are left out of store builds, and their addresses open the list instead. Show them again only once they have real data.
3. **Give the reviewer a live example.** Alerts appear only when a cheaper exact match exists at that moment. On submission day, find a product page that shows an alert, and one Amazon product with a clip-on coupon, and put both URLs in the test instructions below. Use the first URL for the Save item steps too: *Save item* appears only on a page Hold can read as a product.
4. **Landing page mismatch.** `index.html` says prices you viewed are compared "for 12 hours". The code uses them for 15 minutes (`PRICE_EVIDENCE_MAX_AGE_MS`). Change the page, or the code if Codex's speed work changes this.

## Store listing

**Name:** Hold (from the manifest; changing it needs a rebuild). Needs Chrome 140 or later.

**Short description** (120 of 132 characters; already the manifest description since 0.4.0):

> Hold before you buy: warns when the same item is cheaper at another store, and finds cheaper Amazon sellers and coupons.

**Category:** Shopping (in the Lifestyle group). **Language:** English (United States).

**Long description:**

```
Go ahead. Try to overpay.

Hold checks whether the exact item you're about to buy is cheaper somewhere else, and tells you before you buy.

WHAT IT DOES
• Same item, cheaper elsewhere. On a product page, Hold reads the model number or barcode the store publishes and compares the exact same item, in new condition. Other offers count only when their shipping cost is known, and only if they save you at least $1.
• Live checks. With price alerts on, Hold checks Amazon and Walmart for the same item from your browser, with no cookies sent.
• Remembers what you saw. Prices of products you viewed stay in your browser, so Hold can tell you when a store you just visited had it for less.
• Save it for later. Save the item you're viewing to My Hold list and set a target price. Each time Hold reads that page again (when you open Hold on it, or as you browse with price alerts on), it adds the new price to the item's history. There are no background checks or emails. The list stays in your browser, and you can export a backup anytime.
• Cheaper sellers on Amazon. Finds a well-rated seller offering the same new item for less on the same Amazon product.
• Amazon coupons. Shows clip-on coupons Amazon displays for the product and takes you to the checkbox. Clipping it is up to you.
• It holds your first click. On Amazon, Best Buy and eBay, when a cheaper verified offer exists, your first Add to Cart or Buy click pauses once. Go to the cheaper store, or click again to buy where you are.

WHAT IT NEVER DOES
• No account and no sign-up.
• No affiliate links. Hold never adds, removes or swaps affiliate links and earns no commission, so nothing decides which deal you see.
• Never reads your cookies, card details or payment fields, and never places an order.
• Never sells or shares your data. No ads, no trackers.

YOUR CHOICE
After you install it, Hold reads only the tab where you click its button. Price alerts on every store need Chrome's "all https sites" permission, which Hold asks for only when you press Turn on. Turn it off anytime.

GOOD TO KNOW
• Hold compares exact matches only. When it stays quiet, it found nothing cheaper at the stores it can check. That isn't the same as nothing cheaper existing.
• Prices are before tax. Confirm the total at checkout.
• US stores and US dollars for now.

Privacy policy: <privacy policy URL>
```

**Images** (in `docs/store-assets/`, regenerate with `bun docs/store-assets/make-assets.ts`):

| File | Size | Shows |
|---|---|---|
| `01-cheaper-elsewhere.png` | 1280×800 | Real live check on a Best Buy product page, October 8: "$7.99 less at Walmart, $89.00 there vs $96.99 here". From `price-evidence/bestbuy-live-check.png`. |
| `02-hold-before-you-buy.png` | 1280×800 | Real pause dialog on a live Amazon product page, October 8: "$1.69 less at eBay". From `price-evidence/amazon-pause-live.png`. |
| `03-remembers-what-you-saw.png` | 1280×800 | Real banner on the same Amazon page ("You saw it just now"). From `price-evidence/amazon-banner-live.png`. |
| `04-privacy.png` | 1280×800 | The six privacy promises. Text only, no prices. |
| `promo-tile-440x280.png` | 440×280 | Small promo tile. No prices. |

The captures are cropped and framed, never edited. The banner and pause code (`price-content.ts`) is unchanged between those captures and 0.5.1, apart from the 0.4.2 tip line. No screenshot shows My Hold list yet; one taken from a real saved item would be a good fifth image. Store icon: `icon-128.png` from the zip. The optional 1400×560 marquee was not made.

## Privacy tab

**Single purpose:**

> Hold helps shoppers avoid overpaying for the items they shop for. It compares the exact item's price at other stores and other Amazon sellers, shows coupons the store already offers, warns the shopper before they buy, and keeps a list of items they save, with the prices it saw, on their device.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Keeps the shopper's saved items (My Hold list: up to 200 items with their target prices and up to 90 recorded prices each, kept until the shopper deletes them), recently viewed products (up to 300, deleted after 7 days), recent price-check results (15 minutes) and settings on the device. None of it is uploaded. |
| `activeTab` | Reads the product, coupon or order-summary details of the current tab only after the shopper clicks Hold's toolbar button. |
| `scripting` | Injects Hold's own packaged reader script into the tab the shopper clicked on. After the shopper turns on price alerts, it registers that same packaged script for https pages. |
| `offscreen` | Parses Amazon and Walmart pages fetched for a price check with DOMParser, which the service worker lacks. Their scripts never run. |
| Optional host `https://*/*` | Requested only when the shopper presses "Turn on" for price alerts. It lets Hold read product pages on any store and fetch Amazon's and Walmart's public pages for the same item. Off by default and removable at any time. |

**Remote code:** No. All JavaScript ships in the package. The only data fetched is JSON from Hold's two services (schema-validated) and store HTML parsed with DOMParser. My Hold list is a packaged extension page (`dashboard/index.html`) that makes no network requests. If a reviewer asks: the validation library runs in its no-`eval` mode, so its `new Function` code is present in the bundles but never called, and the extension's CSP would block it anyway.

**Data usage.** Recommended answers, chosen to disclose generously:

| Category | Answer | Why |
|---|---|---|
| Personally identifiable information | No | Nothing like names, emails or addresses is read or sent. |
| Health information | No | |
| Financial and payment information | No | Prices and the Amazon order total are read on the device only. Payment fields are never read. |
| Authentication information | No | Store builds have no login and no way to enter the beta shopper token. The worker's `save-token` handler and its token-gated code reports are still in the code, but no store-build screen can reach them, and a fresh store install has no stored token. So no credential is collected or sent. Dev builds keep the field for local tests. |
| Personal communications | No | |
| Location | No | Hold's code does not collect IP addresses. Tick this if the coupon service's `CLIENT_IP_HEADER` is ever set: it then keeps a hash of the address in its rate-limit table. |
| Web history | **Yes** | Products viewed are stored locally, and each product's identity plus the store's host name goes to the price service. Nothing links them to a person. Saved items (titles, links, recorded prices) are stored locally until the shopper deletes them, and never uploaded. |
| User activity | No | Buy clicks are watched on the page only to pause them; nothing about them leaves the device. |
| Website content | **Yes** | Product details are read from pages. Brand, model, barcode, variant, pack size and condition go to the price service. |

Tick all three certifications: no selling or transferring of data outside the approved uses, no use unrelated to the single purpose, no use for credit or lending.

**Privacy policy URL:** the hosted `privacy.html`.

## Test instructions for the reviewer (optional field)

```
1. Open <product URL checked on submission day>, a US product page that lists a model number, and click Hold's toolbar button. The popup shows a price check for that exact item.
2. In the same popup, press "Save item". The popup says "Saved. Open My Hold list to set a target price."
3. Press "My Hold list ↗". A tab opens Hold's own list page, which is part of the extension, showing the item with its price and "Seen on store page". Open the item's ••• menu to set a target price, and click its name to see the recorded prices. "Settings & data" has Export backup and Import backup. The list is stored only in the browser.
4. In the popup, press "Turn on" under price alerts and accept Chrome's prompt. Reload the product page. If Amazon or Walmart has the same new item for at least $1 less (prices change daily), a banner appears, and on Amazon, Best Buy or eBay the first Add to Cart click pauses once.
5. On <Amazon product URL with a clip-on coupon, checked on submission day>, the popup lists the coupon. "Show coupon on Amazon" scrolls to the checkbox but does not clip it.
No account or login is needed.
```

## Founder's submission checklist

- [ ] Check `hold-chrome-0.5.1.zip` against the `SHA256SUMS` next to it from the coordinating session's final build.
- [ ] Host `privacy.html` and replace the contact placeholder.
- [ ] Register a developer account at the Chrome Web Store Developer Dashboard with the Google account that will own Hold. There is a one-time $5 fee; pay it yourself.
- [ ] Turn on 2-Step Verification for that Google account. The dashboard requires it to publish.
- [ ] In the dashboard's Account tab, set and verify the contact email.
- [ ] Answer the trader / non-trader question (EU rules). A trader's name, address, phone and email are shown to EU users. A non-trader listing tells EU users that consumer-protection law doesn't apply. It depends on whether you run Hold as a business, so it's your call; ask an advisor if unsure.
- [ ] Choose visibility. Recommended: **Unlisted** for the beta, so only people with the link can install it. It is still fully reviewed, and you can make it Public later.
- [ ] Distribution: Free. Regions: United States is enough, since Hold handles US stores and US dollars only.
- [ ] Upload the zip. Fill the Store listing tab (above), add the 4 screenshots and the promo tile, and fill the Privacy tab (above).
- [ ] Press Submit for review yourself. Optionally choose to publish manually after approval.
- [ ] After approval, remove the unpacked Hold from your Chrome so two copies don't both show alerts. The store copy gets a new extension ID; both services already accept any extension origin, so no backend change is needed. The two copies keep separate lists: before removing the unpacked one, export a backup from its My Hold list and import it into the store copy. Imported prices then show as entered by you.

## Follow-ups found while checking

- The popup has no "Forget products I viewed" button. The worker already handles a `price-forget` request, but it clears only the viewed-products list, not the 15-minute live-check cache. The privacy policy therefore names uninstalling as the way to delete everything.
- The landing page says "Clicks made for you: 0". Code testing on enabled Shopify checkouts types codes and presses Apply. The hosted coupon service enables no stores (checked October 10), so this is true today. Revisit if stores are enabled.
- Turning alerts off stops new pages, but tabs already open keep Hold's page script until they reload.
- My Hold list's promise and settings pages mention a standalone dashboard with its own list ("The two lists do not sync automatically"). Store users have only the extension's list. Not wrong, but confusing; noted for Codex in `COORDINATION.md`.
