# Firefox Add-ons listing: Hold

Updated October 11, 2026 for 0.5.1: `hold-firefox-0.5.1.zip`, with `hold-source-0.5.1.zip` as the reviewer source. The coordinating session builds both with `apps/extension/release.ts` from the merged commit, next to their `SHA256SUMS`. (First prepared October 10 for `outputs/hold-0.4.2/hold-firefox-0.4.2.zip`, SHA-256 `670e9914…a8dbfb83`.) 0.5.0 adds *Save item* in the popup and the *My Hold list* page inside the add-on (saved items, target prices, recorded price history, backup export and import), kept in the add-on's storage until the shopper deletes it. 0.5.1 hides that page's Coupons and Rewards tabs in store builds. Neither adds a permission, an endpoint or a data category. Upload steps, source-code instructions and reviewer notes are in `STORE-RELEASE.md`. Chrome fields are in [CHROME-WEB-STORE.md](CHROME-WEB-STORE.md). Nothing has been submitted.

## What the Firefox build is

- Add-on ID `hold@hold.deals`. That ID is permanent once submitted. Firefox 140 or later; Firefox for Android 142 or later is declared too.
- Permissions: `storage`, `activeTab`, `scripting`, plus optional `https://*/*`. There is no `offscreen`: Firefox's background page parses fetched store pages itself with DOMParser.
- Same endpoints, cookie handling and data flows as the Chrome build: the two Hold services, plus cookie-free Amazon and Walmart page fetches after the shopper turns on price alerts.
- My Hold list is a packaged page, `dashboard/index.html`, opened from the popup. It makes no network requests.
- Mozilla's linter reports 0 errors and 10 warnings for 0.5.1 (`release.ts` run on October 11). Six are `DANGEROUS_EVAL`, one per script bundle, from the validation library's static code; it runs in its no-`eval` mode. Four are `UNSAFE_VAR_ASSIGNMENT` in `dashboard/main.js`, where the list page builds its HTML from templates. Text from the shopper or a page is escaped first; the other values are validated numbers, dates and IDs.

## Fix before submitting

1. **Shopper token: done in 0.4.1.** Store builds no longer show the shopper-token setting, so nothing in Mozilla's `authenticationInfo` category is collected. The two declared categories, `browsingActivity` and `websiteContent`, are complete.
2. **Android.** The manifest declares Firefox for Android 142+, so AMO will offer Hold there too. The October 10 live test was on desktop only. Test on Android first, or untick Android under the version's compatibility.
3. **Privacy policy hosting.** The same as for Chrome: host `outputs/hold-site/privacy.html`. Its contact address is already `hold.extensionn@gmail.com`.
4. **Try Save item and My Hold list in Firefox.** So far they have been clicked through only in Chromium: Codex's fixture checks, and a live save on a Best Buy product page on October 11. The Firefox build passes the build tests and Mozilla's linter, but nobody has used the list in Firefox yet.

## Listing fields

**Name:** Hold. **Slug:** `hold` if it's free, otherwise `hold-check-before-you-buy`.

**Summary** (211 of 250 characters):

> Hold before you buy: warns when the exact same item is cheaper at another store, finds cheaper Amazon sellers and Amazon coupons, and can pause your first Buy click. No account, no affiliate links, nothing sold.

**Categories** (up to two): Shopping; optionally Alerts & Updates.

**Tags:** price comparison, price alert, shopping, deals, coupons.

**Description.** AMO accepts a little formatting; this plain text works as is. Mozilla expects the listing to say what the add-on sends, so that section stays in.

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

WHAT LEAVES YOUR BROWSER
• To Hold's price service: the product's brand, model number, barcode, color or variant, pack size and condition, and the name of the store you're on. Never the page address, your account or cookies.
• To Amazon and Walmart, with price alerts on: a search for the brand and model number, or the barcode, sent without cookies.
• Firefox shows these at install as "browsing activity" and "website content".
• Your saved list is never sent anywhere. It leaves your browser only as a backup file you choose to export.

WHAT IT NEVER DOES
• No account and no sign-up.
• No affiliate links. Hold never adds, removes or swaps affiliate links and earns no commission, so nothing decides which deal you see.
• Never reads your cookies, card details or payment fields, and never places an order.
• Never sells or shares your data. No ads, no trackers.

YOUR CHOICE
After you install it, Hold reads only the tab where you click its button. Price alerts on every store need access to all https sites, which Hold asks for only when you press Turn on. Turn it off anytime.

GOOD TO KNOW
• Hold compares exact matches only. When it stays quiet, it found nothing cheaper at the stores it can check. That isn't the same as nothing cheaper existing.
• Prices are before tax. Confirm the total at checkout.
• US stores and US dollars for now.

Privacy policy: <privacy policy URL>
```

**Release notes (0.5.1):** First release for Firefox.

**Homepage:** `https://hold.deals` (placeholder until the domain exists). **Support email:** `hold.extensionn@gmail.com`.

**License:** your choice. Pick "All Rights Reserved" if Hold isn't open source. The uploaded source zip goes to Mozilla's reviewers, not onto the listing.

**Privacy policy:** AMO wants the policy text on the listing itself. Paste the text of `privacy.html` into the listing's Privacy Policy field, and put the hosted URL in the description where `<privacy policy URL>` is.

**Images:** the four 1280×800 screenshots in `docs/store-assets/` match AMO's recommended size. They show captures of real alerts taken in Chrome; the in-page banner and pause are the same code in Firefox. The add-on icon comes from the package (`icon-32.png`, `icon-48.png`, `icon-128.png`). The promo tile is Chrome-only.

## Data collection, as declared in the manifest

`browser_specific_settings.gecko.data_collection_permissions.required`, shown by Firefox's consent prompt at install:

| Category | What it covers for Hold |
|---|---|
| `browsingActivity` | The name of the store the shopper is on, such as `www.bestbuy.com`, sent to Hold's price service with each product check. No page addresses and no history. |
| `websiteContent` | Product details read from the page (brand, model number, barcode, color or variant, pack size, condition) sent to Hold's price service. With alerts on, the brand and model number, or the barcode, are searched on Amazon and Walmart. |

Not declared, and correctly so: personal information, health, financial and payment, personal communications, location, website activity (buy clicks are watched on the page only to pause them, and nothing about them is sent), search terms, bookmarks, technical and interaction data. `authenticationInfo` stopped applying in 0.4.1, when store builds dropped the shopper token. The saved list in 0.5.x adds no category: it stays in the add-on's storage, and a backup is a file the shopper saves.

## Founder's checklist (Firefox)

- [ ] Sign in to the Add-on Developer Hub with a Mozilla account that has two-step authentication turned on.
- [ ] Resolve the Android item above.
- [ ] Choose distribution: **On this site** for a public listing on addons.mozilla.org. **On your own** gives a signed file for beta testers without a public listing.
- [ ] Resolve the Firefox Save item / My Hold list item above.
- [ ] Upload `hold-firefox-0.5.1.zip`. When asked whether it uses a build tool or minifier, answer yes and upload `hold-source-0.5.1.zip`; the steps are in `STORE-RELEASE.md`.
- [ ] Fill the fields above, paste the privacy policy text, add the screenshots and submit. You accept Mozilla's agreement and press Submit yourself.
