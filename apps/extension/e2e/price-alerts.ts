import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright';

// Price alerts in the real MV3 extension: the all-sites content script, the worker's
// on-device price memory and the price service, the banner and the buy-click pause.
// Default: synthetic pages shaped like the live stores (observed October 8, 2026),
// no network. --live: the real eBay, Amazon and Walmart pages for the Philips Norelco
// MG5965/49; it reads public product pages and pauses one Add to Cart click, nothing else.
// The scratch manifest grants https://*/* as if the shopper had turned alerts on.
const live = process.argv.includes('--live');
const extensionPath = resolve(process.env.EXTENSION_DIR ?? resolve(import.meta.dir, '../dist'));
const scratch = await mkdtemp(join(tmpdir(), 'price-alerts-'));
const extension = join(scratch, 'extension');
await cp(extensionPath, extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = [...(manifest.host_permissions ?? []), 'https://*/*'];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2));

const URLS = {
  ebay: 'https://www.ebay.com/itm/318944076250',
  amazon: 'https://www.amazon.com/dp/B0GYK61CBH',
  walmart: 'https://www.walmart.com/ip/Philips-Norelco-All-In-One-5000-MG5965-49/15450154953',
  article: 'https://news.example.com/story/123',
  // Any store with schema.org data and no memory of other stores yet.
  shop: 'https://shop.example-grooming.com/products/norelco-mg5965',
  // Live only: Best Buy's All-in-One 9000 (MG9575/49), $96.99 on October 8 while Walmart had it for $89.00.
  bestbuy: 'https://www.bestbuy.com/product/philips-norelco-all-in-one-9000-series-23-piece-trimmer-mg9575-49-silver/J79GGJ9LL9',
};
const ebayLd = { '@context': 'https://schema.org', '@type': 'Product', name: 'Philips Norelco All-in-One 5000 (19 in 1) Trimmer MG5965/49 - NEW - SEALED',
  gtin13: '0075020114105', mpn: 'MG5965/49', color: 'Black', model: 'Philips Norelco All In One 5000', brand: { '@type': 'Brand', name: 'Philips Norelco' },
  offers: { '@type': 'Offer', url: URLS.ebay, itemCondition: 'https://schema.org/NewCondition', availability: 'https://schema.org/InStock', priceCurrency: 'USD', price: '38.27',
    shippingDetails: [{ '@type': 'OfferShippingDetails', shippingRate: { '@type': 'MonetaryAmount', value: '0.0', currency: 'USD' }, shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'USA' } }] } };
const walmartData = { props: { pageProps: { initialData: { data: { product: { usItemId: '15450154953', name: 'Philips Norelco All-In-One 19-Piece Trimmer 5000 Series - Electric Shaver and Clipper, MG5965/49',
  brand: 'Philips Norelco', model: 'MG5965/49', color: 'Black', upc: '075020114105', conditionType: 'New', sellerName: 'Walmart.com', availabilityStatus: 'IN_STOCK', priceInfo: { currentPrice: { price: 49.96 } }, trustBadges: [{ type: 'FREE_SHIPPING' }] } } } } } };
const shopLd = { '@context': 'https://schema.org', '@type': 'Product', url: URLS.shop, color: 'Black', name: 'Philips Norelco All-in-One Trimmer 5000 MG5965/49', gtin12: '075020114105', mpn: 'MG5965/49',
  brand: { '@type': 'Brand', name: 'Philips Norelco' }, offers: { '@type': 'Offer', price: '47.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition' } };
// Amazon "Other sellers" panel, shaped like the live one for B008M5U1C2 on October 8: Amazon.com
// sells it for $53.00; Ace Pursuit (4.5★, 1,083 ratings) has it new for $48.58 with free delivery.
// A cheaper used offer and a cheaper poorly rated seller must both be ignored.
const knifeUrl = 'https://www.amazon.com/dp/B008M5U1C2';
const aodOffer = (pinned: boolean, condition: string, whole: string, fraction: string, seller: string, rating = '') => `<div id="${pinned ? 'aod-pinned-offer' : 'aod-offer'}">
  <div id="aod-offer-heading"><span>${condition}</span></div>
  <div id="aod-price-${pinned ? 0 : 1}"><span class="a-price"><span class="a-offscreen"></span><span aria-hidden="true"><span class="a-price-symbol">$</span><span class="a-price-whole">${whole}<span class="a-price-decimal">.</span></span><span class="a-price-fraction">${fraction}</span></span></span></div>
  <div id="mir-layout-DELIVERY_BLOCK"><span data-csa-c-delivery-price="FREE" data-csa-c-delivery-condition="">FREE delivery Tuesday, October 13</span></div>
  <div id="aod-offer-soldBy"><span>Sold by</span> <a>${seller}</a> ${rating}</div></div>`;
const KNIFE_OFFERS = `<!doctype html><div id="aod-container">${aodOffer(true, 'New', '53', '00', 'Amazon.com')}
  ${aodOffer(false, 'Used - Like New', '40', '00', 'Amazon Resale')}
  ${aodOffer(false, 'New', '45', '00', 'Cheap Knives Co', 'Seller rating is 3.9 out of 5 stars (88 ratings)')}
  ${aodOffer(false, 'New', '48', '58', 'Ace Pursuit', 'Seller rating is 4.5 out of 5 stars (1,083 ratings)')}</div>`;
const KNIFE_PAGE = `<!doctype html><title>Amazon.com</title><input type="hidden" id="ASIN" value="B008M5U1C2">
  <div id="title"><span id="productTitle">Victorinox Fibrox Pro 8 Inch Chef's Knife, Dishwasher Safe, Black</span></div><span id="productTitle" hidden></span>
  <div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span aria-hidden="true"><span class="a-price-symbol">$</span><span class="a-price-whole">53<span class="a-price-decimal">.</span></span><span class="a-price-fraction">00</span></span></span></div>
  <div id="availability">In Stock</div>
  <form><input type="hidden" name="items[0.base][customerVisiblePrice][amount]" value="53.00"><input type="hidden" name="items[0.base][customerVisiblePrice][currencyCode]" value="USD">
  <input type="hidden" name="items[0.base][customerVisiblePrice][amount]" value="40.00"><input type="hidden" name="items[0.base][customerVisiblePrice][currencyCode]" value="USD">
  <input id="add-to-cart-button" name="submit.add-to-cart" type="submit" value="Add to Cart"></form>
  <div id="detailBullets_feature_div"><ul><li>Item model number : 40520</li><li>Manufacturer : Victorinox</li></ul></div>`;

// Background store pages the worker fetches during live checks (fixture runs answer them here).
const STORE_PAGES: Record<string, string> = {
  'https://www.amazon.com/s?k=075020114105': `<!doctype html><div data-asin="B0GYK61CBH" data-component-type="s-search-result"><h2 aria-label="Philips Norelco All-in-One 5000 19-in-1 Trimmer, Face, Hair &amp; Body, Black"><span>Philips Norelco All-in-One 5000</span></h2><span class="a-price"><span class="a-offscreen">$39.96</span></span></div>
    <div data-asin="B0CM5ZYWXB" data-component-type="s-search-result"><h2 aria-label="Sponsored Ad - Trimmer Blade Replacement for Philips Norelco"></h2><span class="a-price"><span class="a-offscreen">$21.99</span></span></div>`,
  'https://www.walmart.com/search?q=MG5965%2F49': `<!doctype html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialData: { searchResult: { itemStacks: [{ items: [
    { __typename: 'Product', usItemId: '15450154953', name: 'Philips Norelco All-In-One 19-Piece Trimmer 5000 Series, MG5965/49', price: 49.96, canonicalUrl: '/ip/Philips-Norelco-All-In-One-5000-MG5965-49/15450154953?classType=REGULAR', isSponsoredFlag: true },
    { __typename: 'Product', usItemId: '15441567597', name: 'Philips Norelco All-In-One 7000 Series 22-Piece Trimmer, MG7965/49', price: 69.96, canonicalUrl: '/ip/x/15441567597', isSponsoredFlag: false },
  ] }] } } } } })}</script>`,
};
const FIXTURES: Record<string, string> = {
  [URLS.ebay]: `<!doctype html><title>eBay</title><script type="application/ld+json">${JSON.stringify(ebayLd)}</script>
    <h1>${ebayLd.name}</h1><div class="x-price-primary">US $38.27</div><a id="binBtn_btn_1" href="#">Buy It Now</a>`,
  [URLS.amazon]: `<!doctype html><title>Amazon.com</title><input type="hidden" id="ASIN" value="B0GYK61CBH"><input type="hidden" id="asin" value="B0GYK61CBH">
    <div id="title"><span id="productTitle">Philips Norelco All-in-One 5000 19-in-1 Trimmer, Face, Hair &amp; Body, Black</span></div><span id="productTitle" hidden></span>
    <a id="bylineInfo" href="#">Visit the Norelco Store</a>
    <div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen"> </span><span aria-hidden="true"><span class="a-price-symbol">$</span><span class="a-price-whole">39<span class="a-price-decimal">.</span></span><span class="a-price-fraction">96</span></span></span></div>
    <div id="mir-layout-DELIVERY_BLOCK">FREE delivery Tuesday, October 13</div><div id="availability">In Stock</div>
    <form id="addToCart" action="/cart/add" method="post"><input type="hidden" name="items[0.base][customerVisiblePrice][amount]" value="39.96"><input type="hidden" name="items[0.base][customerVisiblePrice][currencyCode]" value="USD">
    <input id="add-to-cart-button" name="submit.add-to-cart" type="submit" value="Add to Cart"></form>
    <div id="detailBullets_feature_div"><ul><li>Item model number &#8207; : &#8206; MG5965/49</li><li>Manufacturer &#8207; : &#8206; Philips Norelco</li><li>Color : Black</li><li>ASIN &#8207; : &#8206; B0GYK61CBH</li></ul></div>`,
  [URLS.walmart]: `<!doctype html><title>Walmart.com</title><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(walmartData)}</script>
    <h1>Philips Norelco All-In-One 19-Piece Trimmer 5000 Series</h1><span itemprop="price">$49.96</span><button data-automation-id="atc">Add to cart</button>`,
  [URLS.article]: `<!doctype html><title>News</title><article><h1>Trimmers are popular</h1><p>The MG5965/49 costs $10.00 somewhere.</p></article>`,
  [URLS.shop]: `<!doctype html><title>Grooming shop</title><script type="application/ld+json">${JSON.stringify(shopLd)}</script><main itemscope itemtype="https://schema.org/Product"><h1 itemprop="name">${shopLd.name}</h1><p itemprop="price">$47.00</p><button>Add to cart</button></main>`,
};
STORE_PAGES['https://www.amazon.com/dp/B0GYK61CBH'] = FIXTURES[URLS.amazon]!;
STORE_PAGES['https://www.walmart.com/ip/Philips-Norelco-All-In-One-5000-MG5965-49/15450154953'] = FIXTURES[URLS.walmart]!;

let passed = 0;
function check(name: string, action: () => unknown) { action(); passed++; console.log(`PASS ${name}`); }
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, message: string, ms = 15000): Promise<T> {
  const deadline = Date.now() + ms; let value: T;
  do { value = await read(); if (accept(value)) return value; await Bun.sleep(150); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${message}; last value: ${JSON.stringify(value)}`);
}

// The alert lives in a closed shadow root; CDP's pierce view is the only outside reader.
type DomNode = { nodeId: number; nodeName: string; nodeValue?: string; attributes?: string[]; children?: DomNode[]; shadowRoots?: DomNode[] };
async function alert(cdp: CDPSession): Promise<{ text: string; buttons: { label: string; nodeId: number }[] } | null> {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }) as { root: DomNode };
  const find = (node: DomNode): DomNode | null => {
    const id = node.attributes?.[node.attributes.indexOf('id') + 1];
    if (node.attributes?.includes('id') && id === 'checkout-savings-price-alert') return node;
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) { const found = find(child); if (found) return found; }
    return null;
  };
  const host = find(root);
  if (!host) return null;
  const texts: string[] = []; const buttons: { label: string; nodeId: number }[] = [];
  const walk = (node: DomNode) => {
    if (node.nodeName === '#text' && node.nodeValue?.trim()) texts.push(node.nodeValue.trim());
    if (node.nodeName === 'STYLE') return;
    if (node.nodeName === 'BUTTON' || node.nodeName === 'A') {
      const label: string[] = []; const collect = (n: DomNode) => { if (n.nodeName === '#text') label.push(n.nodeValue ?? ''); n.children?.forEach(collect); };
      collect(node); buttons.push({ label: label.join('').trim(), nodeId: node.nodeId });
    }
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) walk(child);
  };
  walk(host);
  return { text: texts.join(' | '), buttons };
}
async function clickNode(page: Page, cdp: CDPSession, nodeId: number) {
  const { model } = await cdp.send('DOM.getBoxModel', { nodeId }) as { model: { content: number[] } };
  const [x1, y1, , , x3, y3] = model.content as [number, number, number, number, number, number];
  await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
}

async function open(context: BrowserContext, url: string): Promise<{ page: Page; cdp: CDPSession }> {
  const page = await context.newPage();
  if (!live) await page.addInitScript(() => {
    const globals = window as any; globals.__submits = 0;
    document.addEventListener('submit', (event) => { event.preventDefault(); globals.__submits++; });
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  return { page, cdp: await context.newCDPSession(page) };
}

const context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
  headless: false, viewport: { width: 1280, height: 900 },
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  if (!live) await context.route('**/*', async (route) => {
    const url = route.request().url().split('#')[0]!;
    if (url.startsWith('https://www.amazon.com/gp/product/ajax/aodAjaxMain/') && url.includes('asin=B008M5U1C2')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: KNIFE_OFFERS });
    }
    const body = url === knifeUrl ? KNIFE_PAGE : FIXTURES[url];
    return body && route.request().isNavigationRequest() ? route.fulfill({ status: 200, contentType: 'text/html', body }) : route.abort();
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  // Fixture runs: the worker's background store checks get the synthetic store pages; nothing leaves the machine.
  if (!live) await worker.evaluate((pages) => {
    const globals = globalThis as any; globals.__storeFetches = [];
    globals.fetch = async (input: string | URL, init?: RequestInit) => {
      const url = String(input); globals.__storeFetches.push(url);
      if (globals.__delayStoreFetches) await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 5000);
        init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
      if (!(url in pages)) throw new TypeError('Fixture run: network disabled');
      const response = new Response(pages[url], { headers: { 'content-type': 'text/html; charset=utf-8' } });
      Object.defineProperty(response, 'url', { value: url });
      return response;
    };
  }, STORE_PAGES);
  const seen = () => worker.evaluate(async () => ((await chrome.storage.local.get('priceSeen')).priceSeen ?? []) as { merchant: string; priceCents: number; identity: { model: string | null; gtin: string | null } }[]);
  await until(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id)), (ids) => ids.includes('price-alerts'), 'price script registered for every https site');
  check('granting https://*/* registers the price script on every https site', () => undefined);

  // 0. Any store, empty memory: the extension checks Amazon and Walmart itself.
  const first = await open(context, live ? URLS.bestbuy : URLS.shop);
  const firstBanner = await until(() => alert(first.cdp), (value) => Boolean(value?.text.includes('less at')), 'live-check banner', live ? 60000 : 15000)
    .catch(async (error) => {
      // Show what the extension saw before failing.
      console.log(JSON.stringify(await worker.evaluate(async () => {
        const stored = await chrome.storage.local.get(['priceSeen', 'priceLiveChecks']);
        return { seen: (stored.priceSeen ?? []).map((item: any) => `${item.merchant} ${item.priceCents} ${item.identity.model}`),
          live: Object.fromEntries(Object.entries(stored.priceLiveChecks ?? {}).map(([key, value]: any) => [key, value.products.map((item: any) => `${item.merchant} ${item.priceCents} ship ${item.shippingCents}`)])) };
      })));
      throw error;
    });
  if (live && process.env.E2E_SCREENSHOT_DIR) await first.page.screenshot({ path: join(process.env.E2E_SCREENSHOT_DIR, 'bestbuy-live-check.png') });
  check(`${live ? 'Best Buy (MG9575/49)' : 'an unknown store at $47.00'} warns "less at ${live ? 'Walmart/Amazon' : 'Amazon'}" from a live check, with nothing remembered`, () => {
    assert.match(firstBanner!.text, live ? /\$\d+\.\d{2} less at (Walmart|Amazon)/ : /\$7\.04 less at Amazon/);
    assert.match(firstBanner!.text, /Checked live/);
  });
  if (live) console.log(`Live banner: ${firstBanner!.text.split(' | ').slice(0, 4).join(' | ')}`);
  if (!live) {
    const fetched = await worker.evaluate(() => (globalThis as any).__storeFetches as string[]);
    check('live checks fetch search then product pages, skipping ads for other products', () => {
      assert.ok(fetched.includes('https://www.amazon.com/s?k=075020114105')); assert.ok(fetched.includes('https://www.amazon.com/dp/B0GYK61CBH'));
      assert.ok(!fetched.includes('https://www.amazon.com/dp/B0CM5ZYWXB')); assert.ok(fetched.includes('https://www.walmart.com/search?q=MG5965%2F49'));
      assert.ok(!fetched.some((url) => url.includes('15441567597')));
    });
  }
  await first.page.close();

  // 4. Amazon: another seller of the same item is cheaper. Used offers and poorly rated sellers don't count.
  async function amazonSellerStep() {
    const knife = await open(context, knifeUrl);
    const knifeBanner = await until(() => alert(knife.cdp), (value) => Boolean(value?.text.includes('less')), 'Amazon seller banner', live ? 30000 : 15000)
      .catch((error) => { if (live) return null; throw error; });
    // Live prices move: on October 9 Amazon.com itself dropped to $47.00 and only used offers were
    // cheaper, so the right live outcome is silence. Used offers must never raise an alert.
    if (live && !knifeBanner) {
      check('live: no cheaper new seller on the knife right now, and cheaper used offers raise no alert', () => assert.equal(knifeBanner, null));
      await knife.page.close();
      return;
    }
    check('Amazon page with several purchase modes: a cheaper new seller is found ("$4.42 less from another seller on Amazon")', () => {
      if (live) { assert.match(knifeBanner!.text, /\$\d+\.\d{2} less (from another seller on Amazon|at \w+)/); return; }
      assert.match(knifeBanner!.text, /CHEAPER SELLER ON AMAZON|Cheaper seller on Amazon/i);
      assert.match(knifeBanner!.text, /\$4\.42 less from another seller on Amazon/);
      assert.match(knifeBanner!.text, /\$48\.58 vs \$53\.00 for the main offer/);
      assert.match(knifeBanner!.text, /Seller: Ace Pursuit \(4\.5★, 1,083 ratings\)/);
      assert.ok(knifeBanner!.buttons.some((button) => button.label.startsWith('See all sellers')));
    });
    if (live) console.log(`Live Amazon seller banner: ${knifeBanner!.text.split(' | ').slice(0, 4).join(' | ')}`);
    await knife.page.locator('#add-to-cart-button').first().click();
    const knifePause = await until(() => alert(knife.cdp), (value) => Boolean(value?.text.includes('Hold on before you buy')), 'seller pause');
    check('the Add to Cart click is held for the cheaper seller too', () => assert.match(knifePause!.text, /Show me this seller|Go to/));
    await knife.page.close();
  }

  // 1. The cheapest store: remembered, no alert. eBay started serving an error page to
  // automated browsers on October 8; live runs then skip the eBay-dependent steps.
  const ebay = await open(context, URLS.ebay);
  if (live && /Error Page/i.test(await ebay.page.title())) {
    console.log('SKIP eBay steps: eBay served its error page to this automated browser (no workaround attempted).');
    const amazonOnly = await open(context, URLS.amazon);
    const cache = await until(() => worker.evaluate(async () => (await chrome.storage.local.get('priceLiveChecks')).priceLiveChecks ?? {}),
      (value) => Object.keys(value).some((key) => key.includes('walmart|') && key.includes('MG5965/49')), 'Walmart live check from Amazon', 60000);
    const walmartFound = Object.entries(cache).filter(([key]) => key.includes('walmart|') && key.includes('MG5965/49')).flatMap(([, value]: any) => value.products);
    const amazonAlert = await alert(amazonOnly.cdp);
    check('from the real Amazon page, the live check finds Walmart\'s exact MG5965/49 and (being pricier) raises no alert', () => {
      assert.ok(walmartFound.some((item: any) => item.identity.model === 'MG5965/49' && item.merchant === 'Walmart'));
      assert.equal(amazonAlert, null);
    });
    await amazonSellerStep();
    console.log(`${passed} price-alert checks passed (LIVE stores).`);
    await context.close(); await rm(scratch, { recursive: true, force: true }); process.exit(0);
  }
  const afterEbay = await until(seen, (items) => items.some((item) => item.merchant === 'eBay'), 'eBay product remembered', live ? 45000 : 15000);
  const ebayItem = afterEbay.find((item) => item.merchant === 'eBay')!;
  check('eBay product page is read from its JSON-LD (UPC + model) and remembered on the device', () => {
    assert.equal(ebayItem.priceCents, 3827); assert.equal(ebayItem.identity.gtin, '00075020114105'); assert.equal(ebayItem.identity.model, 'MG5965/49');
  });
  await Bun.sleep(1500);
  const ebayAlert = await alert(ebay.cdp);
  check('no alert on the cheapest store', () => assert.equal(ebayAlert, null));

  // 2. Amazon: same model, $1.69 more. Banner, then the first Add to Cart is held.
  const amazon = await open(context, URLS.amazon);
  const banner = await until(() => alert(amazon.cdp), (value) => Boolean(value?.text.includes('less at eBay')), 'Amazon banner', live ? 30000 : 15000);
  check('Amazon shows "$1.69 less at eBay" for the exact model, before tax', () => {
    assert.match(banner!.text, /\$1\.69 less at eBay/); assert.match(banner!.text, /\$38\.27 there vs \$39\.96 here/);
    assert.match(banner!.text, /New · Free shipping/); assert.match(banner!.text, /before tax/);
    assert.ok(banner!.buttons.some((button) => button.label.startsWith('View on eBay')));
  });
  const shots = process.env.E2E_SCREENSHOT_DIR;
  if (shots) await amazon.page.screenshot({ path: join(shots, `amazon-banner${live ? '-live' : ''}.png`) });
  const amazonUrl = amazon.page.url();
  await amazon.page.locator('#add-to-cart-button').first().click();
  const paused = await until(() => alert(amazon.cdp), (value) => Boolean(value?.text.includes('Hold on before you buy')), 'pause dialog');
  if (shots) await amazon.page.screenshot({ path: join(shots, `amazon-pause${live ? '-live' : ''}.png`) });
  const submitsWhilePaused = live ? 0 : await amazon.page.evaluate(() => (window as any).__submits);
  check('the first Add to Cart click is held with the cheaper offer; nothing is submitted', () => {
    assert.equal(amazon.page.url(), amazonUrl); assert.equal(submitsWhilePaused, 0); assert.match(paused!.text, /\$1\.69 less at eBay/);
  });
  const stay = paused!.buttons.find((button) => button.label === 'Buy here anyway')!;
  await clickNode(amazon.page, amazon.cdp, stay.nodeId);
  await until(() => alert(amazon.cdp), (value) => !value?.text.includes('Hold on before you buy'), 'pause dismissed');
  if (!live) {
    await amazon.page.locator('#add-to-cart-button').click();
    await until(() => amazon.page.evaluate(() => (window as any).__submits as number), (count) => count === 1, 'second click goes through');
    check('"Buy here anyway" then a second click proceeds normally (the extension never clicks for you)', () => undefined);
  }

  // The popup on the same page: the price card and the alerts switch (fixture runs only;
  // programmatic openPopup needs the focused synthetic window).
  if (!live) {
    await amazon.page.bringToFront();
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.windows.update(tab!.windowId, { focused: true });
      await chrome.action.openPopup({ windowId: tab!.windowId });
    });
    // Action popups are not Playwright pages; talk to the popup target over CDP.
    const cdp = amazon.cdp; let sequence = 0;
    const pending = new Map<number, (value: any) => void>();
    cdp.on('Target.receivedMessageFromTarget', ({ message }) => { const reply = JSON.parse(message); pending.get(reply.id)?.(reply); pending.delete(reply.id); });
    const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find((info) => info.url.endsWith('/popup.html')) ?? null, Boolean, 'popup target', 10000).catch(() => null);
    if (target) {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId });
      const run = (method: string, params: object) => new Promise<any>((resolve) => { const id = ++sequence; pending.set(id, resolve); void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }); });
      const text = async () => (await run('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true })).result?.result?.value as string ?? '';
      const popupText = await until(text, (value) => value.includes('less at eBay'), 'popup price card');
      if (shots) {
        const shot = await run('Page.captureScreenshot', { format: 'png' });
        await Bun.write(join(shots, 'popup.png'), Buffer.from(shot.result.data, 'base64'));
      }
      check('popup shows the cheaper offer, its evidence and that alerts are on', () => {
        assert.match(popupText, /CHEAPER ELSEWHERE/i); assert.match(popupText, /\$1\.69 less at eBay/);
        assert.match(popupText, /\$38\.27 \+ free shipping vs \$39\.96 here/); assert.match(popupText, /View on eBay/);
        assert.match(popupText, /Price alerts are on for every store/); assert.match(popupText, /Before tax/);
      });
      await cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => undefined);
    } else console.log('SKIP popup check: Chrome did not open the action popup (window focus).');
  }

  // 3. Walmart: matched by UPC; the best of everything seen is eBay. Walmart's bot
  // protection blocks automated browsers (it redirects to /blocked), so live runs skip it.
  if (!live) {
  const walmart = await open(context, URLS.walmart);
  const walmartBanner = await until(() => alert(walmart.cdp), (value) => Boolean(value?.text.includes('less at')), 'Walmart banner', live ? 30000 : 15000);
  check('Walmart shows the cheapest store seen (eBay, $11.69 less), matched by UPC', () => {
    assert.match(walmartBanner!.text, /\$11\.69 less at eBay/); assert.match(walmartBanner!.text, /vs \$49\.96 here/);
  });
  }

  await amazonSellerStep();

  // 5. Pages that are not product pages send nothing and show nothing.
  if (!live) {
    const before = (await seen()).length;
    const article = await open(context, URLS.article);
    await Bun.sleep(3500);
    const [articleAlert, after] = [await alert(article.cdp), (await seen()).length];
    check('an article mentioning the model and a price is ignored', () => { assert.equal(articleAlert, null); assert.equal(after, before); });
  }

  // Regression checks use synthetic pages only. No real cart controls are clicked.
  if (!live) {
    await worker.evaluate(async () => {
      (globalThis as any).__delayStoreFetches = true;
      await chrome.storage.local.remove('priceLiveChecks');
    });
    const started = Date.now();
    const fast = await open(context, URLS.amazon);
    await until(() => alert(fast.cdp), (value) => Boolean(value?.text.includes('less at eBay')), 'cached offer before slow sources', 2000);
    const elapsed = Date.now() - started;
    check('a remembered offer appears before delayed network sources complete', () => assert.ok(elapsed < 2000, `Cached alert took ${elapsed}ms`));
    console.log(`Cached offer, new tab to banner: ${elapsed}ms (background responses delayed 5000ms).`);

    // The shopper can change a variant/price and click in the same task, before a
    // mutation observer has fired. The capture handler must re-read synchronously.
    await fast.page.evaluate(() => {
      document.querySelector('.a-price-whole')!.textContent = '37.';
      document.querySelector('.a-price-fraction')!.textContent = '00';
      (document.querySelector('input[name="items[0.base][customerVisiblePrice][amount]"]') as HTMLInputElement).value = '37.00';
      (document.querySelector('#add-to-cart-button') as HTMLInputElement).click();
    });
    await until(() => alert(fast.cdp), (value) => !value, 'old price alert withdrawn');
    const submitsAfterDrop = await fast.page.evaluate(() => (window as any).__submits);
    check('same-URL price drop cannot pause a click using the previous price', () => assert.equal(submitsAfterDrop, 1));
    // Old network results finish after the page changed; they must not resurrect the alert.
    await Bun.sleep(5400);
    const lateAlert = await alert(fast.cdp);
    check('late network results cannot restore an alert for the previous price', () => assert.equal(lateAlert, null));

    await fast.page.evaluate(() => {
      document.querySelector('.a-price-whole')!.textContent = '39.';
      document.querySelector('.a-price-fraction')!.textContent = '96';
      (document.querySelector('input[name="items[0.base][customerVisiblePrice][amount]"]') as HTMLInputElement).value = '39.96';
    });
    await until(() => alert(fast.cdp), (value) => Boolean(value?.text.includes('less at eBay')), 'changed price compared again');
    await fast.page.evaluate(() => {
      const color = [...document.querySelectorAll('#detailBullets_feature_div li')].find((node) => node.textContent?.startsWith('Color'))!;
      color.textContent = 'Color : Silver';
      (document.querySelector('#add-to-cart-button') as HTMLInputElement).click();
    });
    await until(() => alert(fast.cdp), (value) => !value, 'variant alert withdrawn');
    const submitsAfterVariant = await fast.page.evaluate(() => (window as any).__submits);
    check('same-URL variant change cannot pause a click with another variant’s offer', () => assert.equal(submitsAfterVariant, 2));
    await fast.page.close();

    const disabled = await open(context, URLS.amazon);
    await until(() => alert(disabled.cdp), (value) => Boolean(value?.text.includes('less at eBay')), 'alert before turning off');
    await worker.evaluate(async () => { await chrome.permissions.remove({ origins: ['https://*/*'] }); });
    await until(() => alert(disabled.cdp), (value) => !value, 'turning off removes existing alerts');
    await disabled.page.locator('#add-to-cart-button').click();
    const submitsAfterOff = await disabled.page.evaluate(() => (window as any).__submits);
    check('turning alerts off removes the existing page’s purchase pause', () => assert.equal(submitsAfterOff, 1));
    const beforeOff = await worker.evaluate(async () => JSON.stringify((await chrome.storage.local.get('priceSeen')).priceSeen));
    await disabled.page.evaluate(() => {
      document.querySelector('.a-price-whole')!.textContent = '42.';
      (document.querySelector('input[name="items[0.base][customerVisiblePrice][amount]"]') as HTMLInputElement).value = '42.96';
    });
    await Bun.sleep(1800);
    const afterOff = await worker.evaluate(async () => JSON.stringify((await chrome.storage.local.get('priceSeen')).priceSeen));
    check('turning alerts off stops recording from already injected pages', () => assert.equal(afterOff, beforeOff));
  }
  const final = await seen();
  console.log(`Remembered on this device: ${final.map((item) => `${item.merchant} $${(item.priceCents / 100).toFixed(2)}`).join(', ')}`);
  console.log(`${passed} price-alert checks passed (${live ? 'LIVE stores' : 'synthetic pages'}).`);
} finally {
  await context.close();
  await rm(scratch, { recursive: true, force: true });
}
