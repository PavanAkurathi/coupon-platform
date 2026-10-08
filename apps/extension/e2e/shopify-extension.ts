import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

// Complete MV3 popup, worker and injected Shopify content script against the
// behavioral fixture. Every page request is intercepted and the worker's fetch is
// replaced by an in-memory coupon service, so nothing reaches a store or the API.
// Programmatic openPopup does not grant activeTab, so a disposable copy of the build
// receives a temporary host grant; the shipping manifest is unchanged.
const fixture = await Bun.file(`${import.meta.dir}/fixtures/shopify-checkout.html`).text();
const host = 'www.allbirds.com';
const checkoutUrl = `https://${host}/checkouts/cn/hWN4FixtureToken0000/en-us?tag=creator-fixture`;
const merchantId = '00000000-0000-4000-8000-0000000000a1';
const scratch = await mkdtemp(join(tmpdir(), 'coupon-shopify-mv3-'));
const extension = join(scratch, 'extension');
await cp(resolve(import.meta.dir, '../dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = [...(manifest.host_permissions ?? []), `https://${host}/*`];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
  headless: false,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking'],
});
let passed = 0;
const check = (label: string, action: () => void) => { action(); passed++; console.log(`PASS ${label}`); };
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, message: string, ms = 30000): Promise<T> {
  const deadline = Date.now() + ms; let value: T;
  do { value = await read(); if (accept(value)) return value; await Bun.sleep(100); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${message}; last value: ${JSON.stringify(value)}`);
}
try {
  await context.route('**/*', (route) => route.request().isNavigationRequest()
    ? route.fulfill({ status: 200, contentType: 'text/html', body: fixture }) : route.abort());
  const page = context.pages()[0] ?? await context.newPage();
  await page.addInitScript(() => {
    const globals = window as any; globals.__payClicks = 0;
    document.addEventListener('click', (event) => { if ((event.target as Element)?.closest?.('#checkout-pay-button')) globals.__payClicks++; }, true);
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const service = (merchants: unknown[]) => worker.evaluate(([merchantId, merchants]) => {
    const globals = globalThis as any; globals.__calls = []; globals.__reports = [];
    const safety = { approvalStatus: 'approved', audience: 'public', attributionBehavior: 'neutral', reviewedAt: '2026-10-08T12:00:00.000Z', evidenceRef: 'fixture-only' };
    const candidate = (code: string, cents: number, extra = {}) => ({ id: crypto.randomUUID(), code, successRate: 1, expectedSavingsCents: cents, score: cents,
      confirmations: 3, lastConfirmedAt: '2026-10-07T12:00:00.000Z', expiresAt: null, ...safety, ...extra });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globals.fetch = async (input: string, init?: RequestInit) => {
      const url = new URL(String(input)); globals.__calls.push(url.pathname);
      if (url.pathname === '/v1/merchants') return json({ merchants });
      if (url.pathname === '/v1/coupons/candidates') return json({ merchantId, currency: 'USD', candidates: [
        candidate('AFFX', 900, { attributionBehavior: 'affiliate' }), candidate('WELCOME10', 250), candidate('SAVE5', 500), candidate('BAD1', 100)] });
      if (url.pathname === '/v1/coupons/report') {
        globals.__reports.push(JSON.parse(String(init?.body)));
        return json({ couponId: crypto.randomUUID(), status: 'quarantined', confirmations: 1, successRate: 1 });
      }
      return new Response('{}', { status: 404 });
    };
  }, [merchantId, merchants] as const);
  const allbirds = [{ id: merchantId, domain: host, name: 'Allbirds', currency: 'USD' }];
  await service(allbirds);
  await page.goto(checkoutUrl);
  // The fixture also accepts AFFX, so trying it would show up in the applied codes.
  await page.evaluate(() => { (window as any).__fixtureCodes.AFFX = () => 900; });
  const cdp = await context.newCDPSession(page);
  const pending = new Map<number, { resolve(value: any): void; reject(reason: Error): void }>(); let sequence = 0;
  cdp.on('Target.receivedMessageFromTarget', ({ message }) => {
    const response = JSON.parse(message); const task = pending.get(response.id);
    if (!task) return; pending.delete(response.id);
    if (response.error) task.reject(new Error(response.error.message)); else task.resolve(response.result);
  });
  const command = (sessionId: string, method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 60000);
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(reason) { clearTimeout(timer); reject(reason); } });
    void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
  });
  async function openPopup() {
    await worker.evaluate(async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.windows.update(active!.windowId, { focused: true });
      await chrome.action.openPopup({ windowId: active!.windowId });
    });
    const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find((info) => info.url.endsWith('/popup.html')), Boolean, 'action popup', 10000);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target!.targetId });
    const evaluate = async <T = any>(expression: string): Promise<T> => {
      const result = await command(sessionId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    await until(() => evaluate<string>('document.getElementById("status")?.textContent'), (text) => Boolean(text && text !== 'Checking this checkout…'), 'popup status', 10000);
    return { evaluate, close: () => cdp.send('Target.closeTarget', { targetId: target!.targetId }).catch(() => undefined) };
  }
  const view = (popup: Awaited<ReturnType<typeof openPopup>>) => popup.evaluate<{ text: string; store: string; tryDisabled: boolean; pillHidden: boolean; saved: string; applied: string }>(`({
    text: document.body.innerText, store: document.getElementById('store').textContent, tryDisabled: document.getElementById('try-codes').disabled,
    pillHidden: document.getElementById('env-pill').hidden, saved: document.getElementById('saved-amount').textContent, applied: document.getElementById('applied-code').textContent,
  })`);
  const badge = () => worker.evaluate(async () => { const [active] = await chrome.tabs.query({ active: true, currentWindow: true }); return chrome.action.getBadgeText({ tabId: active!.id! }); });
  const store = () => page.evaluate(() => ({ applied: (window as any).__fixtureState.applied, pay: (window as any).__payClicks,
    email: (document.getElementById('email') as HTMLInputElement).value, marketing: (document.getElementById('marketing') as HTMLInputElement).checked, url: location.href }));

  let popup = await openPopup();
  const ready = await view(popup);
  const readyBadge = await badge();
  check('an enabled Shopify checkout is recognized by exact host with an estimate note', () => {
    assert.equal(ready.store, 'Allbirds · checkout'); assert.equal(ready.tryDisabled, false); assert.equal(ready.pillHidden, true);
    assert.match(ready.text, /estimates until you add an address/); assert.equal(readyBadge, '$');
  });
  await popup.evaluate('document.getElementById("try-codes").click()');
  await until(() => popup.evaluate<boolean>('!document.getElementById("try-codes").disabled && document.getElementById("result").hidden === false'), Boolean, 'trial result', 60000);
  const result = await view(popup); const afterRun = await store();
  check('the real popup applies the best verified code and shows the measured saving', () => {
    assert.match(result.applied, /^SAVE5 applied/); assert.deepEqual(afterRun.applied, ['SAVE5']); assert.notEqual(result.saved, '$0.00');
  });
  check('an affiliate-attributed candidate is filtered before any checkout action', () => assert.ok(!afterRun.applied.includes('AFFX')));
  check('trials never touch contact, consent, Pay now or the creator-tagged URL', () => {
    assert.equal(afterRun.pay, 0); assert.equal(afterRun.email, ''); assert.equal(afterRun.marketing, true); assert.equal(afterRun.url, checkoutUrl);
  });
  const noToken = await worker.evaluate(() => (globalThis as any).__reports.length);
  check('without a shopper token no verification report is sent', () => { assert.equal(noToken, 0); assert.match(result.text, /Add a shopper token/); });
  await popup.close();
  popup = await openPopup();
  const reopened = await view(popup);
  check('reopening the popup shows the stored result while the checkout still matches', () => assert.match(reopened.applied, /^SAVE5 applied/));
  await popup.close();

  await page.goto(checkoutUrl); await page.evaluate(() => { (window as any).__fixtureCodes.AFFX = () => 900; });
  await worker.evaluate(() => chrome.storage.local.set({ shopperToken: 'unissued-shopify-fixture-token-000000000000' }));
  popup = await openPopup();
  await popup.evaluate('document.getElementById("try-codes").click()');
  await until(() => popup.evaluate<boolean>('!document.getElementById("try-codes").disabled && document.getElementById("result").hidden === false'), Boolean, 'second trial', 60000);
  const reports = await worker.evaluate(() => (globalThis as any).__reports);
  check('with a token, each attempted code is reported once with its measured outcome', () => {
    assert.deepEqual(reports.map((r: any) => [r.code, r.outcome]), [['WELCOME10', 'success'], ['SAVE5', 'success'], ['BAD1', 'failure']]);
    assert.ok(reports.every((r: any) => r.merchantId === merchantId && r.currency === 'USD'));
  });
  await popup.close();

  await page.goto(checkoutUrl);
  await page.evaluate(() => { (window as any).__fixtureCodes.CREATOR10 = () => 300; (window as any).__fixtureApply('CREATOR10'); });
  popup = await openPopup();
  const existing = await view(popup);
  const refused = await popup.evaluate<{ ok: boolean; error?: string }>('chrome.runtime.sendMessage({type:"run"})');
  const kept = await store();
  check('an existing code disables trials, is named in the popup and stays applied', () => {
    assert.equal(existing.tryDisabled, true); assert.match(existing.text, /CREATOR10 is already applied/);
    assert.equal(refused.ok, false); assert.deepEqual(kept.applied, ['CREATOR10']);
  });
  await popup.close();

  await service([]);
  await page.goto(checkoutUrl);
  popup = await openPopup();
  const disabled = await view(popup);
  check('a store missing from the enabled list is not supported', () => { assert.match(disabled.text, /Not supported here yet/); assert.equal(disabled.tryDisabled, true); });
  await popup.close();

  await service(allbirds);
  await page.goto(`https://${host}/cart`);
  popup = await openPopup();
  const cart = await view(popup);
  const cartCalls = await worker.evaluate(() => (globalThis as any).__calls);
  check('a non-checkout page on an enabled host makes no coupon-service call', () => { assert.match(cart.text, /Not supported here yet/); assert.deepEqual(cartCalls, []); });
  await popup.close();
  console.log(`Shopify MV3: ${passed} checks passed. Synthetic fixture and in-memory service; temporary host grant, real activeTab permission not tested.`);
} finally { await context.close(); await rm(scratch, { recursive: true, force: true }); }
