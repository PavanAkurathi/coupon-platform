import { expect, test } from 'bun:test';
import type { ProductIdentity } from '@repo/shared';
import { notTheSameItem } from './store-lookups';

// Why a live check set a store page aside, as logged in the worker console.
// Identities observed October 10, 2026 (coverage products #12 and #18).
test('the log names the fact that differs', () => {
  const walmartLodge: ProductIdentity = { brand: 'Lodge', model: 'L8SK3', gtin: '00075536300801', variant: null, packQuantity: 1, condition: 'new' };
  expect(notTheSameItem(walmartLodge, { ...walmartLodge, model: 'L8SK3PLT' })).toBe('model L8SK3PLT, not L8SK3');
  const ebayAirPods: ProductIdentity = { brand: 'Apple', model: 'MXP93LL/A', gtin: '00195949689604', variant: 'White', packQuantity: 1, condition: 'new' };
  expect(notTheSameItem(ebayAirPods, { ...ebayAirPods, gtin: null, variant: null, condition: 'used' })).toBe('condition used, not new');
  expect(notTheSameItem(ebayAirPods, { ...ebayAirPods, condition: 'refurbished' })).toBe('condition refurbished, not new');
});
