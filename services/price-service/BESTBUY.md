# Optional Best Buy product lookup

Set `BESTBUY_API_KEY` in the **price service's server environment** and restart that service. Keep the key in the host's secret configuration; never put it in extension files, build defines, URLs shared with shoppers, screenshots, or source control. This packet has not configured or used a real key, deployed a service, or changed eBay access.

The existing identity-only `/v1/prices/offers` endpoint then includes `bestbuy_api` coverage. Without a key it reports `not_configured`; request failures report `unavailable`. The extension needs its existing price-service endpoint configured separately. This is product pricing, not a coupon feed or affiliate enrollment.

The source makes at most two Products API requests: returned UPC must match the barcode lookup; fallback requires a verified brand and exact model. It accepts only active, online, explicitly new physical products with unambiguous shipping and a direct product URL. It rejects bundles, conditional prices, home delivery and unknown costs. The API's `new` flag means recently added, so it is never used as condition evidence. Taxes, destination-specific charges, memberships and delivery dates are not estimated. Returned prices expire after 15 minutes; existing service caching lasts 10 minutes.

Known limits: only the first 50 candidates are considered; normalized model queries can miss punctuation variants; omitted or changed provider fields fail closed. No live API response or shopper savings has been validated with the user's key. Before enabling this in a released extension, confirm real responses and permitted use for this key. The source sends the key only to the fixed HTTPS API host, refuses redirects and discards raw error messages and response metadata. Any host-level request tracing must also redact `apiKey` query values.

References: [Products API fields](https://bestbuyapis.github.io/api-documentation/#products-api), [search syntax](https://bestbuyapis.github.io/api-documentation/#search-techniques), [shipping fields](https://bestbuyapis.github.io/api-documentation/#shipping-and-delivery). Retrieved October 14, 2026.
