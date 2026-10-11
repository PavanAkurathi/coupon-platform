import { expect, test } from 'bun:test';
import { clientAddress, clientIpConfig } from '../src/client-ip';

const headers = (values: Record<string, string>) => new Headers(values);

test('without a configured header, forwarding headers are ignored', () => {
  const config = clientIpConfig({});
  expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.9' }), '10.0.0.2', config)).toBe('10.0.0.2');
});

test('a configured single-value proxy header identifies each shopper', () => {
  const config = clientIpConfig({ CLIENT_IP_HEADER: 'Fly-Client-IP' });
  expect(clientAddress(headers({ 'fly-client-ip': '203.0.113.9' }), '10.0.0.2', config)).toBe('203.0.113.9');
  expect(clientAddress(headers({ 'fly-client-ip': '2001:db8::1' }), '10.0.0.2', config)).toBe('2001:db8::1');
});

test('forwarded lists use the entry added by the trusted proxy, not a forged prefix', () => {
  const one = clientIpConfig({ CLIENT_IP_HEADER: 'x-forwarded-for' });
  expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.9' }), '10.0.0.2', one)).toBe('203.0.113.9');
  expect(clientAddress(headers({ 'x-forwarded-for': '198.51.100.7, 203.0.113.9' }), '10.0.0.2', one)).toBe('203.0.113.9');
  const two = clientIpConfig({ CLIENT_IP_HEADER: 'x-forwarded-for', TRUSTED_PROXY_HOPS: '2' });
  expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.9' }), '10.0.0.2', two)).toBe('203.0.113.9');
  expect(clientAddress(headers({ 'x-forwarded-for': '198.51.100.7, 203.0.113.9, 10.0.0.9' }), '10.0.0.2', two)).toBe('203.0.113.9');
});

test('a forwarded chain shorter than the configured proxy depth is not trusted', () => {
  const config = clientIpConfig({ CLIENT_IP_HEADER: 'x-forwarded-for', TRUSTED_PROXY_HOPS: '2' });
  const shortChain = headers({ 'x-forwarded-for': '203.0.113.9' });
  expect(clientAddress(shortChain, '10.0.0.2', config)).toBe('10.0.0.2');
  expect(clientAddress(shortChain, undefined, config)).toBeUndefined();
});

test('missing or malformed header values fall back to the socket address', () => {
  const config = clientIpConfig({ CLIENT_IP_HEADER: 'x-forwarded-for' });
  expect(clientAddress(headers({}), '10.0.0.2', config)).toBe('10.0.0.2');
  expect(clientAddress(headers({ 'x-forwarded-for': 'not-an-ip' }), '10.0.0.2', config)).toBe('10.0.0.2');
  expect(clientAddress(headers({ 'x-forwarded-for': '203.0.113.9, ' }), '10.0.0.2', config)).toBe('10.0.0.2');
});

test('invalid configuration fails at startup', () => {
  expect(() => clientIpConfig({ CLIENT_IP_HEADER: 'x-forwarded-for, cf-connecting-ip' })).toThrow();
  expect(() => clientIpConfig({ CLIENT_IP_HEADER: 'x-forwarded-for', TRUSTED_PROXY_HOPS: '0' })).toThrow();
});
