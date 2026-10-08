import { z } from 'zod';
import { centsSchema, couponCodeSchema } from './contracts';
import { amazonFocusRequestSchema, amazonInspectionSchema, amazonCheckoutInspectionSchema } from './amazon';

export const popupRequestSchema = z.discriminatedUnion('type', [
  amazonFocusRequestSchema,
  z.object({ type: z.literal('status') }).strict(),
  z.object({ type: z.literal('run') }).strict(),
  z.object({ type: z.literal('try-code'), code: couponCodeSchema }).strict(),
  z.object({ type: z.literal('save-token'), token: z.string().trim().max(512).regex(/^[A-Za-z0-9._~-]*$/) }).strict(),
]);
export const contentRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inspect') }).strict(),
  z.object({ type: z.literal('trial'), codes: z.array(couponCodeSchema).min(1).max(10) }).strict(),
]);
export const checkoutReadySchema = z.object({ type: z.literal('checkout-ready') }).strict();
export const inspectionSchema = z.object({
  checkout: z.boolean(), busy: z.boolean(), completed: z.boolean(),
  cartKey: z.string().nullable(), totalCents: centsSchema.nullable(), appliedCode: z.string().nullable(),
}).strict();
export const trialResultSchema = z.object({
  cartKey: z.string(), savingsCents: centsSchema, additionalSavingsCents: centsSchema,
  appliedCode: z.string().max(48), totalCents: centsSchema,
  attempts: z.array(z.object({
    code: couponCodeSchema, outcome: z.enum(['success', 'failure']), savingsCents: centsSchema,
  }).strict().refine((attempt) => attempt.outcome === 'success' ? attempt.savingsCents > 0 : attempt.savingsCents === 0)).max(10),
}).strict();
export const trialResponseSchema = z.object({ result: trialResultSchema, reportNote: z.string() }).strict();
export const popupStatusSchema = inspectionSchema.extend({
  amazon: amazonInspectionSchema.optional(),
  amazonCheckout: amazonCheckoutInspectionSchema.optional(),
  supported: z.boolean(), hasToken: z.boolean(), merchantName: z.string().optional(),
  result: trialResultSchema.optional(), reportNote: z.string().optional(),
}).strict();
export type CheckoutInspection = z.infer<typeof inspectionSchema>;
export type TrialResult = z.infer<typeof trialResultSchema>;
export type PopupStatus = z.infer<typeof popupStatusSchema>;
export type ExtensionReply<T> = { ok: true; data: T } | { ok: false; error: string };
