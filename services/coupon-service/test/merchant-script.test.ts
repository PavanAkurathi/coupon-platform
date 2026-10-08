import { expect, test } from 'bun:test';
import { exactHostname } from '../src/scripts/merchant';

test('merchant domains must be the exact store hostname the extension matches', () => {
  expect(exactHostname(' WWW.Example.com ')).toBe('www.example.com');
  expect(exactHostname('shop.example.co.uk')).toBe('shop.example.co.uk');
  for (const raw of ['https://www.example.com', 'www.example.com/cart', 'www.example.com:443', '*.myshopify.com', 'localhost', 'example', '-bad.example.com', 'a..b.com']) {
    expect(() => exactHostname(raw)).toThrow();
  }
});
