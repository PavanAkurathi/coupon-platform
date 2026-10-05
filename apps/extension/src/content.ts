import { contentRequestSchema, isDemoCheckout } from "./protocol";
import { inspectCheckout, runTrials } from "./adapter";

if (isDemoCheckout(location.href)) {
  let running = false;
  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab || window !== window.top || !isDemoCheckout(location.href)) return false;
    const parsed = contentRequestSchema.safeParse(raw);
    if (!parsed.success) return false;
    if (parsed.data.type === "inspect") {
      sendResponse({ ok: true, data: { ...inspectCheckout(), busy: running || inspectCheckout().busy } });
      return false;
    }
    if (running) { sendResponse({ ok: false, error: "Coupon testing is already running." }); return false; }
    running = true;
    runTrials(parsed.data.codes)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Testing stopped. Please review your order." }))
      .finally(() => { running = false; });
    return true;
  });
  void chrome.runtime.sendMessage({ type: "checkout-ready" }).catch(() => undefined);
}
