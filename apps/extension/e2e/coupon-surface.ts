import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type CDPSession, type Worker } from 'playwright';

// Synthetic fixtures only. The builds and profiles are disposable, and a dead
// local proxy blocks requests that escape Playwright routing (including worker
// traffic). This suite never uses installed dist, an account, or a real cart.
// Run: bun --no-env-file apps/extension/e2e/coupon-surface.ts
const root = resolve(import.meta.dir, '../../..');
const scratch = await mkdtemp(join(tmpdir(), 'hold-coupon-surface-'));
const shots = join(root, 'output/playwright/coupon-surface');
const productURL = 'https://www.amazon.com/dp/B097S1MF28?tag=creator-fixture';
const checkoutURL = 'https://www.amazon.com/checkout/p/p-000-0000000-0000000/spc?referrer=spc&tag=creator-fixture';
const unsupportedURL = 'https://unsupported.example.test/fixture';
const fixtureShopURL = 'https://fixture-shop.example.test/checkouts/c/synthetic';
const fixtures = {
  product: await Bun.file(join(import.meta.dir, 'fixtures/amazon-product.html')).text(),
  checkout: await Bun.file(join(import.meta.dir, 'fixtures/amazon-checkout.html')).text(),
};
let checks = 0;
const check = (label: string, test: () => void) => { test(); checks++; console.log(`PASS ${label}`); };
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  const end = Date.now() + 12_000;
  let value: T;
  do { value = await read(); if (accept(value)) return value; await Bun.sleep(60); } while (Date.now() < end);
  throw new Error(`Timed out: ${label}; last value: ${JSON.stringify(value)}`);
}

function build(browser: 'chrome' | 'firefox', ui?: 'popup') {
  const outdir = join(scratch, `${browser}-${ui ?? 'default'}`);
  const built = Bun.spawnSync([process.execPath, '--no-env-file', join(root, 'apps/extension/build.ts'),
    '--target', 'beta', '--browser', browser, ...(ui ? ['--ui', ui] : []), '--outdir', outdir], {
    cwd: scratch,
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, COUPON_API_ORIGIN: 'https://coupons.example.test' },
    stdout: 'pipe', stderr: 'pipe',
  });
  assert.equal(built.exitCode, 0, built.stderr.toString() || built.stdout.toString());
  return outdir;
}

// These CDP calls attach to the real action-popup/side-panel target. Merely
// opening sidepanel.html in a tab would not exercise persistent panel behavior.
function rpc(cdp: CDPSession) {
  let next = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  cdp.on('Target.receivedMessageFromTarget', ({ message }) => {
    const response = JSON.parse(message), task = pending.get(response.id);
    if (!task) return;
    pending.delete(response.id);
    if (response.error) task.reject(new Error(response.error.message)); else task.resolve(response.result);
  });
  return (sessionId: string, method: string, params: object = {}) => new Promise<any>((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 12_000);
    pending.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
    void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
      .catch(error => { pending.delete(id); clearTimeout(timer); reject(error); });
  });
}

async function exercise(outdir: string, surface: 'sidepanel' | 'popup') {
  // Scripted action opening does not grant activeTab. Limit the substitute grant
  // to the one synthetic Amazon host, in the disposable copy only.
  const manifest = await Bun.file(join(outdir, 'manifest.json')).json();
  manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), 'https://www.amazon.com/*'])];
  await Bun.write(join(outdir, 'manifest.json'), JSON.stringify(manifest));
  await Bun.write(join(outdir, 'coupon-surface-driver.html'), '<!doctype html><title>Synthetic panel driver</title><button id="open" disabled>Open synthetic panel</button><script src="coupon-surface-driver.js"></script>');
  await Bun.write(join(outdir, 'coupon-surface-driver.js'), `let windowId; chrome.windows.getCurrent().then(w=>{windowId=w.id;document.getElementById('open').disabled=false;});document.getElementById('open').addEventListener('click',()=>chrome.sidePanel.open({windowId}));`);
  const context = await chromium.launchPersistentContext(join(scratch, `profile-${surface}`), {
    headless: false, viewport: { width: 1400, height: 1000 },
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
    args: [`--disable-extensions-except=${outdir}`, `--load-extension=${outdir}`, '--disable-background-networking',
      '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--disable-quic'],
  });
  const errors: string[] = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  let documentFixture = fixtures.product;
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('chrome-extension://')) return route.continue();
    if (route.request().isNavigationRequest() && url === productURL)
      return route.fulfill({ contentType: 'text/html', body: documentFixture });
    if (route.request().isNavigationRequest() && url === checkoutURL)
      return route.fulfill({ contentType: 'text/html', body: fixtures.checkout });
    if (route.request().isNavigationRequest() && [unsupportedURL, fixtureShopURL].includes(url))
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic unsupported page</title><h1>Fixture only. No cart or payment fields.</h1>' });
    return route.abort();
  });
  await context.addInitScript(() => {
    const globals = window as any;
    globals.__merchantClicks = 0; globals.__merchantSubmits = 0;
    document.addEventListener('click', () => globals.__merchantClicks++, true);
    document.addEventListener('submit', event => { event.preventDefault(); globals.__merchantSubmits++; }, true);
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(() => {
      const globals = globalThis as any;
      globals.__fixtureFetches = [];
      globals.__fixtureMerchants = [];
      globals.__fixtureDispatches = [];
      const send = chrome.tabs.sendMessage.bind(chrome.tabs);
      (chrome.tabs as any).sendMessage = (...args: any[]) => {
        globals.__fixtureDispatches.push(args[1]?.type);
        return (send as any)(...args);
      };
      globals.fetch = async (input: unknown) => {
        const url = String(input); globals.__fixtureFetches.push(url);
        if (url === 'https://coupons.example.test/v1/merchants') return Response.json({ merchants: globals.__fixtureMerchants });
        if (url.startsWith('https://coupons.example.test/v1/coupons/candidates?'))
          return Response.json({ merchantId: '00000000-0000-4000-8000-000000000001', currency: 'USD', candidates: [] });
        throw new Error('Synthetic coupon-surface fixture blocked external request');
      };
    });
    const base = worker.url().slice(0, worker.url().lastIndexOf('/'));
    const merchant = context.pages()[0] ?? await context.newPage();
    await merchant.goto(productURL);
    await merchant.bringToFront();
    const tab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]!);
    assert.ok(tab.id);
    const cdp = await context.newCDPSession(merchant), command = rpc(cdp);
    if (surface === 'sidepanel') {
      const driver = await context.newPage();
      await driver.goto(`${base}/coupon-surface-driver.html`);
      const denied = await driver.evaluate(async binding => {
        try { return await chrome.runtime.sendMessage({ type: 'surface-request', ...binding, request: { type: 'status' } }); }
        catch (error) { return { ok: false, error: String(error) }; }
      }, { tabId: tab.id!, url: productURL });
      check('an arbitrary extension page cannot impersonate the coupon surface', () => assert.notEqual(denied?.ok, true));
      await driver.locator('#open').click();
      await merchant.bringToFront();
      await driver.close();
    } else {
      await worker.evaluate(async () => {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.windows.update(active!.windowId, { focused: true });
        await chrome.action.openPopup({ windowId: active!.windowId });
      });
    }
    const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(info => info.url === `${base}/${surface}.html`), Boolean, `${surface} target`);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target!.targetId });
    cdp.on('Target.receivedMessageFromTarget', event => {
      const message = JSON.parse(event.message);
      if (event.sessionId === sessionId && message.method === 'Runtime.exceptionThrown')
        errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    });
    await command(sessionId, 'Runtime.enable');
    const evaluate = async <T = any>(expression: string): Promise<T> => {
      const response = await command(sessionId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
      return response.result.value;
    };
    const request = (request: object, url = productURL, tabId = tab.id!) => evaluate<any>(
      `chrome.runtime.sendMessage(${JSON.stringify({ type: 'surface-request', tabId, url, request })})`);
    const view = () => evaluate<{ text: string; headline: string; showHidden: boolean; resultHidden: boolean; savings: string; total: string }>(`({
      text:document.body.innerText,headline:document.getElementById('headline').textContent,
      showHidden:document.getElementById('amazon-show').hidden,resultHidden:document.getElementById('result').hidden,
      savings:document.getElementById('checkout-savings').textContent,total:document.getElementById('checkout-total').textContent
    })`);
    const shown = await until(view, state => state.text.includes('$15.99'), `${surface} native coupon`);
    check(`${surface}: real MV3 surface shows native offer without a confirmed-saving claim`, () => {
      assert.match(shown.text, /Coupon price/); assert.match(shown.text, /Eligibility not confirmed/);
      assert.equal(shown.resultHidden, true); assert.equal(shown.showHidden, false);
      assert.doesNotMatch(shown.text, /We made|saved on this cart|confirmed by 3 shoppers/i);
    });
    const initial = await request({ type: 'status' });
    check(`${surface}: bound request reads the displayed product`, () => {
      assert.equal(initial.ok, true, JSON.stringify(initial));
      assert.equal(initial.data.amazon.status, 'offers_found');
      assert.equal(initial.data.amazon.offers[0].advertisedPriceCents, 1599);
    });
    const offers = await request({ type: 'coupon-candidates' });
    check(`${surface}: native offers cannot become automatic code trials`, () => {
      assert.equal(offers.ok, true, JSON.stringify(offers)); assert.equal(offers.data.canTest, false); assert.deepEqual(offers.data.candidates, []);
    });
    const forbidden = await Promise.all([request({ type: 'run' }), request({ type: 'try-code', code: 'SYNTHETIC10' })]);
    check(`${surface}: automatic/manual Amazon coupon trials are denied`, () => assert.ok(forbidden.every(reply => reply.ok === false)));
    const senderDenial = await worker.evaluate(async binding => {
      const result = await chrome.scripting.executeScript({ target: { tabId: binding.tabId }, args: [binding],
        func: async binding => {
          try { return await chrome.runtime.sendMessage({ type: 'surface-request', ...binding, request: { type: 'status' } }); }
          catch (error) { return { ok: false, error: String(error) }; }
        },
      });
      return result[0]?.result;
    }, { tabId: tab.id!, url: productURL });
    check(`${surface}: merchant content script cannot impersonate a surface`, () => assert.notEqual(senderDenial?.ok, true));
    await evaluate(`document.getElementById('amazon-show').click()`);
    const focused = await until(() => merchant.evaluate(() => ({ active: document.activeElement?.id,
      checked: (document.getElementById('fixture-coupon') as HTMLInputElement).checked,
      clicks: (window as any).__merchantClicks, submits: (window as any).__merchantSubmits, url: location.href })), state => state.active === 'fixture-coupon', 'focus-only native action');
    check(`${surface}: native action only focuses, preserves attribution and never submits`, () => {
      assert.equal(focused.checked, false); assert.equal(focused.clicks, 0); assert.equal(focused.submits, 0); assert.equal(focused.url, productURL);
    });

    // Full persistent-panel flow; a real action popup legitimately closes when
    // tab focus/navigation changes, so popup parity above stays within one visit.
    if (surface === 'sidepanel') {
      await exercisePanel({ context, worker, merchant, cdp, command, sessionId, evaluate, request, view, tabId: tab.id!, base,
        setFixture: value => { documentFixture = value; }, errors });
    }
    check(`${surface}: no uncaught surface script errors`, () => assert.deepEqual(errors, []));
  } finally { await context.close(); }
}

type PanelHarness = {
  context: BrowserContext; worker: Worker; merchant: import('playwright').Page; cdp: CDPSession;
  command: ReturnType<typeof rpc>; sessionId: string; evaluate: <T = any>(expression: string) => Promise<T>;
  request: (request: object, url?: string, tabId?: number) => Promise<any>; view: () => Promise<any>;
  tabId: number; base: string; setFixture: (value: string) => void; errors: string[];
};
async function exercisePanel(h: PanelHarness) {
  const { worker, merchant, evaluate, request, view, tabId } = h;
  const direct = await evaluate(`chrome.runtime.sendMessage({type:'run'})`);
  check('sidepanel: unbound side-effect request is denied', () => assert.notEqual(direct?.ok, true));
  const wrongTab = await request({ type: 'status' }, productURL, tabId + 10000);
  check('sidepanel: arbitrary tab binding is rejected', () => assert.equal(wrongTab.ok, false));
  const inspection = (await request({ type: 'status' })).data.amazon;
  const oldFocus = { type: 'amazon-focus', asin: inspection.asin, fingerprint: inspection.fingerprint,
    observedAt: inspection.observedAt, offerId: inspection.offers[0].id };

  await merchant.locator('#promoPriceBlockMessage_feature_div').evaluate(node => { node.innerHTML = '<div class="unknown-coupon">Coupon: save 15% in an unknown layout</div>'; });
  await evaluate(`document.getElementById('amazon-refresh').click()`);
  const unknown = await until(view, state => /not recognized/.test(state.text), 'unknown coupon state');
  check('unknown visible coupon is not called no coupon or verified', () => {
    assert.doesNotMatch(unknown.text, /No visible coupon|\$15\.99/); assert.equal(unknown.showHidden, true);
  });
  await merchant.locator('#promoPriceBlockMessage_feature_div').evaluate(node => { (node as HTMLElement).hidden = true; });
  await evaluate(`document.getElementById('amazon-refresh').click()`);
  const empty = await until(view, state => /No visible coupon/.test(state.headline), 'no visible coupon state');
  check('empty native coupon state clears stale offer amounts and actions', () => { assert.equal(empty.showHidden, true); assert.doesNotMatch(empty.text, /\$15\.99/); });

  await merchant.goto(checkoutURL);
  const checkout = await until(view, state => state.savings === '$2.00' && state.total === '$19.11', 'panel follows checkout navigation');
  check('persistent panel reports only the coupon saving and total displayed by Amazon', () => {
    assert.match(checkout.text, /Coupon savings shown by Amazon/); assert.match(checkout.text, /Order total shown by Amazon/);
    assert.match(checkout.text, /Order not placed\. No commission claimed\./); assert.equal(checkout.resultHidden, true);
  });
  await layoutChecks(h, 'checkout');
  await merchant.locator('#coupon-row').evaluate(node => node.remove());
  await evaluate(`document.getElementById('checkout-refresh').click()`);
  const zero = await until(view, state => /No coupon discount shown/.test(state.headline), 'zero checkout savings');
  check('zero discount does not retain a previous coupon saving', () => { assert.equal(zero.savings, ''); assert.equal(zero.total, '$19.11'); });
  await merchant.locator('#total-row').evaluate(node => node.remove());
  await evaluate(`document.getElementById('checkout-refresh').click()`);
  await until(view, state => state.savings === '' && state.total === '', 'unreadable checkout clears money');
  check('unreadable checkout withdraws all amounts', () => undefined);

  await merchant.goto(checkoutURL);
  await until(view, state => state.savings === '$2.00', 'fresh checkout before navigation');
  await merchant.goto(unsupportedURL);
  const departed = await until(view, state => state.savings === '' && state.total === '' && !/\$2\.00|\$19\.11/.test(state.text), 'navigation removes old savings');
  const stale = await request({ type: 'run' }, checkoutURL);
  const staleFocus = await request(oldFocus, productURL);
  check('navigation clears previous savings and denies the previously bound action', () => {
    assert.equal(departed.resultHidden, true); assert.equal(stale.ok, false); assert.equal(staleFocus.ok, false);
  });
  await merchant.goto(fixtureShopURL);
  const candidates = await request({ type: 'coupon-candidates' }, fixtureShopURL);
  check('unapproved synthetic shop cannot produce verified coupons or trial permission', () => {
    assert.equal(candidates.ok, true, JSON.stringify(candidates)); assert.deepEqual(candidates.data.candidates, []); assert.equal(candidates.data.canTest, false);
  });
  const noTrial = await request({ type: 'run' }, fixtureShopURL);
  check('unapproved shop cannot dispatch a coupon trial', () => assert.equal(noTrial.ok, false));
  await worker.evaluate(() => {
    (globalThis as any).__fixtureMerchants = [{ id: '00000000-0000-4000-8000-000000000001',
      domain: 'fixture-shop.example.test', name: 'Synthetic enabled Shopify fixture', currency: 'USD' }];
    (globalThis as any).__fixtureDispatches = [];
  });
  const enabledCandidates = await request({ type: 'coupon-candidates' }, fixtureShopURL);
  const enabledTrial = await request({ type: 'run' }, fixtureShopURL);
  const dispatches = await worker.evaluate(() => (globalThis as any).__fixtureDispatches as string[]);
  check('even an enabled synthetic Shopify merchant is held by C6 before trial dispatch', () => {
    assert.equal(enabledCandidates.ok, true, JSON.stringify(enabledCandidates));
    assert.equal(enabledCandidates.data.merchantName, 'Synthetic enabled Shopify fixture');
    assert.equal(enabledCandidates.data.canTest, false); assert.equal(enabledTrial.ok, false);
    assert.match(enabledTrial.error, /paused|not available|safety|restor/i);
    assert.ok(!dispatches.some(type => /trial/.test(type)), JSON.stringify(dispatches));
  });

  await merchant.goto(productURL);
  await until(view, state => state.text.includes('$15.99'), 'native coupon restored for layout');
  await layoutChecks(h, 'native-coupon');
  const privacy = await worker.evaluate(() => (globalThis as any).__fixtureFetches as string[]);
  check('fixture network stub only receives permitted synthetic catalog requests', () => assert.ok(privacy.every(url => url === 'https://coupons.example.test/v1/merchants' || url.startsWith('https://coupons.example.test/v1/coupons/candidates?')), JSON.stringify(privacy)));
  const untouched = await merchant.evaluate(() => ({ clicks: (window as any).__merchantClicks, submits: (window as any).__merchantSubmits }));
  check('refresh/navigation checks never click or submit merchant controls', () => { assert.equal(untouched.clicks, 0); assert.equal(untouched.submits, 0); });
}

async function layoutChecks(h: PanelHarness, state: string) {
  for (const width of [320, 400, 600]) for (const theme of ['light', 'dark']) for (const zoom of [1, 2]) {
    await h.command(h.sessionId, 'Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await h.command(h.sessionId, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    // CSS zoom exercises 200% reflow; this is not a native browser-zoom test.
    await h.evaluate(`document.documentElement.style.zoom=${JSON.stringify(String(zoom))}; document.fonts.ready`);
    const fits = await h.evaluate<{ width: number; scroll: number }>('({width:innerWidth,scroll:document.documentElement.scrollWidth})');
    check(`${state}: ${width}px ${theme} ${zoom * 100}% CSS zoom has no horizontal overflow`, () => assert.ok(fits.scroll <= fits.width + 1, JSON.stringify(fits)));
    if (zoom === 1 || width === 320) {
      const screenshot = await h.command(h.sessionId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await Bun.write(join(shots, `${state}-${width}-${theme}-${zoom * 100}.png`), Buffer.from(screenshot.data, 'base64'));
    }
  }
  await h.evaluate(`document.documentElement.style.zoom='1'`);
  await h.command(h.sessionId, 'Emulation.clearDeviceMetricsOverride');
}

try {
  await mkdir(shots, { recursive: true });
  const panel = build('chrome'), popup = build('chrome', 'popup'), firefox = build('firefox');
  const panelManifest = await Bun.file(join(panel, 'manifest.json')).json();
  const popupManifest = await Bun.file(join(popup, 'manifest.json')).json();
  const firefoxManifest = await Bun.file(join(firefox, 'manifest.json')).json();
  check('Chrome defaults to side panel and has no competing action popup', () => {
    assert.equal(panelManifest.side_panel.default_path, 'sidepanel.html'); assert.ok(panelManifest.permissions.includes('sidePanel'));
    assert.equal(panelManifest.action.default_popup, undefined);
  });
  check('Chrome popup compatibility build and Firefox retain popup surfaces', () => {
    for (const manifest of [popupManifest, firefoxManifest]) {
      assert.equal(manifest.action.default_popup, 'popup.html'); assert.equal(manifest.side_panel, undefined); assert.ok(!manifest.permissions.includes('sidePanel'));
    }
    assert.equal(firefoxManifest.background.service_worker, undefined); assert.deepEqual(firefoxManifest.background.scripts, ['worker.js']);
  });
  const html = await Bun.file(join(panel, 'sidepanel.html')).text();
  const firefoxHTML = await Bun.file(join(firefox, 'popup.html')).text();
  check('panel and Firefox popup share the coupon interface and explicit surface marker', () => {
    assert.match(html, /data-surface=["']sidepanel["']/); assert.match(html, /popup\.js/);
    for (const id of ['amazon-panel', 'amazon-checkout-panel', 'checkout-savings', 'try-codes']) { assert.ok(html.includes(`id="${id}"`)); assert.ok(firefoxHTML.includes(`id="${id}"`)); }
  });
  await exercise(panel, 'sidepanel');
  await exercise(popup, 'popup');
  console.log(`${checks} coupon-surface checks passed. Synthetic MV3 fixtures; temporary Amazon host grant; CSS zoom only; Firefox packaging checked, Firefox runtime and real activeTab gesture not tested. Screenshots: ${shots}`);
} finally { await rm(scratch, { recursive: true, force: true }); }
