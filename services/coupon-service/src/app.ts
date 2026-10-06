import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import {
  candidatesQuerySchema, candidatesResponseSchema, couponReportSchema,
  couponReportResponseSchema, merchantsResponseSchema, healthResponseSchema,
  couponPreflightQuerySchema, couponPreflightResponseSchema,
} from '@repo/shared';
import { DomainError, eligibleCandidates, hashToken, preflightCoupon, type CouponStore, type RateLimiter } from './domain';

type Dependencies = { store: CouponStore; limiter: RateLimiter; now?: () => Date; corsOrigins?: string[] };
type Env = { Bindings: { clientAddress?: string } };
const fail = (code: string, message: string) => ({ error: { code, message } });

async function healthCheck(ping: () => Promise<void>): Promise<'up' | 'down'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([ping(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Dependency health timeout')), 1500);
    })]);
    return 'up';
  } catch { return 'down'; }
  finally { if (timer) clearTimeout(timer); }
}

export function createApp({ store, limiter, now = () => new Date(), corsOrigins = [] }: Dependencies) {
  const app = new Hono<Env>();
  app.use('*', secureHeaders());
  app.use('/v1/*', cors({
    origin: (origin) => /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/.test(origin) || corsOrigins.includes(origin) ? origin : undefined,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }));
  app.use('/v1/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    // Use the socket address supplied by Bun; never trust client-forwarded headers.
    const ip = c.env?.clientAddress ?? 'unknown';
    if (!await limiter.allow(`ip:${hashToken(ip)}`, 120, 60)) {
      c.header('Retry-After', '60');
      return c.json(fail('RATE_LIMITED', 'Please try again in a minute.'), 429);
    }
    await next();
  });
  app.use('/v1/coupons/report', bodyLimit({
    maxSize: 2048,
    onError: (c) => c.json(fail('BODY_TOO_LARGE', 'Report payload is too large.'), 413),
  }));
  app.get('/health', async (c) => {
    const [database, redis] = await Promise.all([healthCheck(() => store.ping()), healthCheck(() => limiter.ping())]);
    const healthy = database === 'up' && redis === 'up';
    return c.json(healthResponseSchema.parse({
      service: 'coupon-service', status: healthy ? 'ok' : 'degraded', dependencies: { database, redis },
    }), healthy ? 200 : 503);
  });
  app.get('/v1/merchants', async (c) => c.json(merchantsResponseSchema.parse({ merchants: await store.listMerchants() })));
  app.get('/v1/coupons/candidates', async (c) => {
    const query = candidatesQuerySchema.safeParse(c.req.query());
    if (!query.success) return c.json(fail('INVALID_QUERY', 'Provide a valid merchantId and a limit from 1 to 20.'), 400);
    const { merchantId, limit } = query.data;
    if (!await store.hasMerchant(merchantId)) return c.json(fail('MERCHANT_NOT_FOUND', 'This merchant is not supported.'), 404);
    const rows = await store.findCandidates(merchantId, limit, now());
    return c.json(candidatesResponseSchema.parse({ merchantId, currency: 'USD', candidates: eligibleCandidates(rows, now(), limit) }));
  });
  app.post('/v1/coupons/report', async (c) => {
    const bearer = c.req.header('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
    if (!bearer) return c.json(fail('UNAUTHORIZED', 'A verified shopper token is required.'), 401);
    const userId = await store.authenticate(hashToken(bearer));
    if (!userId) return c.json(fail('UNAUTHORIZED', 'A verified shopper token is required.'), 401);
    if (!await limiter.allow(`user:${userId}`, 60, 3600)) {
      c.header('Retry-After', '3600');
      return c.json(fail('RATE_LIMITED', 'Your reporting limit is reached. Try again later.'), 429);
    }
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json(fail('INVALID_JSON', 'Send a JSON report.'), 400); }
    const report = couponReportSchema.safeParse(body);
    if (!report.success) return c.json(fail('INVALID_REPORT', 'Report a valid code and measured savings in cents.'), 400);
    const result = await store.report(userId, report.data, now());
    return c.json(couponReportResponseSchema.parse(result));
  });
  app.get('/v1/coupons/preflight', async (c) => {
    const parsed = couponPreflightQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json(fail('INVALID_QUERY', 'Provide a valid merchantId and coupon code.'), 400);
    const { merchantId, code } = parsed.data;
    if (!await store.hasMerchant(merchantId)) return c.json(fail('MERCHANT_NOT_FOUND', 'This merchant is not supported.'), 404);
    const coupon = await store.findCoupon(merchantId, code);
    return c.json(couponPreflightResponseSchema.parse(preflightCoupon(merchantId, code, coupon, now())));
  });
  app.notFound((c) => c.json(fail('NOT_FOUND', 'Route not found.'), 404));
  app.onError((error, c) => {
    if (error instanceof DomainError) return c.json(fail(error.code, error.message), error.status);
    return c.json(fail('SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.'), 503);
  });
  return app;
}
