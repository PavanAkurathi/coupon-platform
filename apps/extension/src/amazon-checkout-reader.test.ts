import { expect, test } from 'bun:test';
import { parseSummaryUsd } from './amazon-checkout-reader';

test('order summary amounts use exact USD cents with the expected sign', () => {
  expect(parseSummaryUsd('$19.11', 'positive')).toBe(1911);
  expect(parseSummaryUsd('$1,234.56', 'positive')).toBe(123456);
  expect(parseSummaryUsd('$0.00', 'positive')).toBe(0);
  expect(parseSummaryUsd('-$2.00', 'negative')).toBe(200);
  expect(parseSummaryUsd('−$2.00', 'negative')).toBe(200);
  expect(parseSummaryUsd(' - $2.00 ', 'negative')).toBe(200);
});

test('ambiguous, unsigned or foreign amounts never become a saving or total', () => {
  for (const amount of ['$2.00', '2.00', '-2.00', '-$2', '-€2.00', '-$2.00 -$1.00', '($2.00)', '-$1.234,56']) {
    expect(parseSummaryUsd(amount, 'negative')).toBeNull();
  }
  for (const amount of ['-$19.11', '$19.1', '19.11', 'US$19.11', '£19.11', '$19.11 $4.00', '$1000001.00']) {
    expect(parseSummaryUsd(amount, 'positive')).toBeNull();
  }
});
