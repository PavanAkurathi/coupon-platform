import { describe, expect, test } from 'bun:test';
import { amazonFocusRequestSchema, amazonInspectionSchema, amazonProductAsin } from './amazon';

describe('Amazon product boundary', () => {
  test('accepts observed product routes without altering creator URLs', () => {
    for (const path of ['/dp/B097S1MF28', '/SweatBlock-Face-Wipes/dp/B097S1MF28/ref=abc?tag=creator-20', '/gp/product/B097S1MF28?th=1']) {
      expect(amazonProductAsin(`https://www.amazon.com${path}`)).toBe('B097S1MF28');
    }
  });
  test('rejects lookalike hosts, credentials, non-product and non-US routes', () => {
    for (const url of [undefined, 'https://www.amazon.com.evil.test/dp/B097S1MF28', 'https://amazon.com/dp/B097S1MF28',
      'http://www.amazon.com/dp/B097S1MF28', 'https://www.amazon.co.uk/dp/B097S1MF28',
      'https://user@www.amazon.com/dp/B097S1MF28', 'https://www.amazon.com:444/dp/B097S1MF28',
      'https://www.amazon.com/gp/cart/view.html', 'https://www.amazon.com/checkout',
      'https://www.amazon.com/dp/B097S1MF28FAKE', 'https://www.amazon.com/s?k=B097S1MF28']) {
      expect(amazonProductAsin(url)).toBeNull();
    }
  });
});

test('offer contracts prohibit stale offers in empty states and unbound products', () => {
  const value = {site:'amazon-us', status:'offers_found', asin:'B097S1MF28', productTitle:'Fixture product',
    observedAt:'2026-10-07T12:00:00.000Z', fingerprint:'abc', reason:'Observed offer', offers:[{
      id:'coupon-0', kind:'native_coupon', label:'Coupon price $15.99', advertisedPriceCents:1599,
      state:'available', purchaseRequirement:'unknown', terms:['Limit 1 item.'],
    }]};
  expect(amazonInspectionSchema.safeParse(value).success).toBe(true);
  expect(amazonInspectionSchema.safeParse({...value, status:'no_offer'}).success).toBe(false);
  expect(amazonInspectionSchema.safeParse({...value, asin:null}).success).toBe(false);
  expect(amazonInspectionSchema.safeParse({...value, savingsCents:400}).success).toBe(false);
  expect(amazonInspectionSchema.safeParse({...value, offers:[{...value.offers[0], confirmations:3}]}).success).toBe(false);
});

test('focus messages cannot smuggle an activation or a purchase request', () => {
  const value = {type:'amazon-focus', asin:'B097S1MF28', offerId:'coupon-0', fingerprint:'abc', observedAt:'2026-10-07T12:00:00.000Z'};
  expect(amazonFocusRequestSchema.safeParse(value).success).toBe(true);
  expect(amazonFocusRequestSchema.safeParse({...value, click:true}).success).toBe(false);
  expect(amazonFocusRequestSchema.safeParse({...value, type:'purchase'}).success).toBe(false);
});
