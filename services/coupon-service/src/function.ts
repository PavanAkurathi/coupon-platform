import { createApp } from './app';
import { connectDatabase } from './db/client';
import { createCouponStore } from './db/store';
import { createPostgresRateLimiter } from './rate-limit-postgres';
import { clientAddress, clientIpConfig } from './client-ip';
import { evidenceWindowDays } from './domain';

// Neon Functions entry (Node.js runtime, web-standard fetch handler). Neon injects
// DATABASE_URL for the branch; there is no Redis, so limits live in Postgres.
// Neon documents no client-address header: unless CLIENT_IP_HEADER names one set
// by a trusted proxy in front (for example a Cloudflare Worker), anonymous limits
// share one bucket and per-shopper report limits key on the verified token.
const ipConfig = clientIpConfig();
const database = connectDatabase();
const app = createApp({
  store: createCouponStore(database.db, { evidenceWindowDays: evidenceWindowDays() }),
  limiter: createPostgresRateLimiter(database.db),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  anonymousPerMinute: anonymousLimit(process.env.ANON_RATE_LIMIT_PER_MINUTE),
});

function anonymousLimit(raw: string | undefined): number {
  if (!raw?.trim()) return ipConfig.header ? 120 : 600;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 10 || limit > 100_000) throw new Error('ANON_RATE_LIMIT_PER_MINUTE must be a whole number from 10 to 100000.');
  return limit;
}

export default {
  fetch: (request: Request) => app.fetch(request, { clientAddress: clientAddress(request.headers, undefined, ipConfig) }),
};
