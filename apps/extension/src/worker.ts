import { candidatesResponseSchema, checkoutReadySchema, couponPreflightResponseSchema, couponReportSchema, couponReportResponseSchema, merchantsResponseSchema, amazonProductAsin, amazonInspectionSchema, amazonFocusResponseSchema, amazonCheckoutInspectionSchema, isAmazonCheckout } from '@repo/shared';
import type { AmazonInspection, AmazonFocusRequest, AmazonCheckoutInspection } from '@repo/shared';
import { z } from 'zod';
import { API_ORIGIN, inspectionSchema, popupRequestSchema, resultMatchesCheckout, trialResultSchema, unavailableCheckout, type PopupStatus, type Reply, type TrialResult } from './protocol';
import { adapterFor } from './adapters/registry';
import { runApprovedTrial } from './gate';

const running = new Set<number>();
const badgeGenerations = new Map<number, number>();
function nextBadgeGeneration(tabId: number): number {
  const generation = (badgeGenerations.get(tabId) ?? 0) + 1;
  badgeGenerations.set(tabId, generation);
  return generation;
}
const secureStorage = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);
type Merchant = z.infer<typeof merchantsResponseSchema>['merchants'][number];

const SERVICE_UNAVAILABLE = 'The coupon service is unavailable. Please try again shortly.';
async function api<T>(path: string, schema: z.ZodType<T>, body?: unknown, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method: body ? 'POST' : 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Network, CSP and timeout failures (TypeError/AbortError/TimeoutError) never surface browser wording.
    throw new Error(SERVICE_UNAVAILABLE);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Your shopper token was not accepted. Update it in settings.');
    if (response.status === 429) throw new Error('Too many reports for now. Please try again later.');
    throw new Error(SERVICE_UNAVAILABLE);
  }
  // A body timeout or an unexpected payload is reported the same way.
  try { return schema.parse(await response.json()); }
  catch { throw new Error(SERVICE_UNAVAILABLE); }
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

async function inspectAmazon(tab: chrome.tabs.Tab): Promise<AmazonInspection> {
  const tabId = tab.id;
  const asin = amazonProductAsin(tab.url);
  const fallback: AmazonInspection = {
    site: 'amazon-us', status: 'unavailable', asin,
    productTitle: '', observedAt: new Date().toISOString(),
    fingerprint: 'unavailable', offers: [], reason: 'Could not load the coupon reader.',
  };
  if (!tabId) return fallback;
  const urlBefore = tab.url;
  try {
    const [injected] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['amazon-content.js'] });
    const currentTab = await chrome.tabs.get(tabId);
    if (currentTab.url !== urlBefore) return { ...fallback, reason: 'The page changed during inspection.' };
    // Use documentId when available so the reply is bound to the exact injected document.
    const sendOptions = injected?.documentId != null
      ? ({ documentId: injected.documentId } as chrome.tabs.MessageSendOptions)
      : { frameId: 0 };
    const reply: Reply<unknown> = await chrome.tabs.sendMessage(tabId, { type: 'amazon-inspect' }, sendOptions);
    if ((await chrome.tabs.get(tabId)).url !== urlBefore) return { ...fallback, reason: 'The page changed during inspection.' };
    if (!reply?.ok) return fallback;
    const inspection = amazonInspectionSchema.parse(reply.data);
    if (inspection.asin !== asin) return { ...fallback, reason: 'Product mismatch during inspection.' };
    return inspection;
  } catch { return fallback; }
}

// Read-only order-summary observation. It never grants trial, apply or purchase
// authority, and nothing from it is stored or sent to the coupon service.
const CHECKOUT_OBSERVATION_MAX_AGE_MS = 60 * 1000;
async function inspectAmazonCheckout(tab: chrome.tabs.Tab): Promise<AmazonCheckoutInspection> {
  const unavailable = (reason: string): AmazonCheckoutInspection => ({
    site: 'amazon-us', status: 'unavailable', observedAt: new Date().toISOString(),
    couponSavingsCents: null, orderTotalCents: null, reason,
  });
  const fallback = unavailable('Could not read the Amazon order summary.');
  const changed = unavailable('The checkout page changed while it was being read.');
  const tabId = tab.id;
  const urlBefore = tab.url;
  if (!tabId || !isAmazonCheckout(urlBefore)) return fallback;
  const unchanged = async () => {
    const current = await chrome.tabs.get(tabId);
    return current.url === urlBefore && isAmazonCheckout(current.url);
  };
  try {
    if (!await unchanged()) return changed;
    const [injected] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['amazon-content.js'] });
    if (!await unchanged()) return changed;
    const sendOptions = injected?.documentId != null
      ? ({ documentId: injected.documentId } as chrome.tabs.MessageSendOptions)
      : { frameId: 0 };
    const reply: Reply<unknown> = await chrome.tabs.sendMessage(tabId, { type: 'amazon-checkout-inspect' }, sendOptions);
    if (!await unchanged()) return changed;
    if (!reply?.ok) return fallback;
    const inspection = amazonCheckoutInspectionSchema.parse(reply.data);
    const observedMs = Date.parse(inspection.observedAt);
    const now = Date.now();
    if (isNaN(observedMs) || observedMs > now || now - observedMs > CHECKOUT_OBSERVATION_MAX_AGE_MS) {
      return unavailable('The order summary reading was out of date. Check totals again.');
    }
    return inspection;
  } catch { return fallback; }
}

async function badge(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) return;
  const generation = nextBadgeGeneration(tab.id);
  let supported = false;
  try { supported = Boolean(await merchantFor(tab)); } catch { /* Offline is not supported. */ }
  const current = await chrome.tabs.get(tab.id);
  if (badgeGenerations.get(tab.id) !== generation || current.url !== tab.url || current.status === 'loading') return;
  await chrome.action.setBadgeText({ tabId: tab.id, text: supported ? '$' : '' });
  if (supported) await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#215748' });
}
async function status(): Promise<PopupStatus> {
  await secureStorage;
  const tab = await activeTab(); const tabId = tab.id!;
  const { shopperToken } = await chrome.storage.local.get('shopperToken');

  // Amazon checkout review — checked before the product and merchant/API branches.
  if (isAmazonCheckout(tab.url)) {
    const generation = nextBadgeGeneration(tabId);
    const amazonCheckout = await inspectAmazonCheckout(tab);
    const couponShown = amazonCheckout.status === 'review_ready' && (amazonCheckout.couponSavingsCents ?? 0) > 0;
    if (badgeGenerations.get(tabId) === generation && (await chrome.tabs.get(tabId)).url === tab.url) {
      await chrome.action.setBadgeText({ tabId, text: couponShown ? '$' : '' });
      if (couponShown) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#215748' });
    }
    // Not stored in session; the response carries no URL or checkout session ID.
    return { ...unavailableCheckout, supported: false, hasToken: Boolean(shopperToken), amazonCheckout };
  }

  // Amazon product inspection — before any merchant API calls; no DB dependency.
  const asin = amazonProductAsin(tab.url);
  const amazonPage = tab.url?.startsWith('https://www.amazon.com/');
  if (amazonPage) {
    const generation = nextBadgeGeneration(tabId);
    const amazon: AmazonInspection = asin ? await inspectAmazon(tab) : {
      site: 'amazon-us', status: 'unavailable', asin: null, productTitle: '',
      observedAt: new Date().toISOString(), fingerprint: 'unsupported-page', offers: [],
      reason: 'Open an Amazon.com product page to check visible coupons, or your order review page to see the coupon savings Amazon shows. Codes are not tested on Amazon.',
    };
    if (badgeGenerations.get(tabId) === generation && (await chrome.tabs.get(tabId)).url === tab.url) {
      await chrome.action.setBadgeText({ tabId, text: amazon.status === 'offers_found' ? '$' : '' });
      if (amazon.status === 'offers_found') await chrome.action.setBadgeBackgroundColor({ tabId, color: '#215748' });
    }
    // Not stored in session — observations are ephemeral and not verified.
    return { ...unavailableCheckout, supported: false, hasToken: Boolean(shopperToken), amazon };
  }

  const merchant = await merchantFor(tab);
  const checkout = merchant ? await inspect(tabId) : unavailableCheckout;
  const saved = await chrome.storage.session.get(`result:${tabId}`);
  let last = saved[`result:${tabId}`] as { result?: TrialResult; reportNote?: string } | undefined;
  if (last?.result && !resultMatchesCheckout(last.result, checkout)) { last = undefined; await chrome.storage.session.remove(`result:${tabId}`); }
  return { supported: Boolean(merchant), merchantName: merchant?.name, ...checkout, busy: running.has(tabId) || checkout.busy, hasToken: Boolean(shopperToken), ...last };
}

async function focusAmazon(data: AmazonFocusRequest): Promise<{ focused: true }> {
  const tab = await activeTab(); const tabId = tab.id!;
  if (amazonProductAsin(tab.url) !== data.asin) throw new Error('This offer is no longer visible. Please reopen the extension on the product page.');
  const observedMs = Date.parse(data.observedAt);
  const now = Date.now();
  if (isNaN(observedMs) || observedMs > now || now - observedMs > 2 * 60 * 1000) {
    throw new Error('The offer observation has expired. Please open the extension again.');
  }
  const urlBefore = tab.url;
  const [injected] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['amazon-content.js'] });
  const currentTab = await chrome.tabs.get(tabId);
  if (currentTab.url !== urlBefore) throw new Error('The page changed before the coupon control could be shown.');
  const sendOptions = injected?.documentId != null
    ? ({ documentId: injected.documentId } as chrome.tabs.MessageSendOptions)
    : { frameId: 0 };
  const reply: Reply<unknown> = await chrome.tabs.sendMessage(tabId, data, sendOptions);
  if ((await chrome.tabs.get(tabId)).url !== urlBefore) throw new Error('The page changed. Check the product again.');
  if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : 'The coupon control could not be shown. Please try again.');
  try { return amazonFocusResponseSchema.parse(reply.data); }
  catch { throw new Error('The coupon control response was unexpected. Please try again.'); }
}

async function run(code?: string): Promise<{ result: TrialResult; reportNote: string }> {
  await secureStorage;
  const tab = await activeTab(); const tabId = tab.id!;
  // Checkout review is observation only; it never authorizes code trials.
  if (isAmazonCheckout(tab.url)) throw new Error('Amazon checkout is review-only. Codes are not tested here.');
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
    if (data.type === 'amazon-focus') return focusAmazon(data);
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
  if (change.status === 'loading' || change.url) {
    nextBadgeGeneration(tabId);
    void chrome.storage.session.remove(`result:${tabId}`);
    void chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
  }
  if (change.status === 'complete' || change.url) void badge(tab).catch(() => undefined);
});
chrome.tabs.onRemoved.addListener((tabId) => { badgeGenerations.delete(tabId); running.delete(tabId); void chrome.storage.session.remove(`result:${tabId}`); });
chrome.runtime.onInstalled.addListener(() => { void chrome.tabs.query({}).then((tabs) => Promise.all(tabs.map(badge))).catch(() => undefined); });
