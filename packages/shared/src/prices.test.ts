import { expect, test } from 'bun:test';
import {
  brandsCompatible, cleanProductUrl, compareOffers, normalizeGtin, normalizeModel, offerFromPage,
  pageProductSchema, priceComparisonSchema, priceOfferSchema, productIdentityKey, sameProduct, type PageProduct, type PriceOffer,
} from './prices';

const now = new Date('2026-10-08T23:30:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
// Values observed live on October 8, 2026 for the Philips Norelco MG5965/49.
const amazon: PageProduct = pageProductSchema.parse({
  identity: {brand: 'Norelco', model: 'MG5965/49', gtin: null, variant: 'Black', packQuantity: 1, condition: 'new'},
  title: 'Philips Norelco All-in-One 5000 19-in-1 Trimmer, Face, Hair & Body, Black', merchant: 'Amazon',
  merchantDomain: 'www.amazon.com', seller: 'Amazon.com', url: 'https://www.amazon.com/dp/B0GYK61CBH',
  priceCents: 3996, shippingCents: 0, currency: 'USD', availability: 'in_stock', observedAt: minutesAgo(1), reader: 'amazon',
});
const walmart: PageProduct = pageProductSchema.parse({
  ...amazon, identity: {brand: 'Philips Norelco', model: 'MG5965/49', gtin: '075020114105', variant: 'Black', packQuantity: 1, condition: 'new'},
  merchant: 'Walmart', merchantDomain: 'www.walmart.com', seller: 'Walmart.com', reader: 'walmart',
  url: 'https://www.walmart.com/ip/Philips-Norelco-All-In-One-5000-MG5965-49/15450154953', priceCents: 4996, shippingCents: null,
});
const ebay: PageProduct = pageProductSchema.parse({
  ...amazon, identity: {brand: 'Philips Norelco', model: 'MG5965/49', gtin: '0075020114105', variant: 'Black', packQuantity: 1, condition: 'new'},
  merchant: 'eBay', merchantDomain: 'www.ebay.com', seller: null, reader: 'json-ld',
  url: 'https://www.ebay.com/itm/318944076250', priceCents: 3827, shippingCents: 0, observedAt: minutesAgo(5),
});
const checked = [{source: 'seen_by_you' as const, status: 'checked' as const, offers: 1}];

test('GTINs normalize to 14 digits and need a valid check digit', () => {
  expect(normalizeGtin('075020114105')).toBe('00075020114105');
  expect(normalizeGtin('0075020114105')).toBe('00075020114105');
  for (const bad of ['075020114106', '12345', '0000000000000', 'abc075020114105', '']) expect(normalizeGtin(bad)).toBeNull();
});

test('model codes are exact; marketing names are rejected', () => {
  expect(normalizeModel('MG5965/49')).toBe('MG5965/49');
  expect(normalizeModel('x5004-84')).toBe('X500484');
  for (const bad of ['Philips Norelco All In One 5000', 'Black', '5000 Series', '', 'AB1']) expect(normalizeModel(bad)).toBeNull();
});

test('brands match by contained words only', () => {
  expect(brandsCompatible('Norelco', 'Philips Norelco')).toBe(true);
  expect(brandsCompatible('Philips Norelco', 'PHILIPS')).toBe(true);
  expect(brandsCompatible('Philips', 'Remington')).toBe(false);
  expect(brandsCompatible(null, 'Philips')).toBe(false);
});

test('product URLs lose tracking and affiliate parameters', () => {
  expect(cleanProductUrl('https://www.amazon.com/dp/B0GYK61CBH?tag=someone-20&th=1#x')).toBe('https://www.amazon.com/dp/B0GYK61CBH');
  expect(cleanProductUrl('https://shop.example.com/products/a?variant=42&utm_source=x')).toBe('https://shop.example.com/products/a?variant=42');
  for (const bad of ['http://www.ebay.com/itm/1', 'https://user:pw@ebay.com/itm/1', 'https://localhost/x', 'https://ebay.com:8443/x']) {
    expect(cleanProductUrl(bad)).toBeNull();
  }
});

test('the same trimmer matches across Amazon, eBay and Walmart', () => {
  expect(sameProduct(amazon.identity, ebay.identity)).toBe(true); // brand + model
  expect(sameProduct(walmart.identity, ebay.identity)).toBe(true); // GTIN
  expect(sameProduct(amazon.identity, walmart.identity)).toBe(true);
  expect(sameProduct(amazon.identity, {...ebay.identity, condition: 'used'})).toBe(false);
  expect(sameProduct(amazon.identity, {...ebay.identity, gtin: null, model: 'MG5965/50'})).toBe(false);
  expect(sameProduct(amazon.identity, {...ebay.identity, packQuantity: 2})).toBe(false);
  expect(sameProduct(amazon.identity, {...ebay.identity, variant: 'Silver'})).toBe(false);
  expect(sameProduct(walmart.identity, {...ebay.identity, gtin: '00075020114112'})).toBe(false);
  expect(sameProduct(walmart.identity, {...ebay.identity, model: 'MG3740'})).toBe(false);
  expect(sameProduct(walmart.identity, {...ebay.identity, brand: 'Remington'})).toBe(false);
  // Stores often omit or rename colours; the exact model code decides when only one side states one
  // (October 9: Best Buy says "Silver" for MG9575/49, Amazon's listing has no colour field).
  expect(sameProduct(amazon.identity, {...ebay.identity, variant: null})).toBe(true);
  expect(sameProduct({...amazon.identity, variant: 'Matte Black'}, ebay.identity)).toBe(true);
  expect(sameProduct({...amazon.identity, variant: 'Steel'}, {...ebay.identity, variant: 'Silver'})).toBe(false);
  expect(sameProduct(walmart.identity, {...ebay.identity, variant: null})).toBe(true); // equal GTIN proves the variant
});

test('identity cache keys include brand and variant, retaining meaningful model punctuation', () => {
  const identity = amazon.identity;
  expect(productIdentityKey(identity)).not.toBe(productIdentityKey({...identity, brand: 'Remington'}));
  expect(productIdentityKey(identity)).not.toBe(productIdentityKey({...identity, variant: 'White'}));
  expect(productIdentityKey(identity)).not.toBe(productIdentityKey({...identity, model: 'MG596549'}));
  expect(productIdentityKey(identity)).toBe(productIdentityKey({...identity, brand: 'NORELCO', variant: 'black'}));
});

test('a cheaper exact match on another store is a better offer', () => {
  const result = priceComparisonSchema.parse(compareOffers(amazon, [offerFromPage(ebay)], {now, coverage: checked}));
  expect(result.status).toBe('better_offer');
  expect(result.savingsCents).toBe(169);
  expect(result.bestOffer?.merchant).toBe('eBay');
  const fromWalmart = compareOffers(walmart, [offerFromPage(amazon), offerFromPage(ebay)], {now, coverage: checked});
  expect(fromWalmart.bestOffer?.merchant).toBe('eBay');
  expect(fromWalmart.savingsCents).toBe(1169);
});

test('comparisons fail closed', () => {
  const offer = offerFromPage(ebay);
  const cases: [string, PriceOffer[]][] = [
    ['unknown shipping', [{...offer, shippingCents: null}]],
    ['same store', [{...offer, merchantDomain: 'www.amazon.com', url: 'https://www.amazon.com/dp/B000000000'}]],
    ['out of stock', [{...offer, availability: 'out_of_stock'}]],
    ['membership price', [{...offer, requiresMembership: true}]],
    ['stale', [{...offer, observedAt: minutesAgo(16)}]],
    ['future', [{...offer, observedAt: minutesAgo(-0.5)}]],
    ['expired', [{...offer, expiresAt: minutesAgo(1)}]],
    ['used', [{...offer, product: {...offer.product, condition: 'used'}}]],
  ];
  for (const [name, offers] of cases) {
    const result = compareOffers(amazon, offers, {now, coverage: checked});
    expect(`${name}:${result.status}`).toBe(`${name}:not_checked`);
    expect(result.savingsCents).toBe(0);
  }
  expect(compareOffers(amazon, [], {now}).status).toBe('not_checked');
  expect(compareOffers({...amazon, identity: {...amazon.identity, condition: 'unknown'}}, [offer], {now}).status).toBe('not_checked');
  // Shipping on the cheaper store counts against it.
  expect(compareOffers(amazon, [{...offer, shippingCents: 500}], {now, coverage: checked}).status).toBe('no_better_offer');
  // Savings under $1 are not worth interrupting a purchase.
  expect(compareOffers(amazon, [{...offer, priceCents: 3950}], {now, coverage: checked}).status).toBe('no_better_offer');
  expect(compareOffers(amazon, [{...offer, priceCents: 3950}], {now, coverage: checked}).reason).toContain('slightly cheaper');
  expect(compareOffers(amazon, [{...offer, priceCents: 3996}], {now, coverage: checked}).reason).toBe('No compared offer costs less than this page.');
  expect(compareOffers(amazon, [{...offer, observedAt: minutesAgo(16)}], {now, maxAgeMs: 12 * 60 * 60 * 1000}).status).toBe('not_checked');
  expect(compareOffers({...amazon, observedAt: minutesAgo(16)}, [offer], {now}).status).toBe('not_checked');
  expect(compareOffers({...amazon, observedAt: minutesAgo(-1)}, [offer], {now}).status).toBe('not_checked');
  expect(compareOffers(amazon, [{...offer, observedAt: minutesAgo(15)}], {now}).status).toBe('better_offer');
});

test('offers and comparisons reject inconsistent data', () => {
  const offer = offerFromPage(ebay);
  expect(priceOfferSchema.safeParse({...offer, url: 'https://www.evil.com/itm/1'}).success).toBe(false);
  expect(priceOfferSchema.safeParse({...offer, url: 'https://www.ebay.com/itm/1?campid=123'}).success).toBe(false);
  expect(priceComparisonSchema.safeParse({...compareOffers(amazon, [], {now}), savingsCents: 100}).success).toBe(false);
  expect(pageProductSchema.safeParse({...amazon, identity: {...amazon.identity, model: 'All In One', gtin: null}}).success).toBe(false);
});
