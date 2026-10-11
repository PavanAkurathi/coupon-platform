# Price-match tips and price-drop refunds

Research October 10, 2026.

**Status, October 10 evening: (a) is built** in the worktree, uncommitted and not in any store build yet. Code: `apps/extension/src/price-match.ts` (policy table and `matchTip`), tested in `price-match.test.ts`. The tip appears in the banner, the pause dialog and the popup price card. **Best Buy is on.** A live tip was seen on the real Best Buy page: MG9575/49 at $99.99 sold by Best Buy, Amazon $96.99 sold by Amazon.com, with free shipping, checked live. Home Depot, Lowe's and Staples stay off until a tip is seen on each. That run confirmed the live seller value "Amazon.com". Walmart's "Walmart.com" is still unconfirmed live (Walmart had no listing for that item); a different value simply shows no tip. The matching code lives in the extension, not in `packages/shared`, because only the extension uses it. (b) is not built.

The question: should Hold add
- **(a) match tips:** "this store says it matches the lower price", and
- **(b) price-drop alerts:** "the price dropped after you bought, ask for the difference"?

## Answer

- **(a) Yes, small.** Four stores match Amazon and Walmart when the item is sold by Amazon or Walmart itself: Best Buy, Home Depot, Lowe's and Staples. Amazon and Walmart are the two stores Hold already checks live, so the tip reuses evidence Hold already has. Hold needs one new check: the seller must be the store itself, not a marketplace seller.
  - It finds no new savings. It lets the shopper keep a saving Hold already found while still buying at the store they prefer, for example for same-day pickup or easier returns.
- **(b) Yes, as a small second step.** This is money Hold can't get today: a refund after the purchase. Five stores refund a drop in their own price for 14 to 30 days: Target, Best Buy, Costco, Home Depot and Staples. Two limits:
  - Hold doesn't know what the shopper bought.
  - Hold can't check these stores in the background (see [PRICE-ALERTS.md](PRICE-ALERTS.md)).

  So the smallest version is: the shopper taps "I bought this", and Hold checks the price again when they reopen the page.
- **Neither gets shopper-facing UI** until a real case is seen live: one match tip on Best Buy and one real price drop.
- **Amazon and Walmart.com offer neither.** Hold should say nothing about matching on those sites.

## Store policies (US, official pages, read October 10, 2026)

"Own price" means the store refunds a drop in its own price. "Marketplace" means third-party sellers on a store's site.

| Store | Matches other stores? | Amazon / Walmart | Main exclusions | How to ask | After purchase |
|---|---|---|---|---|---|
| **Best Buy** | Yes, 19 "Qualified Competitors", **at time of sale only** | Both on the list, but not marketplace sellers | Membership and loyalty prices; daily or hourly sales; limited quantities; Thursday before Thanksgiving to the Monday after; open-box and refurbished; delivery charges | Chat, 1-888-237-8289, or in store. "Direct us to the ad or website" | Own price during the return period: 15 days for most items, 60 for paid members |
| **Home Depot** | Yes, local stores and named online stores | Amazon and Walmart only if "sold and fulfilled by the retailer" | Auction, marketplace and membership sites (eBay, Wayfair, Costco, Sam's Club). Item must be in stock and ship to you | In store at checkout or the service desk. Online: Live Chat or 1-800-430-3376 with both item numbers | **30 days**, own price **or a matched store's** lower price. Needs order number plus a screenshot or link |
| **Lowe's** | Yes, local stores and online stores (no list) | "We price-match items sold by Amazon.com but not by a third-party seller on Amazon.com." Walmart is not named | Membership wholesalers; loyalty and military prices; one-time promotions such as Black Friday; clearance and open-box. **Shipping counts** | In store: show the ad or site. Online: chat or 1-877-465-6937 | The returns page says to chat or call. **No window stated** |
| **Staples** | Yes, in store and on Staples.com (separate lists) | Amazon.com and Walmart on both lists, but not marketplace sellers | Holiday sales including Black Friday and Cyber Monday; clearance; one match per item per day; pre-tax | In store: service desk; screenshots accepted if complete. Staples.com: 1-800-333-3330; **no screenshots** | **14 days**, own price only |
| **Target** | **No.** Only Target.com, Target stores and Target Circle deals | No | Clearance; Target Plus items match only the same partner; coupons can't be combined | Store checkout or Guest Services. Online: chat or 1-800-591-3869. **No screenshots** | **14 days**, own price |
| **Costco** | **No.** "Costco does not price match with other businesses or retailers." | No | Precious metals; Costco.com isn't matched to warehouse prices; promotions must still be running | Costco.com: "Request a Price Match" form. Warehouse: Returns counter | **30 days**, own price |
| **Walmart** | **No.** Stores match only Walmart.com, at checkout | No | Rollback and other limited-time deals; marketplace sellers | Tell the cashier at checkout (stores only) | **None.** Walmart.com says no matching of any kind, including later price drops |
| **Amazon** | **No.** "We don't offer price matching compensation." | n/a | Only exception: pre-orders sold by Amazon.com that show the Pre-order Price Guarantee | Nothing to ask. The pre-order refund is automatic | None, except that pre-order guarantee |

Sources, all read October 10, 2026. Some were read in the in-app browser because the stores refused plain fetches.

- Best Buy:
  - [Price Match Guarantee](https://www.bestbuy.com/site/help-topics/price-match-guarantee/pcmcat290300050002.c?id=pcmcat290300050002) (effective Sept 2, 2026)
  - [Qualified Competitors](https://www.bestbuy.com/site/price-match-guarantee/qualified-competitors/pcmcat1693426756861.c?id=pcmcat1693426756861) (effective May 11, 2025)
  - [Return policy](https://www.bestbuy.com/site/help-topics/return-exchange-policy/pcmcat260800050014.c?id=pcmcat260800050014) (effective Feb 23, 2026)
- Home Depot: [Price Match Guarantee & Price Inquiries](https://www.homedepot.com/c/price-match-and-price-check) (no date shown). The old `/c/PM_Terms` URL now shows an error page.
- Lowe's (no dates shown):
  - [Lowest Price Guarantee](https://www.lowes.com/l/about/lowest-price-guarantee). The old `/l/about/price-promise` URL returns "Access Denied".
  - [Returns FAQ](https://www.lowes.com/l/help/returns-policy)
- Staples: [Price Match Guarantee Policies](https://www.staples.com/sbd/cre/marketing/pmg/index.html), which redirects to the Staples Help Center (no date shown).
- Target: [Price Match Guarantee](https://www.target.com/help/articles/policies-guidelines/price-match-guarantee) (no date shown).
- Costco: [Price Match – Costco.com Orders](https://customerservice.costco.com/app/answers/detail/a_id/628/~/price-adjustment---costco.com-orders) (version 27.0, published May 15, 2026).
- Walmart:
  - [Price Match Policy](https://corporate.walmart.com/policies) (updated June 8, 2023)
  - [Walmart.com help article](https://www.walmart.com/help/article/walmart-price-match-policy/6295d9e1a501489b9aa40a60c899b288) (updated June 7, 2023)
- Amazon:
  - [Pricing and Price Matching](https://www.amazon.com/gp/help/customer/display.html?nodeId=G9EAYKPV5YYDB8P7)
  - [Pre-order Price Guarantee](https://www.amazon.com/gp/help/customer/display.html?nodeId=G4BRP7LCB9DSDNCR)

## What Hold knows at alert time, against what the stores ask

Each offer is a `PriceOffer` (`packages/shared/src/prices.ts`), built in `price-worker.ts`.

| Store asks for | Hold has it? |
|---|---|
| Identical item (brand, model, size, colour) | ✅ Same UPC, or the same model code with compatible brands. ⚠️ The Amazon reader doesn't read colour; the model code is assumed to fix it |
| New condition | ✅ Required for every alert |
| In stock at the other store | ✅ `availability: in_stock` |
| **Sold by the store itself, not a marketplace seller** | ⚠️ **Read but not used.** `seller` comes from Amazon's "Sold by" line, Walmart's `sellerName` or schema.org data. Alerts ignore it today. The exact live values (for example "Amazon.com") haven't been confirmed |
| Price | ✅ Item price and shipping kept separately. Most stores match the pre-tax item price; Lowe's adds shipping |
| A current price | ✅ At most 15 minutes old. The store checks the live page itself anyway |
| Proof | ✅ A clean, direct link to the other store's page, which is what stores ask for. Target, Walmart and Staples.com refuse screenshots |
| Ships to the shopper's address | ❌ Live checks send no cookies, so they use the store's default location. Home Depot and Lowe's require it |
| Not a daily, limited-time or holiday deal | ❌ Hold can't tell. Best Buy, Lowe's, Staples and Walmart exclude these |
| Not a member-only price | ⚠️ The schema.org reader rejects member-only offers. The Amazon and Walmart readers don't flag them |
| **What the shopper bought, when, and for how much** | ❌ **Never recorded.** Hold sees Amazon's Place Order button, but Amazon gives no refunds |
| The same store's price later | ⚠️ Only when the shopper opens the page again. Best Buy refuses background fetches; Target and Costco pages need scripts. Home Depot, Lowe's and Staples haven't been tested |

### Fit by store

| Store | (a) match tip | (b) price-drop alert |
|---|---|---|
| Best Buy | ✅ **Good fit.** The reader works on the live site. Tip only when Walmart.com or Amazon.com is the seller | ✅ Own price, 15 days. Checked only when the shopper reopens the page |
| Home Depot | ✅ Good fit once Hold's reader is checked on homedepot.com | ✅ **Best fit.** 30 days, and a lower Amazon or Walmart price also counts, which Hold can check in the background |
| Lowe's | ✅ For Amazon.com as seller. Walmart is not named. Reader not checked: lowes.com refused a plain fetch | ⚠️ No window stated. Leave out |
| Staples | ✅ Once the reader is checked | ✅ Own price, 14 days. Reader not checked |
| Target | ❌ Own prices only | ✅ Own price, 14 days. Reader not checked |
| Costco | ❌ | ⚠️ Own price, 30 days, but pages need membership and scripts. Leave out until a live read works |
| Walmart, Amazon | ❌ | ❌ |

## Smallest design

### (a) Match tip

- **Stored:** no new shopper data. The extension carries a small policy table. Each entry has:
  - the store's host;
  - the stores it matches, each with the exact seller name required;
  - how to ask;
  - the policy URL;
  - the date the policy was checked.

  Entries start **off**, and each turns on after one live tip has been seen on that store.
- **When it shows:** the existing alert has found a cheaper offer, and all of these hold:
  - the current store is in the table;
  - the cheaper store is on its list, and the seller is exactly that store;
  - new, in stock and free shipping, so the delivered price equals the item price;
  - the date is outside the store's holiday blackout.
- **Shown:** one extra line in the existing banner, popup card and pause dialog. For example: "Best Buy says it matches Walmart for items sold by Walmart. Ask in Best Buy chat before you buy and share the Walmart link. Daily deals are often excluded. Best Buy decides." The line ends with "Policy checked Oct 10, 2026" and a link to the store's policy page.
- **Code:** one pure function, `matchTip(product, bestOffer, now)`, with tests, plus one line of UI. The policy table and `matchTip` are shared contracts, so Codex adds them; Claude adds the UI.

### (b) Price-drop alert

- **Stored:** in `chrome.storage.local` only, at most 50 entries, each deleted when its window ends. Each entry holds:
  - store, product link, title and identity;
  - price paid: filled in from the price Hold read, and editable, because coupons and member prices change what was paid;
  - date bought (editable) and the last day to ask;
  - the last price Hold checked, and when.
- **How a purchase is recorded:** an "I bought this" button on the popup price card, only on stores with a refund window and a reader checked on the live site. Hold doesn't read order pages, emails or account history.
- **Shown:**
  - A "Bought" list in the popup, for example: "Best Buy · Canon MG9575 · paid $96.99 · ask by Oct 25 · [Check price]".
  - "Check price" opens the product page in a new tab, on the shopper's click. If the same store's price is at least $1 lower, the banner says: "$7.99 lower than you paid on Oct 10. Best Buy's policy refunds its own lower price during the return period. Ask in chat with your order number. Best Buy decides."
  - The extension icon gets a badge when a drop has been found. This needs no new permission.
  - Reminder notifications would need the `alarms` and `notifications` permissions, and a new store review. Not in the smallest version.

### What Hold must never do (both features)

- Contact a store, open its chat, call, fill a claim form or submit anything.
- Say a match or refund is guaranteed. Use "says it matches" and "ask", and say the store decides.
- Make or send screenshots as proof.
- Show a tip for a marketplace seller, an unknown seller, used or open-box items, unknown shipping or a store that isn't on the list.
- Send purchase records off the device, or read order, account or email pages.
- Count a tip as money saved unless the shopper says they got it.
- Get around a store that refuses background checks.

## What it could be worth (real examples from PRICE-ALERTS.md)

| Real alert (October 8) | Match tip? | Extra money compared with today's alert |
|---|---|---|
| Best Buy Canon MG9575/49, $96.99 here, Walmart $89.00, free shipping, checked live | ✅ **If Walmart.com was the seller.** That evidence didn't record the seller. Best Buy matches at time of sale | $0 extra. The same **$7.99 (8%)**, kept at Best Buy |
| Amazon B0GYK61CBH, $39.96 here, eBay $38.27 | ❌ Amazon doesn't match, and Home Depot names eBay as excluded | $0 |
| Amazon Victorinox, $53.00 from Amazon, another seller $48.63 | ❌ The other seller is on Amazon itself, so the existing seller alert already covers it | $0 |

- **(a)** would have applied to 1 of Hold's 3 real cheaper-elsewhere alerts. It moves the saving; it doesn't add to it.
- **(b)** has no real example yet. No purchase was recorded and no price drop has been seen. As an illustration only: if that $96.99 printer had been bought at Best Buy and dropped to $89.00 within 15 days, the refund would be $7.99. How often prices drop inside a 14–30 day window is unknown. Measure it on a few of the founder's real purchases before promising anything.

## Before building

1. Confirm the live `seller` values on Walmart and Amazon live checks: who is the seller when the store sells the item itself?
2. Check Hold's reader on live Home Depot, Lowe's, Staples and Target product pages.
3. See one real match tip on Best Buy, and one real price drop on a store that refunds, before turning on either feature's UI.
4. Re-check every policy page at least every 90 days. Stores change these terms: Best Buy's current terms took effect Sept 2, 2026.
