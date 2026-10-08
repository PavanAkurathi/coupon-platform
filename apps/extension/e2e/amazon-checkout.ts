import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { amazonCheckoutInspectionSchema } from '@repo/shared';

// Every request in this isolated browser is intercepted. No live Amazon access,
// shopper profile, cookies, backend or purchase is used by this fixture suite.
const fixture = await Bun.file(`${import.meta.dir}/fixtures/amazon-checkout.html`).text();
const build = await Bun.build({entrypoints:[`${import.meta.dir}/../src/amazon-checkout-reader.ts`], target:'browser', format:'esm'});
if (!build.success) throw new AggregateError(build.logs, 'Checkout reader test bundle failed');
const source = await build.outputs[0]!.text();
const browser = await chromium.launch({headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {channel:'chromium'}),
});
const context = await browser.newContext();
await context.route('**/*', async route => route.request().isNavigationRequest()
  ? route.fulfill({status:200, contentType:'text/html', body:fixture}) : route.abort());
const page = await context.newPage();
const checkoutUrl = 'https://www.amazon.com/checkout/p/p-000-0000000-0000000/spc?referrer=spc&tag=creator-fixture';
let checks = 0;
const check = (label: string, action: () => void) => { action(); checks++; console.log(`PASS ${label}`); };
async function reset(url = checkoutUrl) {
  await page.goto(url);
  await page.evaluate(async (source) => {
    const globals = window as any;
    globals.__reader = await import(URL.createObjectURL(new Blob([source], {type:'text/javascript'})));
    globals.__clicks = 0; globals.__submits = 0;
    document.addEventListener('click', () => globals.__clicks++, true);
    document.addEventListener('submit', event => {event.preventDefault(); globals.__submits++;}, true);
  }, source);
}
const inspect = async () => amazonCheckoutInspectionSchema.parse(await page.evaluate(() => (window as any).__reader.inspectAmazonCheckout()));
const definition = (row: string) => page.locator(`#${row} .order-summary-line-definition`);
try {
  await reset();
  const observed = await inspect();
  const untouched = await page.evaluate(() => ({clicks:(window as any).__clicks, submits:(window as any).__submits, url:location.href}));
  check('observed order summary reports the coupon saving and the merchant total', () => {
    assert.equal(observed.status, 'review_ready');
    assert.equal(observed.couponSavingsCents, 200);
    assert.equal(observed.orderTotalCents, 1911);
  });
  check('reading the summary never clicks, submits or changes the attribution URL', () => {
    assert.equal(untouched.clicks, 0); assert.equal(untouched.submits, 0); assert.equal(untouched.url, checkoutUrl);
  });
  check('observation contains amounts only: no address, item, URL or session identifier', () => {
    const serialized = JSON.stringify(observed);
    for (const leaked of ['Placeholder', 'Fixture face wipes', 'p-000', 'checkout/p', 'creator-fixture']) assert.ok(!serialized.includes(leaked), leaked);
    assert.deepEqual(Object.keys(observed).sort(), ['couponSavingsCents', 'observedAt', 'orderTotalCents', 'reason', 'site', 'status']);
  });
  check('hidden duplicate summaries are ignored', () => assert.notEqual(observed.orderTotalCents, 100));

  await reset(); await page.locator('#coupon-row').evaluate(el => el.remove());
  const noCoupon = await inspect();
  check('a summary without a coupon row reports zero savings, not a missing value', () => {
    assert.equal(noCoupon.status, 'review_ready'); assert.equal(noCoupon.couponSavingsCents, 0); assert.match(noCoupon.reason, /no coupon savings/);
  });
  await reset();
  await page.locator('#subtotals-marketplace-table').first().evaluate(table => table.append(table.querySelector('#coupon-row')!.cloneNode(true)));
  const twoCoupons = await inspect();
  check('two coupon rows are ambiguous and clear all amounts', () => {
    assert.equal(twoCoupons.status, 'unavailable'); assert.equal(twoCoupons.couponSavingsCents, null); assert.equal(twoCoupons.orderTotalCents, null);
  });
  await reset(); await definition('coupon-row').evaluate(el => { el.textContent = '$2.00'; });
  const unsigned = await inspect();
  check('an unsigned coupon amount is not read as a saving', () => assert.equal(unsigned.status, 'unavailable'));
  await reset(); await definition('total-row').evaluate(el => { el.textContent = '€19.11'; });
  const foreign = await inspect();
  check('a non-USD total is never reported in dollars', () => assert.equal(foreign.status, 'unavailable'));
  await reset(); await page.locator('#total-row').evaluate(el => el.remove());
  const noTotal = await inspect();
  check('a missing order total fails closed', () => assert.equal(noTotal.status, 'unavailable'));
  await reset(); await definition('coupon-row').evaluate(el => el.remove());
  const shifted = await inspect();
  check('a label without its own amount cannot borrow the next row', () => assert.equal(shifted.status, 'unavailable'));
  await reset(); await page.locator('#subtotals-marketplace-table').nth(1).evaluate(el => { (el as HTMLElement).style.display = ''; });
  const twoSummaries = await inspect();
  check('two visible summaries are ambiguous', () => assert.equal(twoSummaries.status, 'unavailable'));
  await reset(); await page.locator('.visible-place-order').evaluate(el => { (el as HTMLElement).style.display = 'none'; });
  const noReview = await inspect();
  check('without a visible final-review control, totals are not treated as final', () => {
    assert.equal(noReview.status, 'unavailable'); assert.match(noReview.reason, /delivery and payment/);
  });
  for (const [label, url] of [
    ['cart route', 'https://www.amazon.com/gp/cart/view.html'],
    ['product route', 'https://www.amazon.com/dp/B097S1MF28'],
    ['lookalike domain', 'https://www.amazon.com.evil.test/checkout/p/p-1/spc'],
  ] as const) {
    await reset(url);
    const outside = await inspect();
    check(`${label} is outside checkout reader capability even with matching HTML`, () => {
      assert.equal(outside.status, 'unavailable'); assert.equal(outside.orderTotalCents, null);
    });
  }
  console.log(`Amazon checkout reader: ${checks} fixture browser checks passed. No live shopping traffic.`);
} finally { await context.close(); await browser.close(); }

// Complete MV3 popup, worker and injected content script against the same fixture.
// Programmatic openPopup does not grant activeTab, so a disposable copy of the
// built extension receives a temporary Amazon host grant. The shipping manifest
// is unchanged; the real toolbar permission is checked in the founder's Chrome.
const scratch = await mkdtemp(join(tmpdir(), 'coupon-amazon-checkout-mv3-'));
const extension = join(scratch, 'extension');
await cp(resolve(import.meta.dir, '../dist'), extension, {recursive:true});
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = [...(manifest.host_permissions ?? []), 'https://www.amazon.com/*'];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const mv3 = await chromium.launchPersistentContext(join(scratch, 'profile'), {
  headless:false,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {channel:'chromium'}),
  args:[`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking'],
});
let mv3Checks = 0;
const mv3Check = (label: string, action: () => void) => { action(); mv3Checks++; console.log(`PASS ${label}`); };
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, message: string): Promise<T> {
  const deadline = Date.now() + 10000; let value: T;
  do { value = await read(); if (accept(value)) return value; await Bun.sleep(80); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${message}; last value: ${JSON.stringify(value)}`);
}
try {
  await mv3.route('**/*', async route => route.request().isNavigationRequest()
    ? route.fulfill({status:200, contentType:'text/html', body:fixture}) : route.abort());
  const tab = mv3.pages()[0] ?? await mv3.newPage();
  await tab.addInitScript(() => {
    const globals = window as any; globals.__clicks = 0; globals.__submits = 0;
    document.addEventListener('click', () => globals.__clicks++, true);
    document.addEventListener('submit', event => {event.preventDefault(); globals.__submits++;}, true);
  });
  const worker = mv3.serviceWorkers()[0] ?? await mv3.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    const globals = globalThis as any; globals.__attemptedFetches = [];
    globals.fetch = async (...args: unknown[]) => { globals.__attemptedFetches.push(String(args[0])); throw new Error('Fixture test forbids network requests'); };
  });
  await tab.goto(checkoutUrl);
  const cdp = await mv3.newCDPSession(tab);
  const pending = new Map<number, {resolve(value: any): void; reject(reason: Error): void}>(); let sequence = 0;
  cdp.on('Target.receivedMessageFromTarget', ({message}) => {
    const response = JSON.parse(message); const task = pending.get(response.id);
    if (!task) return; pending.delete(response.id);
    if (response.error) task.reject(new Error(response.error.message)); else task.resolve(response.result);
  });
  const command = (sessionId: string, method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {pending.delete(id); reject(new Error(`${method} timed out`));}, 12000);
    pending.set(id, {resolve(value) {clearTimeout(timer); resolve(value);}, reject(reason) {clearTimeout(timer); reject(reason);}});
    void cdp.send('Target.sendMessageToTarget', {sessionId, message:JSON.stringify({id, method, params})}).catch(reject);
  });
  async function openPopup() {
    await worker.evaluate(async () => {
      const [active] = await chrome.tabs.query({active:true, currentWindow:true});
      await chrome.windows.update(active!.windowId, {focused:true});
      await chrome.action.openPopup({windowId:active!.windowId});
    });
    const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(info => info.url.endsWith('/popup.html')), Boolean, 'action popup');
    const {sessionId} = await cdp.send('Target.attachToTarget', {targetId:target!.targetId});
    const evaluate = async <T = any>(expression: string): Promise<T> => {
      const result = await command(sessionId, 'Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    await until(() => evaluate<string>('document.getElementById("status")?.textContent'), text => Boolean(text && !/^(Checking this checkout|Reading Amazon)/.test(text)), 'checkout inspection');
    return {evaluate, close:() => cdp.send('Target.closeTarget', {targetId:target!.targetId}).catch(() => undefined)};
  }
  const view = (popup: Awaited<ReturnType<typeof openPopup>>) => popup.evaluate<{text: string; headline: string; savings: string; total: string; summaryHidden: boolean; trialHidden: boolean; codeHidden: boolean; tokenHidden: boolean; productHidden: boolean}>(`({
    text: document.body.innerText, headline: document.getElementById('headline').textContent,
    savings: document.getElementById('checkout-savings').textContent, total: document.getElementById('checkout-total').textContent,
    summaryHidden: document.getElementById('checkout-summary').hidden, trialHidden: document.getElementById('try-codes').hidden,
    codeHidden: document.getElementById('code-section').hidden, tokenHidden: document.getElementById('token-section').hidden,
    productHidden: document.getElementById('amazon-panel').hidden,
  })`);
  const badge = () => worker.evaluate(async () => {
    const [active] = await chrome.tabs.query({active:true, currentWindow:true});
    return chrome.action.getBadgeText({tabId:active!.id!});
  });
  const refreshPopup = async (popup: Awaited<ReturnType<typeof openPopup>>) => {
    await popup.evaluate('document.getElementById("checkout-refresh").click()');
    await until(() => popup.evaluate<boolean>('!document.getElementById("checkout-refresh").disabled'), Boolean, 'checkout refresh');
    return view(popup);
  };

  let popup = await openPopup();
  const shown = await view(popup);
  mv3Check('real popup shows the coupon saving and total exactly as Amazon displays them', () => {
    assert.equal(shown.headline, 'Coupon applied at checkout.');
    assert.equal(shown.savings, '$2.00'); assert.equal(shown.total, '$19.11');
    assert.match(shown.text, /Order not placed\. No commission claimed\./);
  });
  mv3Check('checkout review offers no code trial, community, token or product controls', () => {
    assert.ok(shown.trialHidden && shown.codeHidden && shown.tokenHidden && shown.productHidden);
    assert.doesNotMatch(shown.text, /We made|We saved you|confirmed by 3|Try codes/);
  });
  const shownBadge = await badge();
  mv3Check('a shown coupon saving receives the badge', () => assert.equal(shownBadge, '$'));
  const tried = await popup.evaluate<{ok: boolean; error?: string}>('chrome.runtime.sendMessage({type:"run"})');
  const manual = await popup.evaluate<{ok: boolean; error?: string}>('chrome.runtime.sendMessage({type:"try-code", code:"SAVE10"})');
  mv3Check('the worker refuses automatic and manual code trials on Amazon checkout', () => {
    assert.equal(tried.ok, false); assert.equal(manual.ok, false); assert.match(tried.error ?? '', /review-only/);
  });

  await tab.locator('#coupon-row').evaluate(el => el.remove());
  const noCoupon = await refreshPopup(popup);
  const noCouponBadge = await badge();
  mv3Check('after the coupon is removed, a refresh says no discount and drops the badge', () => {
    assert.equal(noCoupon.headline, 'No coupon discount shown.'); assert.equal(noCoupon.savings, ''); assert.equal(noCoupon.total, '$19.11');
    assert.equal(noCouponBadge, '');
  });
  await tab.locator('#total-row').evaluate(el => el.remove());
  const unreadable = await refreshPopup(popup);
  mv3Check('an unreadable summary clears every previously shown amount', () => {
    assert.equal(unreadable.summaryHidden, true); assert.equal(unreadable.savings, ''); assert.equal(unreadable.total, '');
    assert.doesNotMatch(unreadable.text, /\$19\.11|\$2\.00/);
  });
  const merchant = await tab.evaluate(() => ({clicks:(window as any).__clicks, submits:(window as any).__submits, url:location.href}));
  const leaks = await worker.evaluate(async () => ({
    fetches:(globalThis as any).__attemptedFetches.length,
    session:Object.keys(await chrome.storage.session.get(null)), local:Object.keys(await chrome.storage.local.get(null)),
  }));
  mv3Check('review never clicks, submits or rewrites the creator-tagged checkout URL', () => {
    assert.equal(merchant.clicks, 0); assert.equal(merchant.submits, 0); assert.equal(merchant.url, checkoutUrl);
  });
  mv3Check('review sends no API request and stores no checkout snapshot', () => {
    assert.equal(leaks.fetches, 0); assert.deepEqual(leaks.session, []); assert.deepEqual(leaks.local, []);
  });
  await popup.close();

  await tab.goto(checkoutUrl);
  popup = await openPopup(); await popup.close();
  await until(badge, value => value === '$', 'badge restored on a fresh checkout reading');
  await tab.goto('https://www.amazon.com/gp/cart/view.html');
  const clearedBadge = await until(badge, value => value === '', 'badge cleared after navigation');
  popup = await openPopup();
  const cart = await view(popup);
  mv3Check('leaving checkout clears the badge and the popup stops showing checkout amounts', () => {
    assert.equal(clearedBadge, ''); assert.notEqual(cart.headline, 'Coupon applied at checkout.');
    assert.doesNotMatch(cart.text, /\$19\.11|\$2\.00|Order total shown by Amazon/);
  });
  await popup.close();
  console.log(`Amazon checkout MV3: ${mv3Checks} checks passed. Synthetic fixture; temporary test host grant, real activeTab permission not tested.`);
} finally { await mv3.close(); await rm(scratch, {recursive:true, force:true}); }
