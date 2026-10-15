import { brandTokens, cleanProductUrl, normalizeGtin, normalizeModel, priceOfferSchema, sameBundle, sameProduct, type PriceOffer, type ProductIdentity } from '@repo/shared';
import type { OfferSource } from './ebay';

// Products API only: never the cart, buying-options, affiliate or Commerce APIs.
// Attribute meanings: https://bestbuyapis.github.io/api-documentation/#products-api
export type BestBuyConfig = { apiKey: string; fetch?: typeof fetch; now?: () => Date };
export const BESTBUY_OFFER_TTL_MS = 15 * 60 * 1000;
const PAGE_SIZE = 50;
const FIELDS = 'sku,name,manufacturer,modelNumber,upc,color,condition,preowned,secondaryMarket,type,active,onlineAvailability,orderable,homeDelivery,specialOrder,salePrice,shippingCost,freeShipping,priceRestriction,contracts,url';
const NOT_NEW = /\b(?:refurbished|refurb|renewed|pre[- ]?owned|used|open[- ]box|for parts|box only)\b/i;
const CONDITIONAL = /\b(?:with activation|with (?:a |new )?plan|member[- ]only|members? price|subscription)\b/i;

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
}
function cents(value: unknown): number | null {
  // The Products API returns JSON numbers, not currency strings. Reject fractions
  // of a cent instead of silently rounding a materially different amount.
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
  const rounded = Math.round(value * 100);
  return Math.abs(value * 100 - rounded) < 0.000001 ? rounded : null;
}
function packQuantity(title: string): number | null {
  const counts = [...title.normalize('NFKC').replace(/[-‐‑‒–—_]+/g, ' ').matchAll(/\b(?:pack|set|lot) of (\d{1,3})\b|\b(\d{1,3})[- ]?(?:pack|pk|count|ct|units)\b|\b(?:qty|quantity)\s*:?\s*(\d{1,3})\b|\bx\s*(\d{1,3})\b|\b(\d{1,3})\s*x\b/gi)]
    .map((match) => Number(match.slice(1).find(Boolean)));
  return new Set(counts).size > 1 ? null : counts[0] ?? 1;
}
function productUrl(value: unknown, sku: string): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = cleanProductUrl(value);
  if (!cleaned) return null;
  const url = new URL(cleaned);
  if (url.hostname !== 'www.bestbuy.com') return null;
  // Accept the documented legacy product route and the current product route.
  // Search, cart and redirect endpoints cannot masquerade as a product link.
  const legacy = new RegExp(`^/site/(?:[^/]+/)?${sku}\\.p$`).test(url.pathname);
  const current = /^\/product\/[^/]+\/[A-Z0-9]+\/?$/i.test(url.pathname);
  if (!legacy && !current) return null;
  if ([...url.searchParams].some(([key, value]) => key.toLowerCase() === 'skuid' && value !== sku)) return null;
  // This API already identifies the product by path. Drop even allowed shared
  // query parameters rather than retaining unknown variant selectors.
  url.search = '';
  return url.toString();
}

export function offerFromBestBuy(raw: unknown, requested: ProductIdentity, matchedBy: 'gtin' | 'model', at: Date): PriceOffer | null {
  if (!record(raw) || requested.condition !== 'new') return null;
  const sku = typeof raw.sku === 'number' && Number.isSafeInteger(raw.sku) ? String(raw.sku) : raw.sku;
  const title = text(raw.name, 300);
  if (typeof sku !== 'string' || !/^\d{1,10}$/.test(sku) || !title) return null;
  // `new` means recently added to the catalog, NOT item condition.
  if (text(raw.condition, 30)?.toLowerCase() !== 'new' || raw.preowned !== false || raw.secondaryMarket !== false
    || text(raw.type, 30)?.toLowerCase() !== 'hardgood' || raw.active !== true || raw.onlineAvailability !== true
    || text(raw.orderable, 30)?.toLowerCase() !== 'available') return null;
  if (NOT_NEW.test(title) || CONDITIONAL.test(title) || !sameBundle(title, title)) return null;
  if (raw.homeDelivery !== false || raw.specialOrder !== false) return null;
  if (raw.priceRestriction !== null && raw.priceRestriction !== '') return null;
  if (!Array.isArray(raw.contracts) || raw.contracts.length > 0) return null;
  const priceCents = cents(raw.salePrice);
  const shippingCents = cents(raw.shippingCost);
  const url = productUrl(raw.url, sku);
  if (!priceCents || shippingCents === null || !url) return null;
  // Do not infer free delivery from freeShippingEligible, membership, a spend
  // threshold, or an absent amount. Conflicting shipping facts also fail closed.
  if (typeof raw.freeShipping !== 'boolean' || raw.freeShipping !== (shippingCents === 0)) return null;
  const brand = text(raw.manufacturer, 160);
  const model = normalizeModel(raw.modelNumber);
  const gtin = normalizeGtin(raw.upc);
  const variant = raw.color === null || raw.color === undefined || raw.color === '' ? null : text(raw.color, 160);
  const quantity = packQuantity(title);
  if (quantity === null || (raw.upc !== null && raw.upc !== undefined && raw.upc !== '' && !gtin)) return null;
  if ((raw.manufacturer !== null && raw.manufacturer !== undefined && raw.manufacturer !== '' && !brand)
    || (raw.modelNumber !== null && raw.modelNumber !== undefined && raw.modelNumber !== '' && !model)) return null;
  if (raw.color && !variant) return null;
  if (matchedBy === 'gtin' && (!gtin || gtin !== normalizeGtin(requested.gtin))) return null;
  if (matchedBy === 'model' && (!brand || !model || model !== normalizeModel(requested.model))) return null;
  const product: ProductIdentity = { brand, model, gtin, variant, packQuantity: quantity, condition: 'new' };
  if (!sameProduct(requested, product)) return null;
  const parsed = priceOfferSchema.safeParse({
    id: `bestbuy:${sku}`, product, title, merchant: 'Best Buy', merchantDomain: 'www.bestbuy.com', seller: null,
    url, priceCents, shippingCents, currency: 'USD', availability: 'in_stock', requiresMembership: false, requiresCoupon: false,
    observedAt: at.toISOString(), expiresAt: new Date(at.getTime() + BESTBUY_OFFER_TTL_MS).toISOString(),
    source: 'bestbuy_api', evidenceRef: `Best Buy Products API SKU ${sku}`,
  });
  return parsed.success ? parsed.data : null;
}

export function bestBuySource({ apiKey, fetch: http = fetch, now = () => new Date() }: BestBuyConfig): OfferSource {
  async function search(filter: string, signal: AbortSignal): Promise<unknown[]> {
    const url = new URL(`https://api.bestbuy.com/v1/products(${filter}&active=true&onlineAvailability=true&type=HardGood)`);
    url.search = new URLSearchParams({ apiKey, format: 'json', show: FIELDS, pageSize: String(PAGE_SIZE), page: '1' }).toString();
    // Best Buy requires a query credential. Never propagate its response body,
    // canonicalUrl, fetch exception or request URL into logs or caller errors.
    try {
      const response = await http(url, { signal, redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('unavailable');
      const body: unknown = await response.json();
      if (!record(body) || !Array.isArray(body.products) || body.products.length > PAGE_SIZE || body.partial !== false) throw new Error('invalid response');
      return body.products;
    } catch {
      throw new Error('Best Buy product lookup unavailable.');
    }
  }
  return {
    name: 'bestbuy_api',
    async search(identity, signal) {
      if (identity.condition !== 'new') return [];
      const mapped = (items: unknown[], by: 'gtin' | 'model') => {
        const at = now();
        return items.map((item) => offerFromBestBuy(item, identity, by, at)).filter((offer): offer is PriceOffer => offer !== null);
      };
      const gtin = normalizeGtin(identity.gtin);
      if (gtin) {
        const forms = [...new Set([gtin, ...[8, 12, 13].filter((length) => normalizeGtin(gtin.slice(-length)) === gtin).map((length) => gtin.slice(-length))])];
        const found = mapped(await search(`(${forms.map((form) => `upc=${form}`).join('|')})`, signal), 'gtin');
        if (found.length) return found;
      }
      const model = normalizeModel(identity.model);
      if (!model || !brandTokens(identity.brand).length) return [];
      // Exact attribute query, then independently verify brand + model + UPC.
      // No keyword-title match or model suffix guessing in the fallback.
      return mapped(await search(`modelNumber=${encodeURIComponent(`"${model}"`)}`, signal), 'model');
    },
  };
}
