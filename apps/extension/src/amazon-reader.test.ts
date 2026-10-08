import { expect, test } from 'bun:test';
import { parseDisplayedUsd } from './amazon-reader';

test('displayed coupon prices use exact USD cents and reject ambiguous amounts', () => {
  expect(parseDisplayedUsd('$15.99')).toBe(1599);
  expect(parseDisplayedUsd('$1,234.56')).toBe(123456);
  for (const amount of ['$15.9', '$15', '15.99', '£15.99', '$15.99 / count', '$1.234,56', '$0.00', '$-1.00', '$15.99 $4.00', '$1000001.00']) {
    expect(parseDisplayedUsd(amount)).toBeNull();
  }
});
