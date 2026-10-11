import {
  compareOffers, offerFromPage, pageProductSchema, priceOffersResponseSchema, sameMerchant, sameProduct,
  PRICE_EVIDENCE_MAX_AGE_MS, type PageProduct, type PriceComparison, type PriceCoverage, type PriceOffer,
} from '@repo/shared';
import { PRICE_API_ORIGIN, type Reply } from './protocol';
import type { ProductRead } from './product-reader';
import { LIVE_ORIGINS, liveCheck } from './store-lookups';

// Price comparison in the extension worker. Two offer sources:
// - seen_by_you: product pages this shopper viewed, kept only in this browser
//   (chrome.storage.local is not readable by content scripts).
// - the price service, when this build has one: it receives the product identity
//   (brand, model code, UPC, condition) and the current store's host, nothing else.

export const ALL_SITES = { origins: ['https://*/*'] };
const SCRIPT_ID = 'price-alerts';
const SEEN_KEY = 'priceSeen';
const SEEN_LIMIT = 300;
const SEEN_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_TIMEOUT_MS = 2500;

async function seenProducts(): Promise<PageProduct[]> {
  const stored = (await chrome.storage.local.get(SEEN_KEY))[SEEN_KEY];
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((item) => { const parsed = pageProductSchema.safeParse(item); return parsed.success ? [parsed.data] : []; });
}
// One entry per store and product; the newest observation replaces older ones.
let writes = Promise.resolve();
export function rememberProduct(product: PageProduct): Promise<void> {
  writes = writes.then(async () => {
    const cutoff = Date.now() - SEEN_KEEP_MS;
    const kept = (await seenProducts()).filter((item) => Date.parse(item.observedAt) > cutoff
      && !(sameMerchant(item.merchantDomain, product.merchantDomain) && sameProduct(item.identity, product.identity)));
    await chrome.storage.local.set({ [SEEN_KEY]: [product, ...kept].slice(0, SEEN_LIMIT) });
  }).catch(() => undefined);
  return writes;
}
export async function forgetProducts(): Promise<void> { await chrome.storage.local.remove(SEEN_KEY); }

async function serviceOffers(product: PageProduct): Promise<{ offers: PriceOffer[]; coverage: PriceCoverage[] }> {
  if (!PRICE_API_ORIGIN) return { offers: [], coverage: [] };
  try {
    const response = await fetch(`${PRICE_API_ORIGIN}/v1/prices/offers`, {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: product.identity, excludeDomain: product.merchantDomain }), signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(String(response.status));
    return priceOffersResponseSchema.parse(await response.json());
  } catch {
    return { offers: [], coverage: [{ source: 'ebay_api', status: 'unavailable', offers: 0 }] };
  }
}

// The same listing seen twice: the newest observation wins. The shopper's own
// signed-in view can differ from an anonymous live check (October 9: Amazon showed
// a signed-out check $96.49 from one seller, the founder $96.99 for the same ASIN).
export function newestPerListing(offers: PriceOffer[]): PriceOffer[] {
  const newest = new Map<string, PriceOffer>();
  for (const offer of offers) {
    const key = `${offer.merchantDomain}|${offer.url}`;
    const current = newest.get(key);
    if (!current || Date.parse(offer.observedAt) > Date.parse(current.observedAt)) newest.set(key, offer);
  }
  return [...newest.values()];
}

export async function comparePrice(product: PageProduct): Promise<PriceComparison> {
  const now = new Date();
  const local = (await seenProducts()).filter((item) => !sameMerchant(item.merchantDomain, product.merchantDomain)
    && sameProduct(item.identity, product.identity) && now.getTime() - Date.parse(item.observedAt) <= PRICE_EVIDENCE_MAX_AGE_MS)
    .map((item) => offerFromPage(item));
  const [remote, live] = await Promise.all([serviceOffers(product), liveCheck(product)]);
  const checked = live.products.map((item) => offerFromPage(item, 'live_check'));
  const coverage: PriceCoverage[] = [
    ...live.coverage,
    { source: 'seen_by_you', status: local.length ? 'checked' : 'unavailable', offers: local.length },
    ...remote.coverage,
  ];
  const result = compareOffers(product, newestPerListing([...checked, ...local, ...remote.offers]), { now: new Date(), coverage });
  if (result.status === 'better_offer' || product.identity.condition !== 'new') return result;
  // Without the price-alerts permission the worker cannot check other stores at all.
  if (!await chrome.permissions.contains({ origins: LIVE_ORIGINS })) {
    return { ...result, reason: 'Turn on price alerts below to check Amazon and Walmart for this exact item.' };
  }
  if (result.status === 'not_checked') {
    return { ...result, reason: 'No other store price for this exact item right now.' };
  }
  return result;
}

// Popup reads and in-page checks for the same product share one comparison.
const inflight = new Map<string, { at: number; result: Promise<PriceComparison> }>();
export function comparisonFor(tabId: number, product: PageProduct): Promise<PriceComparison> {
  const key = `${tabId}|${product.url}|${product.priceCents}`;
  const cached = inflight.get(key);
  if (cached && Date.now() - cached.at < 30_000) return cached.result;
  for (const [entry, value] of inflight) if (Date.now() - value.at >= 30_000) inflight.delete(entry);
  const result = rememberProduct(product).then(() => comparePrice(product));
  inflight.set(key, { at: Date.now(), result });
  result.catch(() => inflight.delete(key));
  return result;
}

// A content script may only report the page it is running on.
export function trustedPageProduct(raw: unknown, sender: chrome.runtime.MessageSender): PageProduct | null {
  if (sender.frameId !== 0 || !sender.url || !sender.tab?.id) return null;
  const parsed = pageProductSchema.safeParse((raw as { product?: unknown } | null)?.product);
  if (!parsed.success) return null;
  try {
    const page = new URL(sender.url);
    return page.protocol === 'https:' && page.hostname === parsed.data.merchantDomain ? parsed.data : null;
  } catch { return null; }
}

// Alerts on every store need the optional https host permission, which only the
// popup can request (a user gesture). The registered script survives restarts.
export async function alertsEnabled(): Promise<boolean> {
  return chrome.permissions.contains(ALL_SITES);
}
export async function syncPriceAlerts(): Promise<boolean> {
  const enabled = await alertsEnabled();
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length > 0;
  if (enabled && !registered) {
    await chrome.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: ['https://*/*'], js: ['price-content.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true }]);
  } else if (!enabled && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  return enabled;
}
export async function disablePriceAlerts(): Promise<boolean> {
  await chrome.permissions.remove(ALL_SITES);
  return syncPriceAlerts();
}

export type PopupPrice = { product: PageProduct | null; comparison: PriceComparison | null; reason: string };
// Uses the popup's temporary activeTab grant; the same script then keeps watching the page.
export async function popupPrice(tab: chrome.tabs.Tab): Promise<PopupPrice | undefined> {
  const tabId = tab.id; const url = tab.url;
  if (!tabId || !url?.startsWith('https://')) return undefined;
  try {
    const [injected] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['price-content.js'] });
    if ((await chrome.tabs.get(tabId)).url !== url) return undefined;
    const options = injected?.documentId != null ? ({ documentId: injected.documentId } as chrome.tabs.MessageSendOptions) : { frameId: 0 };
    const reply: Reply<ProductRead> = await chrome.tabs.sendMessage(tabId, { type: 'price-read' }, options);
    if (!reply?.ok || (await chrome.tabs.get(tabId)).url !== url) return undefined;
    const read = reply.data;
    if (read.status !== 'product') return read.status === 'unrecognized' ? { product: null, comparison: null, reason: read.reason } : undefined;
    const product = pageProductSchema.parse(read.product);
    if (new URL(url).hostname !== product.merchantDomain) return undefined;
    return { product, comparison: await comparisonFor(tabId, product), reason: '' };
  } catch { return undefined; }
}
