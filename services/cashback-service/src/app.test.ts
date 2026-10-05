import { expect, test } from 'bun:test';
import { app } from './app';
import { healthResponseSchema, stubResponseSchema } from '@repo/shared';
test('stub is healthy but cannot perform a real operation', async () => {
  const health = await app.request('/health');
  expect(health.status).toBe(200);
  expect(healthResponseSchema.parse(await health.json()).phase).toBe(3);
  for (const method of ['GET', 'POST']) {
    const response = await app.request('/v1/cashback/example', {method});
    expect(response.status).toBe(501);
    expect(stubResponseSchema.parse(await response.json()).status).toBe('not_implemented');
  }
});
