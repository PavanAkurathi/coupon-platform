import { describe, expect, test } from 'bun:test';
import { isShopifyCheckout, shopifyCheckoutInspectionSchema } from './shopify';

const enabled = ['mvmt.com', 'www.allbirds.com'];
describe('Shopify checkout boundary', () => {
  test('accepts the observed route only on an exact enabled host', () => {
    expect(isShopifyCheckout('https://mvmt.com/checkouts/cn/hWN4abcDEF123xyz/en-us', enabled)).toBe(true);
    expect(isShopifyCheckout('https://www.allbirds.com/checkouts/cn/hWN4abcDEF123xyz', enabled)).toBe(true);
    expect(isShopifyCheckout('https://www.allbirds.com/checkouts/cn/hWN4abcDEF123xyz/en-us?tag=creator', enabled)).toBe(true);
  });
  test('rejects unknown, lookalike, insecure and non-checkout routes', () => {
    for (const url of [undefined, 'https://www.mvmt.com/checkouts/cn/hWN4abcDEF123xyz', 'https://mvmt.com.evil.test/checkouts/cn/hWN4abcDEF123xyz',
      'http://mvmt.com/checkouts/cn/hWN4abcDEF123xyz', 'https://user@mvmt.com/checkouts/cn/hWN4abcDEF123xyz', 'https://mvmt.com:8443/checkouts/cn/hWN4abcDEF123xyz',
      'https://mvmt.com/cart', 'https://mvmt.com/checkouts/cn/', 'https://mvmt.com/checkouts/cn/abc/thank-you', 'https://other.myshopify.com/checkouts/cn/hWN4abcDEF123xyz']) {
      expect(isShopifyCheckout(url, enabled)).toBe(false);
    }
    expect(isShopifyCheckout('https://mvmt.com/checkouts/cn/hWN4abcDEF123xyz', [])).toBe(false);
  });
  test('observations carry amounts only and never stale ones', () => {
    const ready = {platform:'shopify', status:'ready', observedAt:'2026-10-08T14:00:00.000Z', subtotalCents:2500, discountCents:0,
      totalCents:2817, totalIsEstimate:true, discountField:'available', codeRejected:false, reason:'Order summary read.'};
    expect(shopifyCheckoutInspectionSchema.safeParse(ready).success).toBe(true);
    expect(shopifyCheckoutInspectionSchema.safeParse({...ready, totalCents:null}).success).toBe(false);
    expect(shopifyCheckoutInspectionSchema.safeParse({...ready, status:'unavailable'}).success).toBe(false);
    expect(shopifyCheckoutInspectionSchema.safeParse({...ready, checkoutToken:'hWN4'}).success).toBe(false);
    expect(shopifyCheckoutInspectionSchema.safeParse({...ready, email:'a@b.c'}).success).toBe(false);
  });
});
