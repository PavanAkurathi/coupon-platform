import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

// Real MV3 worker/content/action popup against synthetic HTML only. Every HTTP
// request is intercepted. No real Amazon, account, cookie or backend is used.
const extensionPath = resolve(import.meta.dir, '../dist');
const fixture = await Bun.file(`${import.meta.dir}/fixtures/amazon-product.html`).text();
const productUrl = 'https://www.amazon.com/dp/B097S1MF28?tag=creator-fixture';
const scratch = await mkdtemp(join(tmpdir(), 'coupon-amazon-mv3-'));
let passed = 0;
function check(name: string, action: () => unknown) { action(); passed++; console.log(`PASS ${name}`); }
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, message: string): Promise<T> {
  const deadline = Date.now() + 10000;
  let value: T;
  do { value = await read(); if (accept(value)) return value; await Bun.sleep(80); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${message}; last value: ${JSON.stringify(value)}`);
}

async function exercise(path: string, fixtureHostGrant: boolean): Promise<boolean> {
  const context = await chromium.launchPersistentContext(join(scratch, fixtureHostGrant ? 'granted-profile' : 'shipping-profile'), {
    headless: false,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {channel:'chromium'}),
    args:[`--disable-extensions-except=${path}`, `--load-extension=${path}`, '--disable-background-networking'],
  });
  try {
    await context.route('**/*', async route => route.request().isNavigationRequest()
      ? route.fulfill({status:200,contentType:'text/html',body:fixture}) : route.abort());
    const page = context.pages()[0] ?? await context.newPage();
    await page.addInitScript(() => {
      const globals = window as any;
      globals.__merchantClicks = 0; globals.__orderSubmits = 0;
      document.addEventListener('click', () => globals.__merchantClicks++, true);
      document.addEventListener('submit', event => {event.preventDefault(); globals.__orderSubmits++;}, true);
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    // Extension service-worker traffic does not reliably pass through page routes.
    // Trap every attempted fetch before testing so none can leave this harness.
    await worker.evaluate(() => {
      const globals = globalThis as any;
      globals.__attemptedFetches = [];
      globals.fetch = async (...args: unknown[]) => {
        globals.__attemptedFetches.push(String(args[0]));
        throw new Error('Fixture test forbids network requests');
      };
    });
    await page.goto(productUrl);
    const cdp = await context.newCDPSession(page);
    const pending = new Map<number, {resolve(value: any): void; reject(reason: Error): void}>();
    let sequence = 0;
    cdp.on('Target.receivedMessageFromTarget', ({message}) => {
      const response = JSON.parse(message); const task = pending.get(response.id);
      if (!task) return;
      pending.delete(response.id);
      if (response.error) task.reject(new Error(response.error.message)); else task.resolve(response.result);
    });
    function command(sessionId: string, method: string, params: object = {}): Promise<any> {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {pending.delete(id); reject(new Error(`${method} timed out`));}, 12000);
        pending.set(id, {resolve(value) {clearTimeout(timer); resolve(value);}, reject(reason) {clearTimeout(timer); reject(reason);}});
        void cdp.send('Target.sendMessageToTarget', {sessionId,message:JSON.stringify({id,method,params})}).catch(reject);
      });
    }
    async function openPopup() {
      await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
        if (!tab?.id) throw new Error('Synthetic Amazon tab missing');
        await chrome.tabs.update(tab.id,{active:true});
        await chrome.windows.update(tab.windowId,{focused:true});
        await chrome.action.openPopup({windowId:tab.windowId});
      });
      const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(target => target.url.endsWith('/popup.html')), Boolean, 'action popup target');
      const {sessionId} = await cdp.send('Target.attachToTarget',{targetId:target!.targetId});
      async function evaluate<T = any>(expression: string): Promise<T> {
        const result = await command(sessionId,'Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result.value;
      }
      await until(() => evaluate<string>('document.getElementById("status")?.textContent'), value => Boolean(value && value !== 'Checking this checkout…'), 'Amazon popup inspection');
      return {evaluate,close:() => cdp.send('Target.closeTarget',{targetId:target!.targetId}).catch(() => undefined)};
    }
    const merchantState = () => page.evaluate(() => ({
      clicks:(window as any).__merchantClicks,submits:(window as any).__orderSubmits,
      checked:(document.getElementById('fixture-coupon') as HTMLInputElement).checked,
      active:document.activeElement?.id,url:location.href,
    }));
    const badge = () => worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      return chrome.action.getBadgeText({tabId:tab!.id!});
    });
    let popup = await openPopup();
    const firstText = await popup.evaluate<string>('document.body.innerText');
    if ((!firstText.includes('Coupon price') || !firstText.includes('$15.99')) && !fixtureHostGrant) {
      console.log('Programmatic openPopup did not grant activeTab; retrying with a temporary fixture-only Amazon host permission. Actual user-gesture permission must be tested separately.');
      await popup.close();
      return false;
    }
    check('real MV3 popup reads the synthetic native coupon and omits demo/verified/revenue claims', () => {
      assert.match(firstText,/Coupon price/); assert.match(firstText,/\$15\.99/);
      assert.match(firstText,/Eligibility not confirmed/);
      assert.doesNotMatch(firstText,/LOCAL DEMO|confirmed by 3 shoppers|We made|saved on this cart/i);
    });
    const initial = await popup.evaluate('chrome.runtime.sendMessage({type:"status"})');
    check('native offers are separate from checkout savings and trial authority', () => {
      assert.equal(initial.ok,true); assert.equal(initial.data.supported,false);
      assert.equal(initial.data.checkout,false); assert.equal(initial.data.amazon.status,'offers_found');
      assert.equal(initial.data.amazon.offers[0].advertisedPriceCents,1599);
      assert.equal(initial.data.result,undefined);
    });
    const shownBadge = await badge();
    check('native coupon receives a badge after inspection', () => assert.equal(shownBadge,'$'));
    const forbidden = await popup.evaluate('Promise.all([chrome.runtime.sendMessage({type:"run"}),chrome.runtime.sendMessage({type:"try-code",code:"FIXTURE10"})])');
    const beforeFocus = await merchantState();
    check('Amazon cannot dispatch automatic or manual code trials', () => {
      assert.ok(forbidden.every((reply: any) => reply.ok === false));
      assert.equal(beforeFocus.clicks,0); assert.equal(beforeFocus.submits,0); assert.equal(beforeFocus.checked,false);
    });
    await popup.evaluate('document.getElementById("amazon-show").click()');
    const focused = await until(merchantState, value => value.active === 'fixture-coupon', 'coupon focus');
    check('popup action focuses only, without clipping, purchasing or changing attribution URL', () => {
      assert.equal(focused.clicks,0); assert.equal(focused.submits,0); assert.equal(focused.checked,false);
      assert.equal(focused.url,productUrl);
    });
    await popup.close();

    await page.locator('#fixture-coupon').evaluate((node: HTMLInputElement) => {node.checked=true;});
    popup = await openPopup();
    const selected = await popup.evaluate('({text:document.body.innerText,hidden:document.getElementById("amazon-show").hidden})');
    check('selected checkbox is not presented as a confirmed checkout discount', () => {
      assert.match(selected.text,/Selected on Amazon/); assert.match(selected.text,/Confirm the discount at checkout/);
      assert.doesNotMatch(selected.text,/already applied|coupon applied|We made/i); assert.equal(selected.hidden,true);
    });
    await popup.close();
    await page.locator('#fixture-coupon').evaluate((node: HTMLInputElement) => {node.checked=false;node.disabled=true;});
    popup = await openPopup();
    const disabled = await popup.evaluate('({text:document.body.innerText,hidden:document.getElementById("amazon-show").hidden,primary:document.getElementById("amazon-refresh").classList.contains("primary")})');
    check('disabled offer has no focus action and retains a primary recheck action', () => {
      assert.match(disabled.text,/cannot currently be selected/); assert.equal(disabled.hidden,true); assert.equal(disabled.primary,true);
    });
    await popup.close();

    await page.locator('#fixture-coupon').evaluate((node: HTMLInputElement) => {node.disabled=false;});
    popup = await openPopup();
    await page.locator('#promoPriceBlockMessage_feature_div .a-offscreen').first().evaluate(node => {node.textContent='$17.99';});
    await popup.evaluate('document.getElementById("amazon-show").click()');
    const stale = await until(() => popup.evaluate('({text:document.getElementById("status").textContent,disabled:document.getElementById("amazon-show").disabled})'), value => /changed|out of date/.test(value.text), 'stale offer rejection');
    const afterStale = await merchantState();
    check('changed coupon rejects the stale action and keeps it disabled until refresh', () => {
      assert.equal(stale.disabled,true); assert.equal(afterStale.clicks,0); assert.equal(afterStale.submits,0); assert.equal(afterStale.checked,false);
    });
    await popup.evaluate('document.getElementById("amazon-refresh").click()');
    const refreshed = await until(() => popup.evaluate('({text:document.body.innerText,disabled:document.getElementById("amazon-refresh").disabled,showDisabled:document.getElementById("amazon-show").disabled})'), value => !value.disabled && value.text.includes('$17.99'), 'fresh price in popup');
    check('refresh replaces stale offer text and reenables a fresh action', () => {assert.equal(refreshed.showDisabled,false);assert.doesNotMatch(refreshed.text,/\$15\.99/);});

    await page.locator('#promoPriceBlockMessage_feature_div').evaluate(node => {(node as HTMLElement).hidden=true;});
    await popup.evaluate('document.getElementById("amazon-refresh").click()');
    const empty = await until(() => popup.evaluate('({headline:document.getElementById("headline").textContent,cards:document.getElementById("amazon-offers").childElementCount,hidden:document.getElementById("amazon-show").hidden,disabled:document.getElementById("amazon-refresh").disabled})'), value => !value.disabled && value.headline === 'No visible coupon.', 'empty offer state');
    const emptyBadge = await badge();
    check('no visible coupon clears the stale offer, action and badge', () => {
      assert.equal(empty.cards,0); assert.equal(empty.hidden,true); assert.equal(emptyBadge,'');
    });
    await page.locator('#title #productTitle').evaluate(node => {node.textContent='';});
    await popup.evaluate('document.getElementById("amazon-refresh").click()');
    const unavailable = await until(() => popup.evaluate('({headline:document.getElementById("headline").textContent,disabled:document.getElementById("amazon-refresh").disabled})'), value => !value.disabled && value.headline === 'Check this product.', 'unreadable state');
    check('unreadable product does not claim that no coupon exists', () => assert.equal(unavailable.headline,'Check this product.'));
    await popup.close();

    await page.goto(productUrl);
    popup = await openPopup();
    assert.equal(await badge(),'$');
    await popup.close();
    await page.goto('https://www.amazon.com/gp/cart/view.html');
    const navigatedBadge = await until(badge, value => value === '', 'navigation clears badge');
    popup = await openPopup();
    const cart = await popup.evaluate('({text:document.body.innerText,hidden:document.getElementById("amazon-show").hidden})');
    check('cart navigation clears product badge and explains the unsupported checkout boundary', () => {
      assert.equal(navigatedBadge,''); assert.match(cart.text,/Cart and checkout coupon testing are not available yet/);
      assert.equal(cart.hidden,true); assert.doesNotMatch(cart.text,/\$15\.99|LOCAL DEMO/);
    });
    const forbiddenShape = await popup.evaluate('chrome.runtime.sendMessage({type:"amazon-focus",asin:"B097S1MF28",offerId:"x",fingerprint:"x",observedAt:new Date().toISOString(),click:true})');
    check('runtime contract rejects a request to add a click side effect', () => assert.equal(forbiddenShape.ok,false));
    const privacy = await worker.evaluate(async () => ({
      fetches:(globalThis as any).__attemptedFetches,
      local:await chrome.storage.local.get(null),session:await chrome.storage.session.get(null),
    }));
    check('inspection sends no API requests and stores no product or savings snapshot', () => {
      assert.deepEqual(privacy.fetches,[]); assert.deepEqual(privacy.local,{}); assert.deepEqual(privacy.session,{});
    });
    await popup.close();

    // Deliberately delay a synthetic demo merchant response, navigate away, then
    // release it. A previous tab's result must not restore a stale dollar badge.
    await worker.evaluate(() => {
      const globals = globalThis as any;
      globals.__pendingDemoResponses = [];
      globals.fetch = async (input: unknown) => {
        if (String(input) !== 'http://localhost:3001/v1/merchants') throw new Error('Unexpected fixture request');
        return new Promise<Response>(resolve => globals.__pendingDemoResponses.push(() => resolve(Response.json({
          merchants:[{id:'00000000-0000-4000-8000-000000000001',domain:'localhost',name:'Fixture demo',currency:'USD'}],
        }))));
      };
    });
    await page.goto('http://localhost:4173/checkout');
    await until(() => worker.evaluate(() => (globalThis as any).__pendingDemoResponses.length), value => value > 0, 'delayed demo merchant lookup');
    await page.goto('https://www.amazon.com/gp/cart/view.html');
    await until(badge, value => value === '', 'new page has no badge');
    const released = await worker.evaluate(() => {
      const pending = (globalThis as any).__pendingDemoResponses.splice(0);
      for (const release of pending) release();
      return pending.length;
    });
    // Observe through the delayed response's asynchronous JSON/tab API work.
    const staleBadges: string[] = [];
    const observationDeadline = Date.now() + 700;
    do { staleBadges.push(await badge()); await Bun.sleep(50); } while (Date.now() < observationDeadline);
    check('late demo API response cannot restore a badge after Amazon cart navigation', () => {
      assert.ok(released > 0); assert.ok(staleBadges.every(value => value === ''));
    });
    console.log(`Amazon MV3: ${passed} checks passed. Synthetic fixture only; ${fixtureHostGrant ? 'temporary test host grant, real activeTab permission not tested' : 'shipping manifest with programmatic action popup'}.`);
    return true;
  } finally { await context.close(); }
}

try {
  if (!await exercise(extensionPath,false)) {
    const fixtureExtension = join(scratch,'fixture-extension');
    await cp(extensionPath,fixtureExtension,{recursive:true});
    const manifest = JSON.parse(await readFile(join(fixtureExtension,'manifest.json'),'utf8'));
    // This modification is confined to a disposable copy. Shipping permissions
    // remain unchanged and must be exercised in the user's real Chrome separately.
    manifest.host_permissions = [...manifest.host_permissions,'https://www.amazon.com/*'];
    await writeFile(join(fixtureExtension,'manifest.json'),JSON.stringify(manifest));
    await exercise(fixtureExtension,true);
  }
} finally { await rm(scratch,{recursive:true,force:true}); }
