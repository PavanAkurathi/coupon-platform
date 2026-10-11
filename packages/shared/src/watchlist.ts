import { z } from 'zod';
import { cleanProductUrl, pageProductSchema, sameProduct, sameBundle, type PageProduct } from './prices';

export const WATCHLIST_KEY = 'holdWatchlistV1';
export const WATCHLIST_LIMIT = 200;
const money = z.number().int().min(1).max(100_000_000);
const target = money.nullable();
const directUrl = z.string().max(2000).refine((value) => cleanProductUrl(value) === value, 'Use a direct HTTPS product link.');
export const watchObservationSchema = z.object({
  priceCents: money, shippingCents: z.number().int().min(0).max(100_000_000).nullable(),
  observedAt: z.iso.datetime(), source: z.enum(['page', 'manual']),
}).strict();
export const watchInputSchema = z.object({
  title: z.string().trim().min(1).max(300), url: directUrl,
  priceCents: money.nullable(), targetCents: target,
}).strict();
export const savedItemSchema = z.object({
  id: z.uuid(), title: z.string().trim().min(1).max(300), url: directUrl,
  addedAt: z.iso.datetime(), updatedAt: z.iso.datetime(), targetCents: target,
  product: pageProductSchema.nullable(), history: z.array(watchObservationSchema).max(90),
}).strict().superRefine((item, ctx) => {
  if (item.product && item.product.url !== item.url) ctx.addIssue({ code: 'custom', message: 'Saved product must belong to this link.' });
  if (item.history.some((point, i) => Date.parse(point.observedAt) > Date.now() + 60_000
    || (i > 0 && Date.parse(point.observedAt) < Date.parse(item.history[i - 1]!.observedAt)))) {
    ctx.addIssue({ code: 'custom', message: 'Price history must be chronological and cannot be in the future.' });
  }
});
export const watchlistSchema = z.object({ version: z.literal(1), items: z.array(savedItemSchema).max(WATCHLIST_LIMIT) }).strict()
  .refine((list) => new Set(list.items.map((item) => item.id)).size === list.items.length
    && new Set(list.items.map((item) => item.url)).size === list.items.length, 'Saved items must be unique.');
export type Watchlist = z.infer<typeof watchlistSchema>;
export type SavedItem = z.infer<typeof savedItemSchema>;
export type WatchInput = z.infer<typeof watchInputSchema>;
export type WatchObservation = z.infer<typeof watchObservationSchema>;
export const emptyWatchlist = (): Watchlist => ({ version: 1, items: [] });

// Only extension-owned popup/dashboard pages can send these. Page content cannot
// read or mutate the watchlist. Saving the current page is resolved by the worker.
export const watchlistRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hold-list') }).strict(),
  z.object({ type: z.literal('hold-save-page') }).strict(),
  z.object({ type: z.literal('hold-put-item'), item: watchInputSchema }).strict(),
  z.object({ type: z.literal('hold-set-target'), id: z.uuid(), targetCents: target }).strict(),
  z.object({ type: z.literal('hold-remove'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('hold-clear') }).strict(),
  z.object({ type: z.literal('hold-import'), list: watchlistSchema }).strict(),
]);
export type WatchlistRequest = z.infer<typeof watchlistRequestSchema>;

function append(history: WatchObservation[], point: WatchObservation): WatchObservation[] {
  const latest = history.at(-1);
  if (latest && Date.parse(point.observedAt) <= Date.parse(latest.observedAt)) return history;
  // Coalesce repeated reads within a minute, while retaining actual price changes.
  if (latest && latest.source === point.source && latest.priceCents === point.priceCents
    && latest.shippingCents === point.shippingCents && Date.parse(point.observedAt) - Date.parse(latest.observedAt) < 60_000) return history;
  return [...history, point].slice(-90);
}
function replace(list: Watchlist, item: SavedItem): Watchlist {
  if (!list.items.some((entry) => entry.id === item.id) && list.items.length >= WATCHLIST_LIMIT) throw new Error('Your list holds up to 200 items. Remove one before adding another.');
  return watchlistSchema.parse({ version: 1, items: [item, ...list.items.filter((entry) => entry.id !== item.id)] });
}
export function saveManualItem(list: Watchlist, raw: WatchInput, now = new Date()): Watchlist {
  const input = watchInputSchema.parse(raw);
  const existing = list.items.find((item) => item.url === input.url);
  const at = now.toISOString();
  return replace(list, {
    id: existing?.id ?? crypto.randomUUID(), title: input.title, url: input.url,
    addedAt: existing?.addedAt ?? at, updatedAt: at, targetCents: input.targetCents,
    product: existing?.product ?? null,
    history: input.priceCents === null ? existing?.history ?? [] : append(existing?.history ?? [], {
      priceCents: input.priceCents, shippingCents: null, observedAt: at, source: 'manual',
    }),
  });
}
export function savePageItem(list: Watchlist, raw: PageProduct, now = new Date()): Watchlist {
  const product = pageProductSchema.parse(raw);
  if (Date.parse(product.observedAt) > now.getTime() || now.getTime() - Date.parse(product.observedAt) > 15 * 60_000) throw new Error('Reopen this product page to save a fresh price.');
  const existing = list.items.find((item) => item.url === product.url);
  if (existing?.product && (!sameProduct(existing.product.identity, product.identity)
    || (existing.product.title !== product.title && !sameBundle(existing.product.title, product.title)))) {
    throw new Error('This page now describes a different or uncertain product. Remove the old saved item before saving it again.');
  }
  return replace(list, {
    id: existing?.id ?? crypto.randomUUID(), title: product.title, url: product.url,
    addedAt: existing?.addedAt ?? now.toISOString(), updatedAt: now.toISOString(), targetCents: existing?.targetCents ?? null,
    product, history: append(existing?.history ?? [], {
      priceCents: product.priceCents, shippingCents: product.shippingCents, observedAt: product.observedAt, source: 'page',
    }),
  });
}
export function observeSavedPage(list: Watchlist, product: PageProduct): Watchlist {
  if (!list.items.some((item) => item.url === product.url)) return list;
  try { return savePageItem(list, product); } catch { return list; }
}
export function setWatchTarget(list: Watchlist, id: string, cents: number | null): Watchlist {
  const item = list.items.find((item) => item.id === id);
  if (!item) throw new Error('This item is no longer saved.');
  return replace(list, { ...item, targetCents: target.parse(cents), updatedAt: new Date().toISOString() });
}
// Import is a shopper-supplied backup, never independent evidence of a store price.
// Strip product identities and mark every observation manual at this trust boundary.
export function importWatchlist(current: Watchlist, raw: unknown): Watchlist {
  const incoming = watchlistSchema.parse(raw);
  let result = current;
  for (const item of incoming.items) {
    if (result.items.some((entry) => entry.url === item.url)) continue;
    result = replace(result, { ...item, id: crypto.randomUUID(), product: null, history: item.history.map((point) => ({ ...point, source: 'manual' })) });
  }
  return result;
}
export function applyWatchlistRequest(list: Watchlist, request: Exclude<WatchlistRequest, { type: 'hold-save-page' }>): Watchlist {
  switch (request.type) {
    case 'hold-list': return list;
    case 'hold-put-item': return saveManualItem(list, request.item);
    case 'hold-set-target': return setWatchTarget(list, request.id, request.targetCents);
    case 'hold-remove': return { ...list, items: list.items.filter((item) => item.id !== request.id) };
    case 'hold-clear': return emptyWatchlist();
    case 'hold-import': return importWatchlist(list, request.list);
  }
}
