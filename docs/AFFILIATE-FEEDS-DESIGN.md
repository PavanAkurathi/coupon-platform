# Affiliate product feeds and voucher codes

**Status:** Proposed design only · **Date:** October 11, 2026 · **Owner:** Codex backend; Claude extension integration.

## Decision and scope

Import approved network catalogs into Neon Postgres and let the price service return product-page candidates by barcode or brand + model. The extension must check each candidate's live page before claiming savings. Commission and tracking links remain outside the lookup and ranking data path. M1 delivers feed coverage; M2 adds click-time links; M3 adds vouchers after C6. eBay remains on hold.

This follows `CODEX-V1-PACKET.md` and the founder's Hold v1 plan: commission only, no shopper accounts, electronics/appliances/tools first, and at least 17 correct savings in a fixed 50-product basket with zero false claims. No importer, migration, schedule, network enrollment or deployment is created by this document.

## Postgres model

| Table | Key and essential fields |
|---|---|
| `catalog_sources` | UUID; network, advertiser/feed IDs, exact approved merchant hosts, market/currency, access status, extension-use approval/evidence, enabled flag, polling interval, freshness limit, active import ID. Credentials stay in deployment secrets. |
| `catalog_identities` | UUID; normalized GTIN-14 (nullable), normalized brand/model (nullable), original identifiers, variant, condition, pack quantity, bundle status and optional documented contents. Require GTIN or brand + model. |
| `catalog_listings` | Stable UUID, unique `(source_id, external_product_id)`; survives successive imports and supplies an opaque reference for M2. |
| `catalog_listing_versions` | Unique `(listing_id, import_id)`; identity ID, clean direct product URL, title, seller, integer price/shipping cents (shipping nullable), availability, restrictions, source-updated time, fetched time, evidence time, validity and evidence hash. No tracking URLs or commission fields. |
| `import_runs` | UUID; source, full/delta mode, cursor/version, start/end, status, accepted/rejected counts and redacted error summary. Staging rows are keyed by run and external ID. |
| `voucher_candidates` | Unique `(source_id, external_promotion_id)`; merchant, optional code, discount type/value/currency, dates/timezone, region, minimum spend, customer restrictions, stacking/exclusions, terms, source evidence, authorization and attribution-review status. |
| `voucher_scopes` | Voucher ID plus typed inclusion/exclusion scope: identity/GTIN, brand + model, category or whole merchant. An absent scope means unknown, never “all products.” |
| `commercial.partner_terms`, `commercial.link_targets` | Separate restricted schema: program eligibility, commission terms, network product/promotion references and tracking-link metadata, linked by opaque listing/voucher IDs. M2 only. |

Use partial B-tree indexes on GTIN and `(brand_key, model_key)` plus listing indexes on identity/source/validity. These are lookup keys, **not global uniqueness constraints**: variants, sellers and bundles can share a base barcode. Brand aliases require reviewed mappings. Preserve conflicting source records for diagnosis; do not merge identities on title similarity. Keep price timestamps separate from download timestamps and use `timestamptz`; ambiguous dates and missing facts remain unknown.

GTIN validation, model normalization and matching must reuse the reviewed shared rules. Equal valid barcodes may resolve a model-prefix suffix only with compatible stated brands; condition, quantity and variant contradictions still veto. Matching bundle words or a base-item UPC do not establish identical bundle contents. Keep bundles out of alerts until explicit contents can be compared.

## Scheduled import

One scheduled worker polls due sources, outside shopper requests. Proposed starting intervals are six hours for products and one hour for promotions, adjusted to each approved source's limits and update cadence. The scheduler's hosting platform is an implementation decision; jobs invoke one authenticated importer.

1. Take a per-source lease with a monotonically increasing fencing token; fetch only approved endpoints with bounded sizes, timeouts, pagination and retries/backoff. Use conditional requests when supported. Logs exclude credentials and token-bearing URLs.
2. Stream into importer-only staging, validate identity, money, URLs and eligibility, and separate commercial fields. Tracking-only links cannot become candidates or be followed to discover a product URL. Quarantine bad rows; suspicious count drops, schema drift or incomplete pagination fail the run.
3. Publish version rows by atomically switching the source's active import pointer, rechecking the lease token and source version to prevent an older run overwriting a newer one. Deltas form a complete effective snapshot with explicit deletions; absent rows retire only after a complete full import. Retain the previous accepted generation for rollback. Failure leaves the previous snapshot active.
4. Exclude expired, disabled or over-age sources at query time. Reject future timestamps. When source time is missing or unreliable, use first-seen time for that payload hash, marked as ingestion evidence only; unchanged downloads retain it. Start with a configurable 24-hour candidate age limit and honor earlier source expiry. Neither that clock nor a download proves a current price. Record import lag/errors and notify only on actionable failure or stale coverage.

## Price-service lookup and live confirmation

Keep the current identity-only request shape: product identity and excluded merchant; no shopper page URL, title, price, account or browsing history. Add a versioned candidate response contract alongside the current verified-offer response; agree it with Claude before implementation. The existing `PriceOffer` path cannot safely represent an hours-old feed candidate as fresh evidence.

Query indexed barcode and brand/model candidates, then apply the shared identity vetoes and merchant exclusion. Deduplicate the same merchant/seller/product across feeds without discarding provenance. Return a bounded, deterministic list ordered by candidate delivered price where known, with explicit unknown shipping and per-source coverage. Use snapshot version, full identity, excluded domain and eligibility generation in cache keys; disable/revoke must invalidate cached candidates. eBay contributes nothing while on hold; existing noncommission offers and future approved sources join the same comparison path.

The extension checks approved direct product pages using its existing permission and request rules. Only a fresh live observation of the exact new item, price, stock and known shipping becomes a `PriceOffer` passed to `comparableOffers`/`compareOffers`. Re-run bundle/identity checks against the live title and product. Blocked pages, unknown shipping or uncertain identity produce no alert. Feed prices never acquire a new `observedAt` merely because they were fetched. This means feeds improve discovery but cannot by themselves solve stores that block live confirmation.

## Vouchers and commission separation

Importing a network promotion establishes provenance, not universal eligibility or neutral attribution. Preserve terms and require explicit source authorization, applicable scope and attribution review. Unknown, private or creator-assigned codes remain ineligible; bind approval to the reviewed terms/attribution hash so material changes invalidate it. Do not subtract a voucher from the ranked delivered price or assume stacking until the shopper's eligible checkout confirms incremental savings.

M3 must define the new network-code contract explicitly instead of silently bypassing today's coupon gates. C6 remains a prerequisite: no merchant is enabled for automatic trials until its safety fixes and regression checks pass. Tests and application require a shopper click and preserve prior attribution and discounts.

The price-service database role reads only catalog projections; it cannot read the `commercial` schema. Strict `FeedCandidate` and `PriceOffer` types contain no commission, partner preference or tracking link. A separate M2 resolver can obtain a link **after** the winning offer is selected and the shopper clicks, subject to disclosure, extension stand-down and current program eligibility. Amazon stays comparison-only. If monetization is unavailable, the same winning offer retains its plain link. Commission changes must not change candidate inclusion, ordering, tie-breaking or the displayed winner.

## Sources, trade-offs and acceptance

Awin documents an authorized [publisher feed download](https://help.awin.com/apidocs/retail-publisher-productapidocumentation-1) and a separate [promotion/voucher retrieval API](https://help.awin.com/apidocs/promotions). Promotion visibility can include unjoined advertisers, so visibility must not be treated as permission. Its [voucher-attribution documentation](https://help.awin.com/developers/docs/voucher-attribution) also shows why a working code does not prove neutral attribution. These are adapter examples, not evidence that Hold has program access. Confirm approved networks, feed availability and extension rights before selecting the first connector.

**Rakuten Advertising (US)** is another candidate, distinct from Rakuten Japan's `webservice.rakuten.co.jp`. Its official portal lists [Product Search](https://developers.rakutenadvertising.com/guides/product_search) and [Coupon](https://developers.rakutenadvertising.com/guides/coupon) guides. Confirm account-specific endpoint versions, fields and limits before implementing a connector; do not hard-code third-party descriptions as a contract. Its [downloadable-software policy](https://pubhelp.rakutenadvertising.com/hc/en-us/articles/360061252752-Downloadable-Software-Applications-DSAs) requires network testing plus participating advertiser approval, and stand-down for existing publisher attribution. Hold's no-cookie-access approach must be reviewed with the network; detecting a few URL parameters does not establish compliance or ownership. Catalog access and permission to monetize extension traffic are separate approvals. No Rakuten access or agreement is assumed.

Postgres snapshots cost storage and can lag, but give indexed lookups, reproducible evidence and reliable rollback without calling networks during browsing. Direct network queries on every shopper request would add latency, quota dependence and failure coupling. Start with one approved US/USD catalog; expand only after measuring identity completeness and live-confirmation yield.

Before M1 ships, verify: interrupted imports cannot partially replace the catalog; deletions/revocations invalidate results; stale/future prices cannot alert; barcode/model conflicts and unequal bundles fail; lookup plans use the indexes; and changing commission from zero to a large value leaves the candidate set and winner unchanged. Re-run the fixed 50-product basket and report discovery, live-confirmation and correct-alert rates separately. M2 owns links/disclosure; M3 owns vouchers/C6. No revenue, agreement or live saving is asserted by this design.

**Handoff:** design only; no importer, schema migration or schedule created. Main is now merged. The UPC-suffix rule is approved with additional regression coverage; the bundle comparison was tightened to exclude marked bundles until contents are structured. The companion build is a separate packet and does not complete M1, M2 or M3.
