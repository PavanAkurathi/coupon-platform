import { expect, test } from 'bun:test';
import { WATCHLIST_KEY, emptyWatchlist, pageProductSchema, type WatchlistRequest } from '@repo/shared';
import { createWatchlistStore, watchlistSender } from './watchlist-worker';
const id='extension-id'; const getURL=(path:string)=>`chrome-extension://${id}/${path}`;
test('only own top-level popup and dashboard pages can access the saved list',()=>{
  expect(watchlistSender({id,url:getURL('popup.html')},id,getURL)).toBe('popup');
  expect(watchlistSender({id,url:getURL('dashboard/index.html#list'),frameId:0},id,getURL)).toBe('dashboard');
  for(const sender of [{id,url:'https://shop.example.com'}, {id:'another',url:getURL('popup.html')},
    {id,url:getURL('dashboard/index.html/other')},{id,url:getURL('dashboard/index.html'),frameId:1}, {id,url:getURL('content.js')}, {id}]) {
    expect(watchlistSender(sender,id,getURL)).toBeNull();
  }
});
function memory(raw?:unknown){
  let stored:Record<string,unknown>=raw===undefined?{}:{[WATCHLIST_KEY]:raw};
  let fail=false;
  return { storage:{async get(){await Bun.sleep(1);return structuredClone(stored);},async set(value:Record<string,unknown>){if(fail)throw new Error('Storage full');stored=structuredClone(value);}},snapshot:()=>stored,fail:()=>{fail=true;} };
}
const put=(suffix:string):WatchlistRequest=>({type:'hold-put-item',item:{title:`Fixture ${suffix}`,url:`https://shop.example.com/${suffix}`,priceCents:1000,targetCents:null}});
test('concurrent mutations serialize without lost writes and failed writes return an error',async()=>{
  const mem=memory(),store=createWatchlistStore(mem.storage);
  await Promise.all([store.handle(put('a')),store.handle(put('b'))]);
  const list=await store.handle({type:'hold-list'});expect(list.items).toHaveLength(2);
  await Promise.all([store.handle({type:'hold-remove',id:list.items[0]!.id}),store.handle(put('c'))]);
  expect((await store.handle({type:'hold-list'})).items).toHaveLength(2);
  mem.fail();await expect(store.handle(put('d'))).rejects.toThrow('Storage full');
  expect((await store.handle({type:'hold-list'})).items).toHaveLength(2);
});
test('corrupt storage is preserved until an explicit clear',async()=>{
  const mem=memory({broken:true}),store=createWatchlistStore(mem.storage);
  await expect(store.handle(put('a'))).rejects.toThrow('could not be read');
  expect(mem.snapshot()[WATCHLIST_KEY]).toEqual({broken:true});
  expect(await store.handle({type:'hold-clear'})).toEqual(emptyWatchlist());
});
test('navigation during a save cannot commit a stale page',async()=>{
  const mem=memory(),store=createWatchlistStore(mem.storage);
  const product=pageProductSchema.parse({identity:{brand:'Fixture',model:'TEST100',gtin:null,variant:null,packQuantity:1,condition:'new'},
    title:'Fixture product',merchant:'Fixture',merchantDomain:'shop.example.com',seller:null,url:'https://shop.example.com/a',priceCents:1000,shippingCents:0,currency:'USD',availability:'in_stock',observedAt:new Date().toISOString(),reader:'json-ld'});
  await expect(store.handle({type:'hold-save-page'},async()=>({product,async assertCurrent(){throw new Error('Page changed');}}))).rejects.toThrow('Page changed');
  expect((await store.handle({type:'hold-list'})).items).toHaveLength(0);
  await store.handle({type:'hold-save-page'},async()=>({product,async assertCurrent(){}}));
  expect((await store.handle({type:'hold-list'})).items[0]!.history[0]!.source).toBe('page');
});
