import type { CheckoutInspection, TrialResult } from '@repo/shared';
export {
  couponCodeSchema as codeSchema, popupRequestSchema, contentRequestSchema,
  inspectionSchema, trialResultSchema, popupStatusSchema, trialResponseSchema,
} from '@repo/shared';
export type { TrialResult, PopupStatus, ExtensionReply as Reply } from '@repo/shared';

// Chrome match patterns cannot restrict ports. Every runtime boundary does.
export const API_ORIGIN = "http://localhost:3001";
export const DEMO_ORIGIN = "http://localhost:4173";
export const unavailableCheckout = { checkout: false, busy: false, completed: false, cartKey: null, totalCents: null, appliedCode: null };

export function resultMatchesCheckout(result: TrialResult, checkout: CheckoutInspection) {
  return checkout.checkout && !checkout.busy && result.cartKey === checkout.cartKey && result.totalCents === checkout.totalCents && result.appliedCode === checkout.appliedCode;
}

export function isDemoCheckout(url: string | undefined): boolean {
  if (!url) return false;
  try { const parsed = new URL(url); return parsed.origin === DEMO_ORIGIN && parsed.pathname === "/checkout"; }
  catch { return false; }
}
export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
