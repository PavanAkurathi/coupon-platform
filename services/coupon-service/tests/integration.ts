import assert from 'node:assert/strict';
import postgres from 'postgres';

const api = process.env.API_URL ?? 'http://127.0.0.1:3001';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the same disposable development database used by the running coupon service.');
const sql = postgres(process.env.DATABASE_URL, { max: 5 });
const prefix = `integration-${crypto.randomUUID()}`;
const tokens = Array.from({ length: 10 }, () => `${prefix}-${crypto.randomUUID()}`);
const tokenHash = (value: string) => new Bun.CryptoHasher('sha256').update(value).digest('hex');
let merchantId = ''; 
let checks = 0;
const check = (name: string, test: () => unknown) => { test(); checks++; console.log(`PASS ${name}`); };

async function request(path: string, token?: string, data?: unknown) {
  const response = await fetch(`${api}${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { 'content-type': 'application/json' } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const body = await response.json();
  return { status: response.status, body };
}
const report = (code: string, voter: number, outcome = 'success', savingsCents = 400) => request('/v1/coupons/report', tokens[voter], { merchantId, code, outcome, savingsCents, currency: 'USD' });
const candidates = () => request(`/v1/coupons/candidates?merchantId=${merchantId}`);
const rows = (result: any) => result.body.candidates;

try {
  const inserted = await sql`INSERT INTO merchants (domain, name) VALUES (${`${prefix}.invalid`}, ${'Integration merchant'}) RETURNING id`;
  merchantId = inserted[0]!.id;
  for (let i = 0; i < tokens.length; i++) {
    await sql`INSERT INTO users (identity_hash, token_hash) VALUES (${`${prefix}-identity-${i}`}, ${tokenHash(tokens[i]!)})`;
  }
  const missingAuth = await request('/v1/coupons/report', undefined, { merchantId, code: 'FIRST', outcome: 'success', savingsCents: 400, currency: 'USD' });
  check('reports require a provisioned identity', () => assert.equal(missingAuth.status, 401));
  const badAuth = await request('/v1/coupons/report', 'invalid-token', { merchantId, code: 'FIRST', outcome: 'success', savingsCents: 400, currency: 'USD' });
  check('unknown token rejected', () => assert.equal(badAuth.status, 401));
  const zeroSavings = await report('FIRST', 0, 'success', 0);
  check('success requires positive measured savings', () => assert.equal(zeroSavings.status, 400));
  const failedSavings = await report('FIRST', 0, 'failure', 1);
  check('failure cannot claim savings', () => assert.equal(failedSavings.status, 400));

  const first = await report('FIRST', 0, 'success', 200);
  check('first shopper leaves code quarantined', () => { assert.equal(first.status, 200); assert.equal(first.body.status, 'quarantined'); assert.equal(first.body.confirmations, 1); });
  const duplicate = await report('FIRST', 0, 'success', 600);
  check('repeat shopper cannot increase confirmation count', () => assert.equal(duplicate.body.confirmations, 1));
  const quarantined = await candidates();
  check('quarantined code omitted from candidates', () => assert.equal(rows(quarantined).length, 0));
  await report('FIRST', 1, 'success', 400);
  const twoVoters = await candidates();
  check('two shoppers do not release code', () => assert.equal(rows(twoVoters).length, 0));
  const third = await report('FIRST', 2, 'success', 200);
  check('third distinct shopper releases code', () => { assert.equal(third.body.status, 'verified'); assert.equal(third.body.confirmations, 3); });
  const verified = await candidates();
  check('expected savings average uses latest independent reports', () => { assert.equal(rows(verified)[0].expectedSavingsCents, 400); assert.equal(rows(verified)[0].successRate, 1); });

  await report('SECOND', 0, 'success', 500);
  await report('SECOND', 1, 'success', 500);
  await report('SECOND', 2, 'success', 500);
  await report('SECOND', 3, 'failure', 0);
  const ranked = await candidates();
  check('rank is success rate multiplied by expected savings', () => { assert.deepEqual(rows(ranked).map((row: any) => row.code), ['FIRST', 'SECOND']); assert.equal(rows(ranked)[1].score, 375); });

  await sql`UPDATE coupons SET expires_at = now() - interval '1 second' WHERE merchant_id = ${merchantId} AND code = 'FIRST'`;
  const expiryFiltered = await candidates();
  check('expired verified coupon is immediately filtered', () => assert.deepEqual(rows(expiryFiltered).map((row: any) => row.code), ['SECOND']));
  const expiredReport = await report('FIRST', 4);
  check('expired coupon cannot be revived through report', () => assert.equal(expiredReport.status, 410));

  const downgraded = await report('SECOND', 1, 'failure', 0);
  check('failed update reduces quorum and requarantines', () => { assert.equal(downgraded.body.status, 'quarantined'); assert.equal(downgraded.body.confirmations, 2); });
  const downgradedFeed = await candidates();
  check('downgraded coupon disappears from verified feed', () => assert.equal(rows(downgradedFeed).length, 0));

  const concurrent = await Promise.all(tokens.slice(0, 8).map((_token, index) => report('CONCURRENT', index, 'success', 100 + index)));
  check('concurrent first reports all succeed', () => assert.ok(concurrent.every((response) => response.status === 200), JSON.stringify(concurrent)));
  const persisted = await sql`SELECT confirmations, report_count, status FROM coupons WHERE merchant_id = ${merchantId} AND code = 'CONCURRENT'`;
  check('concurrent reports retain all distinct votes atomically', () => { assert.equal(persisted.length, 1); assert.equal(persisted[0]!.confirmations, 8); assert.equal(persisted[0]!.report_count, 8); assert.equal(persisted[0]!.status, 'verified'); });
  const repeats = await Promise.all(Array.from({ length: 8 }, () => report('CONCURRENT', 0, 'success', 777)));
  check('parallel repeat reports remain one vote', () => { assert.ok(repeats.every((response) => response.status === 200)); });
  const afterRepeats = await sql`SELECT confirmations, report_count FROM coupons WHERE merchant_id = ${merchantId} AND code = 'CONCURRENT'`;
  check('repeat vote persistence remains independent', () => { assert.equal(afterRepeats[0]!.confirmations, 8); assert.equal(afterRepeats[0]!.report_count, 8); });

  let databaseRejected = false;
  try { await sql`INSERT INTO coupons (merchant_id, code, status, confirmations, report_count) VALUES (${merchantId}, 'ILLEGAL', 'verified', 2, 2)`; } catch { databaseRejected = true; }
  check('database independently rejects verified status below quorum', () => assert.ok(databaseRejected));
  console.log(`Integration complete: ${checks} checks passed against real Postgres and live HTTP API.`);
} finally {
  if (merchantId) await sql`DELETE FROM merchants WHERE id = ${merchantId}`;
  await sql`DELETE FROM users WHERE identity_hash LIKE ${`${prefix}%`}`;
  await sql.end();
}
