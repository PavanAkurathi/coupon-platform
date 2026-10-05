import { createApp } from './app';
import { connectDatabase } from './db/client';
import { createCouponStore } from './db/store';
import { connectRateLimiter } from './rate-limit';

const database = connectDatabase();
const redis = connectRateLimiter();
const app = createApp({
  store: createCouponStore(database.db),
  limiter: redis.limiter,
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
});
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3001),
  hostname: '0.0.0.0',
  fetch: (request, server) => app.fetch(request, { clientAddress: server.requestIP(request)?.address }),
});
console.info(`coupon-service listening on ${server.port}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  redis.client.disconnect();
  await database.client.end({ timeout: 3 });
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
