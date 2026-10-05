import { z } from 'zod';
import { centsSchema, currencySchema } from './contracts';

// This module never authorizes setting attribution. An existing, merchant-attested
// commission may be allocated later; acquiring attribution requires a separate design.
export const attributionSchema = z.enum(['earned', 'creator', 'other', 'unknown']);
export const settlementEvidenceSchema = z.object({
  orderStatus: z.enum(['pending', 'confirmed', 'refunded']),
  currency: currencySchema,
  savingsCents: centsSchema,
  // Improvement versus the shopper's original total, including any existing code.
  additionalSavingsCents: centsSchema,
  merchantCommissionCents: centsSchema,
  attribution: attributionSchema,
  creatorLinkDetected: z.boolean(),
  merchantVerified: z.boolean(),
}).strict().refine((evidence) => evidence.additionalSavingsCents <= evidence.savingsCents,
  {message: 'Additional savings cannot exceed total shopper savings.', path: ['additionalSavingsCents']});
export type SettlementEvidence = z.infer<typeof settlementEvidenceSchema>;

export function attributionPolicy(attribution: z.infer<typeof attributionSchema>, creatorLinkDetected = false) {
  return {
    couponsAllowed: true,
    mayWriteAffiliateCookie: false as const,
    mayClaimCommission: attribution === 'earned' && !creatorLinkDetected,
  };
}

// Pure policy only. Call ONLY with authenticated merchant evidence in phase 3,
// never with a browser request body. Stubs expose no settlement mutation route.
export function allocateOrderCommission(input: SettlementEvidence) {
  const evidence = settlementEvidenceSchema.parse(input);
  const eligible = evidence.orderStatus === 'confirmed' && evidence.merchantVerified &&
    evidence.additionalSavingsCents > 0 && evidence.merchantCommissionCents >= 100 &&
    attributionPolicy(evidence.attribution, evidence.creatorLinkDetected).mayClaimCommission;
  return {
    feeCents: eligible ? 100 : 0,
    userSavingsCents: evidence.savingsCents,
    remainingMerchantCommissionCents: evidence.merchantCommissionCents - (eligible ? 100 : 0),
  };
}

export const confirmedEarningsSchema = z.object({
  savingsCents: centsSchema,
  feeCents: z.union([z.literal(0), z.literal(100)]),
}).strict().refine((receipt) => receipt.feeCents === 0 || receipt.savingsCents > 0);

export function confirmedEarningsLine(input: z.infer<typeof confirmedEarningsSchema>) {
  const receipt = confirmedEarningsSchema.parse(input);
  return `You saved $${(receipt.savingsCents / 100).toFixed(2)}. We made $${receipt.feeCents / 100}.`;
}

// A hint for UI/stand-down only; absence of a URL marker NEVER proves ownership.
export function hasAffiliateMarker(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return [...url.searchParams.keys()].some((key) => /^(?:aff(?:iliate)?(?:_?id)?|ref(?:errer)?|tag|irclickid|clickid|cjevent|awc|ranmid|raneaid|rancid|partner|creator)$/i.test(key));
  } catch { return true; }
}
