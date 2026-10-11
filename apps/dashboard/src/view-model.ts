import type { SavedItem } from '@repo/shared';
export function dollars(raw: string): number | null {
  if (!raw.trim()) return null;
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(raw.trim())) throw new Error('Enter a price in dollars, such as 49.99.');
  const value = Math.round(Number(raw) * 100);
  if (value < 1 || value > 100_000_000) throw new Error('Enter a price between $0.01 and $1,000,000.');
  return value;
}
export function priceState(item: SavedItem, now = Date.now()) {
  const latest = item.history.at(-1);
  const fresh = !!latest && now - Date.parse(latest.observedAt) >= 0 && now - Date.parse(latest.observedAt) <= 15 * 60_000;
  return {
    latest, fresh,
    atTarget: !!latest && fresh && item.targetCents !== null && latest.priceCents <= item.targetCents,
    verified: !!latest && latest.source === 'page',
  };
}
export function selectItems(items: SavedItem[], search: string, filter: string, sort: string): SavedItem[] {
  const term = search.trim().toLowerCase();
  const visible = items.filter((item) => (!term || `${item.title} ${new URL(item.url).hostname}`.toLowerCase().includes(term))
    && (filter !== 'target' || item.targetCents !== null) && (filter !== 'ready' || priceState(item).atTarget));
  return visible.sort((a, b) => sort === 'price' ? (a.history.at(-1)?.priceCents ?? Infinity) - (b.history.at(-1)?.priceCents ?? Infinity)
    : sort === 'name' ? a.title.localeCompare(b.title) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
