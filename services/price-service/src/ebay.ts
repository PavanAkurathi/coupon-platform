import { brandTokens, cleanProductUrl, normalizeGtin, normalizeModel, priceOfferSchema, sameProduct, type PriceOffer, type ProductIdentity } from '@repo/shared';

// eBay Browse API (item_summary/search) with an application token from the client
// credentials grant. Only new, fixed-price, US-located listings with a fixed
// shipping cost and an established seller become offers. Response shape and the
// gtin/sort=price semantics checked against eBay's docs on October 8, 2026.

export type EbayConfig = { clientId: string; clientSecret: string; fetch?: typeof fetch; now?: () => Date };
export type OfferSource = { name: PriceOffer['source']; search(identity: ProductIdentity, signal: AbortSignal): Promise<PriceOffer[]> };

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
export const EBAY_OFFER_TTL_MS = 15 * 60 * 1000;
const MIN_FEEDBACK_PERCENT = 97;
const MIN_FEEDBACK_SCORE = 50;
// Listings that mention the model but are not the item itself.
const NOT_THE_ITEM = /\b(replacement|compatible|charger|charging (?:cord|cable|stand)|power (?:cord|supply)|adapter|for parts|parts only|lot of|bundle|box only|empty box|broken|as[- ]is|not working|untested|(?:attachment|head|blade|comb|guard|cover|case|stand)s? only)\b/i;

type Amount = { value?: string; currency?: string };
export type EbayItemSummary = {
  itemId?: string; title?: string; price?: Amount; conditionId?: string; itemWebUrl?: string;
  buyingOptions?: string[]; itemLocation?: { country?: string };
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
  shippingOptions?: { shippingCostType?: string; shippingCost?: Amount }[];
};

function cents(amount: Amount | undefined): number | null {
  if (amount?.currency !== 'USD' || typeof amount.value !== 'string' || !/^\d{1,7}(\.\d{1,2})?$/.test(amount.value)) return null;
  const [whole, fraction = ''] = amount.value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
function packOf(title: string): number | null {
  const counts = [...title.matchAll(/\b(?:pack|set|lot) of (\d{1,3})\b|\b(\d{1,3})[- ]?(?:pack|pk|count|ct|units)\b|\b(?:qty|quantity)\s*:?\s*(\d{1,3})\b|\bx\s*(\d{1,3})\b|\b(\d{1,3})\s*x\b/gi)]
    .map((match) => Number(match.slice(1).find(Boolean)));
  return new Set(counts).size > 1 ? null : counts[0] ?? 1;
}

const COLOURS = new Set(['black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'pink', 'purple', 'silver', 'gold', 'gray', 'grey', 'brown', 'beige']);
function identityFromTitle(title: string, requested: ProductIdentity, matchedBy: 'gtin' | 'model'): ProductIdentity | null {
  const words = brandTokens(title);
  const models = (title.match(/[a-z0-9][a-z0-9/.-]*/gi) ?? []).map(normalizeModel).filter((value): value is string => value !== null);
  // Whole tokens only: MG5965/490 and MG5965/49B are different models. A
  // GTIN search must not override a contradictory or missing named model.
  const model = requested.model ? models.find((value) => value === requested.model) ?? null : null;
  if (requested.model && !model) return null;
  const brand = brandTokens(requested.brand).filter((token) => words.includes(token)).join(' ') || null;
  if (matchedBy === 'model' && (!model || !brand)) return null;
  const titleColours = words.filter((word) => COLOURS.has(word));
  const requestedWords = brandTokens(requested.variant);
  if (requestedWords.some((word) => COLOURS.has(word)) && titleColours.some((word) => !requestedWords.includes(word))) return null;
  const phrase = (value: string[]) => ` ${value.join(' ')} `;
  const statedVariant = requested.variant && phrase(words).includes(phrase(requestedWords)) ? requested.variant : null;
  const variant = statedVariant ?? (titleColours.length === 1 ? titleColours[0]! : null);
  if (titleColours.length > 1 && !statedVariant) return null;
  const packQuantity = packOf(title);
  if (packQuantity === null) return null;
  // The GTIN-filtered API response establishes this GTIN. Keyword fallback
  // does not: never stamp the shopper's GTIN onto an unverified keyword result.
  const gtin = matchedBy === 'gtin' ? normalizeGtin(requested.gtin) : null;
  if (matchedBy === 'gtin' && !gtin) return null;
  const product: ProductIdentity = { brand, model, gtin, variant, packQuantity, condition: 'new' };
  return sameProduct(requested, product) ? product : null;
}

export function offerFromEbay(item: EbayItemSummary, identity: ProductIdentity, matchedBy: 'gtin' | 'model', now: Date): PriceOffer | null {
  const title = (item.title ?? '').trim();
  const priceCents = cents(item.price);
  const url = item.itemWebUrl ? cleanProductUrl(item.itemWebUrl) : null;
  if (!item.itemId || !title || !priceCents || !url || new URL(url).hostname !== 'www.ebay.com') return null;
  if (item.conditionId !== '1000' || !item.buyingOptions?.includes('FIXED_PRICE') || item.itemLocation?.country !== 'US') return null;
  if (NOT_THE_ITEM.test(title)) return null;
  const product = identityFromTitle(title, identity, matchedBy);
  if (!product) return null;
  const feedback = Number(item.seller?.feedbackPercentage);
  if (!(feedback >= MIN_FEEDBACK_PERCENT) || !((item.seller?.feedbackScore ?? 0) >= MIN_FEEDBACK_SCORE)) return null;
  const fixed = (item.shippingOptions ?? []).filter((option) => option.shippingCostType === 'FIXED').map((option) => cents(option.shippingCost));
  const shippingCents = fixed.length && !fixed.includes(null) ? Math.min(...(fixed as number[])) : null;
  const parsed = priceOfferSchema.safeParse({
    id: `ebay:${item.itemId}`.slice(0, 200), product,
    title: title.slice(0, 300), merchant: 'eBay', merchantDomain: 'www.ebay.com', seller: item.seller?.username?.slice(0, 100) ?? null,
    url, priceCents, shippingCents, currency: 'USD', availability: 'in_stock', requiresMembership: false, requiresCoupon: false,
    observedAt: now.toISOString(), expiresAt: new Date(now.getTime() + EBAY_OFFER_TTL_MS).toISOString(),
    source: 'ebay_api', evidenceRef: `eBay Browse API item ${item.itemId}`.slice(0, 500),
  });
  return parsed.success ? parsed.data : null;
}

export function ebaySource({ clientId, clientSecret, fetch: http = fetch, now = () => new Date() }: EbayConfig): OfferSource {
  let token: { value: string; expiresAt: number } | null = null;
  async function accessToken(signal: AbortSignal): Promise<string> {
    if (token && token.expiresAt > Date.now()) return token.value;
    const response = await http(TOKEN_URL, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }),
    });
    if (!response.ok) throw new Error(`eBay token request failed (${response.status})`);
    const body = await response.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('eBay token response had no access token');
    token = { value: body.access_token, expiresAt: Date.now() + Math.max(60, (body.expires_in ?? 7200) - 300) * 1000 };
    return token.value;
  }
  async function search(params: Record<string, string>, signal: AbortSignal): Promise<EbayItemSummary[]> {
    const url = new URL(SEARCH_URL);
    for (const [key, value] of Object.entries({ ...params, filter: 'conditionIds:{1000},buyingOptions:{FIXED_PRICE},itemLocationCountry:US,deliveryCountry:US', sort: 'price', limit: '50' })) {
      url.searchParams.set(key, value);
    }
    const response = await http(url, { signal, headers: {
      Authorization: `Bearer ${await accessToken(signal)}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', 'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country%3DUS',
    } });
    if (response.status === 401) token = null;
    if (!response.ok) throw new Error(`eBay search failed (${response.status})`);
    const body = await response.json() as { itemSummaries?: EbayItemSummary[] };
    return Array.isArray(body.itemSummaries) ? body.itemSummaries : [];
  }
  return {
    name: 'ebay_api',
    async search(identity, signal) {
      const at = now();
      const offers = (items: EbayItemSummary[], by: 'gtin' | 'model') => items.map((item) => offerFromEbay(item, identity, by, at)).filter((offer): offer is PriceOffer => offer !== null);
      // eBay takes UPC (12) or EAN (13) digits, never combined with keywords.
      if (identity.gtin) {
        const gtin = identity.gtin.startsWith('00') ? identity.gtin.slice(2) : identity.gtin.startsWith('0') ? identity.gtin.slice(1) : identity.gtin;
        const found = offers(await search({ gtin }, signal), 'gtin');
        if (found.length || !identity.model) return found;
      }
      if (!identity.model || !identity.brand) return [];
      return offers(await search({ q: `${identity.brand} ${identity.model}` }, signal), 'model');
    },
  };
}
