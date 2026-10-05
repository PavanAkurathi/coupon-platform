import { Hono } from 'hono';
import { healthResponseSchema, stubResponseSchema, errorResponseSchema } from '@repo/shared';

export const app = new Hono();
app.get('/health', (c) => c.json(healthResponseSchema.parse({
  service: 'price-service', status: 'ok', phase: 2,
})));
app.all('/v1/prices/*', (c) => c.json(stubResponseSchema.parse({
  service: 'price-service', status: 'not_implemented', phase: 2,
  message: 'Price history and drop alerts are planned for phase 2.',
}), 501));
app.notFound((c) => c.json(errorResponseSchema.parse({error: {code: 'NOT_FOUND', message: 'Route not found.'}}), 404));
