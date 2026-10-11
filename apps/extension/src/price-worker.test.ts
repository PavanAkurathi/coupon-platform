import { expect, test } from 'bun:test';
import type { PriceOffer } from '@repo/shared';
import { newestPerListing } from './price-worker';

const offer = (priceCents: number, observedAt: string, source: PriceOffer['source']): PriceOffer => ({
  id: `${source}:${priceCents}`, product: { brand: 'Philips Norelco', model: 'MG9575/49', gtin: null, variant: null, packQuantity: 1, condition: 'new' },
  title: 'Philips Norelco All-in-One 9000', merchant: 'Amazon', merchantDomain: 'www.amazon.com', seller: null,
  url: 'https://www.amazon.com/dp/B0G22WX3YR', priceCents, shippingCents: 0, currency: 'USD', availability: 'in_stock',
  requiresMembership: false, requiresCoupon: false, observedAt, expiresAt: '2026-10-09T23:00:00.000Z', source, evidenceRef: 'test',
});

test("the shopper's newer signed-in view replaces an older anonymous check of the same listing", () => {
  // October 9: a signed-out live check saw $96.49; the founder's own Amazon page showed $96.99.
  const live = offer(9649, '2026-10-09T14:15:00.000Z', 'live_check');
  const seen = offer(9699, '2026-10-09T14:16:00.000Z', 'seen_by_you');
  expect(newestPerListing([live, seen]).map((item) => item.priceCents)).toEqual([9699]);
  expect(newestPerListing([seen, live]).map((item) => item.priceCents)).toEqual([9699]);
  // Different listings are all kept.
  const other = { ...live, url: 'https://www.amazon.com/dp/B0G22HZTT9' };
  expect(newestPerListing([live, seen, other])).toHaveLength(2);
});
