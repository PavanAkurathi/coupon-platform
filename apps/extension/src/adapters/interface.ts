import type { CheckoutInspection, TrialResult } from '@repo/shared';

// Worker-safe URL/domain metadata. No DOM imports; safe to use in the service worker.
export type AdapterMeta = {
  readonly merchantDomain: string;
  supports(url: string): boolean;
};

// Full DOM adapter — import only in content scripts, never in the service worker.
export type MerchantAdapter = AdapterMeta & {
  inspect(): CheckoutInspection;
  runTrials(codes: string[]): Promise<TrialResult>;
};
