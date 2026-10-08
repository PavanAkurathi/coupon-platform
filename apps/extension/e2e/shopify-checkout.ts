import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { shopifyCheckoutInspectionSchema } from '@repo/shared';

// Every request in this isolated browser is intercepted. No live store, shopper
// profile, cookies, backend or purchase is used by this fixture suite.
const fixture = await Bun.file(`${import.meta.dir}/fixtures/shopify-checkout.html`).text();
const build = await Bun.build({entrypoints:[`${import.meta.dir}/../src/shopify-checkout-reader.ts`], target:'browser', format:'esm'});
if (!build.success) throw new AggregateError(build.logs, 'Shopify reader test bundle failed');
const source = await build.outputs[0]!.text();
const browser = await chromium.launch({headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {channel:'chromium'}),
});
const context = await browser.newContext();
await context.route('**/*', async route => route.request().isNavigationRequest()
  ? route.fulfill({status:200, contentType:'text/html', body:fixture}) : route.abort());
const page = await context.newPage();
const enabled = ['www.allbirds.com'];
const checkoutUrl = 'https://www.allbirds.com/checkouts/cn/hWN4FixtureToken0000/en-us?tag=creator-fixture';
let checks = 0;
const check = (label: string, action: () => void) => { action(); checks++; console.log(`PASS ${label}`); };
async function reset(url = checkoutUrl) {
  await page.goto(url);
  await page.evaluate(async (source) => {
    const globals = window as any;
    globals.__reader = await import(URL.createObjectURL(new Blob([source], {type:'text/javascript'})));
    globals.__clicks = 0; globals.__submits = 0; globals.__inputs = 0;
    document.addEventListener('click', () => globals.__clicks++, true);
    document.addEventListener('input', () => globals.__inputs++, true);
    document.addEventListener('submit', event => {event.preventDefault(); globals.__submits++;}, true);
  }, source);
}
const inspect = async (hosts = enabled) => shopifyCheckoutInspectionSchema.parse(await page.evaluate(hosts => (window as any).__reader.inspectShopifyCheckout(hosts), hosts));
const cell = (row: string) => page.locator(`#${row} [role="cell"]`);
try {
  await reset();
  const observed = await inspect();
  const untouched = await page.evaluate(() => ({clicks:(window as any).__clicks, submits:(window as any).__submits, inputs:(window as any).__inputs,
    marketing:(document.getElementById('marketing') as HTMLInputElement).checked, url:location.href}));
  check('observed money lines report subtotal, total and the estimate flag', () => {
    assert.equal(observed.status, 'ready'); assert.equal(observed.subtotalCents, 2500); assert.equal(observed.totalCents, 2519);
    assert.equal(observed.discountCents, 0); assert.equal(observed.totalIsEstimate, true); assert.equal(observed.discountField, 'available');
    assert.equal(observed.codeRejected, false);
  });
  check('reading never types, clicks, submits, changes marketing consent or the attribution URL', () => {
    assert.equal(untouched.clicks, 0); assert.equal(untouched.submits, 0); assert.equal(untouched.inputs, 0);
    assert.equal(untouched.marketing, true); assert.equal(untouched.url, checkoutUrl);
  });
  check('observation contains amounts only: no item, contact, token or URL', () => {
    const serialized = JSON.stringify(observed);
    for (const leaked of ['flip flop', 'hWN4', 'checkouts', 'creator-fixture', 'email']) assert.ok(!serialized.includes(leaked), leaked);
  });
  check('hidden duplicate summaries and hidden discount fields are ignored', () => assert.notEqual(observed.totalCents, 100));

  await reset();
  await page.evaluate(() => {
    const field = document.getElementById('ReductionsInput-1')!;
    field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', 'error-for-ReductionsInput-1');
    document.getElementById('error-for-ReductionsInput-1')!.textContent = 'Enter a valid discount code or gift card';
  });
  const rejected = await inspect();
  check('the observed invalid-code state is reported as rejected with totals unchanged', () => {
    assert.equal(rejected.codeRejected, true); assert.equal(rejected.totalCents, 2519);
  });
  await reset();
  await page.evaluate(() => document.getElementById('ReductionsInput-1')!.setAttribute('aria-invalid', 'true'));
  const silentInvalid = await inspect();
  check('an invalid flag without a visible error message is not called a rejection', () => assert.equal(silentInvalid.codeRejected, false));

  await reset();
  await page.evaluate(() => {
    const row = document.getElementById('shipping-row')!.cloneNode(true) as HTMLElement;
    row.id = 'discount-row'; row.querySelector('[role="rowheader"]')!.textContent = 'Order discount'; row.querySelector('[role="cell"]')!.textContent = '-$5.00';
    document.getElementById('total-row')!.before(row);
    document.querySelector('#total-row [role="cell"]')!.textContent = 'USD $20.19';
  });
  const discounted = await inspect();
  check('a negative money line is reported as a discount against the subtotal', () => {
    assert.equal(discounted.discountCents, 500); assert.equal(discounted.totalCents, 2019);
  });
  await reset(); await cell('shipping-row').evaluate(el => { el.textContent = 'Free'; }); await page.locator('#tax-row').evaluate(el => el.remove());
  const finalTotals = await inspect();
  check('known shipping without estimated taxes is not labelled an estimate', () => assert.equal(finalTotals.totalIsEstimate, false));
  await reset(); await cell('total-row').evaluate(el => { el.textContent = 'CAD $25.19'; });
  const foreign = await inspect();
  check('a non-USD total is never reported in dollars', () => { assert.equal(foreign.status, 'unavailable'); assert.equal(foreign.totalCents, null); });
  await reset(); await page.locator('#total-row').evaluate(el => el.remove());
  const noTotal = await inspect();
  check('a missing total fails closed', () => assert.equal(noTotal.status, 'unavailable'));
  await reset(); await page.locator('#column-headers').evaluate(el => el.remove());
  const noColumnHeaders = await inspect();
  check('the observed column-header row is optional', () => assert.equal(noColumnHeaders.totalCents, 2519));
  await reset(); await cell('subtotal-row').evaluate(el => el.remove());
  const shifted = await inspect();
  check('a label without its own amount fails closed', () => assert.equal(shifted.status, 'unavailable'));
  await reset(); await page.locator('#money-lines').evaluate(el => el.nextElementSibling!.removeAttribute('style'));
  const twoTables = await inspect();
  check('two visible money-line tables are ambiguous', () => assert.equal(twoTables.status, 'unavailable'));
  await reset(); await page.locator('#discount-form').evaluate(el => { (el as HTMLElement).style.display = 'none'; });
  const collapsed = await inspect();
  check('a collapsed discount form is reported as missing, not available', () => assert.equal(collapsed.discountField, 'missing'));
  for (const [label, url, hosts] of [
    ['a store that is not operator-enabled', checkoutUrl, []],
    ['a lookalike host', 'https://www.allbirds.com.evil.test/checkouts/cn/hWN4FixtureToken0000', ['www.allbirds.com']],
    ['the cart route', 'https://www.allbirds.com/cart', ['www.allbirds.com']],
  ] as const) {
    await reset(url);
    const outside = await inspect([...hosts]);
    check(`${label} is outside reader capability even with matching HTML`, () => { assert.equal(outside.status, 'unavailable'); assert.equal(outside.totalCents, null); });
  }
  console.log(`Shopify checkout reader: ${checks} fixture browser checks passed. No live shopping traffic.`);
} finally { await context.close(); await browser.close(); }
