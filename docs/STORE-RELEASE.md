# Store release: Chrome Web Store and Firefox Add-ons

Prepared on October 10, 2026. Current package: Hold 0.5.1 (October 11), built by `release.ts --ref` from the merged commit; the 0.4.x notes below are history. Nothing has been submitted. The listing text, screenshots and privacy policy live in [CHROME-WEB-STORE.md](CHROME-WEB-STORE.md), `docs/store-assets/` and `outputs/hold-site/privacy.html` (store-pack session).

## Build

```bash
bun run --cwd apps/extension release.ts
```

The script builds from a clean export of a commit (`--ref`, default HEAD), so uncommitted work never ships. It then runs these steps:

1. Install with the frozen lockfile.
2. Typecheck.
3. Run the unit tests for the extension and `packages/shared`.
4. Build the Chrome and Firefox packages against the hosted APIs.
5. Run Mozilla's linter (`web-ext lint`); the release fails on any error.
6. Zip the source for Mozilla's reviewers.
7. Unzip that source zip, rebuild Firefox from it, and fail unless the result is byte-identical to the package.

Output goes to `apps/extension/release/<version>/`: `hold-chrome-<v>.zip`, `hold-firefox-<v>.zip`, `hold-source-<v>.zip`, `SHA256SUMS` and `RELEASE.txt`.

Both packages so far were built with `--from`, from HEAD 170cc32 plus uncommitted changes. Rebuild from the commit once those changes land.

- **0.4.2** (`outputs/hold-0.4.2/`, the one to upload): 0.4.1 plus price-match tips ([PRICE-MATCH.md](PRICE-MATCH.md)). No checkout-tips work.
  - On Best Buy, the alert adds that Best Buy will match the cheaper price when Amazon or Walmart sells the item itself. Home Depot, Lowe's and Staples are switched off.
  - It changes `manifest.json`, `popup.css`, `popup.html`, `popup.js` and `price-content.js`. No new permissions, no new data leaves the browser.
  - The store-pack session checked it live on Best Buy MG9575/49.
  - Installed in the founder's Chrome on October 10 (byte-identical to the zip).
- **0.4.1** (`outputs/hold-0.4.1/`): the same as 0.4.0 except `popup.js` and the version.
  - Beta builds hide the community code and shopper-token sections, which only dev builds show. A reviewer can't get a token, and the founder's other extension was once rejected for a feature the reviewer couldn't use.
  - The token is therefore never set, nothing authentication-related is sent, and the listing declares no authentication information.
  - SHA-256 sums are in that folder.
  - Installed in the founder's Chrome on October 10 (`coupon-platform/apps/extension/dist`), then replaced by 0.4.2.
- **0.4.0** (`outputs/hold-0.4.0/`): the first store build, the one tested live in Firefox above. 0.4.1 changes only the popup, which the store-pack session checked in the real Chrome popup.

## What differs between the packages

| | Chrome | Firefox |
|---|---|---|
| Background | `service_worker` | `scripts` (an event page) |
| Parsing fetched store pages | Offscreen document (`offscreen` permission) | The background page's own DOMParser; no `offscreen` |
| Storage access level | `setAccessLevel(TRUSTED_CONTEXTS)` | Not available in Firefox; skipped (`worker.ts`) |
| Minimum version | Chrome 140 (`storage.local.setAccessLevel`) | Firefox 140 desktop, 142 Android (built-in data consent) |
| ID | Assigned by the store | `hold@hold.deals`, permanent once submitted |
| Data declaration | Dashboard form | `data_collection_permissions.required: browsingActivity, websiteContent` |

Both packages request `storage`, `activeTab` and `scripting`, plus the optional `https://*/*` that the user grants from the popup ("Turn on price alerts"). The build fails if the manifest description is longer than 132 characters. Every bundle starts by setting zod to jitless, so no code is compiled with `new Function` at runtime.

## Tested on October 10

**Unit tests:**
- 43 extension tests, including the build tests that check both manifests.
- 49 shared tests.

**Chrome, with fixture store pages:**
- Price-alerts e2e: 13 checks pass. They cover reading other stores' pages in the offscreen document, the banner, the held click and the popup.
- The one failure is Codex's "cached offer before slow sources", a feature still in progress on `codex/price-speed`.
- Amazon MV3: 19/19. Shopify MV3: 10/10.
- Live Chrome could not be run: Best Buy refuses automated Chrome at the network level (`ERR_HTTP2_PROTOCOL_ERROR`) before the extension runs.

**Firefox 157, live, temporary install in a throwaway profile:**
- The add-on installed.
- The all-sites permission was granted the way the add-on's Permissions tab in about:addons grants it. Automation cannot click inside extension pages. The worker then registered the price script.
- Best Buy MG9575/49 at $99.99 showed "$3.00 less at Amazon" ($96.99, checked live).
- The Amazon and Walmart checks ran in the background page.
- The toolbar popup showed the same offer with "Compared with Amazon (live), Walmart (live)".
- The first Add to cart click was held ("Hold on before you buy").
- Amazon MG5965/49 at $39.96 correctly stayed quiet, because Walmart was $49.96.
- The released Firefox zip is byte-identical to the build tested.

**Not covered by automation:** Firefox's own permission prompt after clicking "Turn on" in the popup. Check it once by hand: about:debugging → This Firefox → Load Temporary Add-on → pick `manifest.json` from the unzipped Firefox package.

**Merge:** Codex's uncommitted `codex/price-speed` changes apply cleanly on top of these changes (dry run, October 10).

## Chrome Web Store

1. Founder: register at the Chrome Web Store Developer Dashboard (one-time $5, 2-step verification on the Google account), and answer the trader/non-trader question.
2. Add a new item and upload `hold-chrome-<v>.zip`.
3. Fill in the store listing, privacy practices (single purpose, permission justifications, data use) and screenshots from [CHROME-WEB-STORE.md](CHROME-WEB-STORE.md).
4. Privacy policy URL: the hosted `privacy.html`, which needs the site to be online first.
5. Visibility: **Unlisted** for the beta (installable by link, updates automatically). Switch to Public later.

## Firefox Add-ons (addons.mozilla.org)

1. Founder: sign in at addons.mozilla.org/developers with a Mozilla account (free) and accept the distribution agreement.
2. Submit a new add-on. Choose where it lives:
   - **On this site:** a public listing reviewed by Mozilla, with automatic updates. This gives the most trust.
   - **On your own:** Mozilla signs the file (usually automated and quick) and you share the `.xpi` with testers yourself.

   Both are possible; a version goes to one channel.
3. Upload `hold-firefox-<v>.zip`. Platforms: Firefox for desktop. Leave Android unchecked until it has been tried on a phone.
4. "Does your add-on use minified, concatenated or machine-generated code?" Yes. Upload `hold-source-<v>.zip`; `SOURCE-BUILD.md` inside it gives the exact build.
5. Data collection comes from the manifest, and Firefox shows it in its install prompt.
6. Add the privacy policy URL and listing text (store-pack session), then paste the reviewer notes below.

### Notes for Mozilla's reviewer (paste as-is)

> Hold warns a shopper when the exact product on the page they are viewing is cheaper at another store.
>
> **When it runs:** nothing runs on web pages until the user turns on price alerts in the toolbar popup. That requests the optional `https://*/*` permission, and Hold registers its content script only after it is granted. Before that, the popup reads the current page only when clicked (activeTab).
>
> **Network:**
> 1. Our price service (`…-priceapi.compute.c-13.us-east-1.aws.neon.tech`) receives the product identity read from the page (brand, model code, UPC/GTIN, condition) and the current store's domain.
> 2. Our coupon service (`…-couponapi…`) is asked for its list of supported stores. On a supported checkout it is asked for candidate codes for that store.
> 3. Amazon's and Walmart's public search and product pages are fetched without cookies (`credentials: 'omit'`) and parsed inert with DOMParser in the background page. Only prices and identifiers are kept. Requests are capped at 60 per store per hour, and a store that blocks is left alone.
>
> **What it never does:**
> - read cookies;
> - add or change affiliate links;
> - submit forms or orders.
>
> The "hold" delays the first buy click once while it shows the cheaper offer. The user's next click proceeds normally.
>
> **Saved list:** the popup's "Save item" stores the product read from the current tab in extension storage, and "My Hold list" opens the packaged page `dashboard/index.html` to view it, set target prices, and export or import a JSON backup through a normal file download or file picker. The list is never sent anywhere; that page makes no network requests. Only the extension's own popup and list page can read or change the list (checked against the message sender's URL in `watchlist-worker.ts`).
>
> **Lint:** the 6 DANGEROUS_EVAL warnings come from zod 4, the validation library, whose code can compile parsers with `new Function`. Every bundle begins with `globalThis.__zod_globalConfig={jitless:true};` (see `build.ts`), so that path never runs, and the extension CSP would block it anyway. The 4 UNSAFE_VAR_ASSIGNMENT warnings are the list page's `innerHTML` templates in `apps/dashboard/src/main.ts`; text from the shopper or a page (titles, links, store names) goes through `esc()` first, links are validated direct https URLs, and the other values are schema-validated numbers, dates and IDs.
>
> **Build:** see `SOURCE-BUILD.md` in the source zip. The output is byte-identical to the submitted package.
>
> **To try it:**
> 1. Turn on price alerts in the popup.
> 2. Open https://www.bestbuy.com/product/philips-norelco-all-in-one-9000-series-23-piece-trimmer-mg9575-49-silver/J79GGJ9LL9
> 3. A banner appears if Amazon or Walmart sells the same model for at least $1 less. Prices change, so on some days there is no banner.
> 4. On the same page, open the popup and press "Save item". Then press "My Hold list ↗": the item is listed with its price and "Seen on store page". Its ••• menu sets a target price; "Settings & data" has Export backup and Import backup.

## Before submitting

- [ ] Commit the store-release changes, then rerun `release.ts` from the commit.
- [ ] Put the site, including `privacy.html`, online and use its URL in both stores.
- [ ] Load each zip once in its real browser and click "Turn on price alerts".
