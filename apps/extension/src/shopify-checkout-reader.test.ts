import { expect, test } from 'bun:test';
import { parseShopifyMoney } from './shopify-checkout-reader';

test('observed Shopify money lines parse to signed USD cents', () => {
  expect(parseShopifyMoney('$19.00')).toBe(1900);
  expect(parseShopifyMoney('USD $28.17')).toBe(2817);
  expect(parseShopifyMoney('USD  $1,234.56')).toBe(123456);
  expect(parseShopifyMoney('-$5.00')).toBe(-500);
  expect(parseShopifyMoney('−$5.00')).toBe(-500);
});

test('other currencies, estimates and prose never become amounts', () => {
  for (const raw of ['CAD $28.17', '€28.17', '$28.1', '28.17', 'Enter shipping address', 'Free', '$28.17 $1.00', 'USD', '$1000001.00']) {
    expect(parseShopifyMoney(raw)).toBeNull();
  }
});
