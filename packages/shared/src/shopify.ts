import { z } from 'zod';
import { centsSchema, couponCodeSchema } from './contracts';

// Observed on October 8, 2026 (docs/SHOPIFY-CHECKOUT-EVIDENCE.md): Shopify's
// one-page checkout runs on the store's own host at /checkouts/cn/<token>[/<locale>].
// A store is eligible only when its exact host is an operator-enabled merchant.
export function isShopifyCheckout(raw: string | undefined, enabledHosts: readonly string[]): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && enabledHosts.includes(url.hostname)
      && /^\/checkouts\/cn\/[A-Za-z0-9_-]{8,200}(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/?$/.test(url.pathname);
  } catch { return false; }
}

// An observation of the merchant's own order summary. It is not a verified
// saving, an earned commission or authority to apply codes.
export const shopifyCheckoutInspectionSchema = z.object({
  platform: z.literal('shopify'),
  status: z.enum(['ready', 'unavailable']),
  observedAt: z.iso.datetime(),
  subtotalCents: centsSchema.nullable(),
  discountCents: centsSchema.nullable(),
  totalCents: centsSchema.nullable(),
  // Shipping or taxes are not final until the shopper enters an address.
  totalIsEstimate: z.boolean(),
  discountField: z.enum(['available', 'missing']),
  codeRejected: z.boolean(),
  // Codes already applied in checkout, as Shopify labels their remove buttons.
  // They may be the shopper's or a creator's; trials never remove them.
  appliedCodes: z.array(z.string().trim().min(1).max(48)).max(10),
  reason: z.string().max(400),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'ready' && (value.subtotalCents === null || value.totalCents === null || value.discountCents === null)) {
    ctx.addIssue({code:'custom', message:'A ready checkout requires unambiguous amounts.'});
  }
  if (value.status === 'unavailable' && (value.subtotalCents !== null || value.totalCents !== null || value.discountCents !== null || value.codeRejected || value.appliedCodes.length)) {
    ctx.addIssue({code:'custom', message:'An unavailable checkout must clear previous amounts.'});
  }
});
export type ShopifyCheckoutInspection = z.infer<typeof shopifyCheckoutInspectionSchema>;

// Worker → injected content script. The worker supplies the exact enabled host;
// trial codes have already passed the shared safety gate.
export const shopifyContentRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('shopify-inspect'), host: z.string().min(1).max(253) }).strict(),
  z.object({ type: z.literal('shopify-trial'), host: z.string().min(1).max(253), codes: z.array(couponCodeSchema).min(1).max(10) }).strict(),
]);
export type ShopifyContentRequest = z.infer<typeof shopifyContentRequestSchema>;
