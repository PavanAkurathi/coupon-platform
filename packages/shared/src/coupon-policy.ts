import { z } from 'zod';

// Shopper success and operator safety approval are independent decisions.
export const couponSafetySchema = z.object({
  approvalStatus: z.enum(['pending', 'approved', 'rejected']),
  audience: z.enum(['unknown', 'public', 'private', 'creator']),
  attributionBehavior: z.enum(['unknown', 'neutral', 'affiliate']),
  reviewedAt: z.iso.datetime().nullable(),
  evidenceRef: z.string().trim().min(1).max(2000).nullable(),
});
export type CouponSafety = z.infer<typeof couponSafetySchema>;
export const unreviewedCouponSafety: CouponSafety = {
  approvalStatus: 'pending', audience: 'unknown', attributionBehavior: 'unknown',
  reviewedAt: null, evidenceRef: null,
};
export const couponPreflightReasonSchema = z.enum([
  'approved', 'needs_review', 'restricted', 'attribution_unknown', 'attribution_changes', 'expired', 'not_found',
]);
export type CouponPreflightReason = z.infer<typeof couponPreflightReasonSchema>;

export function couponSafetyReason(input: unknown): CouponPreflightReason {
  const parsed = couponSafetySchema.safeParse(input);
  if (!parsed.success) return 'needs_review';
  const safety = parsed.data;
  if (safety.approvalStatus !== 'approved' || !safety.reviewedAt || !safety.evidenceRef) return 'needs_review';
  if (safety.audience !== 'public') return 'restricted';
  if (safety.attributionBehavior === 'unknown') return 'attribution_unknown';
  if (safety.attributionBehavior !== 'neutral') return 'attribution_changes';
  return 'approved';
}
export function canAutoApplyCoupon(input: unknown): boolean {
  return couponSafetyReason(input) === 'approved';
}
