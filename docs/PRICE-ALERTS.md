# Price alerts: "cheaper elsewhere" on any store

Built October 8, 2026 (evening) on branch `codex/price-compare`, from the founder's request: the extension should save money on whichever store the shopper is on, and stop them before buying when the same item is cheaper elsewhere.

## What the shopper gets

- **Banner:** on any store's product page, when the exact same item (new) is at least $1 cheaper elsewhere, delivered and before tax. Example: "$1.69 less at eBay · $38.27 there vs $39.96 here · New · Free shipping · You saw it 5 min ago". It links straight to the cheaper store, with no affiliate or tracking parameters.
- **Pause:** the first Add to Cart or Buy Now click on such a page is held, and a dialog shows the cheaper offer. "Buy here anyway" closes it, and the shopper clicks again. The extension never clicks, submits or navigates for them. It only holds purchase controls observed live: Amazon (Add to Cart, Buy Now), Best Buy (product-page Add to Cart) and eBay (Buy It Now, Add to cart). Every other store gets the banner only.
- **Popup:** a price card on any recognized product page, with an on/off switch for "Price alerts on every store".

## How it decides

1. **Read the product on the device** ([product-reader.ts](../apps/extension/src/product-reader.ts)). There are three readers, each checked against the live store on October 8:

   | Reader | Where it applies | What it reads |
   |---|---|---|
   | Amazon | Amazon product pages | Buy-box price, cross-checked against Amazon's own buy-box amount; model number from the product details |
   | Walmart | Walmart product pages | The page's product record, which must match the item ID in the URL and the visible price |
   | schema.org Product data | eBay, Best Buy and most other stores | The product data embedded in the page |

   A price is accepted only if the same amount is visible on the page.
2. **Match exactly** ([prices.ts](../packages/shared/src/prices.ts)):
   - If both sides have a UPC/EAN, the UPC must be the same.
   - Otherwise the model code must be identical (e.g. MG5965/49) and the brands compatible.
   - Condition must be new on both sides. Pack size and colour must not conflict.
   - Marketing names such as "All In One 5000" are never treated as model codes.
3. **Find offers from three sources:**
   - **Live checks** ([store-lookups.ts](../apps/extension/src/store-lookups.ts)): the worker fetches Amazon and Walmart search pages from the shopper's browser, with no cookies sent, and opens the top results. It parses each page in an offscreen document using the same reader, and keeps only exact matches. Results are cached for 30 minutes, capped at 60 requests per store per hour, and a store that blocks is rested for 30 minutes.
   - **Prices this shopper saw:** product pages they viewed in the last 12 hours, stored only in this browser.
   - **The price service:** it receives only the product identity and the current store's host.
4. **Fail closed.** None of these can produce an alert:
   - unknown shipping
   - stale or expired evidence
   - out of stock
   - membership or coupon prices
   - the same store
   - savings under $1

   A source that is down is shown as unavailable, never as "nothing cheaper".

## Cheaper seller on the same Amazon page (0.3.1)

On an Amazon product page, the content script loads Amazon's "Other sellers" panel the way the page does, as the signed-in shopper, so delivery terms follow their Prime status. The code is in [amazon-sellers.ts](../apps/extension/src/amazon-sellers.ts).

It alerts and holds Add to Cart only for an offer that meets all of these:
- new condition;
- known delivery cost;
- sold by Amazon, or by a seller with at least 4.5★ and 100 ratings;
- at least $1 under the buy box;
- the buy box matches the price the page shows.

The link opens Amazon's seller list (`/dp/ASIN?aod=1`). This check needs no model code.

- **Live, October 8:** Victorinox Fibrox 8" (B008M5U1C2) is $53.00 from Amazon.com. The extension showed "$4.37 less from another seller on Amazon" for Ace Pursuit (4.5★, 1,083 ratings, $48.63, free delivery) and held Add to Cart.
- **How often it helps:** a scan of about 50 products found this kind of saving on 1. It helps sometimes, not usually.
- **Reader fixes found live the same night:**
  - Amazon pages with several purchase modes (new, used, list) are read from the shown price.
  - The newer "Product information" table (`#prodDetails`) supplies the model number and UPC.

## Which stores can be checked live (tested October 8)

| Store | Background check |
|---|---|
| Amazon | ✅ Search and product pages answer |
| Walmart | ✅ Search and product pages answer. Opening Walmart pages in an automated browser is blocked; plain page fetches are not |
| eBay | ❌ Refuses with 403. Use the eBay API (keys) instead |
| Best Buy | ❌ Search answers but product pages refuse. Needs the Best Buy API |
| Target, Costco | ❌ Results render only with scripts |

The extension never tries to get around a block: the store is reported as unavailable.

## Price service

`POST /v1/prices/offers` with `{identity, excludeDomain}` returns `{offers, coverage}`. Results are cached for 10 minutes, a lookup times out after 2 seconds, and requests are rate-limited per client address.

- **eBay Browse API** (`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` in `services/price-service/.env`). It searches by UPC first, then by brand and model. It keeps only listings that are new, fixed-price, located in the US and from sellers with at least 97% feedback and 50 ratings. Accessory, lot and multi-pack titles are dropped, and listings with calculated shipping are kept as "shipping unknown". **Not yet run against the live API: no keys yet.**
- **Reviewed feed** (`REVIEWED_OFFERS_FILE`): operator-reviewed offers, each with evidence and an expiry.

Run it locally:

```
cd services/price-service && bun src/index.ts
```

It listens on port 3002, which is what the dev extension calls. Beta builds call it only when `PRICE_API_ORIGIN` is set; otherwise beta uses the prices the shopper has seen.

## Permissions and privacy

Alerts on every store use the optional `https://*/*` host permission. The popup requests it on "Turn on", and it can be revoked in Chrome. The price script runs on https pages but sends nothing unless the page is a recognized product page. It stores what it reads only in `chrome.storage.local`, which content scripts cannot read. The privacy policy (a founder blocker) must describe this before any external beta.

## Evidence (October 8)

- **Unit tests:** shared 48 (8 new price tests), extension 39, price service 7 (all new). Typecheck passes in all 5 workspaces.
- **Fixture end-to-end:** `bun run test:e2e:prices` passes 9 checks covering the banner, pause, second click, popup, Walmart UPC match and an ignored article page.
- **Live check, end to end:** the real Best Buy All-in-One 9000 (MG9575/49, $96.99), opened with an empty memory, showed "$7.99 less at Walmart · $89.00 there vs $96.99 here · New · Free shipping · Checked live" ([screenshot](price-evidence/bestbuy-live-check.png)). From the real Amazon trimmer page, the live check found Walmart's exact MG5965/49 ($49.96, free shipping) and raised no alert, because Amazon was cheaper.
- **Fixture end-to-end (now 11 checks):** adds an unknown store at $47.00 that gets "$7.04 less at Amazon" from a live check, and confirms that search ads for other products are never opened.
- **Live, earlier:** `bun run test:live:prices` runs the real eBay listing 318944076250 ($38.27), then the real Amazon B0GYK61CBH ($39.96). It showed "$1.69 less at eBay" and held the real Add to Cart click (5 checks). Screenshots are in [price-evidence/](price-evidence/).
- **Reader on live pages:** run directly on eBay, Amazon and Best Buy (X5004/84), and all were correct. Walmart's bot protection redirects automated browsers to `/blocked`, so its structure was verified in a regular browser session but not end to end.
- **Regressions:** Amazon reader 27, Amazon checkout 15 and 9, Amazon MV3 19, Shopify reader 17, Shopify adapter 9 and Shopify MV3 10 all pass. Two popup-focus flakes passed on re-run.
- **Not run:** the demo smoke test (it needs the local coupon API and demo server), the eBay API live (no keys), and the real Chrome user-gesture permission prompt.

## Open decisions

- **eBay keys:** the founder creates the developer keyset.
- **Best Buy API key:** optional.
- **Privacy policy:** must cover price reading.
- **Pause scope:** whether the pause should cover more stores' buttons. Each needs a live observation first.
- **Coverage gaps:** eBay and Best Buy need their APIs. Target and Costco are covered only by prices the shopper has seen.
- **Store terms:** stores' terms of use generally discourage automated access. The live checks are low-volume and made from the shopper's own browser, but this is a founder risk decision before a public launch.
