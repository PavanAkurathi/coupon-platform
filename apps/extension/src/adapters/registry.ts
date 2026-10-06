import { isDemoCheckout } from '../protocol';
import type { AdapterMeta } from './interface';

// Exact-match entries only. Adding a new merchant requires a reviewed adapter
// implementation plus explicit manifest host_permissions. No wildcard or
// suffix matching — merchant.domain is a bare hostname (e.g. "localhost").
const DEMO_META: AdapterMeta = {
  merchantDomain: 'localhost',
  supports: isDemoCheckout,
};

const ADAPTERS: readonly AdapterMeta[] = [DEMO_META];

export function adapterFor(url: string | undefined): AdapterMeta | undefined {
  if (!url) return undefined;
  return ADAPTERS.find((a) => a.supports(url));
}
