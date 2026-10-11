# Coverage: how often Hold finds a cheaper exact match

Measured October 10, 2026, 7:45–9:45 PM EDT, with the Hold 0.4.2 Chrome store build (`outputs/hold-0.4.2/hold-chrome-0.4.2.zip`). Setup:
- Playwright Chromium from a scratch copy, with a fresh profile and `https://*/*` granted, so alerts were on.
- No sign-ins, no cart clicks.
- Each product was opened once on its main store. Hold's own reader, live checks and banner did the work.
- Every alert and near miss was then checked by hand in a separate browser.

## Result

- **0 correct alerts in 25 product pages.**
- **1 alert was shown, and it was wrong.** It compared a new item against an open-box offer (details below).
- Of the 25 pages:
  - **10:** Hold identified the product.
  - **9:** the page loaded but Hold couldn't read it.
  - **6:** the store blocked the test browser.
- **5 more products were not opened.** Their store had already blocked the test browser, and the rule was to stop at a block.
- **By hand, I found 2 real savings that Hold missed:**
  - AirPods 4 ANC: $11.89 less at Amazon.
  - CeraVe cleanser: $3.51 less at Amazon (free delivery there needs a $35 order).
- **Price service:** every call returned `ebay_api: not_configured`, because there are no eBay keys yet. Only live checks of Amazon and Walmart ran.

"Blocked" means the store refused the automated test browser. It says nothing about Hold's reader on that store, and a real shopper's Chrome may not be blocked. "Couldn't read" means the page loaded normally and Hold found no usable product identity or price.

## Hit rate by category

| | Products | Opened | Identified | Couldn't read | Blocked | Not opened (store blocked earlier) | Correct alerts |
|---|---|---|---|---|---|---|---|
| Electronics, appliances, tools | 16 | 15 | 6 | 4 | 5 | 1 | 0 (1 wrong alert) |
| Other (beauty, home, office, toys, clothing, garden) | 14 | 10 | 4 | 5 | 1 | 4 | 0 |
| **All** | **30** | **25** | **10** | **9** | **6** | **5** | **0** |

## Products

"Price" is the price Hold read on the page. The "Compared" column shows Hold's live-check result per store: the number of exact matches it accepted.

| # | Store | Product | Price | Identified | Compared | Alert | What actually happened |
|---|---|---|---|---|---|---|---|
| 1 | Amazon | [Logitech MX Master 3S](https://www.amazon.com/dp/B09HM94VDS) | $119.99 | Yes (UPC, 910-006557) | Walmart 0 | No | Walmart search returned 0 results for both the part number and the UPC |
| 2 | Best Buy | [Sony WH-1000XM5, black](https://www.bestbuy.com/product/sony-wh-1000xm5-wireless-noise-cancelling-over-the-ear-headphones-black/J7XSRH5CXG) | $198.00 | Yes (model) | Amazon 0, Walmart 1 | No | The Walmart "match" was a $319.99 **bundle** (2-year protection plan, case) from a marketplace seller. Not the same item; it was pricier, so no harm |
| 3 | Best Buy | [Ninja AF101 air fryer](https://www.bestbuy.com/product/ninja-air-fryer-black-gray/JXJVXGK9G5) | $79.99 | Yes (model) | Amazon 0, Walmart 0 | No | Both searches surfaced accessories. Amazon's result was silicone liners "for AF101"; Walmart's results were trays and a furnace igniter |
| 4 | Target | [JBL Flip 7, pink](https://www.target.com/p/jbl-portable-flip-7-speakers-pink/-/A-94779241) | – | Couldn't read | – | – | No product data in the page |
| 5 | Home Depot | [DeWalt DCD771C2 drill kit](https://www.homedepot.com/p/DEWALT-20V-MAX-Cordless-1-2-in-Drill-Driver-2-20V-1-3Ah-Batteries-Charger-and-Bag-DCD771C2/204279858) | – | Blocked | – | – | "Error Page" |
| 6 | Lowe's | [DeWalt XR impact driver kit](https://www.lowes.com/pd/DEWALT-DEWALT-20V-MAX-XR-174-1-4-in-3-Speed-Impact-Driver-Kit/5000207477) | – | Blocked | – | – | "Access Denied" |
| 7 | Staples | [Logitech MK270 combo](https://www.staples.com/logitech-combo-mk270-wireless-keyboard-mouse-black-920-004536/product_57256) | $29.99 | Yes (model) | Amazon 0, Walmart 1 | No | Walmart had it for $24.99 from a marketplace seller, with shipping not free and not stated. Not provably cheaper, so no alert was correct |
| 8 | Newegg | [Samsung 990 PRO 2TB](https://www.newegg.com/samsung-2tb-990-pro-nvme-2-0/p/N82E16820147861) | – | Couldn't read | – | – | No schema.org product data; price data is only in page scripts |
| 9 | Newegg | [Logitech G502 X wired](https://www.newegg.com/logitech-g502-x-w-bk-910-006136-usb-wired/p/N82E16826197554) | – | Couldn't read | – | – | Same as #8 |
| 10 | B&H | [Samsung T7 1TB](https://www.bhphotovideo.com/c/product/1559836-REG/samsung_mu_pc1t0t_am_1tb_t7_portable_ssd.html) | – | Blocked | – | – | Cloudflare challenge "Just a moment…", 403 |
| 11 | B&H | [GoPro HERO13 Black](https://www.bhphotovideo.com/c/product/1846709-REG/gopro_chdhx_131_th_hero13_black.html) | – | Not opened | – | – | Store had already blocked |
| 12 | eBay | [AirPods 4 with ANC, new, sealed](https://www.ebay.com/itm/168690833008) | $128.88 | Yes (UPC, MXP93LL/A) | Amazon 0, Walmart 1 | **Yes, wrong** | Banner: "$28.91 less at Walmart · $99.97 there". [Walmart's $99.97 offer](https://www.walmart.com/ip/Apple-AirPods-4-with-Active-Noise-Cancellation/11384707978) is **Open Box** (VIPOUTLET); its new offer on the same page is $119.97. [Amazon.com sells it new](https://www.amazon.com/dp/B0DGJ7HYG1) at $116.99 with free delivery. Hold opened that page but didn't accept it. **Missed: $11.89** |
| 13 | Macy's | [KitchenAid KSM150PS mixer](https://www.macys.com/shop/product/kitchenaid-artisan-5-qt.-stand-mixer-ksm150ps?ID=77589) | – | Blocked | – | – | Blank "Loading" page that never finished |
| 14 | Kohl's | [Keurig K-Mini Plus](https://www.kohls.com/product/prd-3457362/keurig-k-mini-plus-single-serve-k-cup-pod-coffee-maker.jsp) | – | Blocked | – | – | "Access Denied" |
| 15 | Costco | [AirPods Pro 3 with AppleCare+](https://www.costco.com/p/-/apple-airpods-pro-3-wireless-earbuds-active-noise-cancellation-hearing-aid-feature-heart-rate-sensing-includes-2-years-of-applecare/4000404510) | – | Couldn't read | – | – | Product data has price ($199.99) and Costco SKU, but no model or UPC; the model is only in page text |
| 16 | Walmart | [Ninja AF100WM 4-qt](https://www.walmart.com/ip/Ninja-4QT-Air-Fryer-Black-AF100WM/844320666) | $59.00 | Yes (UPC, model) | Amazon 0 | No | Walmart-only model |
| 17 | Amazon | [CeraVe Moisturizing Cream 19 oz](https://www.amazon.com/dp/B00TTD9BRC) | – | Couldn't read | – | – | Hold: "model code, UPC or price missing" |
| 18 | Walmart | [Lodge 10.25 in. skillet L8SK3](https://www.walmart.com/ip/Lodge-Cast-Iron-Seasoned-10-25-Skillet/5969628) | $24.90 | Yes (UPC, model) | Amazon 0 | No | Amazon's listing ([B00006JSUA](https://www.amazon.com/dp/B00006JSUA)) is also $24.90. Hold couldn't read it: two purchase-mode prices on the page. No saving missed |
| 19 | Target | [Stanley Quencher 40 oz](https://www.target.com/p/stanley-40-oz-stainless-steel-h2-0-flowstate-quencher-tumbler/-/A-88429520) | – | Couldn't read | – | – | No product data in the page |
| 20 | Costco | [Tide Pods 156 ct](https://www.costco.com/p/-/tide-pods-laundry-detergent-pods-spring-meadow-156-count/4000417929) | – | Couldn't read | – | – | Same as #15 |
| 21 | Home Depot | [Rubbermaid Roughneck 18 gal, 6-pack](https://www.homedepot.com/p/Rubbermaid-Roughneck-Tote-18-Gal-Storage-Tote-Container-in-Heritage-Blue-6-Pack-RMRT180056/328942630) | – | Not opened | – | – | Store had already blocked |
| 22 | Lowe's | [Scotts Turf Builder 12.5 lb](https://www.lowes.com/pd/Scotts-Turf-Builder-North-12-5-lb-5000-sq-ft-32-0-4-Lawn-Food/3653982) | – | Not opened | – | – | Store had already blocked |
| 23 | Staples | [Sharpie fine, black, 12-pack (30001)](https://www.staples.com/sharpie-permanent-marker-fine-tip-black-dozen-30001/product_125328) | $12.99 | Yes (model) | Amazon unavailable, Walmart 0 | No | Amazon's one result was a 24-count, a different item. Walmart's "30001" search returned a hitch mount, a tire and a sink part |
| 24 | Ulta | [Olaplex No.3PLUS 3.3 oz](https://www.ulta.com/p/no3plus-complete-bond-repair-pre-shampoo-hair-treatment-pimprod2057274?sku=2651909) | $34.00 | Yes (UPC) | Amazon 1, Walmart 0 | No | Amazon matched by UPC at the same $34.00 |
| 25 | Ulta | [CeraVe Hydrating Cleanser 16 oz](https://www.ulta.com/p/hydrating-facial-cleanser-xlsImpprod4190255?sku=2541603) | $18.99 | Yes (UPC) | Amazon 0, Walmart 0 | No | [Amazon.com has it](https://www.amazon.com/dp/B01MSSDEPK), same 16 oz, for $15.48 (free delivery on $35+ orders). Ulta gives only a UPC and Amazon only a model code, so Hold can't match them. **Missed: $3.51** |
| 26 | Macy's | [Levi's 501 Original Fit](https://www.macys.com/shop/product/levis-mens-501-original-fit-jeans?ID=12123182) | – | Not opened | – | – | Store had already blocked |
| 27 | Kohl's | [Nike Revolution 7, men's](https://www.kohls.com/product/prd-6257323/nike-revolution-7-mens-road-running-shoes.jsp) | – | Not opened | – | – | Store had already blocked |
| 28 | Wayfair | [Lodge enameled Dutch oven](https://www.wayfair.com/kitchen-tabletop/pdp/lodge-enameled-cast-iron-dutch-oven-w004539250.html) | – | Couldn't read | – | – | Page loaded; Hold found no product data |
| 29 | Wayfair | [simplehuman 45 L step can](https://www.wayfair.com/storage-organization/pdp/simplehuman-45-liter-12-gal-rectangular-hands-free-kitchen-step-trash-can-shn10097.html) | – | Blocked | – | – | 429, "Access to this page has been denied" |
| 30 | eBay | [LEGO 75375 Millennium Falcon, new](https://www.ebay.com/itm/157840375691) | – | Couldn't read | – | – | Listing at $94.99 or Best Offer. Hold: "model code, UPC or price missing" |

Four URLs I picked first were dead and were replaced; they are not counted:
- Target JBL Flip 6: 404.
- Costco Dyson V15: "Product Not Available".
- eBay AirPods: already sold.
- Ulta Olaplex No.3: 404.

## Store scorecard

The first column is Hold's reader on 2 real product pages in the test browser. The other columns are cookie-free requests from Hold's worker. These were made from a scratch copy whose `connect-src` was widened, because the shipped build can only reach Amazon, Walmart and Hold's API. Requests were spaced at least 8 s apart per store, and each store stopped at its first refusal.

| Store | Hold reads product page | Search page, cookie-free | Product page, cookie-free | Live-check candidate? |
|---|---|---|---|---|
| Amazon | 1 of 2 | 200, prices in HTML | 200, but pages with two purchase-mode prices are rejected | Live today |
| Walmart | 2 of 2 (not blocked this time) | 200, data in `__NEXT_DATA__` | 200 | Live today |
| Best Buy | 2 of 2 | 200; model numbers and prices in the page data | Request failed with no response (as on Oct 8) | Search-only check possible |
| Target | 0 of 2: no product data | 200, empty shell; results need scripts | 200, no price, UPC or model in HTML | No |
| Costco | 0 of 2: no model or UPC in data | 200, no results in HTML; needs scripts | 200, same gap as the reader | No |
| Home Depot | Blocked: "Error Page" | 403 (Akamai) | Not tried (stopped) | No |
| Lowe's | Blocked: "Access Denied" | 429 | Not tried | No |
| Staples | 2 of 2 | 200; prices in JSON and an ItemList | 200; Hold reads it (2 of 2) | **Yes** |
| Newegg | 0 of 2: no schema.org data | 200, prices in HTML | 200; price data only in page scripts | With a Newegg reader |
| B&H | Blocked: Cloudflare challenge | 403, Cloudflare challenge | Not tried | No |
| eBay | 1 of 2 live listings; not blocked | 403, eBay error page | Not tried | Via the eBay API only |
| Macy's | Blocked: blank "Loading" page | 403 "Access Denied" | Not tried | No |
| Kohl's | Blocked: "Access Denied" | 403 "Access Denied" (Akamai) | Not tried | No |
| Wayfair | 0 of 1 read, then blocked (429) | 429, "Access to this page has been denied" | Not tried | No |
| Ulta | 2 of 2 | 200, results need scripts | 200; Hold reads it (2 of 2) | Product pages only; no search |

## What failed

1. **Wrong alert: Walmart open-box offers read as new.**
   - On the AirPods page, Walmart's record says `conditionType: "New"`, but `isConditionNew` is `false`, the name starts "(Open Box)", and the page shows "Condition: Open Box".
   - Hold's Walmart reader trusts `conditionType`. On eBay it would also have held the shopper's Buy It Now click for this offer.
2. **Bundles pass as the same item.** A Walmart bundle that includes a protection plan and a case shares the headphones' UPC and model.
3. **UPC-only and model-only pages never match.** Ulta publishes UPCs and Amazon pages often show only a model code. That caused the CeraVe miss.
4. **Amazon pages with two purchase-mode prices are rejected.** This hit the AirPods page (new $116.99 plus a $74.87 option) and the Lodge page.
   - During the run no offer-list request was logged for the AirPods page, so the exact in-run reason is not certain.
   - A later re-parse of the same page gives "no single buy-box price".
5. **Walmart search uses the model code.**
   - Numeric models ("30001", "AF101") return unrelated items.
   - "910006557" and that item's UPC returned nothing.
6. **Unknown shipping stops most small-ticket alerts**, by design: Staples, Ulta and Amazon orders under $35.
7. **The shipped build's `connect-src` allows only Amazon, Walmart and Hold's API.** Any new store needs a manifest change.
   - When testing such a change, use a fresh Chrome profile: an existing profile kept the old policy.

## Stores to add next

**Fix first:** #1 (open box), #2 (bundles) and #4 (two-price Amazon pages). A wrong alert costs more trust than a missing one.

1. **Staples.** Search and product pages both answer cookie-free, and Hold's current reader already reads its product pages. It needs a search parser and a `connect-src` entry. Gaps: no UPC and no shipping cost in its data.
2. **Best Buy.** It is the largest electronics and appliance store here. Search answers with model numbers and prices, but product pages refuse. A check based only on Best Buy's search page needs a founder decision, since there would be no product page to confirm against.
3. **eBay.** Cookie-free requests are refused. The Browse API connector is built and needs the founder's keys; it is unverified live.
4. **Newegg.** It answers cookie-free, but needs its own reader for search and product pages (no schema.org data). Electronics only.
5. **Ulta.** Product pages are readable, but search needs scripts, and it falls outside electronics, appliances and tools.

**Not now:** Target and Costco (need scripts or lack identifiers), and Home Depot, Lowe's, B&H, Macy's, Kohl's and Wayfair (they refuse cookie-free requests).
