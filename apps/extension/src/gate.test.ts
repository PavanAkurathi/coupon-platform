import { describe, expect, test } from 'bun:test';
import type { Candidate } from '@repo/shared';
import { couponPreflightReasonSchema } from '@repo/shared';
import { filterSafeCandidates, preflightErrorMessage, runApprovedTrial } from './gate';
import { adapterFor } from './adapters/registry';

// Fixture: all safety fields pass canAutoApplyCoupon
const SAFE: Candidate = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'SAVE15',
  successRate: 0.9,
  expectedSavingsCents: 1500,
  score: 10,
  confirmations: 5,
  lastConfirmedAt: '2026-10-06T12:00:00.000Z',
  expiresAt: null,
  approvalStatus: 'approved',
  audience: 'public',
  attributionBehavior: 'neutral',
  reviewedAt: '2026-10-05T12:00:00.000Z',
  evidenceRef: 'merchant-review:save15',
};
const UNSAFE: Candidate = { ...SAFE, code: 'PENDING10', approvalStatus: 'pending', reviewedAt: null, evidenceRef: null };
const AFFILIATE: Candidate = { ...SAFE, code: 'AFF20', attributionBehavior: 'affiliate' };
const PRIVATE: Candidate = { ...SAFE, code: 'PRIV5', audience: 'private' };
const MID = '00000000-0000-4000-8000-000000000002';

describe('approval before checkout dispatch', () => {
  const request = { merchantId: MID, url: 'http://localhost:4173/checkout?tag=creator-fixture', code: 'SAVE15' };
  const reviewed = {
    merchantId: MID, code: 'SAVE15', canAutoApply: true, reason: 'approved', expiresAt: null,
    approvalStatus: 'approved', audience: 'public', attributionBehavior: 'neutral',
    reviewedAt: SAFE.reviewedAt, evidenceRef: SAFE.evidenceRef,
  };
  function harness(preflight: unknown = reviewed, candidates: Candidate[] = [SAFE]) {
    const calls: string[][] = [];
    return {
      calls,
      dependencies: {
        fetchPreflight: async () => preflight,
        fetchCandidates: async () => ({ merchantId: MID, currency: 'USD', candidates }),
        dispatch: async (codes: string[]) => { calls.push(codes); return 'checkout-result'; },
      },
    };
  }
  test('reviewed manual code can dispatch on a creator referral without requiring quorum', async () => {
    const { calls, dependencies } = harness();
    expect(await runApprovedTrial(request, dependencies)).toBe('checkout-result');
    expect(calls).toEqual([['SAVE15']]);
  });
  test('unknown, pending and restricted manual codes trigger no checkout mutation', async () => {
    for (const reason of ['not_found', 'needs_review', 'restricted', 'attribution_unknown', 'attribution_changes', 'expired']) {
      const { calls, dependencies } = harness({ ...reviewed, canAutoApply: false, reason });
      await expect(runApprovedTrial(request, dependencies)).rejects.toThrow();
      expect(calls).toEqual([]);
    }
  });
  test('preflight network failure has no fallback to trial dispatch', async () => {
    const { calls, dependencies } = harness();
    dependencies.fetchPreflight = async () => { throw new Error('network unavailable'); };
    await expect(runApprovedTrial(request, dependencies)).rejects.toThrow('network unavailable');
    expect(calls).toEqual([]);
  });
  test('mismatched and internally inconsistent approval responses never dispatch', async () => {
    for (const patch of [
      { merchantId: SAFE.id }, { code: 'OTHER10' }, { audience: 'private' },
      { attributionBehavior: 'affiliate' }, { approvalStatus: 'pending' }, { evidenceRef: null },
    ]) {
      const { calls, dependencies } = harness({ ...reviewed, ...patch });
      await expect(runApprovedTrial(request, dependencies)).rejects.toThrow();
      expect(calls).toEqual([]);
    }
  });
  test('expiry is rechecked after waiting for the current tab', async () => {
    const expiry = Date.parse('2026-10-05T12:00:01.000Z');
    let now = expiry - 1;
    const { calls, dependencies } = harness({ ...reviewed, expiresAt: new Date(expiry).toISOString() });
    await expect(runApprovedTrial(request, {
      ...dependencies, now: () => now, beforeDispatch: async () => { now = expiry; },
    })).rejects.toThrow('expired');
    expect(calls).toEqual([]);
  });
  test('unsafe and expired automatic candidates never reach the checkout', async () => {
    const { calls, dependencies } = harness(reviewed, [UNSAFE, AFFILIATE, { ...SAFE, expiresAt: '2000-01-01T00:00:00.000Z' }]);
    await expect(runApprovedTrial({ ...request, code: undefined }, dependencies)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  test('mixed automatic response dispatches only safe current codes', async () => {
    const { calls, dependencies } = harness(reviewed, [UNSAFE, SAFE, AFFILIATE]);
    await runApprovedTrial({ ...request, code: undefined }, dependencies);
    expect(calls).toEqual([['SAVE15']]);
  });
  test('wrong merchant candidate response and changed checkout never dispatch', async () => {
    const { calls, dependencies } = harness();
    await expect(runApprovedTrial({ ...request, code: undefined }, {
      ...dependencies, fetchCandidates: async () => ({ merchantId: SAFE.id, currency: 'USD', candidates: [SAFE] }),
    })).rejects.toThrow();
    await expect(runApprovedTrial(request, {
      ...dependencies, beforeDispatch: async () => { throw new Error('checkout changed'); },
    })).rejects.toThrow('checkout changed');
    expect(calls).toEqual([]);
  });
  test('unregistered origins never request approval or dispatch trials', async () => {
    const { calls, dependencies } = harness();
    let approvalReads = 0;
    await expect(runApprovedTrial({ ...request, url: 'https://amazon.com/checkout' }, {
      ...dependencies, fetchPreflight: async () => { approvalReads++; return reviewed; },
    })).rejects.toThrow('not supported');
    expect(approvalReads).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('filterSafeCandidates', () => {
  test('returns safe candidate codes when merchantId matches', () => {
    expect(filterSafeCandidates([SAFE], MID, MID)).toEqual(['SAVE15']);
  });
  test('fails closed on merchantId mismatch', () => {
    expect(filterSafeCandidates([SAFE], MID, 'other-merchant-id')).toEqual([]);
  });
  test('drops pending candidates', () => {
    expect(filterSafeCandidates([UNSAFE], MID, MID)).toEqual([]);
  });
  test('drops affiliate-attribution candidates', () => {
    expect(filterSafeCandidates([AFFILIATE], MID, MID)).toEqual([]);
  });
  test('drops private-audience candidates', () => {
    expect(filterSafeCandidates([PRIVATE], MID, MID)).toEqual([]);
  });
  test('keeps safe and drops unsafe from a mixed list', () => {
    expect(filterSafeCandidates([SAFE, UNSAFE, AFFILIATE], MID, MID)).toEqual(['SAVE15']);
  });
  test('safe neutral code is permitted even when URL carries a creator marker', () => {
    // The safety gate operates on candidate metadata, not on the shopper URL.
    // Creator URL markers suppress monetization; they do not block neutral codes.
    expect(filterSafeCandidates([SAFE], MID, MID)).toContain('SAVE15');
  });
});

describe('preflightErrorMessage', () => {
  const blockingReasons = couponPreflightReasonSchema.options.filter((r) => r !== 'approved');
  for (const reason of blockingReasons) {
    test(`${reason} produces a non-empty user-facing message`, () => {
      const msg = preflightErrorMessage(reason);
      expect(msg.length).toBeGreaterThan(10);
      // Message should be prose, not a raw enum value
      expect(msg).not.toBe(reason);
    });
  }
  test('needs_review and not_found give the same awaiting-review message', () => {
    expect(preflightErrorMessage('needs_review')).toBe(preflightErrorMessage('not_found'));
  });
  test('attribution messages are distinct from each other', () => {
    expect(preflightErrorMessage('attribution_unknown')).not.toBe(preflightErrorMessage('attribution_changes'));
  });
});

describe('adapter registry', () => {
  test('demo checkout is recognized at exact path', () => {
    const meta = adapterFor('http://localhost:4173/checkout');
    expect(meta).toBeDefined();
    expect(meta?.merchantDomain).toBe('localhost');
  });
  test('creator referral query param does not affect checkout recognition', () => {
    // Neutral codes may be tested on pages with affiliate/creator URL markers.
    expect(adapterFor('http://localhost:4173/checkout?tag=creator-fixture')).toBeDefined();
    expect(adapterFor('http://localhost:4173/checkout?ref=partner123')).toBeDefined();
  });
  test('unregistered origins cannot select an adapter', () => {
    const unregistered = [
      'https://amazon.com/gp/cart/view.html',
      'https://example.myshopify.com/checkouts/cn/Z2NwLXVz/123',
      'http://localhost:3001/checkout',       // API origin, not checkout
      'http://localhost:4173/other',          // wrong path
      'https://localhost:4173/checkout',      // wrong protocol
      'http://localhost:9999/checkout',       // wrong port
      'http://localhost.evil.test/checkout',  // hostname spoofing
      '',
    ];
    for (const url of unregistered) {
      expect(adapterFor(url)).toBeUndefined();
    }
  });
  test('undefined url returns undefined', () => {
    expect(adapterFor(undefined)).toBeUndefined();
  });
});
