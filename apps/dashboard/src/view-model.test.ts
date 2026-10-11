import { expect, test } from 'bun:test';
import { emptyWatchlist, saveManualItem } from '@repo/shared';
import { dollars, priceState, selectItems } from './view-model';
test('money input rejects partial numbers, exponents and excessive precision',()=>{
  expect(dollars('12.29')).toBe(1229);expect(dollars('')).toBeNull();
  for(const value of ['1e4','-10','NaN','Infinity','12abc','1.234','0','1000000.01'])expect(()=>dollars(value)).toThrow();
});
test('target matches expire, exclude shipping claims, and remain explicit personal notes',()=>{
  const now=new Date();const list=saveManualItem(emptyWatchlist(),{title:'Fixture',url:'https://shop.example.com/a',priceCents:1000,targetCents:1100},now);
  const item=list.items[0]!;
  expect(priceState(item,now.getTime()).atTarget).toBe(true);
  expect(priceState(item,now.getTime()).verified).toBe(false);
  expect(priceState(item,now.getTime()+16*60_000).atTarget).toBe(false);
  expect(selectItems(list.items,'example','target','recent')).toHaveLength(1);
  expect(selectItems(list.items,'nonexistent','all','recent')).toHaveLength(0);
});
