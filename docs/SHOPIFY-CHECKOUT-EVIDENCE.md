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

## Not yet observed

An accepted code: its money-line label, the applied-code chip and its remove control. Neither store published a public code on October 8. Until a real valid code is observed, the Shopify adapter must not apply, remove or compare codes automatically. Inspection and invalid-code detection are the only observed capabilities.

A valid code for structural observation only, for example a single-use welcome code from the founder's own inbox, would close this gap. It would never be stored or distributed.
