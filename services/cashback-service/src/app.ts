import { Hono } from 'hono';
import { healthResponseSchema, stubResponseSchema, errorResponseSchema } from '@repo/shared';

export const app = new Hono();
app.get('/health', (c) => c.json(healthResponseSchema.parse({
  service: 'cashback-service', status: 'ok', phase: 3,
})));
app.all('/v1/cashback/*', (c) => c.json(stubResponseSchema.parse({
  service: 'cashback-service', status: 'not_implemented', phase: 3,
  message: 'Affiliate ledger and merchant-confirmed settlements are planned for phase 3.',
}), 501));
app.notFound((c) => c.json(errorResponseSchema.parse({error: {code: 'NOT_FOUND', message: 'Route not found.'}}), 404));
