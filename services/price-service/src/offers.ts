import { PRICE_EVIDENCE_MAX_AGE_MS, priceOfferSchema, productIdentityKey, sameMerchant, sameProduct, type PriceCoverage, type PriceOffer, type PriceOffersResponse, type ProductIdentity } from '@repo/shared';
import type { OfferSource } from './ebay';

// Answers "who else sells this exact item, for how much" from cached source
// results. A cache entry lives 10 minutes; concurrent lookups share one fetch.
// A source that fails or times out is reported as unavailable, never as "no offers".

export type OfferService = { offers(identity: ProductIdentity, excludeDomain: string): Promise<PriceOffersResponse> };
type Entry = { at: number; offers: PriceOffer[]; coverage: PriceCoverage };
export const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 5000;

export function createOfferService({ sources, unconfigured = [], timeoutMs = 2000, now = () => new Date() }: {
  sources: OfferSource[]; unconfigured?: PriceOffer['source'][]; timeoutMs?: number; now?: () => Date;
}): OfferService {
  const cache = new Map<string, Entry>();
  const pending = new Map<string, Promise<Entry>>();
  const keyOf = (source: OfferSource, identity: ProductIdentity) => `${source.name}|${productIdentityKey(identity)}`;

  async function lookup(source: OfferSource, identity: ProductIdentity): Promise<Entry> {
    const key = keyOf(source, identity);
    const hit = cache.get(key);
    if (hit && now().getTime() - hit.at < CACHE_TTL_MS) return hit;
    const running = pending.get(key);
    if (running) return running;
    const task = (async (): Promise<Entry> => {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const offers = await source.search(identity, signal);
        const entry: Entry = { at: now().getTime(), offers, coverage: { source: source.name, status: 'checked', offers: offers.length } };
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
        cache.set(key, entry);
        return entry;
      } catch {
        // Failures are not cached, so the next shopper retries.
        return { at: now().getTime(), offers: [], coverage: { source: source.name, status: 'unavailable', offers: 0 } };
      } finally { pending.delete(key); }
    })();
    pending.set(key, task);
    return task;
  }

  return {
    async offers(identity, excludeDomain) {
      const results = await Promise.all(sources.map((source) => lookup(source, identity)));
      const at = now().getTime();
      const offers = results.flatMap((entry) => entry.offers).filter((offer) => sameProduct(identity, offer.product)
        && !sameMerchant(offer.merchantDomain, excludeDomain) && Date.parse(offer.expiresAt) > at
        && Date.parse(offer.observedAt) <= at && at - Date.parse(offer.observedAt) <= PRICE_EVIDENCE_MAX_AGE_MS)
        .sort((a, b) => (a.priceCents + (a.shippingCents ?? 1e9)) - (b.priceCents + (b.shippingCents ?? 1e9))).slice(0, 50);
      const coverage = results.map((entry) => ({ ...entry.coverage, offers: offers.filter((offer) => offer.source === entry.coverage.source).length }));
      return { offers: offers.map((offer) => priceOfferSchema.parse(offer)), coverage: [...coverage, ...unconfigured.map((source) => ({ source, status: 'not_configured' as const, offers: 0 }))] };
    },
  };
}

// Operator-reviewed offers from a JSON file: each entry is a full offer with
// source "reviewed_feed", an evidence reference and an expiry. Invalid entries are skipped.
export function reviewedFeedSource(load: () => Promise<unknown>): OfferSource {
  return {
    name: 'reviewed_feed',
    async search(identity) {
      const raw = await load();
      if (!Array.isArray(raw)) throw new Error('Reviewed offers file must be a JSON array.');
      return raw.flatMap((item) => {
        const parsed = priceOfferSchema.safeParse(item);
        return parsed.success && parsed.data.source === 'reviewed_feed' && sameProduct(identity, parsed.data.product) ? [parsed.data] : [];
      });
    },
  };
}
