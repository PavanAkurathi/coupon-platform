import type { MerchantAdapter } from './interface';
import { isDemoCheckout } from '../protocol';
import { inspectCheckout, runTrials } from '../adapter';

// Full adapter including DOM operations. Import in content scripts only.
export const demoAdapter: MerchantAdapter = {
  merchantDomain: 'localhost',
  supports: isDemoCheckout,
  inspect: inspectCheckout,
  runTrials,
};
