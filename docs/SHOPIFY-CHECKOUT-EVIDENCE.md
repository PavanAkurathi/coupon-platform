# Shopify checkout evidence — October 8, 2026

The founder approved live guest-checkout observation on MVMT and Allbirds: an isolated browser with no account or saved data, one item in a guest cart, open checkout, and apply a deliberately invalid code. Contact, address and payment fields were never touched. Pay now was never clicked, no order was placed, and the pre-checked marketing checkbox was left alone. No personal data or checkout tokens were saved.

## Stores

| Store | Storefront | Checkout route | Item |
|---|---|---|---|
| MVMT | `mvmt.com` (Shopify, `5932am-t3.myshopify.com`) | `https://mvmt.com/checkouts/cn/<token>/en-us` | $19.00 charm |
| Allbirds | `www.allbirds.com` (Shopify, `weareallbirds.myshopify.com`) | `https://www.allbirds.com/checkouts/cn/<token>/en-us` | $25.00 flip flop |

Both checkouts run on the store's own host with Shopify's one-page checkout. Structure was identical on both; only copy differed ("Discount code" vs "Discount code or gift card").

## Observed structure

- Discount field: visible `input[name="reductions"][type="text"]`. Its `id` is generated per render (`ReductionsInput…`) and must not be stored. A hidden duplicate exists for the collapsed mobile summary ("Add discount" button).
- Apply: `button[type="submit"][aria-label="Apply Discount Code"]` in the same `form`.
- Invalid code: the field gets `aria-invalid="true"` and `aria-describedby="error-for-<field id>"`; that element reads "Enter a valid discount code" (MVMT) or "Enter a valid discount code or gift card" (Allbirds). The total did not change.
- Money lines: `div[role="table"][aria-labelledby^="MoneyLine-Heading"]` → `div[role="rowgroup"]` → `div[role="row"]`, each with `div[role="rowheader"]` (label: Subtotal, Shipping, Estimated taxes, Total) and `div[role="cell"]` (amount). Total's cell reads `USD $28.17`, with the currency code. Shipping reads "Enter shipping address" until an address exists, so totals before an address are estimates.
- Purchase boundary: `button#checkout-pay-button[type="submit"]` ("Pay now"). Read-only; never clicked.
- Hidden error templates ("There was a problem with our checkout") exist in the DOM and must be ignored unless visible.

## Accepted code (observed October 8, Allbirds)

The founder supplied candidate codes in chat for observation only. They looked aggregator-sourced, so their audience and attribution are unknown and none of them may enter the coupon database without operator review. `AFF-FIRST15` was skipped because its prefix marks an affiliate code. Results on a guest cart with one $25 item (subtotal $27.98):

| Store | Code | Result |
|---|---|---|
| Allbirds | `SAVE16` | Rejected: "Enter a valid discount code or gift card" |
| Allbirds | `WELCOME10` | Accepted: −$2.79; total $28.17 → $25.36, with estimated tax $0.19 → $0.17 |
| MVMT | `WKND30`, `SUM25` | Rejected: "Enter a valid discount code" ($19 item) |

Shopify shows the same message for expired, ineligible and unknown codes. A code accepted before an email is entered (WELCOME10 looks like a new-customer code) can still be re-checked once the shopper identifies themselves.

Accepted-state structure:

- The discount field clears; `aria-invalid` is removed.
- Applied codes appear as chips in `ul[role="list"][aria-label="Discount code or gift card"] > li > div[role="group"]`. Each chip has `button[type="button"][aria-label="Remove <CODE>"]`.
- A live region `div[role="status"]` announces "Discount code <CODE> has been applied".
- Money lines add a heading row `Order discount` (rowheader only, **no cell**), then a row per code (`rowheader` = the code, `cell` = `− $2.79`, with a space after the minus), then a `TOTAL SAVINGS $2.79` row whose amount is in the rowheader and whose cell is empty.
- Clicking `Remove WELCOME10` restored the total to exactly $28.17 and removed the chip and the discount rows.

Implications: the reader skips heading-only rows. It reports applied codes. Trials compare payable totals, which include tax effects. Trials remove only codes they added and never remove a code that was already applied.

## Implemented and proven live (October 8)

- `src/shopify-adapter.ts` applies a code, waits for a settled state and records success only when the payable total drops. It removes the code with its own Remove button and confirms the total returns exactly. It then re-applies the best code and verifies the final total.
- Observed quirks it handles: Apply is disabled while the field is empty. Shopify can reset the field just after a removal, so the adapter re-types until the field holds the code and Apply is enabled. A previous rejection stays flagged on the field, so a new rejection only counts after a longer wait.
- Safety: a code that is already applied (the shopper's or a creator's) blocks trials and is never removed. A cart change stops testing, leaves the changed cart alone and names any code still applied.
- Extension: `shopify-content.js` is injected with activeTab only when the page is a Shopify checkout on the exact host of an operator-enabled merchant. Codes pass the same safety gate as every other merchant.
- Live, Allbirds: the trial adapter passed 13/13 (`SAVE16` rejected, `WELCOME10` −$2.81 payable, final total $25.36 matching Shopify's summary). The real built extension, with its isolated-world content script and an in-memory test service supplying the two codes, showed "$2.81 saved, WELCOME10 applied · $25.36 total". Pay now was never clicked, contact fields stayed empty and only WELCOME10 remained applied.
