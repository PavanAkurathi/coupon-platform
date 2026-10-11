import { expect, test } from 'bun:test';
import { emptyWatchlist, saveManualItem, savePageItem, observeSavedPage, importWatchlist, setWatchTarget, watchlistSchema, watchlistRequestSchema } from './watchlist';
import { pageProductSchema } from './prices';
const now = new Date('2026-10-10T12:00:00.000Z');
const input = { title: 'Test fixture headphones', url: 'https://shop.example.com/headphones', priceCents: 20000, targetCents: 15000 };
const product = pageProductSchema.parse({
  identity: { brand: 'Fixture', model: 'TEST100', gtin: null, variant: null, packQuantity: 1, condition: 'new' },
  title: input.title, merchant: 'Test fixture store', merchantDomain: 'shop.example.com', seller: null, url: input.url,
  priceCents: 20000, shippingCents: 0, currency: 'USD', availability: 'in_stock', observedAt: now.toISOString(), reader: 'json-ld',
});
test('manual entries are labeled, duplicate links preserve history, and target edits add no price', () => {
  const first = saveManualItem(emptyWatchlist(), input, now);
  const second = saveManualItem(first, { ...input, priceCents: 16000 }, new Date(now.getTime()+1000));
  expect(second.items).toHaveLength(1);
  expect(second.items[0]!.id).toBe(first.items[0]!.id);
  expect(second.items[0]!.history.map((point)=>point.source)).toEqual(['manual','manual']);
  expect(setWatchTarget(second,second.items[0]!.id,14000).items[0]!.history).toHaveLength(2);
});
test('saving a page records observed evidence but rejects stale or changed identities', () => {
  const first = savePageItem(emptyWatchlist(), product, now);
  expect(first.items[0]!.history[0]!.source).toBe('page');
  expect(()=>savePageItem(first,{...product,identity:{...product.identity,model:'OTHER100'}},now)).toThrow('different');
  expect(()=>savePageItem(first,product,new Date(now.getTime()+16*60_000))).toThrow('fresh');
  expect(()=>savePageItem(first,{...product,observedAt:new Date(now.getTime()+1).toISOString()},now)).toThrow('fresh');
});
test('observations only update explicitly saved listings, with bounded history and no duplicate polling rows', () => {
  const at = new Date(); const fresh={...product,observedAt:at.toISOString()};
  const empty=emptyWatchlist(); expect(observeSavedPage(empty,fresh)).toBe(empty);
  let list=savePageItem(empty, fresh, at);
  expect(savePageItem(list,fresh,at).items[0]!.history).toHaveLength(1);
  for(let index=1;index<=100;index++) list=saveManualItem(list,{...input,priceCents:20000-index},new Date(now.getTime()+index*1000));
  // Older imported/manual timestamps cannot corrupt the chronological page history.
  expect(list.items[0]!.history).toHaveLength(1);
  let manual=emptyWatchlist();
  for(let index=0;index<100;index++) manual=saveManualItem(manual,{...input,priceCents:20000-index},new Date(now.getTime()+index*1000));
  expect(manual.items[0]!.history).toHaveLength(90);
});
test('backup import never promotes supplied data to observed store evidence', () => {
  const original=savePageItem(emptyWatchlist(),product,now);
  const imported=importWatchlist(emptyWatchlist(),original);
  expect(imported.items[0]!.product).toBeNull();
  expect(imported.items[0]!.history[0]!.source).toBe('manual');
  expect(importWatchlist(imported,original).items).toHaveLength(1);
  expect(()=>importWatchlist(imported,{...original,version:2})).toThrow();
  expect(watchlistSchema.safeParse({version:1,items:[original.items[0],original.items[0]]}).success).toBe(false);
});
test('watchlist wire requests reject unsafe links, embedded product claims and unsupported mutations', () => {
  expect(watchlistRequestSchema.safeParse({type:'hold-save-page',product}).success).toBe(false);
  for(const url of ['javascript:alert(1)','http://shop.example.com/a','https://shop.example.com/a?affiliate=123']) {
    expect(watchlistRequestSchema.safeParse({type:'hold-put-item',item:{...input,url}}).success).toBe(false);
  }
  expect(watchlistRequestSchema.safeParse({type:'hold-set-target',id:crypto.randomUUID(),targetCents:-1}).success).toBe(false);
});
