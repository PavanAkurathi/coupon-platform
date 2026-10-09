import type { CheckoutInspection, TrialResult } from '@repo/shared';
export {
  couponCodeSchema as codeSchema, popupRequestSchema, contentRequestSchema,
  inspectionSchema, trialResultSchema, popupStatusSchema, trialResponseSchema,
} from '@repo/shared';
export type { TrialResult, PopupStatus, ExtensionReply as Reply } from '@repo/shared';

// build.ts injects these with Bun.build `define`. Unbundled runs (bun test, tsc) get the dev values.
declare const __BUILD_TARGET__: string | undefined;
declare const __API_ORIGIN__: string | undefined;
declare const __PRICE_API_ORIGIN__: string | null | undefined;
export const BUILD_TARGET: "dev" | "beta" = typeof __BUILD_TARGET__ === "string" && __BUILD_TARGET__ === "beta" ? "beta" : "dev";
export const API_ORIGIN: string = typeof __API_ORIGIN__ === "string" ? __API_ORIGIN__ : "http://localhost:3001";
// Optional: without a price service, comparisons use only prices seen in this browser.
export const PRICE_API_ORIGIN: string | null = typeof __PRICE_API_ORIGIN__ === "string" ? __PRICE_API_ORIGIN__ : typeof __PRICE_API_ORIGIN__ === "undefined" ? "http://localhost:3002" : null;
// Chrome match patterns cannot restrict ports. Every runtime boundary does.
// Beta builds have no demo checkout, so the demo adapter never matches. Reading the define directly lets the bundler drop the literal.
export const DEMO_ORIGIN: string | null = typeof __BUILD_TARGET__ === "string" && __BUILD_TARGET__ === "beta" ? null : "http://localhost:4173";
export const unavailableCheckout = { checkout: false, busy: false, completed: false, cartKey: null, totalCents: null, appliedCode: null };

export function resultMatchesCheckout(result: TrialResult, checkout: CheckoutInspection) {
  return checkout.checkout && !checkout.busy && result.cartKey === checkout.cartKey && result.totalCents === checkout.totalCents && result.appliedCode === checkout.appliedCode;
}

export function isDemoCheckout(url: string | undefined): boolean {
  if (!url || !DEMO_ORIGIN) return false;
  try { const parsed = new URL(url); return parsed.origin === DEMO_ORIGIN && parsed.pathname === "/checkout"; }
  catch { return false; }
}
export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
