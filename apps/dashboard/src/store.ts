import { WATCHLIST_KEY, applyWatchlistRequest, emptyWatchlist, watchlistSchema, watchlistRequestSchema, type Watchlist, type WatchlistRequest } from '@repo/shared';
type Runtime = { id: string; sendMessage: (message: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }> };
const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: Runtime } }).chrome?.runtime;
export const inExtension = Boolean(runtime?.id && /^(chrome|moz)-extension:$/.test(location.protocol));
let queue: Promise<unknown> = Promise.resolve();
export function readLocal(): Watchlist {
  const saved = localStorage.getItem(WATCHLIST_KEY);
  if (saved === null) return emptyWatchlist();
  try { return watchlistSchema.parse(JSON.parse(saved)); }
  catch { throw new Error('Your saved list could not be read. Export a recovery copy in Settings before resetting it.'); }
}
export function send(raw: WatchlistRequest): Promise<Watchlist> {
  const operation = queue.then(async () => {
    const request = watchlistRequestSchema.parse(raw);
    if (inExtension) {
      const reply = await runtime!.sendMessage(request);
      if (!reply?.ok) throw new Error(reply?.error || 'Hold could not save this change. Please try again.');
      return watchlistSchema.parse(reply.data);
    }
    if (request.type === 'hold-save-page') throw new Error('Save a store page from the Hold extension.');
    const update = () => {
      // Explicit reset is the only operation allowed to replace unreadable data.
      const current = request.type === 'hold-clear' ? emptyWatchlist() : readLocal();
      const next = applyWatchlistRequest(current, request);
      if (request.type !== 'hold-list') localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      return next;
    };
    // Serialize across separate dashboard tabs, not just this module instance.
    return navigator.locks ? navigator.locks.request(WATCHLIST_KEY, update) : update();
  });
  queue = operation.catch(() => undefined);
  return operation;
}
