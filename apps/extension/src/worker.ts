import { candidatesResponseSchema, checkoutReadySchema, couponPreflightResponseSchema, couponReportSchema, couponReportResponseSchema, merchantsResponseSchema } from '@repo/shared';
import { z } from 'zod';
import { API_ORIGIN, inspectionSchema, popupRequestSchema, resultMatchesCheckout, trialResultSchema, unavailableCheckout, type PopupStatus, type Reply, type TrialResult } from './protocol';
import { adapterFor } from './adapters/registry';
import { runApprovedTrial } from './gate';

const running = new Set<number>();
const secureStorage = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
type Merchant = z.infer<typeof merchantsResponseSchema>['merchants'][number];

async function api<T>(path: string, schema: z.ZodType<T>, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    method: body ? 'POST' : 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Your shopper token was not accepted. Update it in settings.');
    if (response.status === 429) throw new Error('Too many reports for now. Please try again later.');
    throw new Error('The coupon service is unavailable. Please try again shortly.');
  }
  return schema.parse(await response.json());
}
async function merchantFor(tab: chrome.tabs.Tab): Promise<Merchant | undefined> {
  const meta = adapterFor(tab.url);
  if (!meta) return undefined;
  const { merchants } = await api('/v1/merchants', merchantsResponseSchema);
  // New merchants need a reviewed adapter + manifest access before activation.
  return merchants.find((merchant) => merchant.domain === meta.merchantDomain);
}
async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Open a supported checkout first.');
  return tab;
}
async function inspect(tabId: number) {
  try {
    const reply: Reply<unknown> = await chrome.tabs.sendMessage(tabId, { type: 'inspect' }, { frameId: 0 });
    return reply?.ok ? inspectionSchema.parse(reply.data) : unavailableCheckout;
  } catch { return unavailableCheckout; }
}
async function badge(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) return;
  let supported = false;
  try { supported = Boolean(await merchantFor(tab)); } catch { /* Offline is not supported. */ }
  await chrome.action.setBadgeText({ tabId: tab.id, text: supported ? '$' : '' });
  if (supported) await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#215748' });
}
async function status(): Promise<PopupStatus> {
  await secureStorage;
  const tab = await activeTab(); const tabId = tab.id!;
  const { shopperToken } = await chrome.storage.local.get('shopperToken');
  const merchant = await merchantFor(tab);
  const checkout = merchant ? await inspect(tabId) : unavailableCheckout;
  const saved = await chrome.storage.session.get(`result:${tabId}`);
  let last = saved[`result:${tabId}`] as { result?: TrialResult; reportNote?: string } | undefined;
  if (last?.result && !resultMatchesCheckout(last.result, checkout)) { last = undefined; await chrome.storage.session.remove(`result:${tabId}`); }
  return { supported: Boolean(merchant), merchantName: merchant?.name, ...checkout, busy: running.has(tabId) || checkout.busy, hasToken: Boolean(shopperToken), ...last };
}
async function run(code?: string): Promise<{ result: TrialResult; reportNote: string }> {
  await secureStorage;
  const tab = await activeTab(); const tabId = tab.id!;
  if (running.has(tabId)) throw new Error('Coupon testing is already running.');
  running.add(tabId);
  try {
    const merchant = await merchantFor(tab);
    if (!merchant) throw new Error('This store is not supported yet. Try the local demo checkout.');
    const checkout = await inspect(tabId);
    if (!checkout.checkout || checkout.busy || checkout.completed) throw new Error('Open an active checkout, wait for it to finish updating, then try again.');
    const { shopperToken } = await chrome.storage.local.get('shopperToken');
    const token = typeof shopperToken === 'string' ? shopperToken : undefined;
    if (code && !token) throw new Error('Add your shopper token before testing a community code.');

    const raw = await runApprovedTrial<Reply<unknown>>({ merchantId: merchant.id, url: tab.url!, code }, {
      fetchPreflight: (requestedCode) => api(
        `/v1/coupons/preflight?merchantId=${encodeURIComponent(merchant.id)}&code=${encodeURIComponent(requestedCode)}`,
        couponPreflightResponseSchema,
      ),
      fetchCandidates: () => api(
        `/v1/coupons/candidates?merchantId=${encodeURIComponent(merchant.id)}&limit=10`,
        candidatesResponseSchema,
      ),
      beforeDispatch: async () => {
        const currentTab = await chrome.tabs.get(tabId);
        if (currentTab.url !== tab.url || !adapterFor(currentTab.url)) throw new Error('The checkout changed. Open the extension again.');
      },
      dispatch: (codes) => chrome.tabs.sendMessage(tabId, { type: 'trial', codes }, { frameId: 0 }),
    });
    if (!raw?.ok) throw new Error(raw && !raw.ok ? raw.error : 'The checkout did not respond. Please review your coupon and total.');
    const result = trialResultSchema.parse(raw.data);
    let reportNote = token ? 'No new verification results to share.' : 'Add a shopper token to share verification results.';
    if (token) {
      let failed = 0;
      for (const attempt of result.attempts) {
        try {
          await api('/v1/coupons/report', couponReportResponseSchema, couponReportSchema.parse({ merchantId: merchant.id, ...attempt, currency: 'USD' }), token);
        } catch { failed++; }
      }
      if (failed) reportNote = 'Testing finished, but some verification reports could not be saved. Check your token or connection.';
      else if (result.attempts.length) reportNote = 'Your results helped check these codes.';
    }
    const response = { result, reportNote };
    if (!resultMatchesCheckout(result, await inspect(tabId))) throw new Error('Your cart changed after testing. Please check your coupon and total.');
    await chrome.storage.session.set({ [`result:${tabId}`]: response });
    return response;
  } finally { running.delete(tabId); }
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.tab) {
    if (sender.frameId === 0 && adapterFor(sender.url) && checkoutReadySchema.safeParse(raw).success) {
      void badge(sender.tab).catch(() => undefined);
    }
    return false;
  }
  if (sender.url !== chrome.runtime.getURL('popup.html')) return false;
  const request = popupRequestSchema.safeParse(raw);
  if (!request.success) { sendResponse({ ok: false, error: 'Invalid request.' }); return false; }
  const handle = async (): Promise<unknown> => {
    const data = request.data;
    if (data.type === 'status') return status();
    if (data.type === 'run') return run();
    if (data.type === 'try-code') return run(data.code);
    await secureStorage;
    if (data.token) await chrome.storage.local.set({ shopperToken: data.token });
    else await chrome.storage.local.remove('shopperToken');
    return { saved: Boolean(data.token) };
  };
  handle().then((data) => sendResponse({ ok: true, data })).catch((error: unknown) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Something went wrong. Please try again.' });
  });
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'loading' || change.url) void chrome.storage.session.remove(`result:${tabId}`);
  if (change.status === 'complete' || change.url) void badge(tab).catch(() => undefined);
});
chrome.tabs.onRemoved.addListener((tabId) => { running.delete(tabId); void chrome.storage.session.remove(`result:${tabId}`); });
chrome.runtime.onInstalled.addListener(() => { void chrome.tabs.query({}).then((tabs) => Promise.all(tabs.map(badge))).catch(() => undefined); });
