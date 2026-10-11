import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext } from 'playwright';

// All products and responses here are labeled fixtures. No merchant requests,
// installed profiles, installed extension output, cookies or checkout actions.
const scratch = await mkdtemp(join(tmpdir(), 'hold-companion-'));
const root = resolve(import.meta.dir, '../../..');
const shots = resolve(root, 'output/playwright');
await mkdir(shots, { recursive: true });
let count=0;
function check(label:string, test:()=>void) { test();count++;console.log(`PASS ${label}`); }
const build = (args:string[], env:Record<string,string|undefined>={}) => {
  const result=Bun.spawnSync([process.execPath,'--no-env-file',...args],{cwd:scratch,env:{PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,...env},stdout:'pipe',stderr:'pipe'});
  if(result.exitCode!==0)throw new Error(result.stderr.toString());
};
build([resolve(root,'apps/dashboard/build.ts')]);
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
  const name=new URL(request.url).pathname.slice(1)||'index.html';
  if(!['index.html','main.js','styles.css'].includes(name))return new Response('',{status:404});
  return new Response(Bun.file(resolve(root,'apps/dashboard/dist',name)),{headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; connect-src 'self'"}});
}});
const origin=`http://127.0.0.1:${server.port}`;
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
let extension:BrowserContext|undefined;
try {
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.getByRole('heading',{name:'Your next good buy.'}).waitFor();
  assert.equal(await page.locator('.item-card').count(),0);
  check('starts with no invented products or balance',()=>undefined);
  await page.screenshot({path:join(shots,'hold-dashboard-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Save an item',exact:false}).click();
  await page.getByLabel('Product name').fill('Fixture headphones <not HTML>');
  await page.getByLabel('Product link').fill('https://shop.example.com/fixture?utm_source=test');
  await page.getByLabel('Price you saw').fill('120.50');await page.getByLabel('Your target price').fill('125');
  await page.getByRole('button',{name:'Save item →',exact:true}).click();
  await page.locator('dialog').waitFor({state:'hidden'});
  check('manual item is saved with explicit evidence label',()=>undefined);
  assert.match(await page.locator('.item-card').innerText(),/Price entered by you/);
  assert.match(await page.locator('.item-card').innerText(),/Recorded price meets target/);
  assert.equal(await page.locator('.item-card a').getAttribute('href'),'https://shop.example.com/fixture');
  await page.reload();await page.locator('.item-card').waitFor();
  assert.equal(await page.locator('.item-title').innerText(),'Fixture headphones <not HTML>');
  check('data survives reload and text is escaped',()=>undefined);
  await page.getByRole('button',{name:'Edit Fixture headphones <not HTML>'}).click();
  await page.getByLabel('Record a new price').fill('110.25');
  await page.getByRole('button',{name:'Save changes →',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});
  await page.locator('.item-title').click();
  assert.equal(await page.locator('tbody tr').count(),2);
  assert.match(await page.locator('tbody').innerText(),/\$110.25/);
  check('price history retains both observations',()=>undefined);
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('searchbox').fill('does not exist');
  await page.getByRole('heading',{name:'Nothing matches this view.'}).waitFor();
  await page.getByRole('button',{name:'Clear filters'}).click();assert.equal(await page.locator('.item-card').count(),1);
  check('search and filter reset work',()=>undefined);
  await page.getByRole('link',{name:'Settings & data'}).click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export backup',exact:true}).click()]);
  const backup=JSON.parse(await Bun.file((await download.path())!).text());assert.equal(backup.items.length,1);
  await page.getByRole('button',{name:'Clear list',exact:true}).click();await page.getByRole('button',{name:'Keep it',exact:true}).click();
  await page.getByRole('button',{name:'Clear list',exact:true}).click();await page.locator('dialog').getByRole('button',{name:'Clear list',exact:true}).click();
  await page.locator('dialog').waitFor({state:'hidden'});
  await page.locator('#import-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.getByRole('status').filter({hasText:'Imported 1 new items'}).waitFor();
  check('backup export, confirmed clear and import round trip work',()=>undefined);
  await page.locator('#import-file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":99}')});
  await page.getByRole('status').filter({hasText:'not a valid Hold backup'}).waitFor();
  await page.getByRole('link',{name:'My list 1',exact:true}).click();await page.locator('.item-card').waitFor();assert.equal(await page.locator('.item-card').count(),1);
  check('malformed import preserves the existing list',()=>undefined);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(shots,'hold-dashboard-mobile.png'),fullPage:true});
  check('mobile layout has no horizontal overflow',()=>undefined);
  await page.getByRole('link',{name:'Coupons',exact:true}).click();await page.getByRole('button',{name:'Refresh codes'}).click();
  await page.getByText('Reviewed coupon service is not connected in this standalone dashboard.').waitFor();
  await page.getByRole('link',{name:'Rewards',exact:true}).click();await page.getByRole('heading',{name:'Savings first. Rewards later.'}).waitFor();
  check('unconnected coupons and rewards are explicit unavailable states',()=>assert.equal(errors.length,0));
  await browser.close();browser=undefined;

  const extensionPath=join(scratch,'extension');
  build([resolve(root,'apps/extension/build.ts'),'--target','beta','--outdir',extensionPath],{COUPON_API_ORIGIN:'https://coupons.example.test'});
  const manifest=await Bun.file(join(extensionPath,'manifest.json')).json();
  manifest.host_permissions=['https://shop.example.test/*']; // fixture-only activeTab substitute
  await Bun.write(join(extensionPath,'manifest.json'),JSON.stringify(manifest));
  extension=await chromium.launchPersistentContext(join(scratch,'profile'),{headless:false,viewport:{width:1200,height:900},args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
  let price='129.00';const fixtureURL='https://shop.example.test/products/headphones';
  await extension.route('**/*',async route=>{
    const url=route.request().url();
    if(url.startsWith('chrome-extension://'))return route.continue();
    if(url.startsWith('https://coupons.example.test/'))return route.fulfill({contentType:'application/json',body:'{"merchants":[]}'});
    if(url===fixtureURL){const data={'@context':'https://schema.org','@type':'Product',url:fixtureURL,name:'Fixture headphones TEST100',brand:{'@type':'Brand',name:'Fixture'},mpn:'TEST100',offers:{'@type':'Offer',url:fixtureURL,price,priceCurrency:'USD',availability:'https://schema.org/InStock',itemCondition:'https://schema.org/NewCondition'}};
      return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Fixture store</title><script type="application/ld+json">${JSON.stringify(data)}</script><h1>Fixture headphones TEST100</h1><div>$${price}</div>`});}
    return route.abort();
  });
  const worker=extension.serviceWorkers()[0]??await extension.waitForEvent('serviceworker');
  // WHATWG URL implementations may give nonstandard schemes a null origin.
  const base=worker.url().slice(0,worker.url().lastIndexOf('/'));
  const dashboard=await extension.newPage();await dashboard.goto(`${base}/dashboard/index.html`);
  await dashboard.getByText('Extension dashboard',{exact:true}).waitFor();
  assert.equal(await dashboard.locator('.item-card').count(),0);
  check('packaged dashboard uses private extension storage',()=>undefined);
  await dashboard.getByRole('button',{name:'Save an item',exact:false}).click();await dashboard.getByLabel('Product name').fill('Fixture saved link');await dashboard.getByLabel('Product link').fill('https://shop.example.test/other');
  await dashboard.getByRole('button',{name:'Save item →',exact:true}).click();await dashboard.locator('dialog').waitFor({state:'hidden'});
  await dashboard.reload();await dashboard.locator('.item-card').waitFor();
  check('dashboard can persist through real MV3 worker messages',()=>undefined);
  const popup=await extension.newPage();await popup.goto(`${base}/popup.html`);
  const shop=await extension.newPage();await shop.goto(fixtureURL);await shop.bringToFront();
  const saved=await popup.evaluate(async()=>await chrome.runtime.sendMessage({type:'hold-save-page'}));
  assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(saved.data.items.length,2);
  assert.equal(saved.data.items[0].history[0].source,'page');
  check('popup saves a product read from the active fixture page',()=>undefined);
  // A content script knows chrome.runtime, but cannot request this private list.
  const denied=await worker.evaluate(async()=>{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    return chrome.scripting.executeScript({target:{tabId:tab!.id!},func:async()=>await chrome.runtime.sendMessage({type:'hold-list'})});
  });
  assert.equal(denied[0].result.ok,false);
  check('real content-script sender cannot read saved items',()=>undefined);
  price='109.00';await shop.reload();await shop.bringToFront();
  const updated=await popup.evaluate(async()=>await chrome.runtime.sendMessage({type:'hold-save-page'}));
  assert.equal(updated.ok,true,JSON.stringify(updated));
  const savedProduct=updated.data.items.find((item:{url:string})=>item.url===fixtureURL);
  assert.equal(savedProduct.history.length,2);assert.equal(savedProduct.history[1].priceCents,10900);
  await dashboard.reload();await dashboard.locator('.item-card').first().waitFor();assert.equal(await dashboard.locator('.item-card').count(),2);
  check('revisiting the product updates the dashboard history',()=>undefined);
  const rejected=await dashboard.evaluate(async()=>await chrome.runtime.sendMessage({type:'hold-save-page'}));
  assert.equal(rejected.ok,false);
  check('dashboard cannot impersonate the popup save action',()=>undefined);
  await dashboard.getByRole('link',{name:'Coupons',exact:true}).click();await dashboard.getByRole('button',{name:'Refresh codes'}).click();
  await dashboard.getByText('No stores are enabled for coupon testing yet. There are no reviewed codes to show.').waitFor();
  check('packaged dashboard reads the configured coupon service without fabricated codes',()=>undefined);
  console.log(`${count} companion browser checks passed.`);
} finally {
  await browser?.close();await extension?.close();server.stop(true);await rm(scratch,{recursive:true,force:true});
}
