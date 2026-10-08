# Live checkout evidence — October 8, 2026

The founder explicitly authorized applying coupons, adding test products and proceeding through checkout on stores, stopping before Buy/Place order. Existing cart items must be preserved; no orders, subscriptions, credentials or payment changes.

Amazon public product B097S1MF28: the previously open 20% coupon failed with a merchant error. Refreshing revealed a current 10% coupon, advertised product price $17.99 against $19.99, expiring October 10. Selecting the native checkbox succeeded. One item was added as a one-time purchase. Prime enrollment was declined. Final review showed **Your Coupon Savings: -$2.00**, **Coupon applied**, and the **Place your order** button. No order was submitted. The test product remains in the cart alongside the user's unchanged existing item.

Observed checkout structure, without saved personal information or checkout IDs:
- Route begins `/checkout/p/` on exact `https://www.amazon.com`.
- Visible `#subtotals-marketplace-table .order-summary-grid` rows contain `.order-summary-line-term` and `.order-summary-line-definition`.
- Exact labels `Your Coupon Savings:` (negative USD amount) and `Order total:` (USD amount).
- Final purchase controls are `input#placeOrder[name="placeYourOrder1"][type="submit"]`; duplicate hidden copies exist. They are read-only boundaries, never clicked by the extension.

A displayed checkout coupon saving is not yet a completed purchase or evidence of an earned affiliate commission. It does not identify which shopper/extension originally supplied the coupon. No coupon report or quorum vote is created from this walkthrough.
