import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Store pages that live checks fetch, parsed exactly as the extension parses them
// (parse-html.ts in a real Chromium DOMParser, no layout). Fixtures are live pages
// fetched without cookies on October 10, 2026, trimmed to the parts Hold reads
// (each file's first comment says where and when). No network is used.
const build = await Bun.build({ entrypoints: [`${import.meta.dir}/../src/parse-html.ts`], target: 'browser', format: 'esm' });
if (!build.success) throw new AggregateError(build.logs, 'Parser bundle failed');
const source = await build.outputs[0]!.text();
const fixture = (name: string) => Bun.file(`${import.meta.dir}/fixtures/${name}.html`).text();

const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
});
const page = await browser.newPage();
await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>parser</title>' }));
await page.goto('https://parser.example.test/');
await page.evaluate(async (source) => {
  (window as any).__parser = await import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
}, source);

type Read = { status: string; reason?: string; product?: { priceCents: number; identity: { condition: string; model: string | null; gtin: string | null } } };
async function read(url: string, html: string, offersHtml?: string): Promise<Read> {
  const reply = await page.evaluate(([url, html, offersHtml]) => (window as any).__parser.parseStoreHtml({ type: 'parse-product', url, html, offersHtml }),
    [url, html, offersHtml] as const);
  assert.equal(reply.ok, true);
  return reply.data;
}
let passed = 0; let failed = 0;
async function check(name: string, action: () => Promise<void>) {
  try { await action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.log(`FAIL ${name}\n  ${(error as Error).message.split('\n').join('\n  ')}`); }
}

const walmartAirPods = 'https://www.walmart.com/ip/Apple-AirPods-4-with-Active-Noise-Cancellation/11384707978';
const walmartLodge = 'https://www.walmart.com/ip/Lodge-Cast-Iron-Seasoned-10-25-Skillet/5969628';
const amazonAirPods = 'https://www.amazon.com/dp/B0DGJ7HYG1';
const amazonLodge = 'https://www.amazon.com/dp/B00006JSUA';
try {
  // Open box read as new: the coverage run's wrong alert on eBay AirPods 4 (product #12).
  await check('Walmart: an open-box buy box is not new, though its record says conditionType "New"', async () => {
    const result = await read(walmartAirPods, await fixture('walmart-airpods4-open-box'));
    assert.equal(result.status, 'product');
    assert.equal(result.product!.priceCents, 9997);
    assert.notEqual(result.product!.identity.condition, 'new');
  });
  await check('Walmart: a new item still reads as new (Lodge L8SK3, $24.90)', async () => {
    const result = await read(walmartLodge, await fixture('walmart-lodge-skillet'));
    assert.equal(result.status, 'product');
    assert.deepEqual([result.product!.priceCents, result.product!.identity.condition, result.product!.identity.model, result.product!.identity.gtin],
      [2490, 'new', 'L8SK3', '00075536300801']);
  });

  // Amazon pages with new and used purchase rows (products #12 and #18).
  await check('Amazon: new $116.99 and used $74.87 rows read as new $116.99 (AirPods 4 ANC)', async () => {
    const result = await read(amazonAirPods, await fixture('amazon-airpods4-new-and-used'));
    assert.equal(result.status, 'product', result.reason);
    assert.deepEqual([result.product!.priceCents, result.product!.identity.condition, result.product!.identity.model], [11699, 'new', 'MXP93LL/A']);
  });
  await check('Amazon: new $24.90 and used $23.16 rows read as new $24.90 (Lodge), without the offer list', async () => {
    const result = await read(amazonLodge, await fixture('amazon-lodge-new-and-used'));
    assert.equal(result.status, 'product', result.reason);
    assert.deepEqual([result.product!.priceCents, result.product!.identity.condition], [2490, 'new']);
  });
  await check('Amazon: the same Lodge page with its offer list (new $24.90 featured) agrees', async () => {
    const result = await read(amazonLodge, await fixture('amazon-lodge-new-and-used'), await fixture('amazon-lodge-offers'));
    assert.equal(result.status, 'product', result.reason);
    assert.deepEqual([result.product!.priceCents, result.product!.identity.condition, result.product!.identity.model], [2490, 'new', 'L8SK3PLT']);
  });
  await check('Amazon: a page that features a used offer ($111.14) reads as used, never new', async () => {
    const result = await read(amazonAirPods, await fixture('amazon-airpods4-used-featured'));
    assert.equal(result.status, 'product');
    assert.deepEqual([result.product!.priceCents, result.product!.identity.condition], [11114, 'used']);
  });
} finally {
  await browser.close();
}
console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
