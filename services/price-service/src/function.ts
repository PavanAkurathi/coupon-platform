import { createApp } from './app';
import { createOfferService } from './offers';
import { apiSources, corsOrigins } from './sources';

// Neon Functions entry (Node.js runtime, web-standard fetch handler), deployed next
// to `couponapi` on project coupon-beta. No database: offers are cached in memory
// per instance. Neon documents no client-address header, so the limiter shares one
// anonymous bucket (PRICE_RATE_LIMIT_PER_MINUTE, default 600) until a trusted
// proxy in front supplies one.
const { sources, unconfigured } = apiSources(process.env);
const app = createApp({
  service: createOfferService({ sources, unconfigured }),
  corsOrigins: corsOrigins(process.env.CORS_ORIGINS),
  perMinute: limit(process.env.PRICE_RATE_LIMIT_PER_MINUTE),
});

function limit(raw: string | undefined): number {
  if (!raw?.trim()) return 600;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 10 || value > 100_000) throw new Error('PRICE_RATE_LIMIT_PER_MINUTE must be a whole number from 10 to 100000.');
  return value;
}

export default { fetch: (request: Request) => app.fetch(request, { clientAddress: undefined }) };
