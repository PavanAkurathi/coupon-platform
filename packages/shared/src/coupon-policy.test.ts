import { expect, test } from 'bun:test';
import { canAutoApplyCoupon, couponSafetyReason, unreviewedCouponSafety, type CouponSafety } from './coupon-policy';

const reviewed: CouponSafety = { approvalStatus: 'approved', audience: 'public', attributionBehavior: 'neutral', reviewedAt: '2026-10-05T12:00:00.000Z', evidenceRef: 'merchant-review:public-neutral-code' };
test('only evidence-backed public neutral codes can be automatically applied', () => {
  expect(canAutoApplyCoupon(reviewed)).toBe(true);
  expect(canAutoApplyCoupon({...reviewed, id: crypto.randomUUID(), confirmations: 3})).toBe(true);
  expect(canAutoApplyCoupon(unreviewedCouponSafety)).toBe(false);
  expect(canAutoApplyCoupon({confirmations: 999, status: 'verified'})).toBe(false);
});
for (const patch of [
  {approvalStatus: 'pending'}, {approvalStatus: 'rejected'},
  {audience: 'unknown'}, {audience: 'private'}, {audience: 'creator'},
  {attributionBehavior: 'unknown'}, {attributionBehavior: 'affiliate'},
  {reviewedAt: null}, {evidenceRef: null}, {evidenceRef: '   '}, {reviewedAt: 'not-a-date'},
]) {
  test(`blocks unsafe metadata ${JSON.stringify(patch)}`, () => expect(canAutoApplyCoupon({...reviewed,...patch})).toBe(false));
}
test('decision describes why an automatic trial is blocked', () => {
  expect(couponSafetyReason({...reviewed,audience:'creator'})).toBe('restricted');
  expect(couponSafetyReason({...reviewed,attributionBehavior:'unknown'})).toBe('attribution_unknown');
  expect(couponSafetyReason({...reviewed,attributionBehavior:'affiliate'})).toBe('attribution_changes');
});
