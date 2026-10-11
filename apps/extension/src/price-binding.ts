import { amazonProductAsin, cleanProductUrl, productIdentityKey, PRICE_EVIDENCE_MAX_AGE_MS, type PageProduct, type PriceComparison } from '@repo/shared';

// Observed time is deliberately excluded: a re-read of an unchanged product must
// not create a new lookup. Every field that can change the comparison is bound.
export function productFingerprint(product: PageProduct): string {
  return JSON.stringify([product.url, product.merchantDomain, productIdentityKey(product.identity), product.priceCents,
    product.shippingCents, product.currency, product.availability, product.seller, product.reader]);
}

export function pageMatchesProduct(url: string, product: PageProduct): boolean {
  try {
    if (new URL(url).hostname !== product.merchantDomain) return false;
    const asin = amazonProductAsin(url);
    return asin ? asin === amazonProductAsin(product.url) : cleanProductUrl(url) === product.url;
  } catch { return false; }
}

export function freshProduct(product: PageProduct, now = Date.now(), maxAge = 30_000): boolean {
  const observed = Date.parse(product.observedAt);
  return Number.isFinite(observed) && observed <= now && now - observed <= maxAge;
}

export function comparisonExpiresAt(result: PriceComparison): number {
  const offer = result.bestOffer;
  return Math.min(Date.parse(result.checkedAt) + PRICE_EVIDENCE_MAX_AGE_MS,
    offer ? Date.parse(offer.expiresAt) : Infinity,
    offer ? Date.parse(offer.observedAt) + PRICE_EVIDENCE_MAX_AGE_MS : Infinity);
}
