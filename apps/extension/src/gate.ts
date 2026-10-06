import { canAutoApplyCoupon, candidatesResponseSchema, couponPreflightResponseSchema } from '@repo/shared';
import type { Candidate, CouponPreflightReason } from '@repo/shared';
import { adapterFor } from './adapters/registry';

function unexpired(expiresAt: string | null, now: number) {
  return expiresAt === null || Date.parse(expiresAt) > now;
}

// Returns the safe candidate codes. Fails closed: an empty array when merchantId
// mismatches or when all candidates fail the safety check.
export function filterSafeCandidates(
  candidates: Candidate[],
  requestMerchantId: string,
  responseMerchantId: string,
  now = Date.now(),
): string[] {
  if (responseMerchantId !== requestMerchantId) return [];
  return candidates.filter((candidate) => canAutoApplyCoupon(candidate) && unexpired(candidate.expiresAt, now)).map((c) => c.code);
}

type TrialGateDependencies<T> = {
  fetchCandidates(): Promise<unknown>;
  fetchPreflight(code: string): Promise<unknown>;
  beforeDispatch?(): Promise<void>;
  dispatch(codes: string[]): Promise<T>;
  now?(): number;
};

// The only path from a coupon API response to trial dispatch. Read-only checks
// finish before dispatch, including the worker's fresh tab check and expiry.
export async function runApprovedTrial<T>(
  request: { merchantId: string; url: string; code?: string },
  dependencies: TrialGateDependencies<T>,
): Promise<T> {
  if (!adapterFor(request.url)) throw new Error('This checkout is not supported yet.');
  const now = dependencies.now ?? Date.now;
  let codes: string[];
  if (request.code) {
    const preflight = couponPreflightResponseSchema.parse(await dependencies.fetchPreflight(request.code));
    if (preflight.merchantId !== request.merchantId || preflight.code !== request.code) {
      throw new Error('Preflight response did not match the requested code.');
    }
    if (!preflight.canAutoApply) throw new Error(preflightErrorMessage(preflight.reason));
    await dependencies.beforeDispatch?.();
    if (!unexpired(preflight.expiresAt, now())) throw new Error(preflightErrorMessage('expired'));
    codes = [request.code];
  } else {
    const response = candidatesResponseSchema.parse(await dependencies.fetchCandidates());
    await dependencies.beforeDispatch?.();
    codes = filterSafeCandidates(response.candidates, request.merchantId, response.merchantId, now());
    if (!codes.length) throw new Error('No verified codes are ready yet. Reviewed codes can still be tested below.');
  }
  return dependencies.dispatch(codes);
}

// Maps a preflight reason to a user-facing popup error string.
// Called only when canAutoApply is false; 'approved' should never arrive here.
export function preflightErrorMessage(reason: CouponPreflightReason): string {
  switch (reason) {
    case 'needs_review':
    case 'not_found':
      return 'This code is awaiting safety review and cannot be tested automatically yet.';
    case 'restricted':
      return 'This code is private or creator-specific and cannot be distributed here.';
    case 'attribution_unknown':
      return 'This code has unknown attribution behavior and cannot be applied automatically.';
    case 'attribution_changes':
      return 'Applying this code could change existing attribution and cannot be applied automatically.';
    case 'expired':
      return 'This code has expired.';
    default:
      return 'This code cannot be applied automatically. Please check back later.';
  }
}
