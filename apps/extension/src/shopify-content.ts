import { isShopifyCheckout, shopifyContentRequestSchema } from '@repo/shared';
import { createShopifyAdapter } from './shopify-adapter';

// Executed only in this extension's isolated world after its action is opened on a
// checkout whose exact host is an operator-enabled merchant. Reopening the popup
// must not register duplicate listeners.
const scope = globalThis as typeof globalThis & { __couponShopifyV1?: boolean };
if (window === window.top && !scope.__couponShopifyV1) {
  scope.__couponShopifyV1 = true;
  let running = false;
  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    const request = shopifyContentRequestSchema.safeParse(raw);
    // Each request re-checks the route: same-document navigation ends the capability.
    if (!request.success || !isShopifyCheckout(location.href, [request.data.host])) return false;
    const adapter = createShopifyAdapter(request.data.host);
    if (request.data.type === 'shopify-inspect') {
      sendResponse({ ok: true, data: adapter.inspect() });
      return false;
    }
    if (running) { sendResponse({ ok: false, error: 'Coupon testing is already running.' }); return false; }
    running = true;
    adapter.runTrials(request.data.codes)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Testing stopped. Please review your order.' }))
      .finally(() => { running = false; });
    return true;
  });
}
