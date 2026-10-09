import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { errorResponseSchema, healthResponseSchema, priceOffersRequestSchema, priceOffersResponseSchema } from '@repo/shared';
import type { OfferService } from './offers';

type Env = { Bindings: { clientAddress?: string } };
const fail = (code: string, message: string) => errorResponseSchema.parse({ error: { code, message } });

// Fixed-window limiter per client address; enough for a single instance.
export function memoryLimiter(perMinute: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string) => {
    const now = Date.now();
    const current = windows.get(key);
    if (!current || now - current.start >= 60_000) {
      if (windows.size > 10_000) windows.clear();
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    return ++current.count <= perMinute;
  };
}

export function createApp({ service, corsOrigins = [], perMinute = 120 }: { service: OfferService; corsOrigins?: string[]; perMinute?: number }) {
  const app = new Hono<Env>();
  const allow = memoryLimiter(perMinute);
  app.use('*', secureHeaders());
  app.use('/v1/*', cors({
    origin: (origin) => /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/.test(origin) || corsOrigins.includes(origin) ? origin : undefined,
    allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 600,
  }));
  app.use('/v1/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.method !== 'OPTIONS' && !allow(c.env?.clientAddress ?? 'unknown')) {
      c.header('Retry-After', '60');
      return c.json(fail('RATE_LIMITED', 'Please try again in a minute.'), 429);
    }
    await next();
  });
  app.use('/v1/prices/offers', bodyLimit({ maxSize: 2048, onError: (c) => c.json(fail('BODY_TOO_LARGE', 'Request is too large.'), 413) }));
  app.get('/health', (c) => c.json(healthResponseSchema.parse({ service: 'price-service', status: 'ok', phase: 2 })));
  // Product identity only: no page URL, title, price or shopper data is accepted.
  app.post('/v1/prices/offers', async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json(fail('INVALID_JSON', 'Send a JSON body.'), 400); }
    const request = priceOffersRequestSchema.safeParse(body);
    if (!request.success) return c.json(fail('INVALID_REQUEST', 'A product needs a GTIN, or a brand and model code.'), 400);
    if (request.data.identity.condition !== 'new') return c.json(priceOffersResponseSchema.parse({ offers: [], coverage: [] }));
    return c.json(priceOffersResponseSchema.parse(await service.offers(request.data.identity, request.data.excludeDomain)));
  });
  app.notFound((c) => c.json(fail('NOT_FOUND', 'Route not found.'), 404));
  return app;
}
