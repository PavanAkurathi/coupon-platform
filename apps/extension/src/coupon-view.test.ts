import { describe, expect, test } from 'bun:test';
import { eligibleCandidates, sameBinding, trialDisplay } from './coupon-view';
import type { Candidate, TrialResult } from '@repo/shared';

const now = Date.parse('2026-10-14T12:00:00Z');
const code: Candidate = {
  id: '7cc870b1-7349-4566-b6ae-73852a308e4c', code: 'SAVE10', successRate: 1,
  expectedSavingsCents: 1000, score: 1, confirmations: 3,
  lastConfirmedAt: '2026-10-14T11:00:00Z', expiresAt: null,
  approvalStatus: 'approved', audience: 'public', attributionBehavior: 'neutral',
  reviewedAt: '2026-10-13T12:00:00Z', evidenceRef: 'fixture:operator-review',
};
const trial: TrialResult = { cartKey: 'fixture', savingsCents: 2000, additionalSavingsCents: 0,
  appliedCode: 'EXISTING20', totalCents: 8000, attempts: [{ code: 'SAVE10', outcome: 'success', savingsCents: 1000 }] };

describe('coupon surface evidence', () => {
  test('an existing discount is never counted as savings from the current test', () => {
    expect(trialDisplay(trial)).toEqual({ additionalSavingsCents: 0, discountCents: 2000, totalCents: 8000, headline: 'Nothing beat your starting price.' });
    expect(trialDisplay({ ...trial, savingsCents: 2500, additionalSavingsCents: 500 }).additionalSavingsCents).toBe(500);
  });
  test('a reviewed public code loses eligibility when its evidence expires or attribution is unknown', () => {
    expect(eligibleCandidates([code], now)).toEqual([code]);
    for (const change of [
      { attributionBehavior: 'unknown' }, { audience: 'creator' }, { approvalStatus: 'pending' },
      { reviewedAt: null }, { lastConfirmedAt: '2026-09-01T00:00:00Z' },
      { lastConfirmedAt: '2026-10-15T00:00:00Z' }, { expiresAt: '2026-10-14T12:00:00Z' },
    ] as Partial<Candidate>[]) expect(eligibleCandidates([{ ...code, ...change }], now)).toEqual([]);
  });
  test('tab switches, same-tab navigation and a loading document invalidate an observed page', () => {
    const binding = { tabId: 1, url: 'https://store.example/checkout/first' };
    expect(sameBinding(binding, { id: 1, url: binding.url, status: 'complete' })).toBe(true);
    expect(sameBinding(binding, { id: 2, url: binding.url })).toBe(false);
    expect(sameBinding(binding, { id: 1, url: 'https://store.example/checkout/next' })).toBe(false);
    expect(sameBinding(binding, { id: 1, url: binding.url, status: 'loading' })).toBe(false);
  });
});
