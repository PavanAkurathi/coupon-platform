import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { chromium } from 'playwright';

// Run with the seeded local API and demo server running. Uses an isolated browser
// profile and the real action popup: a popup opened as a tab is intentionally rejected.
const extensionPath = resolve(import.meta.dir, '../dist');
const profile = await mkdtemp(join(tmpdir(), 'coupon-extension-smoke-'));
const screenshotPath = process.env.E2E_SCREENSHOT ?? resolve(import.meta.dir, '../../../../extension-preview.png');
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
let passed = 0;
function check(name: string, action: () => unknown) { action(); passed++; console.log(`PASS ${name}`); }
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, message: string): Promise<T> {
  const deadline = Date.now() + 10000;
  let value: T;
  do { value = await read(); if (accept(value)) return value; await Bun.sleep(80); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${message}; last value: ${JSON.stringify(value)}`);
}

try {
  const page = context.pages()[0] ?? await context.newPage();
  // Fixture cookie represents a creator-owned attribution. Only the harness sets it.
  await context.addCookies([{ name: 'affiliate_owner', value: 'creator-fixture', domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await page.goto('http://localhost:4173/checkout?tag=creator-fixture');
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const cdp = await context.newCDPSession(page);
  const pending = new Map<number, { resolve(value: any): void; reject(reason: Error): void }>();
  let sequence = 0;
  cdp.on('Target.receivedMessageFromTarget', ({ message }) => {
    const response = JSON.parse(message); const task = pending.get(response.id);
    if (!task) return; pending.delete(response.id);
    if (response.error) task.reject(new Error(response.error.message)); else task.resolve(response.result);
  });
  function command(sessionId: string, method: string, params: object = {}): Promise<any> {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 12000);
      pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value); }, reject(reason) { clearTimeout(timer); reject(reason); } });
      void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
    });
  }
  async function openPopup() {
    await worker.evaluate(async () => {
      const tab = (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith('http://localhost:4173/'));
      if (!tab?.id) throw new Error('Demo browser tab missing');
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.action.openPopup({ windowId: tab.windowId });
    });
    const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find((target) => target.url.endsWith('/popup.html')), Boolean, 'action popup target');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target!.targetId });
    async function evaluate<T = any>(expression: string): Promise<T> {
      const result = await command(sessionId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    }
    await until(() => evaluate<string>('document.getElementById("status")?.textContent'), (text) => Boolean(text && text !== 'Checking this checkout…'), 'popup status');
    return {
      evaluate,
      async close() { await cdp.send('Target.closeTarget', { targetId: target!.targetId }).catch(() => undefined); },
      async screenshot(path: string) {
        const { data } = await command(sessionId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await mkdir(dirname(path), { recursive: true }); await writeFile(path, Buffer.from(data, 'base64'));
      },
      async run() {
        const enabled = await evaluate<boolean>('!document.getElementById("try-codes").disabled');
        assert.equal(enabled, true, await evaluate('document.body.innerText'));
        await evaluate('document.getElementById("try-codes").click()');
        await until(() => evaluate<{ done: boolean; text: string }>('({done:!document.getElementById("try-codes").disabled,text:document.body.innerText})'), (result) => result.done, 'coupon trials complete');
      },
    };
  }
  const badge = await until(() => worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find((tab) => tab.url?.includes('4173/checkout'));
    return chrome.action.getBadgeText({ tabId: tab!.id! });
  }), (text) => text === '$', 'merchant badge');
  check('supported merchant receives dollar badge', () => assert.equal(badge, '$'));

  // A syntactically valid, unissued fixture token enables the manual-code UI only.
  // It is confined to this disposable profile and must never authenticate a report.
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ shopperToken: 'unissued-smoke-fixture-token-0000000000000000' });
  });
  await page.evaluate(() => {
    const instrumented = window as typeof window & { __couponSmokePromoClicks: number };
    instrumented.__couponSmokePromoClicks = 0;
    document.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-apply-coupon], [data-remove-coupon]')) {
        instrumented.__couponSmokePromoClicks++;
      }
    }, true);
  });
  const checkoutSnapshot = () => page.evaluate(() => ({
    data: { ...document.querySelector<HTMLElement>('[data-coupon-demo]')!.dataset },
    promoValue: document.querySelector<HTMLInputElement>('[data-coupon-input]')!.value,
    clicks: (window as typeof window & { __couponSmokePromoClicks: number }).__couponSmokePromoClicks,
  }));
  const beforeUnknown = await checkoutSnapshot();
  let popup = await openPopup();
  const unknownReply = await popup.evaluate<{ ok: boolean; error?: string }>(
    'chrome.runtime.sendMessage({type:"try-code",code:"UNREVIEWED"})',
  );
  check('actual popup rejects unknown manual codes awaiting safety review', () => {
    assert.equal(unknownReply.ok, false);
    assert.match(unknownReply.error ?? '', /awaiting safety review/i);
  });
  const afterUnknown = await checkoutSnapshot();
  check('failed preflight causes zero promo clicks or checkout changes', () => {
    assert.equal(afterUnknown.clicks, 0);
    assert.deepEqual(afterUnknown, beforeUnknown);
  });

  const [reportResponse, legacyReply] = await Promise.all([
    context.waitForEvent('response', {
      predicate: (response) => response.url() === 'http://localhost:3001/v1/coupons/report',
      timeout: 10000,
    }),
    popup.evaluate<{ ok: boolean; data?: { reportNote: string; result: { appliedCode: string | null; savingsCents: number } } }>(
      'chrome.runtime.sendMessage({type:"try-code",code:"LEGACY5"})',
    ),
  ]);
  const afterLegacy = await checkoutSnapshot();
  const creatorCookieAfterManual = (await context.cookies()).find((cookie) => cookie.name === 'affiliate_owner');
  check('reviewed quarantined manual code works while protecting creator attribution', () => {
    assert.equal(legacyReply.ok, true);
    assert.equal(legacyReply.data?.result.appliedCode, 'LEGACY5');
    assert.equal(legacyReply.data?.result.savingsCents, 500);
    assert.equal(afterLegacy.data.appliedCode, 'LEGACY5');
    assert.equal(afterLegacy.data.totalCents, '9500');
    assert.equal(afterLegacy.data.completed, 'false');
    assert.ok(afterLegacy.clicks > 0, 'Promo click instrumentation also observes approved trials');
    assert.equal(creatorCookieAfterManual?.value, 'creator-fixture');
    assert.ok(page.url().endsWith('?tag=creator-fixture'));
  });
  check('unissued token cannot save a report or claim verification success', () => {
    assert.equal(reportResponse.status(), 401);
    assert.match(legacyReply.data?.reportNote ?? '', /verification reports could not be saved/i);
    assert.doesNotMatch(legacyReply.data?.reportNote ?? '', /Your results helped check these codes/i);
  });
  await popup.close();
  popup = await openPopup();
  const unsavedReportText = await popup.evaluate<string>('document.getElementById("status").textContent');
  check('popup displays the unsaved verification report honestly', () => {
    assert.match(unsavedReportText, /verification reports could not be saved/i);
    assert.doesNotMatch(unsavedReportText, /Your results helped check these codes/i);
  });
  await popup.close();
  await worker.evaluate(async () => {
    await chrome.storage.local.remove('shopperToken');
    await chrome.storage.session.clear();
  });
  await page.getByRole('button', { name: 'Start a new cart', exact: true }).click();

  // Preserve the original automatic-trial, recovery and receipt smoke checks.
  popup = await openPopup();
  await popup.run();
  const first = await page.locator('[data-coupon-demo]').evaluate((element) => ({ ...((element as HTMLElement).dataset) }));
  check('real popup applies highest-saving verified code', () => { assert.equal(first.appliedCode, 'SAVE15'); assert.equal(first.totalCents, '8500'); });
  check('extension never submits the order', () => assert.equal(first.completed, 'false'));
  const resultText = await popup.evaluate<string>('document.body.innerText');
  check('popup shows measured savings', () => assert.ok(resultText.includes('$15.00') && resultText.includes('SAVE15 applied')));
  const cookie = (await context.cookies()).find((cookie) => cookie.name === 'affiliate_owner');
  check('creator attribution cookie and URL remain intact', () => { assert.equal(cookie?.value, 'creator-fixture'); assert.ok(page.url().endsWith('?tag=creator-fixture')); });
  await popup.screenshot(screenshotPath);
  await popup.close();

  await page.getByRole('textbox', { name: 'Promo code' }).fill('NEW20');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-coupon-demo]')?.dataset.appliedCode === 'NEW20');
  popup = await openPopup(); await popup.run();
  const preserved = await page.locator('[data-coupon-demo]').evaluate((element) => ({ ...((element as HTMLElement).dataset) }));
  check('a better pre-existing coupon is restored', () => { assert.equal(preserved.appliedCode, 'NEW20'); assert.equal(preserved.totalCents, '8000'); });
  await popup.close();
  await page.getByRole('button', { name: 'Complete demo checkout', exact: true }).click();
  popup = await openPopup();
  const receipt = await popup.evaluate<string>('document.getElementById("receipt").textContent');
  check('completed demo receipt does not fabricate commission', () => assert.equal(receipt, 'You saved $20.00. We made $0. (Demo)'));
  await popup.close();
  await page.getByRole('button', { name: 'Start a new cart', exact: true }).click();
  popup = await openPopup();
  const staleHidden = await popup.evaluate('document.getElementById("result").hidden');
  check('new cart clears stale savings', () => assert.equal(staleHidden, true));
  await popup.close();

  await page.goto('http://localhost:4173/not-a-checkout');
  const unsupportedBadge = await until(() => worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find((tab) => tab.url?.includes('4173/not-a-checkout'));
    return chrome.action.getBadgeText({ tabId: tab!.id! });
  }), (text) => text === '', 'unsupported merchant badge removed');
  check('unsupported page receives no badge', () => assert.equal(unsupportedBadge, ''));
  popup = await openPopup();
  const disabled = await popup.evaluate('document.getElementById("try-codes").disabled');
  check('unsupported page cannot run coupon trials', () => assert.equal(disabled, true));
  await popup.close();
  console.log(`Browser smoke complete: ${passed} checks; real MV3 popup, worker and checkout content script. Screenshot: ${screenshotPath}`);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
