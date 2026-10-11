import { expect, test } from 'bun:test';
import type { PageProduct, PriceOffer } from '@repo/shared';
import { inHolidayBlackout, MATCH_POLICIES, matchTip } from './price-match';

const identity = { brand: 'Philips Norelco', model: 'MG9575/49', gtin: null, variant: null, packQuantity: 1, condition: 'new' as const };
const here = (merchantDomain: string, seller: string | null = null): PageProduct => ({
  identity, title: 'Philips Norelco All-in-One 9000', merchant: 'Store', merchantDomain, seller, url: `https://${merchantDomain}/p/1`,
  priceCents: 9699, shippingCents: null, currency: 'USD', availability: 'in_stock', observedAt: '2026-10-10T15:00:00.000Z', reader: 'json-ld',
});
const offer = (merchantDomain: string, seller: string | null, changes: Partial<PriceOffer> = {}): PriceOffer => ({
  id: `live:${merchantDomain}`, product: identity, title: 'Philips Norelco All-in-One 9000', merchant: merchantDomain.includes('amazon') ? 'Amazon' : 'Walmart',
  merchantDomain, seller, url: `https://${merchantDomain}/dp/1`, priceCents: 8900, shippingCents: 0, currency: 'USD', availability: 'in_stock',
  requiresMembership: false, requiresCoupon: false, observedAt: '2026-10-10T15:00:00.000Z', expiresAt: '2026-10-10T15:15:00.000Z', source: 'live_check', evidenceRef: 'test',
  ...changes,
});
// Every store on, so each policy is exercised whether or not it has been seen live yet.
const allOn = Object.fromEntries(Object.entries(MATCH_POLICIES).map(([host, policy]) => [host, { ...policy, live: true }]));
const october = new Date(2026, 9, 10, 12);

test('Best Buy gets a tip for a cheaper item sold by Amazon.com or Walmart.com itself', () => {
  const amazon = matchTip(here('www.bestbuy.com', 'Best Buy'), offer('www.amazon.com', 'Amazon.com'), october, allOn);
  expect(amazon?.text).toBe('Best Buy says it matches Amazon for items sold by Amazon.com. Ask Best Buy in chat, by phone or in store before you buy, and share the Amazon link. Daily deals and member prices don\'t count. Best Buy decides.');
  expect(amazon?.url).toStartWith('https://www.bestbuy.com/');
  expect(amazon?.checked).toBe('Best Buy policy checked Oct 10, 2026');
  expect(matchTip(here('www.bestbuy.com'), offer('www.walmart.com', 'Walmart.com'), october, allOn)?.text).toContain('share the Walmart link');
});

test('no tip for marketplace sellers, unknown sellers or stores outside the policy', () => {
  expect(matchTip(here('www.bestbuy.com'), offer('www.walmart.com', 'AYCM PRODUCT INC'), october, allOn)).toBeNull();
  expect(matchTip(here('www.bestbuy.com'), offer('www.amazon.com', null), october, allOn)).toBeNull();
  expect(matchTip(here('www.bestbuy.com'), offer('www.ebay.com', 'Amazon.com'), october, allOn)).toBeNull();
  // Lowe's names Amazon only.
  expect(matchTip(here('www.lowes.com'), offer('www.walmart.com', 'Walmart.com'), october, allOn)).toBeNull();
  expect(matchTip(here('www.lowes.com'), offer('www.amazon.com', 'Amazon.com'), october, allOn)).not.toBeNull();
  // Neither Amazon nor Walmart matches other stores.
  expect(matchTip(here('www.amazon.com'), offer('www.walmart.com', 'Walmart.com'), october, allOn)).toBeNull();
  expect(matchTip(here('www.target.com'), offer('www.amazon.com', 'Amazon.com'), october, allOn)).toBeNull();
});

test('no tip when this page is another seller on the current store', () => {
  expect(matchTip(here('www.bestbuy.com', 'Gadget Outlet LLC'), offer('www.amazon.com', 'Amazon.com'), october, allOn)).toBeNull();
  expect(matchTip(here('www.homedepot.com', 'The Home Depot'), offer('www.amazon.com', 'Amazon.com'), october, allOn)).not.toBeNull();
});

test('no tip unless the offer is new, in stock, free to ship and needs no membership or coupon', () => {
  const page = here('www.bestbuy.com');
  for (const changes of [{ shippingCents: 599 }, { shippingCents: null }, { availability: 'unknown' as const }, { requiresMembership: true }, { requiresCoupon: true },
    { product: { ...identity, condition: 'refurbished' as const } }]) {
    expect(matchTip(page, offer('www.amazon.com', 'Amazon.com', changes), october, allOn)).toBeNull();
  }
});

test('stores stay off until a tip has been seen on their live site', () => {
  const off = Object.fromEntries(Object.entries(MATCH_POLICIES).map(([host, policy]) => [host, { ...policy, live: false }]));
  expect(matchTip(here('www.bestbuy.com'), offer('www.amazon.com', 'Amazon.com'), october, off)).toBeNull();
});

test('no tips from the Thursday before Thanksgiving through the Monday after', () => {
  // Thanksgiving 2026 is November 26; 2027 is November 25.
  expect(inHolidayBlackout(new Date(2026, 10, 18, 23, 59))).toBe(false);
  expect(inHolidayBlackout(new Date(2026, 10, 19, 0, 0))).toBe(true);
  expect(inHolidayBlackout(new Date(2026, 10, 30, 23, 59))).toBe(true);
  expect(inHolidayBlackout(new Date(2026, 11, 1, 0, 0))).toBe(false);
  expect(inHolidayBlackout(new Date(2027, 10, 18, 12))).toBe(true);
  expect(matchTip(here('www.bestbuy.com'), offer('www.amazon.com', 'Amazon.com'), new Date(2026, 10, 27, 12), allOn)).toBeNull();
});
