import { z } from 'zod';
import { centsSchema } from './contracts';

export const amazonAsinSchema = z.string().regex(/^[A-Z0-9]{10}$/);
// Observed merchant offers are not crowdsourced codes or confirmed savings.
export const amazonOfferSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.literal('native_coupon'),
  label: z.string().min(1).max(400),
  advertisedPriceCents: centsSchema.nullable(),
  state: z.enum(['available', 'already_selected', 'unavailable']),
  purchaseRequirement: z.enum(['one_time', 'subscription', 'prime', 'unknown']),
  terms: z.array(z.string().min(1).max(400)).max(5),
}).strict();
export const amazonInspectionSchema = z.object({
  site: z.literal('amazon-us'),
  status: z.enum(['offers_found', 'no_offer', 'unavailable']),
  asin: amazonAsinSchema.nullable(),
  productTitle: z.string().max(500),
  observedAt: z.iso.datetime(),
  fingerprint: z.string().min(1).max(100),
  offers: z.array(amazonOfferSchema).max(10),
  reason: z.string().max(400),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'offers_found' && (!value.asin || !value.productTitle || !value.offers.length)) {
    ctx.addIssue({code:'custom', message:'An offer must be bound to a product.'});
  }
  if (value.status !== 'offers_found' && value.offers.length) {
    ctx.addIssue({code:'custom', message:'Unavailable states cannot carry stale offers.'});
  }
});
export const amazonFocusRequestSchema = z.object({
  type: z.literal('amazon-focus'), asin: amazonAsinSchema,
  offerId: z.string().min(1).max(100), fingerprint: z.string().min(1).max(100),
  observedAt: z.iso.datetime(),
}).strict();
export const amazonContentRequestSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('amazon-inspect')}).strict(),
  z.object({type:z.literal('amazon-checkout-inspect')}).strict(),
  amazonFocusRequestSchema,
]);
export const amazonFocusResponseSchema = z.object({focused:z.literal(true)}).strict();
export type AmazonInspection = z.infer<typeof amazonInspectionSchema>;
export type AmazonOffer = z.infer<typeof amazonOfferSchema>;
export type AmazonFocusRequest = z.infer<typeof amazonFocusRequestSchema>;

export function amazonProductAsin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.origin !== 'https://www.amazon.com' || url.username || url.password) return null;
    const match = url.pathname.match(/^\/(?:[^/]+\/)?dp\/([A-Z0-9]{10})(?:\/|$)/)
      ?? url.pathname.match(/^\/gp\/product\/([A-Z0-9]{10})(?:\/|$)/);
    return match?.[1] ?? null;
  } catch { return null; }
}

// A merchant checkout summary is an observation, not a placed order, earned
// commission, shopper report or proof that this extension caused the saving.
export const amazonCheckoutInspectionSchema = z.object({
  site: z.literal('amazon-us'),
  status: z.enum(['review_ready', 'unavailable']),
  observedAt: z.iso.datetime(),
  couponSavingsCents: centsSchema.nullable(),
  orderTotalCents: centsSchema.nullable(),
  reason: z.string().max(400),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'review_ready' && (value.couponSavingsCents === null || value.orderTotalCents === null)) {
    ctx.addIssue({code:'custom', message:'A checkout observation requires unambiguous amounts.'});
  }
  if (value.status === 'unavailable' && (value.couponSavingsCents !== null || value.orderTotalCents !== null)) {
    ctx.addIssue({code:'custom', message:'An unavailable checkout must clear previous amounts.'});
  }
});
export type AmazonCheckoutInspection = z.infer<typeof amazonCheckoutInspectionSchema>;
export function isAmazonCheckout(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.origin === 'https://www.amazon.com' && !url.username && !url.password
      && /^\/checkout\/p\/[^/]+(?:\/|$)/.test(url.pathname);
  } catch { return false; }
}
