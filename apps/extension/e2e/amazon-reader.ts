import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { amazonInspectionSchema } from '@repo/shared';

// Every request in this isolated browser is intercepted. No live Amazon access,
// shopper profile, cookies, backend or purchase is used by this fixture suite.
const fixture = await Bun.file(`${import.meta.dir}/fixtures/amazon-product.html`).text();
const build = await Bun.build({entrypoints:[`${import.meta.dir}/../src/amazon-reader.ts`], target:'browser', format:'esm'});
if (!build.success) throw new AggregateError(build.logs, 'Reader test bundle failed');
const source = await build.outputs[0]!.text();
const browser = await chromium.launch({headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {channel:'chromium'}),
});
const context = await browser.newContext();
await context.route('**/*', async route => route.request().isNavigationRequest()
  ? route.fulfill({status:200, contentType:'text/html', body:fixture}) : route.abort());
const page = await context.newPage();
let checks = 0;
const check = (label: string, action: () => void) => { action(); checks++; console.log(`PASS ${label}`); };
async function reset(url = 'https://www.amazon.com/dp/B097S1MF28?tag=creator-fixture') {
  await page.goto(url);
  await page.evaluate(async (source) => {
    const globals = window as any;
    globals.__reader = await import(URL.createObjectURL(new Blob([source], {type:'text/javascript'})));
    globals.__clicks = 0; globals.__submits = 0;
    document.addEventListener('click', () => globals.__clicks++);
    document.addEventListener('submit', event => {event.preventDefault(); globals.__submits++;});
  }, source);
}
const inspect = () => page.evaluate(() => (window as any).__reader.inspectAmazonPage());
const requestFor = (snapshot: any) => ({type:'amazon-focus',asin:snapshot.asin,offerId:snapshot.offers[0].id,
  fingerprint:snapshot.fingerprint,observedAt:snapshot.observedAt});
const focus = (request: unknown) => page.evaluate(request => {
  try { return {ok:true, value:(window as any).__reader.focusAmazonOffer(request)}; }
  catch { return {ok:false}; }
}, request);
try {
  await reset();
  const original = amazonInspectionSchema.parse(await inspect());
  check('observed product structure returns one merchant coupon, ignoring ads and hidden duplicates', () => {
    assert.equal(original.status,'offers_found'); assert.equal(original.offers.length,1);
    assert.equal(original.offers[0]!.advertisedPriceCents,1599);
    assert.equal(original.offers[0]!.purchaseRequirement,'unknown');
    assert.ok(original.offers[0]!.terms.includes('Limit 1 item.'));
    assert.equal('savingsCents' in original,false);
  });
  const focused = await focus(requestFor(original));
  const untouched = await page.evaluate(() => ({clicks:(window as any).__clicks,submits:(window as any).__submits,
    checked:(document.getElementById('fixture-coupon') as HTMLInputElement).checked,
    active:document.activeElement?.id,url:location.href}));
  check('show-coupon only focuses: zero clicks, submissions, selection changes or attribution URL changes', () => {
    assert.equal(focused.ok,true); assert.equal(untouched.clicks,0); assert.equal(untouched.submits,0);
    assert.equal(untouched.checked,false); assert.equal(untouched.active,'fixture-coupon');
    assert.equal(untouched.url,'https://www.amazon.com/dp/B097S1MF28?tag=creator-fixture');
  });
  const expired = {...requestFor(original),observedAt:new Date(Date.now()-121000).toISOString()};
  const future = {...requestFor(original),observedAt:new Date(Date.now()+60000).toISOString()};
  const oldResult = await focus(expired); const futureResult = await focus(future);
  check('old and future observations cannot focus a coupon', () => {assert.equal(oldResult.ok,false);assert.equal(futureResult.ok,false);});
  await page.locator('#fixture-coupon').evaluate((el: HTMLInputElement) => {el.checked=true;});
  const selected = await inspect(); const selectedFocus = await focus(requestFor(selected));
  check('already-selected coupon is reported honestly and cannot be activated', () => {
    assert.equal(selected.offers[0].state,'already_selected'); assert.equal(selectedFocus.ok,false);
  });
  await reset(); const beforeChange = await inspect();
  await page.locator('#promoPriceBlockMessage_feature_div .a-offscreen').first().evaluate(el=>{el.textContent='$17.99';});
  const changedFocus = await focus(requestFor(beforeChange));
  check('changed coupon price invalidates the old action',()=>assert.equal(changedFocus.ok,false));
  await reset();
  await page.locator('#ASIN').evaluate((el: HTMLInputElement)=>{el.value='B000000001';});
  const changing = await inspect();
  check('URL and selected variant mismatch clears offers',()=>{assert.equal(changing.status,'unavailable');assert.equal(changing.offers.length,0);});
  await reset(); const beforeNavigation = await inspect();
  await page.evaluate(()=>history.replaceState(null,'','/dp/B000000001'));
  const navigated = await focus(requestFor(beforeNavigation));
  check('same-document navigation cannot reuse a previous product action',()=>assert.equal(navigated.ok,false));
  await reset();
  await page.locator('#fixture-coupon').evaluate((el: HTMLInputElement)=>{el.disabled=true;});
  const disabled = await inspect();
  check('disabled coupon is not actionable',()=>assert.equal(disabled.offers[0].state,'unavailable'));
  await reset();
  await page.locator('#promoPriceBlockMessage_feature_div').evaluate(el=>{(el as HTMLElement).hidden=true;});
  const hidden = await inspect();
  check('hidden coupon sections and unrelated ads do not become offers',()=>{assert.equal(hidden.status,'no_offer');assert.equal(hidden.offers.length,0);});
  await reset();
  await page.locator('#promoPriceBlockMessage_feature_div .a-offscreen').first().evaluate(el=>{el.textContent='€15.99';});
  const currency = await inspect();
  check('ambiguous currency never becomes a USD price',()=>assert.equal(currency.offers[0].advertisedPriceCents,null));
  await reset();
  await page.locator('#promoPriceBlockMessage_feature_div .a-price').nth(1).evaluate(el=>{
    (el as HTMLElement).style.display=''; el.querySelector('.a-offscreen')!.textContent='€4.00';
  });
  const mixedCurrency = await inspect();
  check('mixed visible amounts cannot promote one parseable USD value',()=>assert.equal(mixedCurrency.offers[0].advertisedPriceCents,null));
  await reset();
  await page.locator('label.ct-coupon-checkbox-label').nth(1).evaluate(el=>el.setAttribute('for','buy'));
  const relabelled = await inspect();
  check('mismatched coupon/control association fails closed',()=>assert.equal(relabelled.status,'unavailable'));
  await reset();
  await page.locator('#title #productTitle').evaluate(el=>el.remove());
  const noTitle = await inspect();
  check('missing product identity fails closed',()=>assert.equal(noTitle.status,'unavailable'));
  await reset('https://www.amazon.com/gp/cart/view.html');
  const cart = await inspect();
  check('cart and checkout pages are outside reader capability',()=>{assert.equal(cart.status,'unavailable');assert.equal(cart.offers.length,0);});
  await reset('https://www.amazon.com.evil.test/dp/B097S1MF28');
  const lookalike = await inspect();
  check('lookalike domains are rejected even with matching HTML',()=>assert.equal(lookalike.status,'unavailable'));
  console.log(`Amazon reader: ${checks} fixture browser checks passed. No live shopping traffic.`);
} finally { await context.close(); await browser.close(); }
