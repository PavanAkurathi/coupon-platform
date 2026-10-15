import { WATCHLIST_KEY, applyWatchlistRequest, emptyWatchlist, observeSavedPage, savePageItem, watchlistSchema, type PageProduct, type Watchlist, type WatchlistRequest } from '@repo/shared';

export function watchlistSender(sender: { id?: string; url?: string; frameId?: number }, runtimeId: string, getURL: (path: string) => string): 'popup' | 'dashboard' | null {
  if (sender.id !== runtimeId || !sender.url || (sender.frameId !== undefined && sender.frameId !== 0)) return null;
  const path = sender.url.split(/[?#]/)[0];
  if (path === getURL('popup.html')) return 'popup';
  if (path === getURL('dashboard/index.html')) return 'dashboard';
  return null;
}
type Storage = { get(key: string): Promise<Record<string, unknown>>; set(value: Record<string, unknown>): Promise<void> };
type BoundPage = { product: PageProduct; assertCurrent(): Promise<void> };
export function createWatchlistStore(storage: Storage, ready: Promise<unknown> = Promise.resolve()) {
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const operation = queue.then(async () => { await ready; return task(); });
    queue = operation.catch(() => undefined);
    return operation;
  };
  const load = async (): Promise<Watchlist> => {
    const raw = (await storage.get(WATCHLIST_KEY))[WATCHLIST_KEY];
    if (raw === undefined) return emptyWatchlist();
    const parsed = watchlistSchema.safeParse(raw);
    if (!parsed.success) throw new Error('Your saved list could not be read. Keep a backup before clearing it.');
    return parsed.data;
  };
  return {
    handle(request: WatchlistRequest, currentPage?: () => Promise<BoundPage>): Promise<Watchlist> {
      return serialized(async () => {
        const current = request.type === 'hold-clear' ? emptyWatchlist() : await load();
        let next: Watchlist;
        if (request.type === 'hold-save-page') {
          if (!currentPage) throw new Error('Save items from the extension on a product page.');
          const bound = await currentPage();
          next = savePageItem(current, bound.product);
          await bound.assertCurrent();
        } else next = applyWatchlistRequest(current, request);
        if (request.type !== 'hold-list') await storage.set({ [WATCHLIST_KEY]: next });
        return next;
      });
    },
    observe(product: PageProduct): Promise<void> {
      return serialized(async () => {
        const current = await load();
        const next = observeSavedPage(current, product);
        if (next !== current) await storage.set({ [WATCHLIST_KEY]: next });
      });
    },
  };
}
