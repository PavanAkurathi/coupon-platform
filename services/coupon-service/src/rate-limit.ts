import Redis from 'ioredis';
import type { RateLimiter } from './domain';

const consume = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

export function connectRateLimiter(url = process.env.REDIS_URL) {
  if (!url) throw new Error('REDIS_URL is required');
  const client = new Redis(url, {
    connectTimeout: 2000,
    commandTimeout: 2000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 250, 2000),
  });
  client.on('error', () => { /* Requests return 503 while Redis is unavailable. */ });
  const limiter: RateLimiter = {
    async allow(key, limit, seconds) {
      const count = Number(await client.eval(consume, 1, `coupon:limit:${key}`, seconds));
      return count <= limit;
    },
    async ping() { await client.ping(); },
  };
  return { client, limiter };
}
