import { canAutoApplyCoupon, type Candidate, type TrialResult } from '@repo/shared';

// A published discount is not savings caused by this test. Keep the two values
// separate even when the shopper started with a better code already applied.
export function trialDisplay(result: TrialResult) {
  return {
    additionalSavingsCents: result.additionalSavingsCents,
    discountCents: result.savingsCents,
    totalCents: result.totalCents,
    headline: result.additionalSavingsCents > 0 ? 'A better total.' : 'Nothing beat your starting price.',
  };
}

export function eligibleCandidates(candidates: Candidate[], now = Date.now()): Candidate[] {
  return candidates.filter((candidate) => canAutoApplyCoupon(candidate)
    && Date.parse(candidate.lastConfirmedAt) <= now
    && Date.parse(candidate.lastConfirmedAt) >= now - 30 * 24 * 60 * 60_000
    && (!candidate.expiresAt || Date.parse(candidate.expiresAt) > now));
}

export type PageBinding = { tabId: number; url: string };
export function sameBinding(binding: PageBinding, tab: { id?: number; url?: string; status?: string } | undefined): boolean {
  return tab?.id === binding.tabId && tab.url === binding.url && tab.status !== 'loading';
}
