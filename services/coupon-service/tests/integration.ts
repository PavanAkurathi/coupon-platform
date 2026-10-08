import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { couponPreflightResponseSchema, type CouponSafety } from '@repo/shared';
import { connectDatabase } from '../src/db/client';
import { createPostgresRateLimiter } from '../src/rate-limit-postgres';

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
  return { status: response.status, body, cacheControl: response.headers.get('cache-control') };
}
const report = (code: string, voter: number, outcome = 'success', savingsCents = 400) => request('/v1/coupons/report', tokens[voter], { merchantId, code, outcome, savingsCents, currency: 'USD' });
const candidates = (limit = 10) => request(`/v1/coupons/candidates?merchantId=${merchantId}&limit=${limit}`);
const preflight = (code: string) => request(`/v1/coupons/preflight?merchantId=${merchantId}&code=${encodeURIComponent(code)}`);
const rows = (result: any) => result.body.candidates;
// Synthetic review evidence applies only to this disposable integration merchant.
const approve = (code: string) => sql`
  UPDATE coupons SET approval_status = 'approved', audience = 'public', attribution_behavior = 'neutral',
    reviewed_at = now(), evidence_ref = ${`${prefix}:synthetic-test-evidence`}, reviewed_by = ${prefix}
  WHERE merchant_id = ${merchantId} AND code = ${code}`;
const safetyRow = (code: string) => sql`
  SELECT approval_status, audience, attribution_behavior, reviewed_at, evidence_ref, reviewed_by
  FROM coupons WHERE merchant_id = ${merchantId} AND code = ${code}`;
async function reviewWithCli(approval: 'approved' | 'rejected', create = false) {
  const child = Bun.spawn([
    process.execPath, resolve(import.meta.dir, '../src/scripts/review-coupon.ts'),
    '--merchant', merchantId, '--code', 'CLI_REVIEW', '--operator', prefix,
    '--approval', approval, '--audience', 'public', '--attribution', 'neutral',
    '--evidence', `${prefix}:synthetic-cli-test-evidence`, ...(create ? ['--create'] : []),
  ], {
    env: process.env,
    // Report only exit status; never echo inherited environment or credentials.
    stdin: 'ignore', stdout: 'ignore', stderr: 'ignore',
  });
  return child.exited;
}
async function merchantCli(...args: string[]) {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../src/scripts/merchant.ts'), ...args], {
    env: process.env, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore',
  });
  return child.exited;
}
const ageVotes = (code: string, voters: number[], days: number) => sql`
  UPDATE coupon_reports SET updated_at = now() - make_interval(days => ${days})
  WHERE coupon_id = (SELECT id FROM coupons WHERE merchant_id = ${merchantId} AND code = ${code})
    AND user_id IN (SELECT id FROM users WHERE identity_hash IN ${sql(voters.map((voter) => `${prefix}-identity-${voter}`))})`;
function expectPreflight(result: Awaited<ReturnType<typeof request>>, code: string, allowed: boolean, reason: string) {
  assert.equal(result.status, 200);
  const parsed = couponPreflightResponseSchema.parse(result.body);
  assert.equal(parsed.merchantId, merchantId);
  assert.equal(parsed.code, code);
  assert.equal(parsed.canAutoApply, allowed);
  assert.equal(parsed.reason, reason);
  assert.equal(result.cacheControl, 'no-store');
}

try {
  const inserted = await sql`INSERT INTO merchants (domain, name) VALUES (${`${prefix}.invalid`}, ${'Integration merchant'}) RETURNING id`;
  merchantId = inserted[0]!.id;
  for (let i = 0; i < tokens.length; i++) {
    await sql`INSERT INTO users (identity_hash, token_hash) VALUES (${`${prefix}-identity-${i}`}, ${tokenHash(tokens[i]!)})`;
  }
  const cliCreated = await reviewWithCli('approved', true);
  check('operator CLI creates a reviewed code successfully', () => assert.equal(cliCreated, 0));
  const cliInitial = await sql`SELECT status, confirmations, report_count, approval_status
    FROM coupons WHERE merchant_id = ${merchantId} AND code = 'CLI_REVIEW'`;
  check('CLI approval creates no synthetic shopper votes', () => assert.deepEqual(cliInitial[0], {
    status: 'quarantined', confirmations: 0, report_count: 0, approval_status: 'approved',
  }));
  const cliPreflight = await preflight('CLI_REVIEW');
  check('CLI-approved quarantined code passes manual preflight', () => expectPreflight(cliPreflight, 'CLI_REVIEW', true, 'approved'));
  for (const voter of [0, 1, 2]) {
    const response = await report('CLI_REVIEW', voter);
    assert.equal(response.status, 200);
  }
  const cliRevoked = await reviewWithCli('rejected');
  check('operator CLI revokes a reviewed code successfully', () => assert.equal(cliRevoked, 0));
  const cliAfterRevocation = await sql`SELECT status, confirmations, report_count, approval_status
    FROM coupons WHERE merchant_id = ${merchantId} AND code = 'CLI_REVIEW'`;
  check('CLI revocation preserves independently collected shopper quorum', () => assert.deepEqual(cliAfterRevocation[0], {
    status: 'verified', confirmations: 3, report_count: 3, approval_status: 'rejected',
  }));
  const cliBlocked = await preflight('CLI_REVIEW');
  check('CLI-revoked code immediately fails preflight', () => expectPreflight(cliBlocked, 'CLI_REVIEW', false, 'needs_review'));
  const missingAuth = await request('/v1/coupons/report', undefined, { merchantId, code: 'FIRST', outcome: 'success', savingsCents: 400, currency: 'USD' });
  check('reports require a provisioned identity', () => assert.equal(missingAuth.status, 401));
  const badAuth = await request('/v1/coupons/report', 'invalid-token', { merchantId, code: 'FIRST', outcome: 'success', savingsCents: 400, currency: 'USD' });
  check('unknown token rejected', () => assert.equal(badAuth.status, 401));
  const zeroSavings = await report('FIRST', 0, 'success', 0);
  check('success requires positive measured savings', () => assert.equal(zeroSavings.status, 400));
  const failedSavings = await report('FIRST', 0, 'failure', 1);
  check('failure cannot claim savings', () => assert.equal(failedSavings.status, 400));
  const missing = await preflight('UNKNOWN');
  check('unknown code fails preflight without cached approval', () => expectPreflight(missing, 'UNKNOWN', false, 'not_found'));

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
  check('third distinct shopper verifies code independently of safety approval', () => { assert.equal(third.status, 200); assert.equal(third.body.status, 'verified'); assert.equal(third.body.confirmations, 3); });
  const unreviewed = await candidates();
  check('three successes cannot release an unreviewed code', () => assert.equal(rows(unreviewed).length, 0));
  const unreviewedSafety = await safetyRow('FIRST');
  check('crowdsourced codes retain safe database defaults', () => assert.deepEqual(unreviewedSafety[0], {
    approval_status: 'pending', audience: 'unknown', attribution_behavior: 'unknown',
    reviewed_at: null, evidence_ref: null, reviewed_by: null,
  }));
  const pending = await preflight('FIRST');
  check('verified but unreviewed code fails preflight', () => expectPreflight(pending, 'FIRST', false, 'needs_review'));
  const forgedApproval = await request('/v1/coupons/report', tokens[3], {
    merchantId, code: 'FIRST', outcome: 'success', savingsCents: 400, currency: 'USD',
    approvalStatus: 'approved', audience: 'public', attributionBehavior: 'neutral',
    reviewedAt: new Date().toISOString(), evidenceRef: 'forged', reviewedBy: 'shopper',
  });
  check('reports cannot supply operator approval metadata', () => assert.equal(forgedApproval.status, 400));
  const afterForgery = await safetyRow('FIRST');
  check('rejected approval injection leaves stored safety untouched', () => assert.deepEqual(afterForgery, unreviewedSafety));
  await approve('FIRST');
  const verified = await candidates();
  check('approved verified code enters feed with independent savings average', () => {
    assert.equal(verified.status, 200); assert.equal(rows(verified).length, 1);
    assert.equal(rows(verified)[0].expectedSavingsCents, 400); assert.equal(rows(verified)[0].successRate, 1);
    assert.equal(rows(verified)[0].approvalStatus, 'approved'); assert.equal(rows(verified)[0].attributionBehavior, 'neutral');
  });

  await report('MANUAL', 0, 'success', 700);
  await approve('MANUAL');
  const manual = await preflight('manual');
  check('reviewed quarantined code can be tested explicitly with normalized code', () => expectPreflight(manual, 'MANUAL', true, 'approved'));
  const manualFeed = await candidates();
  check('safety approval alone does not bypass shopper quorum', () => assert.deepEqual(rows(manualFeed).map((row: any) => row.code), ['FIRST']));
  await sql`UPDATE coupons SET approval_status = 'rejected' WHERE merchant_id = ${merchantId} AND code = 'MANUAL'`;
  const revokedSafety = await safetyRow('MANUAL');
  const revoked = await preflight('MANUAL');
  check('revoking operator approval immediately blocks manual trials', () => expectPreflight(revoked, 'MANUAL', false, 'needs_review'));
  await report('MANUAL', 1, 'success', 700);
  await report('MANUAL', 2, 'success', 700);
  const afterRevocationReports = await safetyRow('MANUAL');
  check('later successful reports cannot restore revoked approval', () => assert.deepEqual(afterRevocationReports, revokedSafety));

  await report('SECOND', 0, 'success', 500);
  await report('SECOND', 1, 'success', 500);
  await report('SECOND', 2, 'success', 500);
  await approve('SECOND');
  const approvedSafety = await safetyRow('SECOND');
  await report('SECOND', 3, 'failure', 0);
  const afterFailure = await safetyRow('SECOND');
  check('report updates preserve operator approval and evidence', () => assert.deepEqual(afterFailure, approvedSafety));
  const ranked = await candidates();
  check('rank is success rate multiplied by expected savings', () => { assert.deepEqual(rows(ranked).map((row: any) => row.code), ['FIRST', 'SECOND']); assert.equal(rows(ranked)[1].score, 375); });

  const unsafeReviews: Array<{ code: string; approval: CouponSafety['approvalStatus']; audience: CouponSafety['audience']; attribution: CouponSafety['attributionBehavior']; reason: string }> = [
    { code: 'UNREVIEWED_HIGH', approval: 'pending', audience: 'public', attribution: 'neutral', reason: 'needs_review' },
    { code: 'REJECTED_HIGH', approval: 'rejected', audience: 'public', attribution: 'neutral', reason: 'needs_review' },
    { code: 'PRIVATE_HIGH', approval: 'approved', audience: 'private', attribution: 'neutral', reason: 'restricted' },
    { code: 'CREATOR_HIGH', approval: 'approved', audience: 'creator', attribution: 'neutral', reason: 'restricted' },
    { code: 'AUDIENCE_UNKNOWN_HIGH', approval: 'approved', audience: 'unknown', attribution: 'neutral', reason: 'restricted' },
    { code: 'ATTRIBUTION_UNKNOWN_HIGH', approval: 'approved', audience: 'public', attribution: 'unknown', reason: 'attribution_unknown' },
    { code: 'AFFILIATE_HIGH', approval: 'approved', audience: 'public', attribution: 'affiliate', reason: 'attribution_changes' },
  ];
  for (const review of unsafeReviews) {
    await sql`INSERT INTO coupons (merchant_id, code, status, confirmations, report_count, expected_savings_cents,
      approval_status, audience, attribution_behavior, reviewed_at, evidence_ref, reviewed_by)
      VALUES (${merchantId}, ${review.code}, 'verified', 3, 3, 100000,
        ${review.approval}, ${review.audience}, ${review.attribution}, now(), ${`${prefix}:synthetic-test-evidence`}, ${prefix})`;
    const blocked = await preflight(review.code);
    check(`${review.code} fails preflight with a specific reason`, () => expectPreflight(blocked, review.code, false, review.reason));
  }
  const limited = await candidates(1);
  check('SQL excludes unsafe higher scores before applying candidate limit', () => {
    assert.equal(limited.status, 200); assert.deepEqual(rows(limited).map((row: any) => row.code), ['FIRST']);
  });

  await sql`UPDATE coupons SET expires_at = now() - interval '1 second' WHERE merchant_id = ${merchantId} AND code = 'FIRST'`;
  const expiryFiltered = await candidates();
  check('expired verified coupon is immediately filtered', () => assert.deepEqual(rows(expiryFiltered).map((row: any) => row.code), ['SECOND']));
  const expiredPreflight = await preflight('FIRST');
  check('previously approved expired code fails preflight', () => expectPreflight(expiredPreflight, 'FIRST', false, 'expired'));
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

  for (const voter of [0, 1, 2]) await report('AGING', voter, 'success', 300);
  await approve('AGING');
  const agingFresh = await candidates();
  check('three recent confirmations make an approved code a candidate that publishes when it last worked', () => {
    const row = rows(agingFresh).find((candidate: any) => candidate.code === 'AGING');
    assert.ok(row); assert.ok(Date.now() - Date.parse(row.lastConfirmedAt) < 5 * 60_000);
  });
  await ageVotes('AGING', [0, 1], 31);
  const agingStale = await candidates();
  check('votes older than the evidence window stop counting on the next read', () => assert.ok(!rows(agingStale).some((row: any) => row.code === 'AGING')));
  const revive = await report('AGING', 3, 'success', 300);
  check('one new success cannot revive two stale votes', () => {
    assert.equal(revive.status, 200); assert.equal(revive.body.confirmations, 2); assert.equal(revive.body.status, 'quarantined');
  });
  const afterRevive = await candidates();
  check('a code with too few recent votes stays out of candidates', () => assert.ok(!rows(afterRevive).some((row: any) => row.code === 'AGING')));
  await report('AGING', 4, 'success', 300);
  const requalified = await candidates();
  check('a fresh independent quorum restores the code with a current last-success time', () => {
    const row = rows(requalified).find((candidate: any) => candidate.code === 'AGING');
    assert.ok(row); assert.equal(row.confirmations, 3); assert.ok(Date.now() - Date.parse(row.lastConfirmedAt) < 5 * 60_000);
  });

  const disabledExit = await merchantCli('disable', '--merchant', merchantId, '--operator', prefix, '--reason', 'integration kill-switch test');
  check('operator CLI disables a merchant', () => assert.equal(disabledExit, 0));
  const listedWhileDisabled = await request('/v1/merchants');
  const candidatesWhileDisabled = await candidates();
  const preflightWhileDisabled = await preflight('SECOND');
  const reportWhileDisabled = await report('SECOND', 5, 'success', 500);
  check('a disabled merchant disappears from the supported list', () => assert.ok(!listedWhileDisabled.body.merchants.some((merchant: any) => merchant.id === merchantId)));
  check('a disabled merchant serves no candidates, preflight or reports', () => {
    assert.equal(candidatesWhileDisabled.status, 404); assert.equal(preflightWhileDisabled.status, 404); assert.equal(reportWhileDisabled.status, 404);
  });
  const enabledExit = await merchantCli('enable', '--merchant', merchantId, '--operator', prefix, '--reason', 'integration kill-switch test complete');
  const listedAgain = await request('/v1/merchants');
  check('re-enabling restores the merchant immediately', () => {
    assert.equal(enabledExit, 0); assert.ok(listedAgain.body.merchants.some((merchant: any) => merchant.id === merchantId));
  });
  let silentDisable: unknown;
  try { await sql`UPDATE merchants SET enabled = false, status_note = NULL WHERE id = ${merchantId}`; } catch (error) { silentDisable = error; }
  check('database rejects a merchant disable without a recorded reason', () => {
    assert.equal((silentDisable as any)?.code, '23514'); assert.equal((silentDisable as any)?.constraint_name, 'merchants_disable_reason');
  });
  const badDomainExit = await merchantCli('add', '--domain', 'https://shop.example.com/cart', '--name', 'Bad', '--operator', prefix);
  check('operator CLI refuses a merchant domain that is not an exact hostname', () => assert.notEqual(badDomainExit, 0));

  const limiterDb = connectDatabase(process.env.DATABASE_URL);
  try {
    const postgresLimiter = createPostgresRateLimiter(limiterDb.db);
    const key = `${prefix}:limit`;
    const allowed = await Promise.all(Array.from({ length: 5 }, () => postgresLimiter.allow(key, 3, 60)));
    check('Postgres limiter admits exactly the limit under concurrent requests', () => assert.equal(allowed.filter(Boolean).length, 3));
    await sql`UPDATE rate_limits SET window_start = now() - interval '61 seconds' WHERE key = ${`coupon:limit:${key}`}`;
    const afterWindow = await postgresLimiter.allow(key, 3, 60);
    check('Postgres limiter starts a fresh window after it expires', () => assert.equal(afterWindow, true));
    await sql`DELETE FROM rate_limits WHERE key LIKE ${`coupon:limit:${prefix}%`}`;
  } finally { await limiterDb.client.end({ timeout: 3 }); }

  let quorumError: unknown;
  try { await sql`INSERT INTO coupons (merchant_id, code, status, confirmations, report_count) VALUES (${merchantId}, 'ILLEGAL', 'verified', 2, 2)`; } catch (error) { quorumError = error; }
  check('database independently rejects verified status below quorum', () => {
    assert.equal((quorumError as any)?.code, '23514');
    assert.equal((quorumError as any)?.constraint_name, 'coupons_verified_threshold');
  });
  const incompleteEvidence = [
    { code: 'NO_REVIEW_DATE', reviewedAt: null, evidence: 'fixture', reviewer: prefix },
    { code: 'NO_EVIDENCE', reviewedAt: new Date(), evidence: null, reviewer: prefix },
    { code: 'BLANK_EVIDENCE', reviewedAt: new Date(), evidence: '   ', reviewer: prefix },
    { code: 'NO_REVIEWER', reviewedAt: new Date(), evidence: 'fixture', reviewer: null },
    { code: 'BLANK_REVIEWER', reviewedAt: new Date(), evidence: 'fixture', reviewer: '   ' },
  ];
  for (const invalid of incompleteEvidence) {
    let approvalError: unknown;
    try {
      await sql`INSERT INTO coupons (merchant_id, code, approval_status, audience, attribution_behavior,
        reviewed_at, evidence_ref, reviewed_by) VALUES (${merchantId}, ${invalid.code}, 'approved', 'public', 'neutral',
        ${invalid.reviewedAt}, ${invalid.evidence}, ${invalid.reviewer})`;
    } catch (error) { approvalError = error; }
    check(`database rejects approval with ${invalid.code}`, () => {
      assert.equal((approvalError as any)?.code, '23514');
      assert.equal((approvalError as any)?.constraint_name, 'coupons_approval_evidence');
    });
  }
  console.log(`Integration complete: ${checks} checks passed against real Postgres and live HTTP API.`);
} finally {
  if (merchantId) await sql`DELETE FROM merchants WHERE id = ${merchantId}`;
  await sql`DELETE FROM users WHERE identity_hash LIKE ${`${prefix}%`}`;
  await sql.end();
}
