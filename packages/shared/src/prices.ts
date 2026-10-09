import { z } from 'zod';

// Cross-store price comparison. Prices come only from observed product pages,
// official merchant APIs or operator-reviewed feeds; never from a language model.
// A comparison is pre-tax and fails closed: unknown shipping, stale evidence,
// another condition or an inexact product match never produces a savings claim.

const money = z.number().int().min(0).max(100_000_000);
const hostname = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/);
const shortText = z.string().trim().min(1).max(160);

// GTIN-8/12/13/14 normalized to 14 digits with a valid check digit.
export function normalizeGtin(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const digits = String(raw).trim();
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return null;
  const gtin = digits.padStart(14, '0');
  if (/^0+$/.test(gtin)) return null;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(gtin[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(gtin[13]) ? gtin : null;
}

// A manufacturer model code such as MG5965/49 or X5004/84. Marketing names
// ("All In One 5000") contain spaces and are rejected rather than guessed at.
export function normalizeModel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.length > 40) return null;
  const model = trimmed.toUpperCase().replaceAll('-', '');
  if (!/^[A-Z0-9][A-Z0-9/.]{3,29}$/.test(model) || !/\d/.test(model)) return null;
  return model;
}

const BRAND_NOISE = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'company', 'the', 'store', 'brand', 'official']);
export function brandTokens(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter((token) => token && !BRAND_NOISE.has(token)))];
}
// "Norelco" and "Philips Norelco" are the same brand; "Philips" and "Remington" are not.
export function brandsCompatible(a: string | null, b: string | null): boolean {
  const left = brandTokens(a); const right = brandTokens(b);
  if (!left.length || !right.length) return false;
  const [small, large] = left.length <= right.length ? [left, right] : [right, left];
  return small.every((token) => large.includes(token));
}

export const productConditionSchema = z.enum(['new', 'used', 'refurbished', 'unknown']);
export const productIdentitySchema = z.object({
  brand: shortText.nullable(),
  model: z.string().nullable().transform((value) => normalizeModel(value)),
  gtin: z.string().nullable().transform((value) => normalizeGtin(value)),
  variant: shortText.nullable(),
  packQuantity: z.number().int().min(1).max(1000),
  condition: productConditionSchema,
}).strict().refine((identity) => identity.gtin || (identity.model && identity.brand), 'A product needs a GTIN, or a brand and model code.');
export type ProductIdentity = z.infer<typeof productIdentitySchema>;

// Direct HTTPS product links only. Query strings are dropped except a variant
// selector, so tracking and affiliate parameters never travel with an offer.
const KEPT_QUERY = new Set(['variant', 'skuid']);
export function cleanProductUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!hostname.safeParse(url.hostname).success) return null;
  const kept = [...url.searchParams].filter(([key]) => KEPT_QUERY.has(key.toLowerCase()));
  url.search = ''; url.hash = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);
  return url.toString();
}
const productUrl = z.url().max(2000).refine((raw) => cleanProductUrl(raw) === raw, 'Use a clean, direct HTTPS product URL.');

export const productReaderSchema = z.enum(['amazon', 'walmart', 'json-ld']);
// What the shopper's current product page shows. Read on the device; the page URL
// and title are never sent to the price service, only the product identity.
export const pageProductSchema = z.object({
  identity: productIdentitySchema,
  title: z.string().trim().min(1).max(300),
  merchant: z.string().min(1).max(100),
  merchantDomain: hostname,
  seller: z.string().max(100).nullable(),
  url: productUrl,
  priceCents: money.min(1),
  shippingCents: money.nullable(),
  currency: z.literal('USD'),
  availability: z.enum(['in_stock', 'out_of_stock', 'unknown']),
  observedAt: z.iso.datetime(),
  reader: productReaderSchema,
}).strict().refine((product) => new URL(product.url).hostname === product.merchantDomain, 'Product URL must match its merchant host.');
export type PageProduct = z.infer<typeof pageProductSchema>;

// live_check: a store's public product page fetched from the shopper's own browser.
export const priceSourceSchema = z.enum(['seen_by_you', 'live_check', 'ebay_api', 'bestbuy_api', 'reviewed_feed']);
export type PriceSource = z.infer<typeof priceSourceSchema>;
export const priceOfferSchema = z.object({
  id: z.string().min(1).max(200),
  product: productIdentitySchema,
  title: z.string().min(1).max(300),
  merchant: z.string().min(1).max(100),
  merchantDomain: hostname,
  seller: z.string().max(100).nullable(),
  url: productUrl,
  priceCents: money.min(1),
  // null means shipping is unknown, so the offer can never be shown as cheaper.
  shippingCents: money.nullable(),
  currency: z.literal('USD'),
  availability: z.enum(['in_stock', 'out_of_stock', 'unknown']),
  requiresMembership: z.boolean(),
  requiresCoupon: z.boolean(),
  observedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  source: priceSourceSchema,
  evidenceRef: z.string().min(1).max(500),
}).strict().refine((offer) => new URL(offer.url).hostname === offer.merchantDomain, 'Offer URL must match its merchant host.');
export type PriceOffer = z.infer<typeof priceOfferSchema>;

export const priceCoverageSchema = z.object({
  source: priceSourceSchema,
  merchant: z.string().min(1).max(100).optional(),
  status: z.enum(['checked', 'not_configured', 'unavailable']),
  offers: z.number().int().nonnegative(),
}).strict();
export type PriceCoverage = z.infer<typeof priceCoverageSchema>;

// Wire contract for the price service: identity in, matching offers out.
export const priceOffersRequestSchema = z.object({ identity: productIdentitySchema, excludeDomain: hostname }).strict();
export type PriceOffersRequest = z.input<typeof priceOffersRequestSchema>;
export const priceOffersResponseSchema = z.object({
  offers: z.array(priceOfferSchema).max(50),
  coverage: z.array(priceCoverageSchema).max(10),
}).strict();
export type PriceOffersResponse = z.infer<typeof priceOffersResponseSchema>;

export const priceComparisonSchema = z.object({
  status: z.enum(['better_offer', 'no_better_offer', 'not_checked']),
  baselineCents: money.nullable(),
  bestOffer: priceOfferSchema.nullable(),
  savingsCents: money,
  offersChecked: z.number().int().nonnegative(),
  coverage: z.array(priceCoverageSchema).max(10),
  checkedAt: z.iso.datetime(),
  reason: z.string().max(300),
  taxIncluded: z.literal(false),
}).strict().superRefine((r, ctx) => {
  if (r.status === 'better_offer' && (!r.bestOffer || r.savingsCents <= 0 || r.baselineCents === null)) {
    ctx.addIssue({code: 'custom', message: 'A better offer requires positive measured savings.'});
  }
  if (r.status !== 'better_offer' && (r.bestOffer !== null || r.savingsCents !== 0)) {
    ctx.addIssue({code: 'custom', message: 'Only a better offer can claim savings.'});
  }
});
export type PriceComparison = z.infer<typeof priceComparisonSchema>;

// Same store family: www.ebay.com and ebay.com, or two hosts of one domain.
export function sameMerchant(a: string, b: string): boolean {
  const root = (host: string) => host.toLowerCase().split('.').slice(-2).join('.');
  return root(a) === root(b);
}

export function sameProduct(a: ProductIdentity, b: ProductIdentity): boolean {
  if (a.condition === 'unknown' || a.condition !== b.condition || a.packQuantity !== b.packQuantity) return false;
  // Conflicting facts must never disappear behind a matching (possibly mistyped) GTIN.
  if (a.model && b.model && a.model !== b.model) return false;
  if (a.brand && b.brand && !brandsCompatible(a.brand, b.brand)) return false;
  if (a.variant && b.variant && a.variant.toLowerCase() !== b.variant.toLowerCase()) return false;
  if (a.gtin && b.gtin) return a.gtin === b.gtin;
  // A model can describe several colours/sizes. Only the same GTIN can bridge
  // a missing variant without guessing that the selected options are identical.
  if (Boolean(a.variant) !== Boolean(b.variant)) return false;
  return Boolean(a.model && b.model && a.model === b.model && brandsCompatible(a.brand, b.brand));
}

// All fields used to select offers belong in a cache key, even when a provider
// chooses to search by GTIN first. Brand/model/variant contradictions still matter.
export function productIdentityKey(identity: ProductIdentity): string {
  return JSON.stringify([
    brandTokens(identity.brand).sort(), normalizeModel(identity.model), normalizeGtin(identity.gtin),
    identity.variant?.trim().toLowerCase() ?? null, identity.packQuantity, identity.condition,
  ]);
}

export const PRICE_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;
export const MIN_ALERT_SAVINGS_CENTS = 100;
export type CompareOptions = { now?: Date; minSavingsCents?: number; maxAgeMs?: number; coverage?: PriceCoverage[] };

export function deliveredCents(offer: Pick<PriceOffer, 'priceCents' | 'shippingCents'>): number | null {
  return offer.shippingCents === null ? null : offer.priceCents + offer.shippingCents;
}
// Offers that may be compared at all: exact product, another store, fresh, in
// stock, known shipping, no membership or extra coupon needed.
export function comparableOffers(baseline: PageProduct, offers: PriceOffer[], now = new Date(), maxAgeMs = PRICE_EVIDENCE_MAX_AGE_MS): PriceOffer[] {
  const nowMs = now.getTime();
  const freshness = Math.min(maxAgeMs, PRICE_EVIDENCE_MAX_AGE_MS);
  return offers.filter((offer) => {
    const observed = Date.parse(offer.observedAt); const expires = Date.parse(offer.expiresAt);
    return sameProduct(baseline.identity, offer.product) && !sameMerchant(offer.merchantDomain, baseline.merchantDomain)
      && offer.currency === baseline.currency && offer.availability === 'in_stock' && offer.shippingCents !== null
      && !offer.requiresMembership && !offer.requiresCoupon
      && observed <= nowMs && nowMs - observed <= freshness && expires > nowMs;
  });
}

export function compareOffers(baseline: PageProduct, offers: PriceOffer[], options: CompareOptions = {}): PriceComparison {
  const now = options.now ?? new Date();
  const coverage = options.coverage ?? [];
  const base = { checkedAt: now.toISOString(), coverage, taxIncluded: false as const, bestOffer: null, savingsCents: 0 };
  if (baseline.identity.condition !== 'new') {
    return { ...base, status: 'not_checked', baselineCents: null, offersChecked: 0, reason: 'Only new items are compared.' };
  }
  const baselineAt = Date.parse(baseline.observedAt);
  if (baselineAt > now.getTime() || now.getTime() - baselineAt > PRICE_EVIDENCE_MAX_AGE_MS || !Number.isFinite(baselineAt)) {
    return { ...base, status: 'not_checked', baselineCents: null, offersChecked: 0, reason: 'Refresh this page to compare its current price.' };
  }
  // This page's own shipping is often unknown; comparing against its item price alone
  // can only understate the saving, never overstate it.
  const baselineCents = baseline.priceCents + (baseline.shippingCents ?? 0);
  const comparable = comparableOffers(baseline, offers, now, options.maxAgeMs);
  if (!comparable.length) {
    return { ...base, status: 'not_checked', baselineCents, offersChecked: 0,
      reason: 'Could not compare fresh delivered prices for this exact item.' };
  }
  const best = comparable.reduce((winner, offer) => deliveredCents(offer)! < deliveredCents(winner)! ? offer : winner);
  const savingsCents = baselineCents - deliveredCents(best)!;
  if (savingsCents < (options.minSavingsCents ?? MIN_ALERT_SAVINGS_CENTS)) {
    return { ...base, status: 'no_better_offer', baselineCents, offersChecked: comparable.length,
      reason: savingsCents > 0 ? 'A matching offer is slightly cheaper, below the alert threshold.' : 'No compared offer costs less than this page.' };
  }
  return { ...base, status: 'better_offer', baselineCents, bestOffer: best, savingsCents, offersChecked: comparable.length,
    reason: 'Same item, new condition, delivered price before tax.' };
}

// A product page the shopper saw, or one checked live, becomes an offer for comparisons on other stores.
// Retain observations for later refresh, but never use the retention period as
// permission to alert from an old price.
export const SEEN_OFFER_TTL_MS = 12 * 60 * 60 * 1000;
export const LIVE_CHECK_TTL_MS = PRICE_EVIDENCE_MAX_AGE_MS;
export function offerFromPage(product: PageProduct, source: 'seen_by_you' | 'live_check' = 'seen_by_you'): PriceOffer {
  const ttl = source === 'live_check' ? LIVE_CHECK_TTL_MS : SEEN_OFFER_TTL_MS;
  const expires = new Date(Date.parse(product.observedAt) + ttl).toISOString();
  return priceOfferSchema.parse({
    id: `${source === 'live_check' ? 'live' : 'seen'}:${product.merchantDomain}:${product.url}`.slice(0, 200),
    product: product.identity, title: product.title, merchant: product.merchant, merchantDomain: product.merchantDomain,
    seller: product.seller, url: product.url, priceCents: product.priceCents, shippingCents: product.shippingCents,
    currency: product.currency, availability: product.availability, requiresMembership: false, requiresCoupon: false,
    observedAt: product.observedAt, expiresAt: expires, source,
    evidenceRef: source === 'live_check' ? 'Store product page checked from this browser.' : 'Product page you viewed in this browser.',
  });
}
