import { expect, test } from 'bun:test';
import { priceOffersResponseSchema, type PriceOffer, type ProductIdentity } from '@repo/shared';
import { createApp } from './app';
import { ebaySource, offerFromEbay, type EbayItemSummary, type OfferSource } from './ebay';
import { createOfferService, reviewedFeedSource } from './offers';

const now = new Date('2026-10-08T23:30:00.000Z');
const identity: ProductIdentity = { brand: 'Philips Norelco', model: 'MG5965/49', gtin: '00075020114105', variant: null, packQuantity: 1, condition: 'new' };
const extension = { Origin: 'chrome-extension://abcdefghijklmnop', 'Content-Type': 'application/json' };
// Shaped like eBay's documented item_summary/search response; values from the live listing of October 8.
const listing: EbayItemSummary = {
  itemId: 'v1|318944076250|0', title: 'Philips Norelco All-in-One 5000 (19 in 1) Trimmer MG5965/49 - NEW - SEALED',
  price: { value: '38.27', currency: 'USD' }, conditionId: '1000', buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'],
  itemWebUrl: 'https://www.ebay.com/itm/318944076250?hash=item4a42c5d0da:g:IOUAAeSwfCZqvswV', itemLocation: { country: 'US' },
  seller: { username: 'hatcitypawn1', feedbackPercentage: '99.7', feedbackScore: 12254 },
  shippingOptions: [{ shippingCostType: 'FIXED', shippingCost: { value: '0.00', currency: 'USD' } }],
};

test('an eBay listing becomes a clean, expiring offer', () => {
  const offer = offerFromEbay(listing, identity, 'gtin', now)!;
  expect(offer.url).toBe('https://www.ebay.com/itm/318944076250');
  expect(offer.priceCents).toBe(3827);
  expect(offer.shippingCents).toBe(0);
  expect(offer.seller).toBe('hatcitypawn1');
  expect(Date.parse(offer.expiresAt) - now.getTime()).toBe(15 * 60 * 1000);
});

test('eBay listings that are not this exact new item are dropped', () => {
  const rejected: [string, EbayItemSummary][] = [
    ['used', { ...listing, conditionId: '3000' }],
    ['auction', { ...listing, buyingOptions: ['AUCTION'] }],
    ['abroad', { ...listing, itemLocation: { country: 'CN' } }],
    ['accessory', { ...listing, title: 'Replacement charger for Philips Norelco MG5965/49' }],
    ['two pack', { ...listing, title: 'Philips Norelco MG5965/49 trimmer 2 pack' }],
    ['two count', { ...listing, title: 'Philips Norelco MG5965/49 trimmer 2 count' }],
    ['quantity two', { ...listing, title: 'Philips Norelco MG5965/49 trimmer Qty: 2' }],
    ['new seller', { ...listing, seller: { username: 'x', feedbackPercentage: '100', feedbackScore: 3 }}],
    ['low feedback', { ...listing, seller: { username: 'x', feedbackPercentage: '91.0', feedbackScore: 900 }}],
    ['foreign currency', { ...listing, price: { value: '38.27', currency: 'CAD' } }],
  ];
  for (const [name, item] of rejected) expect(`${name}:${offerFromEbay(item, identity, 'gtin', now)}`).toBe(`${name}:null`);
  // Calculated shipping is unknown shipping: kept, but it can never be shown as cheaper.
  expect(offerFromEbay({ ...listing, shippingOptions: [{ shippingCostType: 'CALCULATED' }] }, identity, 'gtin', now)?.shippingCents).toBeNull();
  // A keyword match must name the exact model.
  expect(offerFromEbay({ ...listing, title: 'Philips Norelco All-in-One 5000 trimmer' }, identity, 'model', now)).toBeNull();
  expect(offerFromEbay(listing, identity, 'model', now)).not.toBeNull();
});

test('eBay requires independent whole-model and variant evidence', () => {
  for (const title of ['Philips Norelco MG5965/490 trimmer', 'Philips Norelco MG5965/49B trimmer', 'Philips Norelco MG596549 trimmer']) {
    for (const matchedBy of ['model', 'gtin'] as const) {
      expect(offerFromEbay({...listing, title}, identity, matchedBy, now)).toBeNull();
    }
  }
  const black = {...identity, variant: 'Black'};
  expect(offerFromEbay({...listing, title: `${listing.title} White`}, black, 'model', now)).toBeNull();
  expect(offerFromEbay({...listing, title: `${listing.title} White`}, black, 'gtin', now)).toBeNull();
  expect(offerFromEbay(listing, black, 'model', now)).toBeNull(); // no variant evidence
  const offer = offerFromEbay({...listing, title: `${listing.title} Black`}, black, 'model', now)!;
  expect(offer.product.variant).toBe('Black');
  expect(offer.product.model).toBe('MG5965/49');
  expect(offer.product.gtin).toBeNull(); // keyword results do not prove the requested GTIN
  expect(offerFromEbay({...listing, title: `${listing.title} Black White`}, black, 'model', now)).toBeNull();
});

test('the eBay source authenticates once and searches by UPC first', async () => {
  const calls: string[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    if (url.includes('/oauth2/token')) {
      expect(String((init?.headers as Record<string, string>).Authorization)).toBe(`Basic ${btoa('id:secret')}`);
      return Response.json({ access_token: 'token', expires_in: 7200 });
    }
    expect((init?.headers as Record<string, string>)['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_US');
    return Response.json({ itemSummaries: url.includes('gtin=075020114105') ? [listing] : [] });
  }) as typeof fetch;
  const source = ebaySource({ clientId: 'id', clientSecret: 'secret', fetch: fake, now: () => now });
  expect((await source.search(identity, AbortSignal.timeout(1000))).map((offer) => offer.priceCents)).toEqual([3827]);
  await source.search(identity, AbortSignal.timeout(1000));
  expect(calls.filter((url) => url.includes('/oauth2/token'))).toHaveLength(1);
  const search = new URL(calls[1]!);
  expect(search.searchParams.get('gtin')).toBe('075020114105');
  expect(search.searchParams.has('q')).toBe(false);
  expect(search.searchParams.get('sort')).toBe('price');
});

function fixedSource(offers: PriceOffer[], name: PriceOffer['source'] = 'ebay_api'): OfferSource & { calls: number } {
  return { name, calls: 0, async search() { this.calls++; return offers; } };
}

test('the API returns matching offers, caches them and reports coverage', async () => {
  const offer = offerFromEbay(listing, identity, 'gtin', new Date())!;
  const source = fixedSource([offer]);
  const app = createApp({ service: createOfferService({ sources: [source], unconfigured: ['bestbuy_api'] }) });
  const ask = (body: unknown) => app.request('/v1/prices/offers', { method: 'POST', headers: extension, body: JSON.stringify(body) });
  const response = await ask({ identity, excludeDomain: 'www.amazon.com' });
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBe(extension.Origin);
  const body = priceOffersResponseSchema.parse(await response.json());
  expect(body.offers.map((item) => item.priceCents)).toEqual([3827]);
  expect(body.coverage).toEqual([{ source: 'ebay_api', status: 'checked', offers: 1 }, { source: 'bestbuy_api', status: 'not_configured', offers: 0 }]);
  // The same complete identity shares cached source evidence.
  await ask({ identity, excludeDomain: 'www.amazon.com' });
  expect(source.calls).toBe(1);
  // The current store is never offered back to the shopper.
  expect(priceOffersResponseSchema.parse(await (await ask({ identity, excludeDomain: 'ebay.com' })).json()).offers).toHaveLength(0);
  // Bad input.
  expect((await ask({ identity: { ...identity, gtin: null, model: 'All In One 5000' }, excludeDomain: 'www.amazon.com' })).status).toBe(400);
  expect((await ask({ identity, excludeDomain: 'www.amazon.com', url: 'https://www.amazon.com/dp/B0GYK61CBH' })).status).toBe(400);
  expect((await app.request('/v1/prices/offers', { method: 'POST', headers: extension, body: 'x'.repeat(4096) })).status).toBe(413);
});

test('source caches cannot cross brands or selected variants', async () => {
  let calls = 0;
  const source: OfferSource = {name: 'reviewed_feed', async search(product) {
    calls++;
    return [{...offerFromEbay(listing, identity, 'gtin', now)!, source: 'reviewed_feed', product}];
  }};
  const service = createOfferService({sources: [source], now: () => now});
  for (const product of [
    {...identity, gtin: null, brand: 'Brand A', variant: 'Black'},
    {...identity, gtin: null, brand: 'Brand B', variant: 'Black'},
    {...identity, gtin: null, brand: 'Brand B', variant: 'White'},
  ]) expect((await service.offers(product, 'www.amazon.com')).offers).toHaveLength(1);
  expect(calls).toBe(3);
});

test('expired, old and future-dated source evidence is never returned', async () => {
  const offer = offerFromEbay(listing, identity, 'gtin', now)!;
  const service = createOfferService({sources: [fixedSource([
    {...offer, observedAt: new Date(now.getTime() - 16 * 60_000).toISOString()},
    {...offer, observedAt: new Date(now.getTime() + 1).toISOString()},
    {...offer, expiresAt: now.toISOString()},
  ])], now: () => now});
  expect((await service.offers(identity, 'www.amazon.com')).offers).toHaveLength(0);
});

test('a failing source is unavailable, not "no offers", and is retried', async () => {
  let calls = 0;
  const failing: OfferSource = { name: 'ebay_api', async search() { calls++; throw new Error('down'); } };
  const service = createOfferService({ sources: [failing] });
  expect((await service.offers(identity, 'www.amazon.com')).coverage).toEqual([{ source: 'ebay_api', status: 'unavailable', offers: 0 }]);
  await service.offers(identity, 'www.amazon.com');
  expect(calls).toBe(2);
  const slow: OfferSource = { name: 'ebay_api', search: (_identity, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) };
  const started = Date.now();
  expect((await createOfferService({ sources: [slow], timeoutMs: 50 }).offers(identity, 'www.amazon.com')).coverage[0]!.status).toBe('unavailable');
  expect(Date.now() - started).toBeLessThan(1000);
});

test('reviewed feed entries must be reviewed offers for this product', async () => {
  const good = { ...offerFromEbay(listing, identity, 'gtin', new Date())!, id: 'reviewed:1', source: 'reviewed_feed' };
  const source = reviewedFeedSource(async () => [good, { ...good, source: 'ebay_api' }, { ...good, product: { ...identity, gtin: '00012345678905' } }, { nonsense: true }]);
  expect((await source.search(identity, AbortSignal.timeout(100))).map((offer) => offer.id)).toEqual(['reviewed:1']);
});

test('health stays public and other routes 404', async () => {
  const app = createApp({ service: createOfferService({ sources: [] }) });
  expect((await app.request('/health')).status).toBe(200);
  expect((await app.request('/v1/prices/example')).status).toBe(404);
});
