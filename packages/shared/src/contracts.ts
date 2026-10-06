import { z } from 'zod';
import { canAutoApplyCoupon, couponPreflightReasonSchema, couponSafetySchema } from './coupon-policy';

export const currencySchema = z.literal('USD');
export const centsSchema = z.number().int().min(0).max(100_000_000);
export const couponCodeSchema = z.string().trim().toUpperCase().min(2).max(48).regex(/^[A-Z0-9_-]+$/);
export const couponStatusSchema = z.enum(['quarantined', 'verified']);
export const candidatesQuerySchema = z.object({
  merchantId: z.uuid(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
}).strict();
export const candidateSchema = z.object({
  id: z.uuid(),
  code: couponCodeSchema,
  successRate: z.number().min(0).max(1),
  expectedSavingsCents: centsSchema,
  score: z.number().nonnegative(),
  confirmations: z.number().int().min(3),
  expiresAt: z.iso.datetime().nullable(),
  ...couponSafetySchema.shape,
}).strict();
export const couponPreflightQuerySchema = z.object({merchantId: z.uuid(), code: couponCodeSchema}).strict();
// A reviewed, quarantined code may be tested by a shopper but is never suggested
// automatically until it also has three successful independent confirmations.
export const couponPreflightResponseSchema = z.object({
  merchantId: z.uuid(), code: couponCodeSchema,
  canAutoApply: z.boolean(), reason: couponPreflightReasonSchema,
  expiresAt: z.iso.datetime().nullable(), ...couponSafetySchema.shape,
}).strict().superRefine((response, ctx) => {
  if ((response.canAutoApply && (response.reason !== 'approved' || !canAutoApplyCoupon(response))) ||
      (!response.canAutoApply && response.reason === 'approved')) {
    ctx.addIssue({code:'custom', message:'Preflight decision must match approval evidence.'});
  }
});
export const candidatesResponseSchema = z.object({
  merchantId: z.uuid(), currency: currencySchema, candidates: z.array(candidateSchema),
}).strict();
export const couponReportSchema = z.object({
  merchantId: z.uuid(), code: couponCodeSchema,
  outcome: z.enum(['success', 'failure']),
  savingsCents: centsSchema, currency: currencySchema,
}).strict().superRefine((report, ctx) => {
  if ((report.outcome === 'success' && report.savingsCents <= 0) ||
      (report.outcome === 'failure' && report.savingsCents !== 0)) {
    ctx.addIssue({code: 'custom', path: ['savingsCents'], message: 'Success requires positive measured savings; failure requires zero.'});
  }
});
export const couponReportResponseSchema = z.object({
  couponId: z.uuid(), status: couponStatusSchema,
  confirmations: z.number().int().nonnegative(), successRate: z.number().min(0).max(1),
}).strict();
export const merchantSchema = z.object({
  id: z.uuid(), domain: z.string().min(1).max(253), name: z.string().min(1).max(100), currency: currencySchema,
}).strict();
export const merchantsResponseSchema = z.object({merchants: z.array(merchantSchema)}).strict();
export const errorResponseSchema = z.object({error: z.object({code: z.string(), message: z.string()}).strict()}).strict();
export const healthResponseSchema = z.object({
  service: z.string(), status: z.enum(['ok', 'degraded']),
  dependencies: z.record(z.string(), z.enum(['up', 'down'])).optional(),
  phase: z.number().int().optional(),
}).strict();
export const stubResponseSchema = z.object({
  service: z.enum(['price-service', 'cashback-service']),
  status: z.literal('not_implemented'), phase: z.union([z.literal(2), z.literal(3)]), message: z.string(),
}).strict();
export type Candidate = z.infer<typeof candidateSchema>;
export type CouponReport = z.infer<typeof couponReportSchema>;
export type CouponReportResponse = z.infer<typeof couponReportResponseSchema>;
export type Merchant = z.infer<typeof merchantSchema>;
