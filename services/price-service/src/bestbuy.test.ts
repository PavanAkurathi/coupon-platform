import { expect, test } from 'bun:test';
import { type ProductIdentity } from '@repo/shared';
import { bestBuySource, offerFromBestBuy, BESTBUY_OFFER_TTL_MS } from './bestbuy';
import { createOfferService } from './offers';
import { apiSources } from './sources';

const at = new Date('2026-10-14T15:00:00.000Z');
const identity: ProductIdentity = { brand: 'Philips Norelco', model: 'MG5965/49', gtin: '00075020114105', variant: 'Black', packQuantity: 1, condition: 'new' };
// Synthetic Products API fixture. No live prices, merchant approval or coupon evidence.
const product = {
  sku: 6543210, name: 'Philips Norelco MG5965/49 Trimmer - Black', manufacturer: 'Philips Norelco', modelNumber: 'MG5965/49',
  upc: '075020114105', color: 'Black', condition: 'New', preowned: false, secondaryMarket: false, type: 'HardGood',
  active: true, onlineAvailability: true, orderable: 'Available', homeDelivery: false, specialOrder: false, salePrice: 49.99,
  shippingCost: 0, freeShipping: true, priceRestriction: null, contracts: [],
  url: 'https://www.bestbuy.com/site/example-trimmer/6543210.p?skuId=6543210&ref=example#reviews',
};
const signal = () => new AbortController().signal;
const response = (products: unknown[], extra: Record<string, unknown> = {}) => Response.json({ products, partial: false, ...extra });
const mockFetch = (fn: (url: URL, init?: RequestInit) => Promise<Response>) => fn as unknown as typeof fetch;

test('Best Buy maps explicit current facts to a clean expiring offer', () => {
  const offer = offerFromBestBuy(product, identity, 'gtin', at)!;
  expect(offer.url).toBe('https://www.bestbuy.com/site/example-trimmer/6543210.p');
  expect(offer.priceCents).toBe(4999);
  expect(offer.shippingCents).toBe(0);
  expect(offer.product.gtin).toBe(identity.gtin);
  expect(offer.source).toBe('bestbuy_api');
  expect(offer.seller).toBeNull();
  expect(offer.requiresMembership).toBe(false);
  expect(offer.requiresCoupon).toBe(false);
  expect(Date.parse(offer.expiresAt) - at.getTime()).toBe(BESTBUY_OFFER_TTL_MS);
  expect(offerFromBestBuy({ ...product, shippingCost: 4.99, freeShipping: false }, identity, 'gtin', at)?.shippingCents).toBe(499);
  expect(offerFromBestBuy({ ...product, url: 'https://www.bestbuy.com/product/example-trimmer/J79GGJ9LL9' }, identity, 'gtin', at)).not.toBeNull();
});

test('Best Buy rejects unknown shipping, conditional delivery and contradictory free-shipping facts', () => {
  const rejected = [
    { shippingCost: undefined }, { shippingCost: null }, { shippingCost: '0' }, { shippingCost: -1 },
    { shippingCost: 1.001 }, { shippingCost: NaN }, { shippingCost: 4.99 }, { freeShipping: undefined },
    { freeShipping: false, freeShippingEligible: true }, { homeDelivery: true }, { homeDelivery: undefined },
    { specialOrder: true }, { specialOrder: undefined },
  ];
  for (const override of rejected) expect(offerFromBestBuy({ ...product, ...override }, identity, 'gtin', at)).toBeNull();
});

test('recently added is not new condition; used, bundles, unavailable and conditional prices fail closed', () => {
  const rejected = [
    { condition: undefined, new: true }, { condition: 'Refurbished', new: true }, { preowned: true }, { preowned: undefined },
    { secondaryMarket: true }, { type: 'Bundle' }, { type: 'Music' }, { active: false }, { onlineAvailability: false },
    { orderable: 'PreorderNow' }, { orderable: 'BackOrder' }, { orderable: undefined },
    { priceRestriction: 'MAP' }, { priceRestriction: undefined }, { contracts: [{ type: 'New Plan' }] }, { contracts: undefined },
    { salePrice: 0 }, { salePrice: '49.99' }, { salePrice: Infinity },
    { name: `${product.name} open-box` }, { name: `${product.name} + protection plan` },
    { name: `${product.name} members price` }, { name: `${product.name} with activation` },
    { name: `${product.name} 2-pack` }, { name: `${product.name} 2 count` }, { name: `${product.name} x 2` },
  ];
  for (const override of rejected) expect(offerFromBestBuy({ ...product, ...override }, identity, 'gtin', at)).toBeNull();
});

test('returned UPC, brand, model and variant must not contradict the requested item', () => {
  for (const override of [
    { upc: null }, { upc: 'not-a-barcode' }, { upc: '036000291452' }, { manufacturer: 'Remington' },
    { modelNumber: 'X5004/84' }, { color: 'Silver' }, { manufacturer: 123 }, { modelNumber: 'Not a model code' },
  ]) expect(offerFromBestBuy({ ...product, ...override }, identity, 'gtin', at)).toBeNull();
  // Shared UPC-suffix exception applies only with explicit compatible brands.
  expect(offerFromBestBuy({ ...product, modelNumber: 'MG5965/49B' }, identity, 'gtin', at)).not.toBeNull();
  expect(offerFromBestBuy({ ...product, modelNumber: 'MG5965/49B', manufacturer: null }, identity, 'gtin', at)).toBeNull();
  // A model-only result does not inherit the shopper's UPC.
  const byModel = offerFromBestBuy({ ...product, upc: null }, identity, 'model', at)!;
  expect(byModel.product.gtin).toBeNull();
  expect(offerFromBestBuy({ ...product, upc: null, modelNumber: 'MG5965/49B' }, identity, 'model', at)).toBeNull();
  expect(offerFromBestBuy({ ...product, upc: null, manufacturer: null }, identity, 'model', at)).toBeNull();
});

test('only genuine Best Buy product paths are accepted; tracking and cart endpoints are refused', () => {
  for (const url of [
    'https://api.bestbuy.com/click/-/6543210/cart', 'https://example.com/site/item/6543210.p',
    'https://www.bestbuy.com.evil.test/site/item/6543210.p', 'https://www.bestbuy.com/site/searchpage.jsp',
    'https://www.bestbuy.com/cart', 'https://www.bestbuy.com/site/item/7654321.p',
    'https://www.bestbuy.com/site/item/6543210.p?skuId=7654321',
    'https://user:password@www.bestbuy.com/site/item/6543210.p', 'http://www.bestbuy.com/site/item/6543210.p',
  ]) expect(offerFromBestBuy({ ...product, url }, identity, 'gtin', at)).toBeNull();
});

test('lookup prefers barcode, uses real returned identity, and never sends page or shopper information', async () => {
  const urls: URL[] = [];
  const abort = signal();
  const source = bestBuySource({ apiKey: 'test-key', now: () => at, fetch: mockFetch(async (url, init) => {
    urls.push(url);
    expect(url.origin).toBe('https://api.bestbuy.com');
    expect(url.pathname).toContain('upc=075020114105');
    expect(url.pathname).not.toContain('modelNumber');
    expect(url.searchParams.get('apiKey')).toBe('test-key');
    expect(url.searchParams.get('pageSize')).toBe('50');
    expect(url.searchParams.get('show')).not.toContain('affiliate');
    expect(init?.signal).toBe(abort);
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
    expect(init?.body).toBeUndefined();
    return response([product], { canonicalUrl: 'secret-url-test-key' });
  }) });
  const offers = await source.search(identity, abort);
  expect(urls).toHaveLength(1);
  expect(offers).toHaveLength(1);
  expect(JSON.stringify(offers)).not.toContain('test-key');
});

test('empty or rejected barcode results get at most one exact-model fallback', async () => {
  const urls: URL[] = [];
  const source = bestBuySource({ apiKey: 'test-key', now: () => at, fetch: mockFetch(async (url) => {
    urls.push(url);
    return response(urls.length === 1 ? [{ ...product, upc: null }] : [product, { ...product, manufacturer: 'Other' }]);
  }) });
  expect(await source.search(identity, signal())).toHaveLength(1);
  expect(urls).toHaveLength(2);
  expect(decodeURIComponent(urls[1]!.pathname)).toContain('modelNumber="MG5965/49"');
  expect([...urls[1]!.searchParams.keys()].sort()).toEqual(['apiKey', 'format', 'page', 'pageSize', 'show']);
});

test('model fallback requires a brand and a valid model; unsafe input never becomes a query expression', async () => {
  let calls = 0;
  const source = bestBuySource({ apiKey: 'test-key', now: () => at, fetch: mockFetch(async () => { calls++; return response([]); }) });
  for (const requested of [
    { ...identity, condition: 'used' as const },
    { ...identity, gtin: null, brand: null },
    { ...identity, gtin: null, model: 'AB12&active=false' },
  ]) expect(await source.search(requested, signal())).toEqual([]);
  expect(calls).toBe(0);
});

test('provider, parsing and network errors expose no credential or response body', async () => {
  const key = 'test-secret-in-exception';
  const failures = [
    async () => new Response(key, { status: 403 }),
    async () => new Response(key, { status: 500 }),
    async () => new Response(key),
    async () => Response.json({ message: key }),
    async () => response([product], { partial: true }),
    async () => response(Array.from({ length: 51 }, () => product)),
    async () => { throw new Error(`request failed at https://api.bestbuy.com/?apiKey=${key}`); },
  ];
  for (const fail of failures) {
    const source = bestBuySource({ apiKey: key, fetch: mockFetch(fail) });
    await expect(source.search(identity, signal())).rejects.toThrow('Best Buy product lookup unavailable.');
    try { await source.search(identity, signal()); } catch (error) {
      expect(String(error)).not.toContain(key);
      expect((error as Error).cause).toBeUndefined();
    }
  }
});

test('cancellation is unavailable coverage, never a successful empty comparison', async () => {
  const source = bestBuySource({ apiKey: 'test-key', fetch: mockFetch(async (_url, init) => {
    return await new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('canceled')), { once: true }));
  }) });
  const service = createOfferService({ sources: [source], timeoutMs: 10, now: () => at });
  const result = await service.offers(identity, 'www.amazon.com');
  expect(result.offers).toEqual([]);
  expect(result.coverage).toEqual([{ source: 'bestbuy_api', status: 'unavailable', offers: 0 }]);
});

test('existing offer service caches Best Buy, excludes the current merchant and expires evidence', async () => {
  let calls = 0;
  let current = at;
  const source = bestBuySource({ apiKey: 'test-key', now: () => current, fetch: mockFetch(async () => { calls++; return response([product]); }) });
  const service = createOfferService({ sources: [source], now: () => current });
  expect((await service.offers(identity, 'www.amazon.com')).offers).toHaveLength(1);
  expect((await service.offers(identity, 'www.bestbuy.com')).offers).toEqual([]);
  expect(calls).toBe(1);
  current = new Date(at.getTime() + 16 * 60_000);
  expect((await service.offers(identity, 'www.amazon.com')).offers[0]!.observedAt).toBe(current.toISOString());
  expect(calls).toBe(2);
});

test('Best Buy is optional and server-configured without changing eBay configuration', () => {
  expect(apiSources({}).unconfigured).toEqual(['ebay_api', 'bestbuy_api']);
  expect(apiSources({ BESTBUY_API_KEY: '   ' }).sources).toEqual([]);
  const configured = apiSources({ BESTBUY_API_KEY: 'test-key' });
  expect(configured.sources.map((source) => source.name)).toEqual(['bestbuy_api']);
  expect(configured.unconfigured).toEqual(['ebay_api']);
});
