import { contentRequestSchema } from './protocol';
import { adapterFor } from './adapters/registry';
import { demoAdapter } from './adapters/demo';
import type { MerchantAdapter } from './adapters/interface';

// Content-side full-adapter lookup. The registry confirms the URL is a known
// merchant; this function maps the domain to its DOM adapter. Unregistered
// domains have no trial capability even if adapterFor returns metadata.
function contentAdapterFor(url: string): MerchantAdapter | undefined {
  const meta = adapterFor(url);
  if (meta?.merchantDomain === 'localhost') return demoAdapter;
  return undefined;
}

const adapter = contentAdapterFor(location.href);
if (adapter) {
  let running = false;
  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab || window !== window.top || !contentAdapterFor(location.href)) return false;
    const parsed = contentRequestSchema.safeParse(raw);
    if (!parsed.success) return false;
    if (parsed.data.type === 'inspect') {
      const inspection = adapter.inspect();
      sendResponse({ ok: true, data: { ...inspection, busy: running || inspection.busy } });
      return false;
    }
    if (running) { sendResponse({ ok: false, error: 'Coupon testing is already running.' }); return false; }
    running = true;
    adapter.runTrials(parsed.data.codes)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Testing stopped. Please review your order.' }))
      .finally(() => { running = false; });
    return true;
  });
  void chrome.runtime.sendMessage({ type: 'checkout-ready' }).catch(() => undefined);
}
