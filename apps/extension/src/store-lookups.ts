import { amazonProductAsin, productIdentityKey, pageProductSchema, sameMerchant, sameProduct, PRICE_EVIDENCE_MAX_AGE_MS, type PageProduct, type PriceCoverage, type ProductIdentity } from '@repo/shared';
import { parseStoreHtml, type ParseRequest } from './parse-html';
import type { ProductRead } from './product-reader';
import type { SearchCandidate, SearchStore } from './search-parsers';

// Live checks: when the shopper views a product, the worker fetches other stores'
// public search and product pages from this browser (no cookies sent), parses them
// inert (Chrome: offscreen document; Firefox: background page) and keeps only exact matches. Verified October 8, 2026:
// Amazon and Walmart answer these requests; eBay (403) and Best Buy product pages
// refuse them, Target and Costco render results only with scripts. A store that
// blocks is reported as unavailable and rested; nothing tries to get around it.

type Search = { url: string; byGtin: boolean };
type Store = { key: SearchStore; host: string; merchant: string; search(identity: ProductIdentity): Search | null };
const upc = (gtin: string) => gtin.startsWith('00') ? gtin.slice(2) : gtin.startsWith('0') ? gtin.slice(1) : gtin;
export const LIVE_STORES: Store[] = [
  { key: 'amazon', host: 'www.amazon.com', merchant: 'Amazon',
    // Amazon answers a UPC search with the exact item; fall back to brand and model.
    search: (id) => id.gtin ? { url: `https://www.amazon.com/s?k=${upc(id.gtin)}`, byGtin: true }
      : id.model && id.brand ? { url: `https://www.amazon.com/s?k=${encodeURIComponent(`${id.brand} ${id.model}`)}`, byGtin: false } : null },
  { key: 'walmart', host: 'www.walmart.com', merchant: 'Walmart',
    search: (id) => id.model && id.brand ? { url: `https://www.walmart.com/search?q=${encodeURIComponent(id.model)}`, byGtin: false }
      : id.gtin ? { url: `https://www.walmart.com/search?q=${upc(id.gtin)}`, byGtin: true } : null },
];
export const LIVE_ORIGINS = LIVE_STORES.map((store) => `https://${store.host}/*`);

const CACHE_KEY = 'priceLiveChecks';
const CACHE_TTL_MS = PRICE_EVIDENCE_MAX_AGE_MS;
const BLOCKED_REST_MS = 30 * 60 * 1000;
const PAGE_TIMEOUT_MS = 6000;
const MAX_PAGE_BYTES = 5_000_000;
const MAX_PRODUCT_PAGES = 3;
const HOURLY_LIMIT = 60;
type Cached = { at: number; status: 'checked' | 'unavailable'; products: PageProduct[] };

class Blocked extends Error {}
const rested = new Map<string, number>();
const recent = new Map<string, number[]>();
function allowRequest(host: string): boolean {
  const now = Date.now();
  if ((rested.get(host) ?? 0) > now) return false;
  const times = (recent.get(host) ?? []).filter((time) => now - time < 3_600_000);
  if (times.length >= HOURLY_LIMIT) return false;
  times.push(now); recent.set(host, times);
  return true;
}

async function fetchPage(url: string, host: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (!allowRequest(host)) throw new Blocked('Resting or over the hourly limit.');
  const response = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]) : AbortSignal.timeout(PAGE_TIMEOUT_MS) });
  const final = new URL(response.url);
  // A redirect to another host, a block page or a robot check rests this store.
  if (final.hostname !== host || /^\/(blocked|errors\/validateCaptcha)/.test(final.pathname) || response.status === 403 || response.status === 429 || response.status === 503) {
    rested.set(host, Date.now() + BLOCKED_REST_MS);
    throw new Blocked(`Blocked (${response.status}).`);
  }
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`Unexpected response ${response.status}`);
  const html = await response.text();
  if (html.length > MAX_PAGE_BYTES) throw new Error('Page too large.');
  if (/action="\/errors\/validateCaptcha"|Robot or human\?/i.test(html)) { rested.set(host, Date.now() + BLOCKED_REST_MS); throw new Blocked('Robot check.'); }
  return html;
}

declare const __BROWSER__: string | undefined;
// Firefox runs the background as a page with a DOMParser and has no offscreen API.
async function inBackgroundPage<T>(message: ParseRequest): Promise<T> {
  const parsed = parseStoreHtml(message);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.data as T;
}
let creating: Promise<void> | null = null;
async function inOffscreenDocument<T>(message: ParseRequest): Promise<T> {
  const open = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (!open.length) {
    creating ??= chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Read prices from store pages fetched for a price comparison.' }).finally(() => { creating = null; });
    await creating;
  }
  const reply: { ok: boolean; data?: T; error?: string } = await chrome.runtime.sendMessage({ target: 'offscreen', ...message });
  if (!reply?.ok) throw new Error(reply?.error ?? 'Parser did not answer.');
  return reply.data as T;
}
// Store builds name the browser, so the unused path drops out of the bundle; tests detect it.
const parseFetched: <T>(message: ParseRequest) => Promise<T> =
  (typeof __BROWSER__ === 'string' ? __BROWSER__ === 'firefox' : typeof DOMParser === 'function') ? inBackgroundPage : inOffscreenDocument;

const alnum = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');
function pick(candidates: SearchCandidate[], identity: ProductIdentity, byGtin: boolean): SearchCandidate[] {
  const model = identity.model ? alnum(identity.model) : null;
  // Results naming the exact model first (ads included: the product page decides).
  // Store titles often omit model codes, and a UPC search names the item exactly,
  // so the top organic results are also opened; their product pages must match.
  const named = candidates.filter((candidate) => model && alnum(candidate.title).includes(model));
  const organic = candidates.filter((candidate) => !candidate.sponsored).slice(0, byGtin || !named.length ? 2 : 0);
  return [...new Map([...named, ...organic].map((candidate) => [candidate.url, candidate])).values()].slice(0, MAX_PRODUCT_PAGES);
}

// Amazon pages with several purchase modes (new, used, list price) can't say which
// price is the buy box without layout; Amazon's own offer list (observed October 9,
// B0G22WX3YR: $96.49 new vs $81.23 used) names it. Fetched only when needed.
async function readCandidate(store: Store, url: string, signal?: AbortSignal): Promise<ProductRead> {
  const html = await fetchPage(url, store.host, signal);
  const first = await parseFetched<ProductRead>({ type: 'parse-product', html, url });
  const asin = store.key === 'amazon' && first.status === 'unrecognized' ? amazonProductAsin(url) : null;
  if (!asin) return first;
  const offersHtml = await fetchPage(`https://www.amazon.com/gp/product/ajax/aodAjaxMain/ref=dp_aod_ALL_mbc?asin=${asin}&pc=dp&experienceId=aodAjaxMain`, store.host, signal);
  return parseFetched<ProductRead>({ type: 'parse-product', html, url, offersHtml });
}

async function checkStore(store: Store, identity: ProductIdentity, signal?: AbortSignal): Promise<Cached> {
  const search = store.search(identity);
  if (!search) return { at: Date.now(), status: 'unavailable', products: [] };
  try {
    const candidates = pick(await parseFetched<SearchCandidate[]>({ type: 'parse-search', store: store.key, html: await fetchPage(search.url, store.host, signal), url: search.url }),
      identity, search.byGtin);
    const reads = await Promise.allSettled(candidates.map((candidate) => readCandidate(store, candidate.url, signal)));
    const products = reads.flatMap((read) => {
      if (read.status !== 'fulfilled' || read.value.status !== 'product') return [];
      const parsed = pageProductSchema.safeParse(read.value.product);
      return parsed.success && parsed.data.merchantDomain === store.host && sameProduct(identity, parsed.data.identity) ? [parsed.data] : [];
    });
    // Every candidate page failing is not the same as "this store does not sell it".
    if (candidates.length && reads.every((read) => read.status === 'rejected' || read.value.status !== 'product')) return { at: Date.now(), status: 'unavailable', products: [] };
    return { at: Date.now(), status: 'checked', products };
  } catch {
    return { at: Date.now(), status: 'unavailable', products: [] };
  }
}

const keyOf = (store: Store, identity: ProductIdentity) => `v2|${store.key}|${productIdentityKey(identity)}`;
const pending = new Map<string, Promise<Cached>>();
let cacheWrites = Promise.resolve();
function validCached(raw: unknown): Cached | null {
  const hit = raw as Cached | undefined;
  if (!hit || !Number.isFinite(hit.at) || hit.at > Date.now() || Date.now() - hit.at >= CACHE_TTL_MS || hit.status !== 'checked' || !Array.isArray(hit.products)) return null;
  const products = hit.products.flatMap((rawProduct) => {
    const parsed = pageProductSchema.safeParse(rawProduct);
    if (!parsed.success) return [];
    const observed = Date.parse(parsed.data.observedAt);
    return observed <= Date.now() && Date.now() - observed < CACHE_TTL_MS ? [parsed.data] : [];
  });
  return { at: hit.at, status: hit.status, products };
}
async function cachedCheck(store: Store, identity: ProductIdentity, signal?: AbortSignal): Promise<Cached> {
  const key = keyOf(store, identity);
  const all = ((await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] ?? {}) as Record<string, Cached>;
  const hit = validCached(all[key]);
  if (hit) return hit;
  const running = pending.get(key);
  if (running) return running;
  const task = checkStore(store, identity, signal).then(async (result) => {
    if (result.status === 'checked' && !signal?.aborted) {
      cacheWrites = cacheWrites.catch(() => undefined).then(async () => {
        if (signal?.aborted) return;
        const latest = ((await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] ?? {}) as Record<string, Cached>;
        const kept = Object.fromEntries(Object.entries(latest).filter(([, value]) => validCached(value)).slice(-299));
        await chrome.storage.local.set({ [CACHE_KEY]: { ...kept, [key]: result } });
      });
      await cacheWrites;
    }
    return result;
  }).finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}

// Checks every live store except the one the shopper is on. Needs host access to
// those stores (granted with "price alerts on every store").
export type LiveResult = { products: PageProduct[]; coverage: PriceCoverage[] };
async function permittedStores(product: PageProduct): Promise<Store[]> {
  const stores = LIVE_STORES.filter((store) => !sameMerchant(store.host, product.merchantDomain));
  const allowed = await Promise.all(stores.map(async (store) => await chrome.permissions.contains({ origins: [`https://${store.host}/*`] }) ? store : null));
  return product.identity.condition === 'new' ? allowed.filter((store): store is Store => store !== null) : [];
}
function combine(stores: Store[], results: Cached[]): LiveResult {
  return {
    products: results.flatMap((result) => result.products),
    coverage: results.map((result, index) => ({ source: 'live_check', merchant: stores[index]!.merchant, status: result.status, offers: result.products.length })),
  };
}
// Storage-only fast path: it never starts a fetch or waits for a pending lookup.
export async function cachedLiveCheck(product: PageProduct): Promise<LiveResult> {
  const stores = await permittedStores(product);
  const all = ((await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] ?? {}) as Record<string, Cached>;
  return combine(stores, stores.map((store) => validCached(all[keyOf(store, product.identity)]) ?? { at: Date.now(), status: 'unavailable', products: [] }));
}
export async function liveCheck(product: PageProduct, onUpdate?: (result: LiveResult) => void, signal?: AbortSignal): Promise<LiveResult> {
  const stores = await permittedStores(product);
  const results: Cached[] = stores.map(() => ({ at: Date.now(), status: 'unavailable', products: [] }));
  await Promise.all(stores.map(async (store, index) => {
    if (signal?.aborted) return;
    results[index] = await cachedCheck(store, product.identity, signal);
    if (!signal?.aborted) onUpdate?.(combine(stores, results));
  }));
  return combine(stores, results);
}
