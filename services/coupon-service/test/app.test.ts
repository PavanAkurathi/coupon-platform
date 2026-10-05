import { describe, expect, test } from 'bun:test';
import { createApp } from '../src/app';
import {
  DomainError, eligibleCandidates, hashToken, summarizeReports,
  type CouponRow, type CouponStore, type RateLimiter,
} from '../src/domain';

const merchantId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-10-04T12:00:00.000Z');
const token = 'a'.repeat(43);
const report = { merchantId, code: 'SAVE10', outcome: 'success', savingsCents: 1000, currency: 'USD' };
const limiter: RateLimiter = { allow: async () => true, ping: async () => {} };
const makeRow = (overrides: Partial<CouponRow> = {}): CouponRow => ({
  id: crypto.randomUUID(), merchantId, code: 'SAVE10', status: 'verified',
  confirmations: 3, reportCount: 3, expectedSavingsCents: 1000, expiresAt: null, ...overrides,
});

function fixture() {
  const rows: CouponRow[] = [];
  const votes = new Map<string, Map<string, { outcome: 'success' | 'failure'; savingsCents: number }>>();
  const store: CouponStore = {
    listMerchants: async () => [{ id: merchantId, domain: 'localhost', name: 'Demo Store', currency: 'USD' }],
    hasMerchant: async (id) => id === merchantId,
    findCandidates: async (id) => rows.filter((row) => row.merchantId === id),
    authenticate: async (hash) => hash === hashToken(token) ? 'shopper-1' : hash === hashToken('b'.repeat(43)) ? 'shopper-2' : hash === hashToken('c'.repeat(43)) ? 'shopper-3' : null,
    async report(userId, input, date) {
      let row = rows.find((row) => row.code === input.code && row.merchantId === input.merchantId);
      if (row?.expiresAt && row.expiresAt <= date) throw new DomainError('COUPON_EXPIRED', 'This code has expired.', 410);
      if (!row) {
        row = makeRow({ code: input.code, status: 'quarantined', confirmations: 0, reportCount: 0 });
        rows.push(row);
      }
      const couponVotes = votes.get(row.id) ?? new Map();
      couponVotes.set(userId, { outcome: input.outcome, savingsCents: input.savingsCents });
      votes.set(row.id, couponVotes);
      Object.assign(row, summarizeReports([...couponVotes.values()]));
      return { couponId: row.id, status: row.status, confirmations: row.confirmations, successRate: row.confirmations / row.reportCount };
    },
    ping: async () => {},
  };
  return { rows, store, app: createApp({ store, limiter, now: () => now }) };
}
function post(app: ReturnType<typeof createApp>, body: unknown, bearer = token) {
  return app.request('/v1/coupons/report', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(body),
  });
}

describe('candidate contract and ranking', () => {
  test('only verified, unexpired codes; score = success rate × savings; limit after ranking', async () => {
    const { app, rows } = fixture();
    rows.push(
      makeRow({ code: 'LARGE', reportCount: 6, expectedSavingsCents: 2000 }),
      makeRow({ code: 'BEST', expectedSavingsCents: 1500 }),
      makeRow({ code: 'SMALL', expectedSavingsCents: 400 }),
      makeRow({ code: 'QUARANTINED', status: 'quarantined', expectedSavingsCents: 9000 }),
      makeRow({ code: 'EXPIRED', expiresAt: now, expectedSavingsCents: 9000 }),
      makeRow({ code: 'NOQUORUM', confirmations: 2, expectedSavingsCents: 9000 }),
    );
    const response = await app.request(`/v1/coupons/candidates?merchantId=${merchantId}&limit=2`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.candidates.map((coupon: {code: string}) => coupon.code)).toEqual(['BEST', 'LARGE']);
    expect(body.candidates[1].score).toBe(1000);
    expect(body.candidates[1].successRate).toBe(0.5);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  test('rejects missing/invalid ids, excessive limits and unknown fields', async () => {
    const { app } = fixture();
    for (const query of ['', 'merchantId=bad', `merchantId=${merchantId}&limit=21`, `merchantId=${merchantId}&userId=arbitrary`]) {
      expect((await app.request(`/v1/coupons/candidates?${query}`)).status).toBe(400);
    }
  });
  test('unknown merchant is 404', async () => {
    const { app } = fixture();
    expect((await app.request(`/v1/coupons/candidates?merchantId=${crypto.randomUUID()}`)).status).toBe(404);
  });
  test('fresh clock check removes a code that expired during database work', () => {
    const row = makeRow({ expiresAt: new Date(now.getTime() + 1) });
    expect(eligibleCandidates([row], now, 10)).toHaveLength(1);
    expect(eligibleCandidates([row], new Date(now.getTime() + 1), 10)).toHaveLength(0);
  });
});

describe('crowdsourced verification through HTTP', () => {
  test('auth is required and an arbitrary identity in JSON is rejected', async () => {
    const { app } = fixture();
    const response = await app.request('/v1/coupons/report', { method: 'POST', body: JSON.stringify(report) });
    expect(response.status).toBe(401);
    expect((await post(app, report, 'z'.repeat(43))).status).toBe(401);
    expect((await post(app, { ...report, userId: 'other-shopper' })).status).toBe(400);
  });
  test('success needs real positive integer cents and failure needs zero', async () => {
    const { app } = fixture();
    for (const patch of [{ savingsCents: 0 }, { savingsCents: -1 }, { savingsCents: 10.5 }, { outcome: 'failure', savingsCents: 100 }, { currency: 'EUR' }]) {
      expect((await post(app, { ...report, ...patch })).status).toBe(400);
    }
    const malformed = await app.request('/v1/coupons/report', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{' });
    expect(malformed.status).toBe(400);
  });
  test('retries count once, third shopper promotes, changed failure re-quarantines', async () => {
    const { app } = fixture();
    const first = await (await post(app, report)).json();
    const retry = await (await post(app, report)).json();
    expect(first.status).toBe('quarantined');
    expect(retry.confirmations).toBe(1);
    await post(app, report, 'b'.repeat(43));
    const third = await (await post(app, report, 'c'.repeat(43))).json();
    expect(third.confirmations).toBe(3);
    expect(third.status).toBe('verified');
    const changed = await (await post(app, { ...report, outcome: 'failure', savingsCents: 0 })).json();
    expect(changed.confirmations).toBe(2);
    expect(changed.successRate).toBeCloseTo(2 / 3);
    expect(changed.status).toBe('quarantined');
  });
  test('expired coupons cannot regain verification through reports', async () => {
    const { app, rows } = fixture();
    rows.push(makeRow({ code: report.code, expiresAt: now }));
    const response = await post(app, report);
    expect(response.status).toBe(410);
    expect((await response.json()).error.code).toBe('COUPON_EXPIRED');
  });
  test('reports normalize the code via shared contract', async () => {
    const { app, rows } = fixture();
    expect((await post(app, { ...report, code: ' save10 ' })).status).toBe(200);
    expect(rows[0]?.code).toBe('SAVE10');
  });
});

describe('availability and limits', () => {
  test('public rate limiting and dependency failure fail closed', async () => {
    const { store } = fixture();
    const limited = createApp({ store, limiter: { ...limiter, allow: async () => false } });
    expect((await limited.request('/v1/merchants')).status).toBe(429);
    const failed = createApp({ store, limiter: { ...limiter, allow: async () => { throw new Error('Redis down'); } } });
    expect((await failed.request('/v1/merchants')).status).toBe(503);
  });
  test('health reports degraded when a required dependency is down', async () => {
    const { store } = fixture();
    const app = createApp({ store: { ...store, ping: async () => { throw new Error('DB down'); } }, limiter });
    const response = await app.request('/health');
    expect(response.status).toBe(503);
    expect((await response.json()).dependencies).toEqual({ database: 'down', redis: 'up' });
  });
});
